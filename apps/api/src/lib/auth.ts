import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { config } from '../config/index.js';
import { prisma } from './prisma.js';
import { addDays, randomToken, sha256 } from './util.js';

export const REFRESH_COOKIE = 'ts_rt';
export const GUEST_COOKIE = 'ts_guest';

export interface AccessClaims {
  sub: string; // user publicId
  uid: number; // internal id — never leaves the server in a response body
  typ: 'customer' | 'staff';
  roles: string[];
  perms: string[];
  sid: number;
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    return jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessClaims;
  } catch {
    return null;
  }
}

/**
 * Issues a rotating refresh token. The raw value goes to an httpOnly cookie and
 * is never stored; only its SHA-256 hash is persisted (spec §11.2).
 */
export async function issueSession(
  userId: number,
  res: Response,
  meta: { userAgent?: string; ip?: string } = {},
  replacesSessionId?: number,
) {
  const raw = randomToken(32);
  const expiresAt = addDays(new Date(), config.REFRESH_TOKEN_TTL_DAYS);
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: sha256(raw),
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      ipAddress: meta.ip?.slice(0, 45) ?? null,
      expiresAt,
      replacedById: replacesSessionId ?? null,
    },
  });

  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });

  return session;
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}

/** Loads a user with the role and permission keys the access token carries. */
export async function loadPrincipal(userId: number) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      profileImage: true,
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!user) return null;

  const roles = user.roles.map((r) => r.role.key);
  const perms = Array.from(
    new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))),
  );
  return { user, roles, perms };
}

/** The user shape returned to the client. Never includes the password hash. */
export function publicUser(
  user: {
    publicId: string;
    username: string;
    email: string | null;
    emailVerifiedAt: Date | null;
    phone: string | null;
    accountType: string;
    status: string;
    marketingOptIn: boolean;
    profileImage?: { urlSm: string; urlMd: string; urlLg: string } | null;
  },
  roles: string[] = [],
  perms: string[] = [],
) {
  return {
    id: user.publicId,
    username: user.username,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    phone: user.phone,
    accountType: user.accountType,
    status: user.status,
    marketingOptIn: user.marketingOptIn,
    profileImage: user.profileImage
      ? { sm: user.profileImage.urlSm, md: user.profileImage.urlMd, lg: user.profileImage.urlLg }
      : null,
    roles,
    permissions: perms,
  };
}
