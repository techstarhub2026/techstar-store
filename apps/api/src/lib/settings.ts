import { prisma } from './prisma.js';

/**
 * Site settings are a typed key–value store read through a short-lived cache.
 * Payment till numbers and instruction blocks live here rather than in code,
 * so correcting a wrong USSD step takes two minutes and not a release
 * (spec §14.16).
 */
let cache: Record<string, string> | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

export async function getSettings(force = false): Promise<Record<string, string>> {
  if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;
  const rows = await prisma.siteSetting.findMany();
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cachedAt = Date.now();
  return cache;
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const all = await getSettings();
  return all[key] ?? fallback;
}

export async function setSettings(
  entries: Record<string, string>,
  group = 'general',
): Promise<void> {
  for (const [key, value] of Object.entries(entries)) {
    await prisma.siteSetting.upsert({
      where: { key },
      create: { key, value: String(value ?? ''), group },
      update: { value: String(value ?? '') },
    });
  }
  cache = null;
}

export function invalidateSettings() {
  cache = null;
}

// ───────────────────────────────────────────────────────── secrets ──

/**
 * Integration credentials live in the same key–value store as everything else,
 * but must never travel back to the browser in the clear: an admin session
 * that leaks would otherwise hand over the store's payment and SMS keys.
 *
 * A key is a secret if its last segment says so. Reads return a mask that
 * shows only the last four characters (enough to tell two keys apart);
 * writes that send the mask back unchanged are ignored, so saving a form
 * the operator never touched cannot overwrite a real key with dots.
 */
const SECRET_SEGMENTS = ['secret', 'apikey', 'password', 'token', 'privatekey', 'passkey'];

export const SECRET_MASK = '••••••••';

export function isSecretKey(key: string): boolean {
  const last = key.split('.').pop()?.toLowerCase() ?? '';
  return SECRET_SEGMENTS.some((s) => last.includes(s));
}

export function maskSecret(value: string): string {
  if (!value) return '';
  const tail = value.length > 4 ? value.slice(-4) : '';
  return `${SECRET_MASK}${tail}`;
}

export function isMaskedValue(value: string): boolean {
  return value.startsWith(SECRET_MASK);
}

/** A copy of the settings map safe to send to an admin client. */
export function maskSettings(all: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(all).map(([k, v]) => [k, isSecretKey(k) ? maskSecret(v) : v]),
  );
}

/** Drops masked secret values so an untouched field keeps its stored key. */
export function stripUnchangedSecrets(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter(([k, v]) => !(isSecretKey(k) && isMaskedValue(v))),
  );
}
