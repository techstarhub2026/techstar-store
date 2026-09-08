import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { ulid } from 'ulid';
import { config } from '../config/index.js';
import { AppError, ForbiddenError, UnauthenticatedError, ValidationError } from '../lib/errors.js';
import { verifyAccessToken, type AccessClaims } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AccessClaims;
    }
  }
}

// ─────────────────────────────────────────────────────── request id ──

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = ulid();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

// ────────────────────────────────────────────────────────── logging ──

export function requestLog(req: Request, res: Response, next: NextFunction) {
  if (config.LOG_LEVEL === 'error') return next();
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    if (res.statusCode >= 500 || (config.LOG_LEVEL === 'debug' && true) || ms > 1000) {
      console.log(
        `${res.statusCode} ${req.method} ${req.originalUrl} ${ms}ms req=${req.requestId}`,
      );
    } else if (config.LOG_LEVEL === 'info' && res.statusCode >= 400) {
      console.log(`${res.statusCode} ${req.method} ${req.originalUrl} ${ms}ms`);
    }
  });
  next();
}

// ─────────────────────────────────────────────────── authentication ──

/**
 * Populates req.auth when a valid bearer token is present. Never rejects —
 * absence of a token is a legitimate state for public routes (spec §4.3).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const claims = verifyAccessToken(header.slice(7).trim());
    if (claims) req.auth = claims;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new UnauthenticatedError());
  next();
}

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new UnauthenticatedError());
  if (req.auth.typ !== 'staff') return next(new ForbiddenError());
  next();
}

export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new UnauthenticatedError());
    if (req.auth.typ !== 'staff') return next(new ForbiddenError());
    const held = new Set(req.auth.perms);
    if (held.has('*')) return next();
    if (keys.some((k) => held.has(k))) return next();
    next(new ForbiddenError(`This action needs the "${keys[0]}" permission.`));
  };
}

// ─────────────────────────────────────────────────────── validation ──

type Part = 'body' | 'query' | 'params';

/**
 * Parses and REPLACES the request part with the typed result, so a handler can
 * never read unvalidated input (spec §11.6).
 */
export function validate(schemas: Partial<Record<Part, ZodSchema>>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      for (const part of ['params', 'query', 'body'] as Part[]) {
        const schema = schemas[part];
        if (!schema) continue;
        const parsed = schema.parse(req[part]);
        if (part === 'query') {
          // Express 4 exposes req.query via a getter on some versions
          Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
        } else {
          (req as unknown as Record<Part, unknown>)[part] = parsed;
        }
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(
          new ValidationError(
            err.issues.map((i) => ({
              field: i.path.join('.') || undefined,
              code: i.code,
              message: i.message,
            })),
          ),
        );
      }
      next(err);
    }
  };
}

// ───────────────────────────────────────────────────────────── 404 ──

export function notFound(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      requestId: req.requestId,
    },
  });
}

// ───────────────────────────────────────────────────── error handler ──

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.httpStatus).json({
      error: {
        code: err.code,
        message: err.message,
        requestId: req.requestId,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // Prisma unique-constraint violation
  const anyErr = err as { code?: string; meta?: { target?: string[] }; message?: string };
  if (anyErr?.code === 'P2002') {
    const field = anyErr.meta?.target?.[0];
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: field
          ? `That ${field} is already in use.`
          : 'That value is already in use.',
        requestId: req.requestId,
      },
    });
  }
  if (anyErr?.code === 'P2025') {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Resource not found.', requestId: req.requestId },
    });
  }
  if (anyErr?.code === 'P2003') {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'That record is still referenced by other data and cannot be removed.',
        requestId: req.requestId,
      },
    });
  }

  console.error(`[${req.requestId}] Unhandled error on ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong at our end.',
      requestId: req.requestId,
      ...(config.isProd ? {} : { debug: String((err as Error)?.message ?? err) }),
    },
  });
}

// ─────────────────────────────────────────────────────────── audit ──

export async function audit(
  req: Request,
  entry: {
    action: string;
    entityType: string;
    entityId?: number | null;
    entityLabel?: string | null;
    before?: unknown;
    after?: unknown;
  },
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: req.auth?.uid ?? null,
        actorEmail: null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        entityLabel: entry.entityLabel?.slice(0, 255) ?? null,
        before: entry.before ? JSON.stringify(entry.before).slice(0, 60_000) : null,
        after: entry.after ? JSON.stringify(entry.after).slice(0, 60_000) : null,
        ipAddress: req.ip?.slice(0, 45) ?? null,
        requestId: req.requestId,
      },
    });
  } catch (e) {
    console.error('audit write failed', e);
  }
}
