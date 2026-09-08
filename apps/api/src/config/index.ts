import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const API_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(API_ROOT, '..', '..');

// The workspace keeps one .env at the repository root; an app-local .env
// overrides it when present.
for (const file of [path.join(REPO_ROOT, '.env'), path.join(API_ROOT, '.env')]) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override: true });
}

/**
 * Configuration is parsed once, here, and nowhere else reads process.env.
 * A missing or malformed variable stops the process at boot with a message
 * naming it — never a runtime `undefined` three hours later. (Spec §20.7)
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('TechStar Store'),
  APP_URL: z.string().default('http://localhost:5173'),
  // The techstarhub.or.tz marketing site is served separately but reads this
  // API for its home page content and product teaser, so it needs to be an
  // allowed origin in production too — not just in the permissive dev mode.
  SITE_URL: z.string().default('http://localhost:8000'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  MEDIA_ROOT: z.string().default('./uploads'),
  // Absolute or API-relative path to the built SPA. Unset in development,
  // where Vite serves the frontend and proxies /api here instead.
  SPA_ROOT: z.string().optional(),
  MEDIA_PUBLIC_URL: z.string().default('http://localhost:4000/media'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM_NAME: z.string().default('TechStar Store'),
  MAIL_FROM_ADDRESS: z.string().default('orders@techstar.co.tz'),

  SMS_PROVIDER: z.enum(['console', 'beem', 'nextsms']).default('console'),
  SMS_API_KEY: z.string().optional(),
  SMS_API_SECRET: z.string().optional(),
  SMS_SENDER_ID: z.string().default('TECHSTAR'),

  RESERVATION_HOURS: z.coerce.number().int().positive().default(48),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
  console.error(`\nConfiguration error — the API cannot start:\n${lines.join('\n')}\n`);
  process.exit(1);
}

const env = parsed.data;

export const config = Object.freeze({
  ...env,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  mediaRoot: path.isAbsolute(env.MEDIA_ROOT)
    ? env.MEDIA_ROOT
    : path.resolve(API_ROOT, env.MEDIA_ROOT),
  SPA_ROOT: env.SPA_ROOT
    ? path.isAbsolute(env.SPA_ROOT)
      ? env.SPA_ROOT
      : path.resolve(API_ROOT, env.SPA_ROOT)
    : undefined,
  maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  currency: 'TZS',
  currencyFractionDigits: 0,
  timezone: 'Africa/Dar_es_Salaam',
});

export type Config = typeof config;
