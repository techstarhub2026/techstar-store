import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handler, ok, created, noContent } from '../lib/http.js';
import { validate, requireAuth } from '../middleware/index.js';
import {
  ConflictError,
  TokenInvalidError,
  UnauthenticatedError,
  ValidationError,
} from '../lib/errors.js';
import {
  REFRESH_COOKIE,
  clearSessionCookie,
  issueSession,
  loadPrincipal,
  publicUser,
  signAccessToken,
} from '../lib/auth.js';
import {
  addDays,
  burnPasswordTime,
  canonicalisePhone,
  cleanName,
  hashPassword,
  newUlid,
  randomToken,
  sha256,
  verifyPassword,
} from '../lib/util.js';

export const authRouter = Router();

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'letmein123', 'welcome123', 'admin12345', 'iloveyou1', 'techstar123',
]);

const passwordField = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), {
    message: 'That password is too common. Choose something less predictable.',
  });

const phoneField = z
  .string()
  .transform((v) => canonicalisePhone(v))
  .refine((v): v is string => Boolean(v), {
    message: 'Enter your number in the form 255XXXXXXXXX',
  });

async function establishSession(userId: number, req: any, res: any) {
  const principal = await loadPrincipal(userId);
  if (!principal) throw new UnauthenticatedError();
  const session = await issueSession(userId, res, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  const accessToken = signAccessToken({
    sub: principal.user.publicId,
    uid: principal.user.id,
    typ: principal.user.accountType === 'staff' ? 'staff' : 'customer',
    roles: principal.roles,
    perms: principal.perms,
    sid: session.id,
  });
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  return {
    accessToken,
    expiresIn: 900,
    user: publicUser(principal.user, principal.roles, principal.perms),
  };
}

// ─────────────────────────────────────────────────────────── register ──

authRouter.post(
  '/register',
  validate({
    body: z
      .object({
        username: z.string().min(2, 'Username is required').max(80).transform(cleanName),
        email: z.string().email('Enter a valid email').max(255).toLowerCase().optional(),
        phone: phoneField.optional(),
        password: passwordField,
        acceptedTerms: z.literal(true, {
          errorMap: () => ({ message: 'Please accept the Terms & Conditions to continue' }),
        }),
        marketingOptIn: z.boolean().default(false),
      })
      .refine((b) => b.email || b.phone, {
        message: 'Enter an email address or a phone number',
        path: ['email'],
      }),
  }),
  handler(async (req, res) => {
    const body = req.body as {
      username: string; email?: string; phone?: string;
      password: string; marketingOptIn: boolean;
    };

    const clash = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          ...(body.email ? [{ email: body.email }] : []),
          ...(body.phone ? [{ phone: body.phone }] : []),
        ],
      },
    });
    if (clash) throw new ConflictError('An account with those details already exists.');

    const user = await prisma.user.create({
      data: {
        publicId: newUlid(),
        username: body.username,
        email: body.email ?? null,
        phone: body.phone ?? null,
        passwordHash: await hashPassword(body.password),
        accountType: 'customer',
        marketingOptIn: body.marketingOptIn,
      },
    });

    // Marketing audience row, carrying consent (spec §11.8.2)
    await prisma.contact.create({
      data: {
        userId: user.id,
        name: user.username,
        email: user.email,
        phone: user.phone,
        source: 'registration',
        emailOptIn: body.marketingOptIn,
        smsOptIn: body.marketingOptIn,
      },
    }).catch(() => undefined);

    if (user.email) {
      const raw = randomToken(32);
      await prisma.emailVerificationToken.create({
        data: { userId: user.id, tokenHash: sha256(raw), expiresAt: addDays(new Date(), 1) },
      });
      console.log(`[mail] verification link for ${user.email}: /auth/verify-email/${raw}`);
    }

    return created(res, await establishSession(user.id, req, res));
  }),
);

// ────────────────────────────────────────────────────────────── login ──

authRouter.post(
  '/login',
  validate({
    body: z.object({
      identifier: z.string().min(3, 'Enter your email or phone number').max(255),
      password: z.string().min(1, 'Password is required'),
    }),
  }),
  handler(async (req, res) => {
    const { identifier, password } = req.body as { identifier: string; password: string };
    const asPhone = canonicalisePhone(identifier);
    const user = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: identifier.toLowerCase() }, ...(asPhone ? [{ phone: asPhone }] : [])],
      },
    });

    const generic = new UnauthenticatedError('Email, phone or password is incorrect');

    if (!user || !user.passwordHash) {
      await burnPasswordTime();
      throw generic;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthenticatedError(`Too many attempts. Please try again in ${mins} minutes.`);
    }
    if (user.status === 'suspended') {
      throw new UnauthenticatedError('This account has been suspended. Please contact support.');
    }

    const good = await verifyPassword(password, user.passwordHash);
    if (!good) {
      const count = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: count,
          lockedUntil: count >= 5 ? new Date(Date.now() + 15 * 60_000) : null,
        },
      });
      throw generic;
    }

    return ok(res, await establishSession(user.id, req, res));
  }),
);

// ──────────────────────────────────────────────────────────── refresh ──

authRouter.post(
  '/refresh',
  handler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthenticatedError('No active session.');

    const session = await prisma.session.findUnique({
      where: { refreshTokenHash: sha256(raw) },
    });
    if (!session) throw new UnauthenticatedError('No active session.');

    // Reuse of a rotated token means it was stolen — revoke the whole family.
    if (session.revokedAt) {
      await prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      clearSessionCookie(res);
      throw new UnauthenticatedError('Session expired. Please sign in again.');
    }
    if (session.expiresAt < new Date()) {
      clearSessionCookie(res);
      throw new UnauthenticatedError('Session expired. Please sign in again.');
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return ok(res, await establishSession(session.userId, req, res));
  }),
);

// ───────────────────────────────────────────────────────────── logout ──

authRouter.post(
  '/logout',
  handler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) {
      await prisma.session.updateMany({
        where: { refreshTokenHash: sha256(raw), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearSessionCookie(res);
    return noContent(res);
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  handler(async (req, res) => {
    await prisma.session.updateMany({
      where: { userId: req.auth!.uid, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    clearSessionCookie(res);
    return noContent(res);
  }),
);

// ─────────────────────────────────────────── email verification flow ──

authRouter.post(
  '/email/verify/request',
  requireAuth,
  handler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.uid } });
    if (!user?.email) throw new ValidationError([
      { field: 'email', code: 'missing', message: 'Add an email address to your account first.' },
    ]);
    if (user.emailVerifiedAt) return ok(res, { alreadyVerified: true });

    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const raw = randomToken(32);
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: sha256(raw), expiresAt: addDays(new Date(), 1) },
    });
    console.log(`[mail] verification link for ${user.email}: /auth/verify-email/${raw}`);
    return ok(res, { sent: true });
  }),
);

authRouter.post(
  '/email/verify',
  validate({ body: z.object({ token: z.string().min(10) }) }),
  handler(async (req, res) => {
    const { token } = req.body as { token: string };
    const row = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new TokenInvalidError();

    await prisma.$transaction([
      prisma.emailVerificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
    return ok(res, { verified: true });
  }),
);

// ────────────────────────────────────────────────── password recovery ──

authRouter.post(
  '/password/forgot',
  validate({ body: z.object({ email: z.string().email().toLowerCase() }) }),
  handler(async (req, res) => {
    const { email } = req.body as { email: string };
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (user) {
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      const raw = randomToken(32);
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(raw),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      });
      console.log(`[mail] password reset for ${email}: /auth/reset-password/${raw}`);
    }
    // Always the same response, whether or not the address exists.
    return ok(res, {
      message: 'If an account exists for that address, we have sent a reset link.',
    });
  }),
);

authRouter.post(
  '/password/reset',
  validate({ body: z.object({ token: z.string().min(10), password: passwordField }) }),
  handler(async (req, res) => {
    const { token, password } = req.body as { token: string; password: string };
    const row = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new TokenInvalidError();

    await prisma.$transaction([
      prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null },
      }),
      prisma.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return ok(res, await establishSession(row.userId, req, res));
  }),
);

authRouter.patch(
  '/password',
  requireAuth,
  validate({
    body: z.object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: passwordField,
    }),
  }),
  handler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string; newPassword: string;
    };
    const user = await prisma.user.findUnique({ where: { id: req.auth!.uid } });
    if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ValidationError([
        { field: 'currentPassword', code: 'invalid', message: 'That password is not correct' },
      ]);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: req.auth!.sid } },
      data: { revokedAt: new Date() },
    });
    return ok(res, { changed: true });
  }),
);
