import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import { config } from '../config/index.js';

// ───────────────────────────────────────────────────────────── ids ──

export const newUlid = () => ulid();

export const randomToken = (bytes = 24) =>
  crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

export const shortHash = (value: string) =>
  crypto.createHash('sha1').update(value).digest('hex').slice(0, 40);

// ─────────────────────────────────────────────────────── passwords ──

export const hashPassword = (plain: string) => bcrypt.hash(plain, 11);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** A dummy verify so an unknown identifier costs the same time as a wrong password. */
const DUMMY_HASH = '$2a$11$N9qo8uLOickgx2ZMRZoMy.MH/rBS5rr9O2M7dK2t8YmZ5r0YkJ7O2';
export const burnPasswordTime = () => bcrypt.compare('x', DUMMY_HASH).then(() => false);

// ─────────────────────────────────────────────────────────── money ──

/** Money is stored and moved as integer minor units (whole TZS). */
export interface Money {
  amount: number;
  currency: string;
  formatted: string;
}

const nf = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: config.currencyFractionDigits,
});

export const money = (amount: number, currency = config.currency): Money => ({
  amount: Math.round(amount),
  currency,
  formatted: `${currency} ${nf.format(Math.round(amount))}`,
});

// ──────────────────────────────────────────────────────────── text ──

/** Trim and collapse internal whitespace — the fix for the dirty product names
 *  observed in the reference platform's data (spec defect R2). */
export const cleanName = (value: string) => value.replace(/\s+/g, ' ').trim();

export const slugify = (value: string, max = 80) => {
  const base = value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (base.length <= max) return base || 'item';
  const cut = base.slice(0, max);
  const at = cut.lastIndexOf('-');
  return (at > 20 ? cut.slice(0, at) : cut) || 'item';
};

export const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Allow-list HTML sanitiser for admin-authored rich text. Applied on write and
 * again on render (spec §11.6) — sanitising in one place only is how stored
 * XSS happens.
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'h2', 'h3', 'h4', 'a', 'blockquote', 'code', 'pre', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'img',
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  // No `onerror`/event-handler attributes reach here regardless (stripped
  // above before tags are parsed at all); `src` is still checked against the
  // same javascript:/data:/vbscript: denylist as `href` so this cannot be
  // used to smuggle a script URI either.
  img: new Set(['src', 'alt', 'width', 'height']),
};

export function sanitizeHtml(input: string): string {
  if (!input) return '';
  // A blanket `.replace(/javascript:/gi, '')` used to run here as a second
  // net under the per-attribute check below. It did the opposite of what it
  // looked like: for `href="javascript:alert(1)"` it deleted only the
  // scheme, in place, before the attribute-level check ever ran — so what
  // reached that check was already the harmless-looking `href="alert(1)"`,
  // which the javascript:/data:/vbscript: test downstream no longer matched
  // and therefore kept. `href`/`src="alert(1)"` cannot execute (no browser
  // resolves that as anything but a broken relative URL), so this was never
  // an active hole, but the value that survived was neither the author's
  // original nor a value the check believed it had rejected — dropping the
  // pass here means the one check downstream, which sees the real
  // pre-mangled value and drops the whole attribute on a match, is the only
  // one doing this job.
  let out = input
    .replace(/<\s*(script|style|iframe|object|embed|form|input|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|link|meta)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  out = out.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (_m, close, tag, attrs) => {
    const name = String(tag).toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (close) return `</${name}>`;
    const allowed = ALLOWED_ATTRS[name];
    if (!allowed) return `<${name}>`;
    const kept: string[] = [];
    const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(attrs)))) {
      const attr = m[1].toLowerCase();
      const value = m[3] ?? m[4] ?? '';
      if (!allowed.has(attr)) continue;
      if ((attr === 'href' || attr === 'src') && /^(javascript|data|vbscript):/i.test(value.trim())) continue;
      if ((attr === 'width' || attr === 'height') && !/^\d+(%|px)?$/.test(value.trim())) continue;
      kept.push(`${attr}="${value.replace(/"/g, '&quot;')}"`);
    }
    if (name === 'a') kept.push('rel="noopener noreferrer"');
    if (name === 'img' && !kept.some((k) => k.startsWith('src='))) return '';
    return `<${name}${kept.length ? ' ' + kept.join(' ') : ''}>`;
  });

  return out.trim();
}

// ─────────────────────────────────────────────────────────── phone ──

/**
 * Canonicalise a Tanzanian number to 255XXXXXXXXX. Accepts +255…, 0…, 255…
 * and bare 9-digit forms. Returns null when it cannot be made valid.
 */
export function canonicalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D/g, '');
  if (d.startsWith('255')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  if (d.length !== 9) return null;
  return `255${d}`;
}

export const isValidPhone = (input: string) => canonicalisePhone(input) !== null;

// ───────────────────────────────────────────────────────────── sku ──

/** Pads a sequence into the fixed-width segment used by the SKU scheme (§12.1). */
export const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** Stable hash of a variant's complete attribute value set, for uniqueness. */
export const attributeHash = (pairs: { name: string; value: string }[]) =>
  shortHash(
    pairs
      .map((p) => `${p.name.toLowerCase().trim()}=${p.value.toLowerCase().trim()}`)
      .sort()
      .join('|') || 'default',
  );

// ────────────────────────────────────────────────────────── numbers ──

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const toInt = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

// ───────────────────────────────────────────────────────────── time ──

export const addDays = (d: Date, days: number) =>
  new Date(d.getTime() + days * 86_400_000);
export const addHours = (d: Date, hours: number) =>
  new Date(d.getTime() + hours * 3_600_000);
