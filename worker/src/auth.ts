import type { Env } from './types';
import { json, nowIso, passwordHash, uuid } from './utils';

const tokenDigest = async (token: string) => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
};
const salt = () => crypto.randomUUID() + crypto.randomUUID();
const sessionToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
};

// Constant-time string compare — used for anything derived from a secret
// (password hash, session-token digest) so a network timing side-channel
// can't leak how many leading bytes matched. Deliberately walks the full
// length of the longer string even on a length mismatch, rather than
// short-circuiting, so length itself isn't a distinguishable timing signal.
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ── Abuse protection ─────────────────────────────────────────────────────
// D1-backed (durable across isolate recycling), not in-memory. One row per
// (kind, ip, 10-minute bucket); a request is rejected once the bucket's
// count reaches the limit for the remainder of that window.
const WINDOW_MS = 10 * 60 * 1000;
const LIMITS: Record<'login' | 'register' | 'discovery', number> = { login: 10, register: 5, discovery: 120 };

export async function checkRateLimit(env: Env, kind: 'login' | 'register' | 'discovery', ip: string): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  const bucketKey = `${kind}:${ip}:${windowStart}`;
  // Atomic increment-then-check: a plain SELECT-then-INSERT here would let
  // two concurrent requests both read the same under-limit count before
  // either write landed, letting a short burst slip past the limit. The
  // UPSERT's increment and the count it returns happen as one D1
  // statement, so there's no window between "read count" and "commit
  // increment" for a racing request to land in.
  const row = await env.DB.prepare(
    `INSERT INTO auth_attempts(bucket_key,count,window_start) VALUES(?,1,?)
     ON CONFLICT(bucket_key) DO UPDATE SET count=count+1
     RETURNING count`
  ).bind(bucketKey, new Date(windowStart).toISOString()).first<{ count: number }>();
  return (row?.count ?? 1) <= LIMITS[kind];
}

export async function register(env: Env, body: any) {
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const name = String(body?.displayName || email.split('@')[0] || 'Reader').trim().slice(0, 60) || 'Reader';
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 200) {
    return json({ error: 'Use a valid email and a password of at least 8 characters' }, { status: 400 });
  }
  const exists = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if (exists) return json({ error: 'Account already exists' }, { status: 409 });
  const s = salt(), hash = await passwordHash(password, s), id = uuid();
  await env.DB.prepare('INSERT INTO users(id,email,password_hash,password_salt,display_name) VALUES(?,?,?,?,?)').bind(id, email, hash, s, name).run();
  return createSession(env, id, { id, email, displayName: name });
}

export async function login(env: Env, body: any) {
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  // Generic "Invalid credentials" for both a missing account and a wrong
  // password — never reveals whether an email is registered.
  const u = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first<any>();
  if (!u) return json({ error: 'Invalid credentials' }, { status: 401 });
  const hash = await passwordHash(password, u.password_salt);
  if (!timingSafeEqual(hash, u.password_hash)) return json({ error: 'Invalid credentials' }, { status: 401 });
  return createSession(env, u.id, { id: u.id, email: u.email, displayName: u.display_name });
}

async function createSession(env: Env, userId: string, user: any) {
  const token = sessionToken();
  const digest = await tokenDigest(token);
  const exp = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(digest, userId, exp).run();
  return json({ user, token, expiresAt: exp });
}

export async function currentUser(env: Env, request: Request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const digest = await tokenDigest(token);
  const row = await env.DB.prepare(
    'SELECT u.id,u.email,u.display_name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?'
  ).bind(digest).first<any>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest).run();
    return null;
  }
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export async function logout(env: Env, request: Request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const digest = await tokenDigest(auth.slice(7).trim());
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest).run();
  }
  return json({ ok: true });
}

/** Opportunistic cleanup, called from the cron handler — keeps the sessions
 *  and auth_attempts tables from growing unbounded. */
export async function pruneExpired(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()).run();
  const cutoff = new Date(Date.now() - WINDOW_MS * 3).toISOString();
  await env.DB.prepare('DELETE FROM auth_attempts WHERE window_start < ?').bind(cutoff).run();
}
