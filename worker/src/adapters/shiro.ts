import type { ProviderTitle } from '../types';
import { fetchJson } from '../utils';
import { register, type SourceAdapter } from './registry';

// Verified by directly calling the live endpoint during this rebuild:
//   GET https://shiro.kuuhaku.space/manhwas
//   GET https://shiro.kuuhaku.space/manhwas?category=action
// Both returned exactly ONE object per call, e.g.:
//   {"name":"Red King","id":89,"Category":{"name":"action","id":1}}
// This is dramatically smaller than what the pre-rebuild adapter assumed
// (it invented description/author/artist/genres/score/popularity/cover
// fields that this API does not return, and treated the response as an
// array). SHIRO is a small, individually-run project (github.com/
// sireeshdevaraj/SHIRO-MANHWA-API) whose README explicitly states "no
// rate limits... FOR NOW" — since "no limit today" isn't a documented
// guarantee, this adapter still self-throttles (ratelimit.ts) and is
// treated as discovery-only: a bare title *name*, nothing else. It is
// never used to build a full BUFU title by itself — orchestrator.ts
// re-searches the metadata providers by the returned name to canonicalize
// it into a real title before it's ever shown as readable.
const BASE = 'https://shiro.kuuhaku.space';

function mapSeed(x: any): ProviderTitle | null {
  const name = x?.name;
  if (!name || typeof name !== 'string') return null;
  return {
    sourceId: 'shiro',
    sourceTitleId: String(x.id ?? name),
    title: name,
    altTitles: [],
    type: 'manhwa', // SHIRO is manhwa-only by name/product (SHIRO-MANHWA-API)
    contentRating: 'unknown',
    readingMode: 'vertical',
    status: 'unknown',
    genres: x?.Category?.name ? [x.Category.name] : [],
  };
}

const adapter: SourceAdapter = {
  id: 'shiro', name: 'SHIRO', role: 'recommendation', production: true, configured: () => true,
  async recommendations(env, category) {
    const base = env.SHIRO_URL || BASE;
    const seen = new Map<string, ProviderTitle>();
    // The endpoint returns one (apparently random) pick per call with no
    // documented "give me N" parameter, so a handful of small, throttled
    // calls is how a real list is built — not a fabricated array.
    for (let i = 0; i < 8; i++) {
      try {
        const u = new URL('/manhwas', base);
        if (category) u.searchParams.set('category', category);
        const r = await fetchJson(u.toString(), {}, 5000, 'shiro');
        const seed = mapSeed(r);
        if (seed) seen.set(seed.sourceTitleId, seed);
      } catch { /* one miss shouldn't drop the whole list */ }
    }
    return [...seen.values()];
  },
  async health(env) {
    try {
      const u = new URL('/manhwas', env.SHIRO_URL || BASE);
      await fetchJson(u.toString(), {}, 5000, 'shiro');
      return true;
    } catch { return false; }
  },
};
register(adapter);
