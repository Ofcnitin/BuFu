import type { Env, MediaType, ProviderChapter, ProviderTitle, UnifiedPage } from '../types';
import { fetchJson } from '../utils';
import { register, type SourceAdapter } from './registry';

// ── Verified against https://api.mangadex.org/docs/ (2026-08) ───────────
// - No API key needed for reads; a Bearer token is only used if provided
//   (higher-trust account context), never required, never sent to the client.
// - Global limit ~5 req/s/IP; /at-home/server/{id} specifically capped at
//   40 req/min (docs/2-limitations). Both are throttled via ratelimit.ts.
// - Collection endpoints: size max 100 (500 for a handful of feed
//   endpoints incl. manga feed), offset+size must stay <=10000.
// - MangaDex explicitly does NOT provide a manga/manhwa/manhua field.
//   originalLanguage (ko/zh*/ja) is the only legitimate signal — content
//   rating (safe/suggestive/erotica/pornographic) is a completely separate
//   axis and must never be used to infer media type.
// - Page images come from GET /at-home/server/{chapterId} → {baseUrl,
//   chapter:{hash,data[],dataSaver[]}}; the client fetches
//   {baseUrl}/data/{hash}/{filename} directly — that direct fetch is the
//   documented, intended MangaDex@Home protocol, distinct from hotlinking
//   uploads.mangadex.org assets from an unrelated page (which MangaDex's
//   docs say returns a deliberately wrong image). No width/height field
//   exists in the at-home response (a request to add it was rejected
//   upstream), so page dimensions are left undefined rather than guessed.
// - Chapters with a non-null `externalUrl` point off-MangaDex (e.g. to a
//   publisher's own site) and are excluded — never presented as a readable
//   BUFU chapter.

const BASE = 'https://api.mangadex.org';

function pickLocalized(loc: Record<string, string> | undefined | null, fallback = 'Untitled'): string {
  if (!loc) return fallback;
  return loc.en || Object.values(loc)[0] || fallback;
}

// A supporting signal only, not a verified classification — MangaDex does
// not expose a manga/manhwa/manhua field, and a Korean-language work is not
// automatically a manhwa (e.g. a Korean scanlation of a Japanese manga).
// canon.ts's mergeIntoExisting treats any type this function returns as
// low-confidence: a later verified provider (AniList/Jikan/Kitsu/
// MangaUpdates, each with their own real type/countryOfOrigin field) is
// allowed to overwrite it, and this guess is never allowed to overwrite a
// verified classification back.
function mediaTypeFromLanguage(originalLanguage?: string): MediaType {
  if (!originalLanguage) return 'unknown';
  const lang = originalLanguage.toLowerCase();
  if (lang === 'ko') return 'manhwa';
  if (lang === 'zh' || lang === 'zh-hk') return 'manhua';
  if (lang === 'ja') return 'manga';
  return 'unknown';
}

function mapManga(m: any, baseHost = 'https://uploads.mangadex.org'): ProviderTitle {
  const attrs = m.attributes || {};
  const rels: any[] = m.relationships || [];
  const author = rels.find(r => r.type === 'author')?.attributes?.name;
  const artist = rels.find(r => r.type === 'artist')?.attributes?.name;
  const coverFile = rels.find(r => r.type === 'cover_art')?.attributes?.fileName;
  const tags: string[] = (attrs.tags || [])
    .filter((t: any) => t?.attributes?.group === 'genre' || t?.attributes?.group === 'theme')
    .map((t: any) => pickLocalized(t.attributes?.name, ''))
    .filter(Boolean)
    .slice(0, 12);
  const statusMap: Record<string, any> = { ongoing: 'ongoing', completed: 'completed', hiatus: 'hiatus', cancelled: 'cancelled' };
  return {
    sourceId: 'mangadex',
    sourceTitleId: m.id,
    sourceUrl: `https://mangadex.org/title/${m.id}`,
    title: pickLocalized(attrs.title),
    altTitles: (attrs.altTitles || []).map((t: any) => pickLocalized(t, '')).filter(Boolean),
    description: pickLocalized(attrs.description, '') || undefined,
    type: mediaTypeFromLanguage(attrs.originalLanguage),
    contentRating: (attrs.contentRating as any) || 'unknown',
    readingMode: mediaTypeFromLanguage(attrs.originalLanguage) === 'manga' ? 'page' : 'vertical',
    status: statusMap[attrs.status] || 'unknown',
    author, artist, genres: tags,
    cover: coverFile ? `${baseHost}/covers/${m.id}/${coverFile}.256.jpg` : undefined,
    year: attrs.year ?? undefined,
    originalLanguage: attrs.originalLanguage,
  };
}

async function authHeaders(env: Env): Promise<Record<string, string>> {
  return env.MANGADEX_ACCESS_TOKEN ? { Authorization: `Bearer ${env.MANGADEX_ACCESS_TOKEN}` } : {};
}

const adapter: SourceAdapter = {
  id: 'mangadex',
  name: 'MangaDex',
  role: 'reader',
  production: true,
  configured: () => true, // public reads work without a token
  async search(env, q) {
    const headers = await authHeaders(env);
    const u = new URL(`${BASE}/manga`);
    u.searchParams.set('title', q);
    u.searchParams.set('limit', '20');
    u.searchParams.append('includes[]', 'cover_art');
    u.searchParams.append('includes[]', 'author');
    u.searchParams.append('includes[]', 'artist');
    const r = await fetchJson(u.toString(), { headers }, 8000, 'mangadex');
    return (r.data || []).map((m: any) => mapManga(m));
  },
  async getTitle(env, id) {
    const headers = await authHeaders(env);
    const u = new URL(`${BASE}/manga/${id}`);
    u.searchParams.append('includes[]', 'cover_art');
    u.searchParams.append('includes[]', 'author');
    u.searchParams.append('includes[]', 'artist');
    try {
      const r = await fetchJson(u.toString(), { headers }, 8000, 'mangadex');
      return r.data ? mapManga(r.data) : null;
    } catch { return null; }
  },
  async chapters(env, mangaId) {
    // MangaDex feed endpoints allow size up to 500; paginate with offset
    // until a page returns fewer than the requested size or we hit the
    // documented offset+size<=10000 ceiling — never an arbitrary fixed cap.
    const headers = await authHeaders(env);
    const out: ProviderChapter[] = [];
    let offset = 0;
    const size = 500;
    for (;;) {
      const u = new URL(`${BASE}/manga/${mangaId}/feed`);
      u.searchParams.set('limit', String(size));
      u.searchParams.set('offset', String(offset));
      u.searchParams.append('translatedLanguage[]', 'en');
      u.searchParams.append('order[chapter]', 'desc');
      u.searchParams.append('order[volume]', 'desc');
      u.searchParams.append('contentRating[]', 'safe');
      u.searchParams.append('contentRating[]', 'suggestive');
      u.searchParams.append('contentRating[]', 'erotica');
      u.searchParams.append('contentRating[]', 'pornographic');
      const r = await fetchJson(u.toString(), { headers }, 8000, 'mangadex');
      const rows: any[] = r.data || [];
      for (const c of rows) {
        const a = c.attributes || {};
        out.push({
          sourceId: 'mangadex',
          sourceChapterId: c.id,
          sourceUrl: `https://mangadex.org/chapter/${c.id}`,
          number: a.chapter === null || a.chapter === undefined || a.chapter === '' ? null : Number(a.chapter),
          volume: a.volume ?? undefined,
          label: a.title || undefined,
          language: a.translatedLanguage || 'en',
          publishedAt: a.publishAt || a.readableAt,
          pagesCount: a.pages,
          external: !!a.externalUrl,
        });
      }
      offset += size;
      if (rows.length < size || offset >= 10000) break;
    }
    return out;
  },
  async pages(env, _mangaId, chapterId) {
    const headers = await authHeaders(env);
    const r = await fetchJson(`${BASE}/at-home/server/${chapterId}`, { headers }, 8000, 'mangadex-athome');
    const baseUrl: string = r.baseUrl;
    const hash: string = r.chapter?.hash;
    const files: string[] = r.chapter?.data || [];
    // Width/height are not returned by this endpoint (verified — a feature
    // request to add them was rejected upstream); left undefined rather
    // than fabricated. The frontend sizes reader images via CSS instead.
    const pages: UnifiedPage[] = files.map((filename, i) => ({
      index: i,
      src: `${baseUrl}/data/${hash}/${filename}`,
      alt: `Page ${i + 1}`,
    }));
    return pages;
  },
  async health(env) {
    try {
      await fetchJson(`${BASE}/manga?limit=1`, {}, 5000, 'mangadex');
      return true;
    } catch { return false; }
  },
};
register(adapter);
