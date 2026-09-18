import type { Env, ProviderChapter, ProviderTitle, UnifiedPage } from '../types';
import { fetchJson } from '../utils';
import { register, type SourceAdapter } from './registry';

function url(envValue: string | undefined, fallback = ''): string {
  return (envValue || fallback).replace(/\/+$/, '');
}

function mapGenericTitle(sourceId: string, x: any, baseUrl?: string): ProviderTitle | null {
  const title = String(x?.title || x?.name || x?.comic?.title || '').trim();
  const rawId = x?.id ?? x?.slug ?? x?.comic?.id;
  if (!title || rawId === undefined || rawId === null) return null;
  const id = String(rawId);
  const sourceUrl = x?.url ? String(x.url) : undefined;
  const t = String(x?.type || x?.comic?.type || '').toLowerCase();
  const type = t.includes('manhwa') ? 'manhwa' : t.includes('manhua') ? 'manhua' : t.includes('manga') ? 'manga' : 'unknown';
  return {
    sourceId,
    sourceTitleId: id,
    sourceUrl,
    title,
    altTitles: Array.isArray(x?.altTitles) ? x.altTitles.map(String) : [],
    description: x?.description || x?.synopsis ? String(x.description || x.synopsis) : undefined,
    type,
    contentRating: 'unknown',
    readingMode: type === 'manga' ? 'page' : type === 'unknown' ? 'auto' : 'vertical',
    status: 'unknown',
    author: x?.author || x?.authors ? String(x.author || x.authors) : undefined,
    artist: x?.artist || x?.artists ? String(x.artist || x.artists) : undefined,
    genres: Array.isArray(x?.genres) ? x.genres.map(String) : [],
    cover: x?.cover || x?.img || x?.thumbnail_url || x?.thumbnail ? String(x.cover || x.img || x.thumbnail_url || x.thumbnail) : undefined,
  };
}

function mapChapter(sourceId: string, c: any): ProviderChapter | null {
  const id = c?.id ?? c?.hid ?? c?.slug;
  if (id === undefined || id === null) return null;
  const number = c?.number === null || c?.number === undefined || c?.number === '' ? null : Number(c.number);
  return {
    sourceId,
    sourceChapterId: String(id),
    sourceUrl: c?.url ? String(c.url) : undefined,
    number: Number.isFinite(number as number) ? number as number : null,
    label: c?.title || c?.name ? String(c.title || c.name) : undefined,
    language: String(c?.language || c?.lang || 'en'),
    publishedAt: c?.date || c?.date_upload || c?.publishedAt ? String(c.date || c.date_upload || c.publishedAt) : undefined,
  };
}

function pagesFrom(data: any): UnifiedPage[] {
  const raw = Array.isArray(data) ? data : (data?.pages || data?.images || []);
  return raw.map((p: any, i: number) => {
    const src = typeof p === 'string' ? p : String(p?.url || p?.src || '');
    if (!src) return null;
    return {
      index: Number.isFinite(Number(p?.index)) ? Number(p.index) : i,
      src,
      width: Number.isFinite(Number(p?.width)) ? Number(p.width) : undefined,
      height: Number.isFinite(Number(p?.height)) ? Number(p.height) : undefined,
      alt: `Page ${i + 1}`,
    };
  }).filter(Boolean) as UnifiedPage[];
}

/**
 * BatoTo Parser's /details and /pages endpoints are keyed by manga/chapter
 * URL (?url=...), never by an id or slug — unlike every other adapter in
 * this file. mapGenericTitle/mapChapter extract an id/slug first and only
 * carry the URL as a side field, so reusing them here would silently hand
 * /details and /pages a non-URL value on any response shape that has both
 * an id and a url. These two keep sourceTitleId/sourceChapterId as the URL
 * itself, and drop any entry with no URL rather than mapping it to
 * something the wrapper can't actually look up.
 */
function mapBatoTitle(x: any): ProviderTitle | null {
  const mangaUrl = x?.url ? String(x.url).trim() : '';
  if (!mangaUrl) return null;
  const mapped = mapGenericTitle('bato-parser', x, mangaUrl);
  if (!mapped) return null;
  mapped.sourceTitleId = mangaUrl;
  mapped.sourceUrl = mangaUrl;
  return mapped;
}

function mapBatoChapter(c: any): ProviderChapter | null {
  const chapterUrl = c?.url ? String(c.url).trim() : '';
  if (!chapterUrl) return null;
  const numberRaw = c?.number;
  const number = numberRaw === null || numberRaw === undefined || numberRaw === '' ? null : Number(numberRaw);
  return {
    sourceId: 'bato-parser',
    sourceChapterId: chapterUrl,
    sourceUrl: chapterUrl,
    number: Number.isFinite(number as number) ? number as number : null,
    label: c?.title || c?.name ? String(c.title || c.name) : undefined,
    language: String(c?.language || c?.lang || 'en'),
    publishedAt: c?.date || c?.date_upload || c?.publishedAt ? String(c.date || c.date_upload || c.publishedAt) : undefined,
  };
}

/** HACHI: optional self-hosted FastAPI bridge. */
const hachi: SourceAdapter = {
  id: 'hachi',
  name: 'HACHI',
  role: 'reader',
  production: true,
  configured: env => !!env.HACHI_URL,
  async search(env, q) {
    const base = url(env.HACHI_URL);
    // Fan out to all 3 sub-sources concurrently (not one at a time): each
    // fetchJson call already has its own timeout, and orchestrator.ts's
    // searchAll() wraps this whole search() in a single, shorter
    // per-provider deadline — a sequential loop here could never reliably
    // finish inside that outer deadline. Promise.allSettled means one
    // failing sub-source (e.g. mangaworld down) doesn't lose comick's and
    // mangafreak's results too.
    const settled = await Promise.allSettled(['comick', 'mangafreak', 'mangaworld'].map(async source => {
      const u = new URL(`${base}/${source}`);
      u.searchParams.set('q', q);
      const data = await fetchJson(u.toString(), {}, 9000, 'hachi');
      const rows = Array.isArray(data) ? data : (data?.results || data?.manga || []);
      return rows.map((row: any): ProviderTitle | null => {
        const mapped = mapGenericTitle('hachi', row, base);
        if (!mapped) return null;
        // HACHI uses different identifiers by source:
        // Comick uses HID; MangaFreak/MangaWorld use the manga URL.
        const providerId = source === 'comick'
          ? String(row?.hid ?? row?.id ?? row?.url ?? mapped.sourceTitleId)
          : String(row?.url ?? mapped.sourceTitleId);
        mapped.sourceTitleId = `${source}|${providerId}`;
        mapped.sourceUrl = row?.url ? String(row.url) : mapped.sourceUrl;
        return mapped;
      }).filter(Boolean) as ProviderTitle[];
    }));
    const results: ProviderTitle[] = [];
    for (const r of settled) if (r.status === 'fulfilled') results.push(...r.value);
    return results;
  },
  async chapters(env, sourceTitleId) {
    const [source, ...rest] = sourceTitleId.split('|');
    const mangaUrl = rest.join('|');
    const base = url(env.HACHI_URL);
    const endpoint = source === 'mangafreak' ? '/mangafreak/chapters'
      : source === 'mangaworld' ? '/mangaworld/chapters'
      : '/comick/chapters';
    const u = new URL(`${base}${endpoint}`);
    if (source === 'comick') u.searchParams.set('hid', mangaUrl);
    else u.searchParams.set('url', mangaUrl);
    const data = await fetchJson(u.toString(), {}, 9000, 'hachi');
    const rows = Array.isArray(data) ? data : (data?.chapters || []);
    return rows.map((x: any) => mapChapter('hachi', x)).filter(Boolean) as ProviderChapter[];
  },
  async pages(env, sourceTitleId, sourceChapterId) {
    const [source] = sourceTitleId.split('|');
    const base = url(env.HACHI_URL);
    const endpoint = source === 'mangafreak' ? '/mangafreak/pages'
      : source === 'mangaworld' ? '/mangaworld/pages'
      : '/comick/pages';
    const u = new URL(`${base}${endpoint}`);
    if (source === 'comick') u.searchParams.set('hid', sourceChapterId);
    else u.searchParams.set('url', sourceChapterId);
    return pagesFrom(await fetchJson(u.toString(), {}, 12000, 'hachi'));
  },
  health: async env => {
    const r = await fetchJson(`${url(env.HACHI_URL)}/`, {}, 5000, 'hachi');
    return !!r;
  },
};
register(hachi);

/** Comix API: optional self-hosted Next.js REST API. */
const comix: SourceAdapter = {
  id: 'comix-api',
  name: 'Comix API',
  role: 'reader',
  production: true,
  configured: env => !!env.COMIX_API_URL,
  async search(env, q) {
    const u = new URL(`${url(env.COMIX_API_URL)}/api/manga/search`);
    u.searchParams.set('q', q);
    u.searchParams.set('sfw', 'true');
    const data = await fetchJson(u.toString(), {}, 9000, 'comix-api');
    const rows = Array.isArray(data?.results) ? data.results : [];
    return rows.map((x: any) => mapGenericTitle('comix-api', x)).filter(Boolean) as ProviderTitle[];
  },
  async getTitle(env, id) {
    const data = await fetchJson(`${url(env.COMIX_API_URL)}/api/manga/${encodeURIComponent(id)}?sfw=true`, {}, 9000, 'comix-api');
    return mapGenericTitle('comix-api', data?.comic || data) as ProviderTitle | null;
  },
  async chapters(env, id) {
    const data = await fetchJson(`${url(env.COMIX_API_URL)}/api/manga/${encodeURIComponent(id)}/chapters?page=1&limit=200`, {}, 9000, 'comix-api');
    const rows = Array.isArray(data?.chapters) ? data.chapters : (Array.isArray(data?.results) ? data.results : []);
    return rows.map((x: any) => mapChapter('comix-api', x)).filter(Boolean) as ProviderChapter[];
  },
  async pages(env, _titleId, chapterId) {
    const u = new URL(`${url(env.COMIX_API_URL)}/api/manga/read`);
    u.searchParams.set('chapterId', chapterId);
    const data = await fetchJson(u.toString(), {}, 12000, 'comix-api');
    return pagesFrom(data);
  },
  health: async env => !!(await fetchJson(`${url(env.COMIX_API_URL)}/api/manga/home?sfw=true`, {}, 6000, 'comix-api')),
};
register(comix);

/** MangaFire API: optional self-hosted FastAPI + Playwright service. */
const mangafire: SourceAdapter = {
  id: 'mangafire-api',
  name: 'MangaFire API',
  role: 'reader',
  production: true,
  configured: env => !!env.MANGAFIRE_API_URL,
  async search(env, q) {
    const u = new URL(`${url(env.MANGAFIRE_API_URL)}/search`);
    u.searchParams.set('query', q);
    u.searchParams.set('language', 'en');
    const data = await fetchJson(u.toString(), {}, 12000, 'mangafire-api');
    const rows = Array.isArray(data?.manga_list) ? data.manga_list : [];
    return rows.map((x: any) => mapGenericTitle('mangafire-api', x)).filter(Boolean) as ProviderTitle[];
  },
  async getTitle(env, id) {
    return mapGenericTitle('mangafire-api', await fetchJson(`${url(env.MANGAFIRE_API_URL)}/manga/${encodeURIComponent(id)}`, {}, 12000, 'mangafire-api'));
  },
  async chapters(env, id) {
    const u = new URL(`${url(env.MANGAFIRE_API_URL)}/manga/${encodeURIComponent(id)}/chapters`);
    u.searchParams.set('language', 'en');
    const data = await fetchJson(u.toString(), {}, 12000, 'mangafire-api');
    return (Array.isArray(data?.chapters) ? data.chapters : []).map((x: any) => mapChapter('mangafire-api', x)).filter(Boolean) as ProviderChapter[];
  },
  async pages(env, _titleId, chapterId) {
    const data = await fetchJson(`${url(env.MANGAFIRE_API_URL)}/chapter/${encodeURIComponent(chapterId)}/pages`, {}, 15000, 'mangafire-api');
    return pagesFrom(data);
  },
  health: async env => !!(await fetchJson(`${url(env.MANGAFIRE_API_URL)}/browser/status`, {}, 6000, 'mangafire-api')),
};
register(mangafire);

/** Legacy Manga API (riimuru) — optional self-hosted Express service. */
const mangato: SourceAdapter = {
  id: 'manga-api',
  name: 'Manga API / Mangato',
  role: 'reader',
  production: true,
  configured: env => !!env.MANGATO_API_URL,
  async search(env, q) {
    const u = new URL(`${url(env.MANGATO_API_URL)}/manga_list`);
    u.searchParams.set('keyword', q);
    const data = await fetchJson(u.toString(), {}, 9000, 'manga-api');
    const rows = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    return rows.map((x: any) => mapGenericTitle('manga-api', x)).filter(Boolean) as ProviderTitle[];
  },
  async chapters(env, id) {
    const u = new URL(`${url(env.MANGATO_API_URL)}/manga/${encodeURIComponent(id)}`);
    const data = await fetchJson(u.toString(), {}, 9000, 'manga-api');
    const rows = Array.isArray(data?.chapters) ? data.chapters : [];
    return rows.map((x: any) => mapChapter('manga-api', x)).filter(Boolean) as ProviderChapter[];
  },
  async pages(env, _titleId, chapterId) {
    const candidates = [
      `${url(env.MANGATO_API_URL)}/chapter/${encodeURIComponent(chapterId)}`,
      `${url(env.MANGATO_API_URL)}/manga/${encodeURIComponent(chapterId)}`,
    ];
    let last: unknown;
    for (const endpoint of candidates) {
      try { return pagesFrom(await fetchJson(endpoint, {}, 12000, 'manga-api')); }
      catch (e) { last = e; }
    }
    throw last instanceof Error ? last : new Error('Manga API page request failed');
  },
  health: async env => !!(await fetchJson(`${url(env.MANGATO_API_URL)}/`, {}, 5000, 'manga-api')),
};
register(mangato);

/**
 * Manga Mapper is an Express aggregator. Its documented endpoints are
 * provider-specific and primarily chapter/page focused, so it is enabled as
 * an optional reader backend once its server URL is supplied.
 */
// NOT production: Manga Mapper's endpoints are keyed on a MangaDex chapter/
// page id (/mangadex/chapters/{id}, /mangadex/pages/{id}) — it's meant as an
// alternate page host for titles BuFu already reads via MangaDex, not a
// standalone searchable source. search() below has always returned [] for
// exactly that reason, but that also means canonicalizeTitle() (canon.ts)
// can never create a source_mappings row with source_id='manga-mapper' for
// any title, which is the only way orchestrator.ts's getChapters/getPages
// ever look up an adapter's chapters()/pages() methods. So even with
// MANGA_MAPPER_URL configured, this adapter's chapters()/pages() could
// never actually be reached — production:true would have advertised a
// working reader source (see SOURCES.md) that structurally could not run.
// Flip this back to true only once orchestrator.ts gains a real "alternate
// page host for an existing MangaDex mapping" path.
const mapper: SourceAdapter = {
  id: 'manga-mapper',
  name: 'Manga Mapper',
  role: 'reader',
  production: false,
  configured: env => !!env.MANGA_MAPPER_URL,
  async search() { return []; },
  async chapters(env, id) {
    const u = new URL(`${url(env.MANGA_MAPPER_URL)}/mangadex/chapters/${encodeURIComponent(id)}`);
    const data = await fetchJson(u.toString(), {}, 9000, 'manga-mapper');
    return (Array.isArray(data?.chapters) ? data.chapters : []).map((x: any) => mapChapter('manga-mapper', x)).filter(Boolean) as ProviderChapter[];
  },
  async pages(env, _titleId, chapterId) {
    const u = new URL(`${url(env.MANGA_MAPPER_URL)}/mangadex/pages/${encodeURIComponent(chapterId)}`);
    return pagesFrom(await fetchJson(u.toString(), {}, 12000, 'manga-mapper'));
  },
  health: async env => !!(await fetchJson(`${url(env.MANGA_MAPPER_URL)}/mangadex/chapters/1`, {}, 5000, 'manga-mapper')),
};
register(mapper);

/**
 * manga-novel-api v2 is a self-hosted unified proxy. It can expose ComicK,
 * MangaDex, WeebCentral and Asura through one normalized HTTP service.
 */
const mangaNovel: SourceAdapter = {
  id: 'manga-novel-api',
  name: 'Manga Novel API',
  role: 'reader',
  production: true,
  configured: env => !!env.MANGA_NOVEL_API_URL,
  async search(env, q) {
    const base = url(env.MANGA_NOVEL_API_URL);
    // Concurrent, not sequential — see the matching comment on HACHI's
    // search() above for why a for-await loop here would almost always
    // blow through searchAll()'s per-provider deadline.
    const settled = await Promise.allSettled(['manga', 'manhwa', 'manhua'].map(async type => {
      const u = new URL(`${base}/api/manga/search`);
      u.searchParams.set('q', q);
      u.searchParams.set('source', 'comick');
      u.searchParams.set('type', type);
      const data = await fetchJson(u.toString(), {}, 10000, 'manga-novel-api');
      const rows = Array.isArray(data?.results) ? data.results : [];
      return rows.map((x: any) => mapGenericTitle('manga-novel-api', x)).filter(Boolean) as ProviderTitle[];
    }));
    const results: ProviderTitle[] = [];
    for (const r of settled) if (r.status === 'fulfilled') results.push(...r.value);
    return results;
  },
  async chapters(env, id) {
    const u = new URL(`${url(env.MANGA_NOVEL_API_URL)}/api/manga/${encodeURIComponent(id)}/chapters`);
    u.searchParams.set('source', 'comick');
    u.searchParams.set('lang', 'en');
    u.searchParams.set('limit', '200');
    const data = await fetchJson(u.toString(), {}, 10000, 'manga-novel-api');
    const rows = Array.isArray(data?.chapters) ? data.chapters : [];
    return rows.map((x: any) => mapChapter('manga-novel-api', x)).filter(Boolean) as ProviderChapter[];
  },
  async pages(env, _titleId, chapterId) {
    const parts = chapterId.split('|');
    const mangaId = parts[0];
    const chId = parts[1] || parts[0];
    const u = new URL(`${url(env.MANGA_NOVEL_API_URL)}/api/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chId)}/pages`);
    u.searchParams.set('source', 'comick');
    return pagesFrom(await fetchJson(u.toString(), {}, 12000, 'manga-novel-api'));
  },
  health: async env => !!(await fetchJson(`${url(env.MANGA_NOVEL_API_URL)}/api/health`, {}, 5000, 'manga-novel-api')),
};
register(mangaNovel);

/**
 * BatoTo parser is a Python library rather than an HTTP API. BuFu therefore
 * treats BATO_PARSER_URL as the URL of a tiny wrapper around that parser.
 * This keeps Python out of the Cloudflare Worker while preserving the
 * parser's actual page-resolution implementation.
 */
const bato: SourceAdapter = {
  id: 'bato-parser',
  name: 'BatoTo Parser',
  role: 'reader',
  production: true,
  configured: env => !!env.BATO_PARSER_URL,
  async search(env, q) {
    const u = new URL(`${url(env.BATO_PARSER_URL)}/search`);
    u.searchParams.set('query', q);
    const data = await fetchJson(u.toString(), {}, 10000, 'bato-parser');
    const rows = Array.isArray(data) ? data : (data?.results || data?.manga || []);
    return rows.map((x: any) => mapBatoTitle(x)).filter(Boolean) as ProviderTitle[];
  },
  async chapters(env, id) {
    // `id` is the manga URL itself (see mapBatoTitle) — exactly what
    // /details expects.
    const u = new URL(`${url(env.BATO_PARSER_URL)}/details`);
    u.searchParams.set('url', id);
    const data = await fetchJson(u.toString(), {}, 10000, 'bato-parser');
    const rows = Array.isArray(data?.chapters) ? data.chapters : [];
    return rows.map((x: any) => mapBatoChapter(x)).filter(Boolean) as ProviderChapter[];
  },
  async pages(env, _titleId, chapterId) {
    const u = new URL(`${url(env.BATO_PARSER_URL)}/pages`);
    u.searchParams.set('url', chapterId);
    return pagesFrom(await fetchJson(u.toString(), {}, 15000, 'bato-parser'));
  },
  health: async env => !!(await fetchJson(`${url(env.BATO_PARSER_URL)}/health`, {}, 5000, 'bato-parser')),
};
register(bato);
