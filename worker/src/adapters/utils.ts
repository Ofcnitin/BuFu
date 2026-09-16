import { throttle } from './adapters/ratelimit';

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });
}

export async function body(request: Request): Promise<any> {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const uuid = () => crypto.randomUUID();
export const normalizeKey = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
export const slugify = (value: string) => normalizeKey(value).replace(/ /g, '-').slice(0, 120) || 'untitled';
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export async function passwordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export function corsHeaders(request: Request, env: { ALLOWED_ORIGINS?: string }): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  // Fail closed: an origin not on the allow-list gets no
  // Access-Control-Allow-Origin header at all, not another origin's value.
  // Browsers already reject a mismatched header before exposing the
  // response to JS, so this was never actually exploitable — but returning
  // allowed[0] for a disallowed origin was misleading about what's
  // actually being permitted, and made this function lie about its own
  // intent if anything downstream ever came to depend on that fallback.
  const allowOrigin = allowed.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export function withCors(request: Request, env: { ALLOWED_ORIGINS?: string }, res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) if (v) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export class ProviderError extends Error {
  status?: number;
  retryAfterMs?: number;
  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * fetchJson: throttled (per rateLimitKey), timed out, and honors 429 /
 * Retry-After exactly once (a single bounded retry — never a silent retry
 * loop that could itself look like abuse to the provider). A required
 * User-Agent is always sent since MangaDex explicitly requires one and it's
 * good practice for the others.
 */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
  rateLimitKey?: string,
): Promise<any> {
  if (rateLimitKey) await throttle(rateLimitKey);
  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { 'User-Agent': 'BUFU/1.0 (+https://ofcnitin.github.io/BuFu/)', ...(init.headers || {}) },
      });
    } finally {
      clearTimeout(t);
    }
  };
  let res: Response;
  try {
    res = await attempt();
  } catch (e: any) {
    throw new ProviderError(e?.name === 'AbortError' ? 'timeout' : 'network error');
  }
  if (res.status === 429) {
    const retryAfterHeader = res.headers.get('Retry-After') || res.headers.get('X-RateLimit-Retry-After');
    const retryAfterMs = retryAfterHeader ? Math.min(Number(retryAfterHeader) * 1000 || 1500, 5000) : 1500;
    await new Promise(r => setTimeout(r, retryAfterMs));
    if (rateLimitKey) await throttle(rateLimitKey);
    try {
      res = await attempt();
    } catch (e: any) {
      throw new ProviderError(e?.name === 'AbortError' ? 'timeout' : 'network error');
    }
    if (res.status === 429) throw new ProviderError('rate limited', 429, retryAfterMs);
  }
  if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, res.status);
  return res.json();
}

/** Runs an async fn with its own timeout, for per-provider deadlines inside a fan-out. */
export function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    p.then(v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } })
     .catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } });
  });
}

/** Thrown by withDeadlineOrThrow when the deadline elapses, so callers can
 *  tell "ran out of time" apart from any other rejection if they need to. */
export class ProviderTimeoutError extends Error {
  constructor(message = 'provider deadline exceeded') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

/**
 * Like withDeadline, but for callers (e.g. callWithHealth in orchestrator.ts)
 * that need to tell a timeout or a provider error apart from a genuine
 * successful response — including one that legitimately resolves to an
 * empty array. withDeadline's fallback-on-timeout-or-rejection design can't
 * make that distinction when the fallback and a real success share the same
 * shape (e.g. `[]`): both timeout and success-with-nothing come out
 * identical. This never swallows a timeout or a rejection into a resolved
 * value — it rejects instead (with ProviderTimeoutError on timeout, or the
 * original error otherwise) and leaves choosing a fallback to the caller.
 */
export function withDeadlineOrThrow<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new ProviderTimeoutError()); }
    }, ms);
    p.then(v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } })
     .catch(e => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}
