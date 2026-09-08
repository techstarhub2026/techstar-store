/**
 * One API client. Handles the access-token header, a single queued refresh on
 * 401, and typed errors. The access token is held in memory only — never in
 * localStorage (spec §11.2).
 */

const BASE = '/api/v1';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onUnauthorised: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const setUnauthorisedHandler = (fn: () => void) => {
  onUnauthorised = fn;
};

export interface ApiErrorDetail {
  field?: string;
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: ApiErrorDetail[];
  requestId?: string;

  constructor(status: number, body: any) {
    const err = body?.error ?? {};
    super(err.message ?? 'Something went wrong.');
    this.name = 'ApiError';
    this.status = status;
    this.code = err.code ?? 'UNKNOWN';
    this.details = err.details;
    this.requestId = err.requestId;
  }

  /** Field errors keyed by field name, for wiring straight into a form. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details ?? []) {
      if (d.field) out[d.field] = d.message;
    }
    return out;
  }
}

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return false;
        const body = await res.json();
        accessToken = body?.data?.accessToken ?? null;
        return Boolean(accessToken);
      } catch {
        return false;
      } finally {
        setTimeout(() => {
          refreshing = null;
        }, 0);
      }
    })();
  }
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  retry?: boolean;
  raw?: boolean;
}

export async function request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, retry = true, raw = false } = opts;

  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: isForm ? (body as FormData) : body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && retry) {
    const ok = await refreshSession();
    if (ok) return request<T>(path, { ...opts, retry: false });
    accessToken = null;
    onUnauthorised?.();
  }

  if (res.status === 204) return undefined as T;

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) throw new ApiError(res.status, payload);
  return raw ? (payload as T) : ((payload?.data ?? payload) as T);
}

export const api = {
  get: <T = any>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { headers }),
  raw: <T = any>(path: string) => request<T>(path, { raw: true }),
  post: <T = any>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body, headers }),
  patch: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
  refresh: refreshSession,
};

/** Builds a query string, omitting empty values so defaults stay out of the URL. */
export function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
