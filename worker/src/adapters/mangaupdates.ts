import type { ProviderTitle } from '../types';
import { fetchJson } from '../utils';
import { register, type SourceAdapter } from './registry';

// Verified base URL/endpoints: https://api.mangaupdates.com/v1
// POST /series/search {search, stype, perpage}, GET /series/{id}. No key
// for these read endpoints. The series `type` field is manga/manhwa/
// manhua/novel — used directly. Cover art is `image.url.original` /
// `image.url.thumb` (a nested object, not a bare string — the pre-rebuild
// adapter read `x.image?.url` directly, which is an object, not a URL).
function mapSeries(x: any): ProviderTitle {
  const t = String(x.type || '').toLowerCase();
  const type = t === 'manhwa' ? 'manhwa' : t === 'manhua' ? 'manhua' : t === 'manga' ? 'manga' : 'unknown';
  return {
    sourceId: 'mangaupdates',
    sourceTitleId: String(x.series_id ?? x.id ?? ''),
    sourceUrl: x.url,
    title: x.title || 'Untitled',
    altTitles: (x.associated || []).map((a: any) => a.title).filter(Boolean),
    description: x.description || undefined,
    type,
    contentRating: 'unknown',
    readingMode: type === 'manga' ? 'page' : type === 'unknown' ? 'auto' : 'vertical',
    status: x.completed ? 'completed' : (String(x.status || '').toLowerCase().includes('ongoing') ? 'ongoing' : 'unknown'),
    author: (x.authors || []).map((a: any) => a.name || a).join(', ') || undefined,
    artist: undefined,
    genres: (x.genres || []).map((g: any) => (typeof g === 'string' ? g : g.genre || g.name)).filter(Boolean),
    score: typeof x.bayesian_rating === 'number' ? x.bayesian_rating : undefined,
    // NOT `-x.rank.position.week` — that was a previous attempt to coerce
    // MangaUpdates' weekly rank *position* (1 = most popular, unbounded,
    // smaller-is-better) into the same `popularity` field every other
    // adapter uses for a raw tracking/favorites *count* (AniList's
    // `popularity`, Jikan's `members`, Kitsu's `userCount` — all
    // positive, bigger-is-better, roughly comparable scales). Negating a
    // rank position doesn't make it comparable to a count: a #1-ranked
    // series becomes popularity=-1, which canon.ts's merge can write over
    // an existing positive count from another source — after that,
    // explore()'s popularity sort silently ranks a top-tracked series
    // below nearly everything else, the exact opposite of correct. Rather
    // than merge two genuinely incompatible units into one field, this
    // stays honestly unset when only a rank position is available.
    popularity: undefined,
    cover: x.image?.url?.original || x.image?.url?.thumb,
  };
}

const BASE = 'https://api.mangaupdates.com/v1';
const adapter: SourceAdapter = {
  id: 'mangaupdates', name: 'MangaUpdates', role: 'metadata', production: true, configured: () => true,
  async search(_env, q) {
    const r = await fetchJson(`${BASE}/series/search`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ search: q, stype: 'title', perpage: 20 }),
    }, 8000, 'mangaupdates');
    const arr = r?.results;
    return Array.isArray(arr) ? arr.map((r: any) => mapSeries(r.record || r)) : [];
  },
  async getTitle(_env, id) {
    try {
      const x = await fetchJson(`${BASE}/series/${encodeURIComponent(id)}`, {}, 8000, 'mangaupdates');
      return mapSeries(x);
    } catch { return null; }
  },
  async health() {
    try {
      await fetchJson(`${BASE}/series/search`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ search: 'a', stype: 'title', perpage: 1 }),
      }, 5000, 'mangaupdates');
      return true;
    } catch { return false; }
  },
};
register(adapter);
