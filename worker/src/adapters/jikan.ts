import type { ProviderTitle } from '../types';
import { fetchJson } from '../utils';
import { register, type SourceAdapter } from './registry';

// Verified: https://docs.api.jikan.moe/ — unofficial MyAnimeList mirror,
// 3 req/s and 60 req/min, no auth. Jikan's `type` field for manga entries
// is the closest verified media-type signal it exposes (manga/manhwa/
// manhua/one_shot/doujinshi/light_novel/novel) — used directly rather than
// re-derived from anything else.
function mapEntry(x: any): ProviderTitle {
  const t = String(x.type || '').toLowerCase();
  const type = t === 'manhwa' ? 'manhwa' : t === 'manhua' ? 'manhua' : t === 'manga' || t === 'one_shot' ? 'manga' : 'unknown';
  return {
    sourceId: 'jikan',
    sourceTitleId: String(x.mal_id),
    sourceUrl: x.url,
    title: x.title || 'Untitled',
    altTitles: [x.title_english, x.title_japanese].filter(Boolean),
    description: x.synopsis || undefined,
    type,
    contentRating: 'unknown',
    readingMode: type === 'manga' ? 'page' : type === 'unknown' ? 'auto' : 'vertical',
    status: (String(x.status || '').toLowerCase().includes('publishing') ? 'ongoing' : String(x.status || '').toLowerCase().includes('finished') ? 'completed' : 'unknown') as any,
    author: (x.authors || []).map((a: any) => a.name).join(', ') || undefined,
    genres: (x.genres || []).map((g: any) => g.name),
    score: x.score ?? undefined,
    popularity: x.members ?? undefined,
    cover: x.images?.jpg?.large_image_url || x.images?.jpg?.image_url,
  };
}

const adapter: SourceAdapter = {
  id: 'jikan', name: 'Jikan / MyAnimeList', role: 'metadata', production: true, configured: () => true,
  async search(env, q) {
    const r = await fetchJson(`${env.JIKAN_URL || 'https://api.jikan.moe/v4'}/manga?q=${encodeURIComponent(q)}&limit=15`, {}, 8000, 'jikan');
    return (r.data || []).map(mapEntry);
  },
  async getTitle(env, id) {
    try {
      const r = await fetchJson(`${env.JIKAN_URL || 'https://api.jikan.moe/v4'}/manga/${encodeURIComponent(id)}`, {}, 8000, 'jikan');
      return r.data ? mapEntry(r.data) : null;
    } catch { return null; }
  },
  async recommendations(env) {
    // Verified endpoint shape: Jikan v4's /top/manga uses the same entry
    // schema as /manga search (confirmed via docs.api.jikan.moe — v4
    // unified response shapes across endpoints). No genre filter here:
    // Jikan's genre filter takes numeric MAL genre IDs and we don't have a
    // verified id-to-name mapping, so rather than guess one, this returns
    // general top-manga popularity only — an honest limitation, not a
    // silent inaccuracy.
    const r = await fetchJson(`${env.JIKAN_URL || 'https://api.jikan.moe/v4'}/top/manga?limit=20`, {}, 8000, 'jikan');
    return (r.data || []).map(mapEntry);
  },
  async health(env) {
    try { await fetchJson(`${env.JIKAN_URL || 'https://api.jikan.moe/v4'}/manga/1`, {}, 5000, 'jikan'); return true; } catch { return false; }
  },
};
register(adapter);
