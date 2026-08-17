import type { ProviderTitle } from '../types';
import { fetchJson } from '../utils';
import { register, type SourceAdapter } from './registry';

// Verified: https://kitsu.docs.apiary.io/ — this is Kitsu's own JSON:API
// manga catalogue at kitsu.io/api/edge, NOT any other "Kitsu" product.
// Public GETs work unauthenticated for non-R18 content. Pagination is
// page[limit]/page[offset], default 10, MAX 20 — used at the documented
// max rather than an assumed higher number. No documented public rate
// limit; throttled conservatively anyway (ratelimit.ts).
function mapEntry(x: any): ProviderTitle {
  const a = x.attributes || {};
  const subtype = String(a.subtype || '').toLowerCase(); // Kitsu's own manga/manhwa/manhua/novel/oneshot/doujin axis
  const type = subtype === 'manhwa' ? 'manhwa' : subtype === 'manhua' ? 'manhua' : subtype === 'manga' || subtype === 'oneshot' ? 'manga' : 'unknown';
  return {
    sourceId: 'kitsu',
    sourceTitleId: String(x.id),
    sourceUrl: a.slug ? `https://kitsu.io/manga/${a.slug}` : undefined,
    title: a.canonicalTitle || a.titles?.en_jp || 'Untitled',
    altTitles: (Object.values(a.titles || {}) as string[]).filter(Boolean),
    description: a.synopsis || undefined,
    type,
    contentRating: a.ageRating === 'R18' ? 'pornographic' : a.ageRating === 'R' ? 'erotica' : 'unknown',
    readingMode: type === 'manga' ? 'page' : type === 'unknown' ? 'auto' : 'vertical',
    status: (String(a.status || '').toLowerCase() as any) || 'unknown',
    genres: [],
    score: a.averageRating ? Number(a.averageRating) / 10 : undefined,
    popularity: a.userCount ?? undefined,
    cover: a.posterImage?.large || a.posterImage?.original,
  };
}

const adapter: SourceAdapter = {
  id: 'kitsu', name: 'Kitsu', role: 'metadata', production: true, configured: () => true,
  async search(env, q) {
    const u = new URL(`${env.KITSU_URL || 'https://kitsu.io/api/edge'}/manga`);
    u.searchParams.set('filter[text]', q);
    u.searchParams.set('page[limit]', '20');
    const r = await fetchJson(u.toString(), { headers: { Accept: 'application/vnd.api+json' } }, 8000, 'kitsu');
    return (r.data || []).map(mapEntry);
  },
  async health(env) {
    try {
      await fetchJson(`${env.KITSU_URL || 'https://kitsu.io/api/edge'}/manga?page[limit]=1`, { headers: { Accept: 'application/vnd.api+json' } }, 5000, 'kitsu');
      return true;
    } catch { return false; }
  },
};
register(adapter);
