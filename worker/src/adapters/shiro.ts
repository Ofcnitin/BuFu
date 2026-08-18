import type { ProviderTitle } from '../types';
import { fetchJson, withDeadline } from '../utils';
import { register, type SourceAdapter } from './registry';

const BASE = 'https://shiro.kuuhaku.space';
const MANGADEX_BASE = 'https://api.mangadex.org';

function mapSeed(x: any): ProviderTitle | null {
  const name = x?.name;
  if (!name || typeof name !== 'string') return null;
  return {
    sourceId: 'shiro',
    sourceTitleId: String(x.id ?? name),
    title: name,
    altTitles: [],
    type: 'manhwa',
    contentRating: 'unknown',
    readingMode: 'vertical',
    status: 'unknown',
    genres: x?.Category?.name ? [x.Category.name] : [],
  };
}

function pickLocalized(loc: Record<string, string> | undefined | null, fallback = 'Untitled'): string {
  if (!loc) return fallback;
  return loc.en || Object.values(loc)[0] || fallback;
}

function mapMangaDex(m: any): ProviderTitle {
  const attrs = m.attributes || {};
  const rels: any[] = m.relationships || [];
  const author = rels.find(r => r.type === 'author')?.attributes?.name;
  const artist = rels.find(r => r.type === 'artist')?.attributes?.name;
  const coverFile = rels.find(r => r.type === 'cover_art')?.attributes?.fileName;
  const lang = String(attrs.originalLanguage || '').toLowerCase();
  const type =
    lang === 'ko' ? 'manhwa' :
    lang === 'zh' || lang === 'zh-hk' ? 'manhua' :
    lang === 'ja' ? 'manga' : 'unknown';

  const statusMap: Record<string, any> = {
    ongoing: 'ongoing', completed: 'completed',
    hiatus: 'hiatus', cancelled: 'cancelled'
  };

  return {
    sourceId: 'mangadex',
    sourceTitleId: String(m.id),
    sourceUrl: `https://mangadex.org/title/${m.id}`,
    title: pickLocalized(attrs.title),
    altTitles: (attrs.altTitles || [])
      .map((t: any) => pickLocalized(t, ''))
      .filter(Boolean),
    description: pickLocalized(attrs.description, '') || undefined,
    type,
    contentRating: attrs.contentRating || 'unknown',
    readingMode: type === 'manga' ? 'page' : 'vertical',
    status: statusMap[attrs.status] || 'unknown',
    author,
    artist,
    genres: (attrs.tags || [])
      .filter((t: any) => t?.attributes?.group === 'genre' || t?.attributes?.group === 'theme')
      .map((t: any) => pickLocalized(t.attributes?.name, ''))
      .filter(Boolean)
      .slice(0, 12),
    score: undefined,
    popularity: undefined,
    cover: coverFile
      ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.256.jpg`
      : undefined,
  };
}

async function resolveSeed(env: any, seed: ProviderTitle): Promise<ProviderTitle> {
  try {
    const u = new URL(`${MANGADEX_BASE}/manga`);
    u.searchParams.set('title', seed.title);
    u.searchParams.set('limit', '10');
    u.searchParams.append('includes[]', 'cover_art');
    u.searchParams.append('includes[]', 'author');
    u.searchParams.append('includes[]', 'artist');

    const r = await withDeadline(
      fetchJson(u.toString(), {}, 3500, 'mangadex'),
      3000,
      null as any,
    );

    const rows: any[] = r?.data || [];
    const wanted = seed.title.toLowerCase().trim();

    const exact = rows.find(m => {
      const a = m.attributes || {};
      const title = pickLocalized(a.title, '').toLowerCase().trim();
      return title === wanted ||
        (a.altTitles || []).some((x: any) =>
          Object.values(x || {}).some(v =>
            String(v).toLowerCase().trim() === wanted
          )
        );
    });

    return exact ? mapMangaDex(exact) : seed;
  } catch {
    return seed;
  }
}

const adapter: SourceAdapter = {
  id: 'shiro',
  name: 'SHIRO',
  role: 'recommendation',
  production: true,
  configured: () => true,

  async recommendations(env, category) {
    const base = env.SHIRO_URL || BASE;

    // SHIRO returns one random recommendation per request.
    // Run the independent requests together instead of sequentially.
    const calls = Array.from({ length: 8 }, async () => {
      try {
        const u = new URL('/manhwas', base);
        if (category) u.searchParams.set('category', category);
        const r = await fetchJson(u.toString(), {}, 5000, 'shiro');
        return mapSeed(r);
      } catch {
        return null;
      }
    });

    const seeds = (await Promise.all(calls)).filter(Boolean) as ProviderTitle[];

    // Resolve recommendations against MangaDex so they receive real
    // covers and, when matched, a real reader source mapping.
    const resolved: ProviderTitle[] = new Array(seeds.length);
    let next = 0;

    const workers = Array.from(
      { length: Math.min(3, seeds.length) },
      async () => {
        while (next < seeds.length) {
          const i = next++;
          resolved[i] = await resolveSeed(env, seeds[i]);
        }
      }
    );

    await Promise.all(workers);

    const seen = new Map<string, ProviderTitle>();
    for (const title of resolved) {
      seen.set(`${title.sourceId}:${title.sourceTitleId}`, title);
    }

    return [...seen.values()];
  },

  async health(env) {
    try {
      const u = new URL('/manhwas', env.SHIRO_URL || BASE);
      await fetchJson(u.toString(), {}, 5000, 'shiro');
      return true;
    } catch {
      return false;
    }
  },
};

register(adapter);
