import './adapters/mangadex';
import './adapters/anilist';
import './adapters/jikan';
import './adapters/kitsu';
import './adapters/mangaupdates';
import './adapters/shiro';
// aggregators.ts is intentionally NOT imported — it registers nothing and
// exists only as a documented, disabled placeholder. See that file.

import { checkRateLimit, currentUser, login, logout, pruneExpired, register } from './auth';
import { getChapters, getPages, getTitleById, probeAllSourceHealth, recommendations, resolveLatestChapterId, searchAll } from './orchestrator';
import { sourceList } from './adapters/registry';
import type { Env } from './types';
import { body, json, nowIso, withCors } from './utils';

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return withCors(request, env, new Response(null, { status: 204 }));

  // ── Auth ────────────────────────────────────────────────────────────
  if (path === '/api/auth/register' && method === 'POST') {
    if (!(await checkRateLimit(env, 'register', clientIp(request)))) return withCors(request, env, json({ error: 'Too many attempts. Try again later.' }, { status: 429 }));
    return withCors(request, env, await register(env, await body(request)));
  }
  if (path === '/api/auth/login' && method === 'POST') {
    if (!(await checkRateLimit(env, 'login', clientIp(request)))) return withCors(request, env, json({ error: 'Too many attempts. Try again later.' }, { status: 429 }));
    return withCors(request, env, await login(env, await body(request)));
  }
  if (path === '/api/auth/logout' && method === 'POST') return withCors(request, env, await logout(env, request));
  if (path === '/api/auth/me' && method === 'GET') {
    const user = await currentUser(env, request);
    return withCors(request, env, json({ user }));
  }

  const user = await currentUser(env, request);
  const requireUser = () => user ? null : withCors(request, env, json({ error: 'Unauthorized' }, { status: 401 }));

  // ── Discovery ───────────────────────────────────────────────────────
  if (path === '/api/search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
    if (!q) return withCors(request, env, json({ results: [] }));
    const results = await searchAll(env, q);
    return withCors(request, env, json({ results }));
  }
  if (path === '/api/recommendations' && method === 'GET') {
    const category = (url.searchParams.get('category') || 'action').trim().slice(0, 40);
    const results = await recommendations(env, category);
    return withCors(request, env, json({ results }));
  }
  if (path === '/api/health' && method === 'GET') {
    // Public: intentionally minimal. No source ids, roles, production
    // flags, circuit state, or latency — that's internal architecture and
    // configuration, not something an anonymous caller needs. A DB round
    // trip is still done so this genuinely reflects "can BUFU reach its
    // database", not just "is the Worker running".
    try {
      await env.DB.prepare('SELECT 1').first();
      return withCors(request, env, json({ status: 'ok' }));
    } catch {
      return withCors(request, env, json({ status: 'degraded' }, { status: 503 }));
    }
  }
  // Protected diagnostics: the same per-source detail the old public
  // /api/health exposed, now gated behind a signed-in session. BUFU has no
  // separate admin role, so "signed in" is the closest real gate available;
  // documented here rather than left unexplained. Never expose secrets or
  // provider base URLs, even to a signed-in user.
  if (path === '/api/admin/health' && method === 'GET') {
    const unauth = requireUser(); if (unauth) return unauth;
    const rows = await env.DB.prepare('SELECT source_id,ok,consecutive_failures,circuit_open_until,checked_at FROM source_health').all();
    return withCors(request, env, json({ sources: rows.results || [], registered: sourceList.map(a => ({ id: a.id, name: a.name, role: a.role, production: a.production })) }));
  }

  // ── Titles — specific routes registered before the generic one ──────
  const pagesMatch = path.match(/^\/api\/title\/([^/]+)\/chapter\/([^/]+)\/pages$/);
  if (pagesMatch && method === 'GET') {
    const titleId = decodeURIComponent(pagesMatch[1]);
    let chapterId = decodeURIComponent(pagesMatch[2]);
    const title = await getTitleById(env, titleId);
    if (!title) return withCors(request, env, json({ error: 'Title not found' }, { status: 404 }));
    if (chapterId === 'latest') {
      const resolved = await resolveLatestChapterId(env, titleId);
      if (!resolved) return withCors(request, env, json({ error: 'No chapters available for this title' }, { status: 404 }));
      chapterId = resolved;
    }
    const pages = await getPages(env, titleId, chapterId);
    if (pages === null) return withCors(request, env, json({ error: 'Chapter not found or no source could serve it' }, { status: 404 }));
    return withCors(request, env, json({ pages }));
  }
  const chaptersMatch = path.match(/^\/api\/title\/([^/]+)\/chapters$/);
  if (chaptersMatch && method === 'GET') {
    const titleId = decodeURIComponent(chaptersMatch[1]);
    const title = await getTitleById(env, titleId);
    if (!title) return withCors(request, env, json({ error: 'Title not found' }, { status: 404 }));
    const chapters = await getChapters(env, titleId);
    return withCors(request, env, json({ chapters }));
  }
  const titleMatch = path.match(/^\/api\/title\/([^/]+)$/);
  if (titleMatch && method === 'GET') {
    const titleId = decodeURIComponent(titleMatch[1]);
    const title = await getTitleById(env, titleId);
    if (!title) return withCors(request, env, json({ error: 'Title not found' }, { status: 404 }));
    return withCors(request, env, json({ title }));
  }

  // ── Authenticated: library / bookmarks / history / progress / updates ─
  if (path === '/api/me/library') {
    const unauth = requireUser(); if (unauth) return unauth;
    if (method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT l.title_id,l.status,l.last_seen_chapter_number,l.added_at,l.updated_at,
                t.title,t.cover_url,t.type,t.status as title_status,t.latest_known_chapter_number
         FROM library l JOIN titles t ON t.id=l.title_id WHERE l.user_id=? ORDER BY l.updated_at DESC`
      ).bind(user!.id).all();
      return withCors(request, env, json({ items: rows.results || [] }));
    }
    if (method === 'PUT') {
      const b = await body(request);
      const titleId = String(b.titleId || '');
      const status = String(b.status || 'reading');
      if (!titleId) return withCors(request, env, json({ error: 'titleId required' }, { status: 400 }));
      const exists = await env.DB.prepare('SELECT id FROM titles WHERE id=?').bind(titleId).first();
      if (!exists) return withCors(request, env, json({ error: 'Title not found' }, { status: 404 }));
      await env.DB.prepare(
        `INSERT INTO library(user_id,title_id,status,added_at,updated_at) VALUES(?,?,?,?,?)
         ON CONFLICT(user_id,title_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`
      ).bind(user!.id, titleId, status, nowIso(), nowIso()).run();
      return withCors(request, env, json({ ok: true }));
    }
    if (method === 'DELETE') {
      const titleId = url.searchParams.get('titleId') || '';
      if (!titleId) return withCors(request, env, json({ error: 'titleId required' }, { status: 400 }));
      await env.DB.prepare('DELETE FROM library WHERE user_id=? AND title_id=?').bind(user!.id, titleId).run();
      return withCors(request, env, json({ ok: true }));
    }
  }
  if (path === '/api/me/bookmarks') {
    const unauth = requireUser(); if (unauth) return unauth;
    if (method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT b.title_id,b.created_at,t.title,t.cover_url,t.type FROM bookmarks b JOIN titles t ON t.id=b.title_id WHERE b.user_id=? ORDER BY b.created_at DESC`
      ).bind(user!.id).all();
      return withCors(request, env, json({ items: rows.results || [] }));
    }
    if (method === 'PUT') {
      const b = await body(request);
      const titleId = String(b.titleId || '');
      if (!titleId) return withCors(request, env, json({ error: 'titleId required' }, { status: 400 }));
      if (b.remove) {
        await env.DB.prepare('DELETE FROM bookmarks WHERE user_id=? AND title_id=?').bind(user!.id, titleId).run();
      } else {
        const exists = await env.DB.prepare('SELECT id FROM titles WHERE id=?').bind(titleId).first();
        if (!exists) return withCors(request, env, json({ error: 'Title not found' }, { status: 404 }));
        await env.DB.prepare('INSERT OR IGNORE INTO bookmarks(user_id,title_id,created_at) VALUES(?,?,?)').bind(user!.id, titleId, nowIso()).run();
      }
      return withCors(request, env, json({ ok: true }));
    }
  }
  if (path === '/api/me/history') {
    const unauth = requireUser(); if (unauth) return unauth;
    if (method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT h.title_id,h.chapter_id,h.updated_at,t.title,t.cover_url,t.type FROM history h JOIN titles t ON t.id=h.title_id WHERE h.user_id=? ORDER BY h.updated_at DESC LIMIT 100`
      ).bind(user!.id).all();
      return withCors(request, env, json({ items: rows.results || [] }));
    }
    if (method === 'POST') {
      const b = await body(request);
      const titleId = String(b.titleId || '');
      if (!titleId) return withCors(request, env, json({ error: 'titleId required' }, { status: 400 }));
      await env.DB.prepare(
        `INSERT INTO history(user_id,title_id,chapter_id,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(user_id,title_id) DO UPDATE SET chapter_id=excluded.chapter_id, updated_at=excluded.updated_at`
      ).bind(user!.id, titleId, b.chapterId ? String(b.chapterId) : null, nowIso()).run();
      return withCors(request, env, json({ ok: true }));
    }
  }
  if (path === '/api/me/progress') {
    const unauth = requireUser(); if (unauth) return unauth;
    if (method === 'GET') {
      const rows = await env.DB.prepare('SELECT * FROM reading_progress WHERE user_id=? ORDER BY updated_at DESC').bind(user!.id).all();
      return withCors(request, env, json({ progress: rows.results || [] }));
    }
    if (method === 'PUT') {
      const b = await body(request);
      const titleId = String(b.titleId || '');
      const chapterId = String(b.chapterId || '');
      if (!titleId || !chapterId) return withCors(request, env, json({ error: 'titleId and chapterId required' }, { status: 400 }));
      const exists = await env.DB.prepare('SELECT id FROM titles WHERE id=?').bind(titleId).first();
      if (!exists) return withCors(request, env, json({ error: 'Title not found' }, { status: 404 }));
      await env.DB.prepare(
        `INSERT INTO reading_progress(user_id,title_id,chapter_id,chapter_number,page_index,scroll_ratio,completed,updated_at)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id,title_id) DO UPDATE SET chapter_id=excluded.chapter_id, chapter_number=excluded.chapter_number,
           page_index=excluded.page_index, scroll_ratio=excluded.scroll_ratio, completed=excluded.completed, updated_at=excluded.updated_at`
      ).bind(user!.id, titleId, chapterId, b.chapterNumber ?? null, Number(b.pageIndex) || 0, Number(b.scrollRatio) || 0, b.completed ? 1 : 0, nowIso()).run();
      // Keep library.last_seen_chapter_number current so /api/me/updates can
      // detect new chapters without a second round trip from the frontend.
      if (typeof b.chapterNumber === 'number') {
        await env.DB.prepare(
          `UPDATE library SET last_seen_chapter_number=MAX(COALESCE(last_seen_chapter_number,0),?), updated_at=? WHERE user_id=? AND title_id=?`
        ).bind(b.chapterNumber, nowIso(), user!.id, titleId).run();
      }
      return withCors(request, env, json({ ok: true }));
    }
  }
  if (path === '/api/me/updates' && method === 'GET') {
    const unauth = requireUser(); if (unauth) return unauth;
    const rows = await env.DB.prepare(
      `SELECT l.title_id,t.title,t.cover_url,t.latest_known_chapter_number,l.last_seen_chapter_number
       FROM library l JOIN titles t ON t.id=l.title_id
       WHERE l.user_id=? AND t.latest_known_chapter_number IS NOT NULL
         AND (l.last_seen_chapter_number IS NULL OR t.latest_known_chapter_number > l.last_seen_chapter_number)
       ORDER BY t.latest_known_chapter_number DESC`
    ).bind(user!.id).all();
    return withCors(request, env, json({ items: rows.results || [] }));
  }

  return withCors(request, env, json({ error: 'Not found' }, { status: 404 }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (e: any) {
      return withCors(request, env, json({ error: 'Internal error' }, { status: 500 }));
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    // The only proactive background work BUFU does: probe configured
    // production sources' health, and prune expired sessions/rate-limit
    // buckets. Chapter/page data is fetched on demand (see orchestrator.ts),
    // not bulk-polled here, to stay a light, well-behaved client of every
    // provider rather than hammering them every 15 minutes for every title
    // in every user's library.
    await probeAllSourceHealth(env);
    await pruneExpired(env);
  },
};
