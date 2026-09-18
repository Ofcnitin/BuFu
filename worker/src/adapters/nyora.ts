import type { Env, ProviderChapter, ProviderTitle, UnifiedPage } from '../types';
import { fetchJson, withDeadline } from '../utils';
import { register, type SourceAdapter } from './registry';

/**
 * Nyora source adapter.
 *
 * Nyora's JS SDK is a thin fetch client over:
 *   /sources
 *   /sources/search?id=<source>&q=<query>&page=<page>
 *   /manga/details?id=<source>&url=<manga-url>
 *   /manga/pages?id=<source>&url=<chapter-url>&branch=<branch>
 *
 * We intentionally call that documented REST contract directly rather than
 * adding a Node-only SDK dependency to the Cloudflare Worker.
 *
 * A separate BUFU source id is registered for every configured Nyora source
 * because D1 intentionally allows one source mapping per provider.
 */

type NyoraRef = {
  sourceId: string;
  url: string;
  branch?: string | null;
};

const DEFAULT_SOURCES = [
  // MangaDex already has a first-class BUFU adapter, so do not duplicate it
  // through Nyora. These are additional Nyora-backed reader sources.
  'bato',
  'comick',
  'mangafreak',
  'mangafire',
  'mangaworld',
  'asura',
  'weebcentral',
  'mangabuddy',
  'mangapark',
  'mangakakalot',
];

function base(env: Env): string {
  return (env.NYORA_BASE_URL || 'https://api.hasanraza.tech').replace(/\/+$/, '');
}

function configuredSources(env: Env): string[] {
  const raw = env.NYORA_SOURCES;
  const values = (raw ? raw.split(',') : DEFAULT_SOURCES)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(values)].slice(0, 20);
}

function sourceName(sourceId: string): string {
  return sourceId
    .split(/[-_]/g)
    .filter(Boolean)
    .map(x => x[0].toUpperCase() + x.slice(1))
    .join(' ');
}

function parseRef(id: string): NyoraRef {
  try {
    return JSON.parse(id) as NyoraRef;
  } catch {
    throw new Error('Invalid Nyora source reference');
  }
}

function typeFromValue(value: unknown): ProviderTitle['type'] {
  const x = String(value || '').toLowerCase();
  if (x.includes('manhwa')) return 'manhwa';
  if (x.includes('manhua')) return 'manhua';
  if (x.includes('manga')) return 'manga';
  return 'unknown';
}

function mapSearchEntry(sourceId: string, x: any): ProviderTitle | null {
  const title = String(x?.title || '').trim();
  const url = String(x?.url || '').trim();
  if (!title || !url) return null;
  const type = typeFromValue(x?.type);
  return {
    sourceId: `nyora:${sourceId}`,
    sourceTitleId: JSON.stringify({ sourceId, url }),
    sourceUrl: url,
    title,
    altTitles: Array.isArray(x?.altTitles) ? x.altTitles.map(String) : [],
    description: x?.description ? String(x.description) : undefined,
    type,
    contentRating: 'unknown',
    readingMode: type === 'manga' ? 'page' : type === 'unknown' ? 'auto' : 'vertical',
    status: 'unknown',
    author: x?.author ? String(x.author) : undefined,
    artist: x?.artist ? String(x.artist) : undefined,
    genres: Array.isArray(x?.genres) ? x.genres.map(String).slice(0, 20) : [],
    cover: x?.coverUrl ? String(x.coverUrl) : (x?.thumbnailUrl ? String(x.thumbnailUrl) : undefined),
    originalLanguage: x?.language ? String(x.language) : undefined,
  };
}

async function details(env: Env, sourceId: string, mangaUrl: string): Promise<any> {
  const u = new URL(`${base(env)}/manga/details`);
  u.searchParams.set('id', sourceId);
  u.searchParams.set('url', mangaUrl);
  // Shared throttle key: every Nyora-backed source hits the same origin
  // (see ratelimit.ts), so all of them coordinate through one 'nyora'
  // bucket rather than each getting its own independent allowance.
  return fetchJson(u.toString(), {}, 10000, 'nyora');
}

function mapDetails(sourceId: string, data: any, fallbackUrl: string): ProviderTitle {
  const m = data?.manga || data || {};
  const title = String(m.title || '').trim() || 'Untitled';
  const type = typeFromValue(m.type);
  const url = String(m.url || fallbackUrl);
  return {
    sourceId: `nyora:${sourceId}`,
    sourceTitleId: JSON.stringify({ sourceId, url }),
    sourceUrl: url,
    title,
    altTitles: Array.isArray(m.altTitles) ? m.altTitles.map(String) : [],
    description: m.description ? String(m.description) : undefined,
    type,
    contentRating: 'unknown',
    readingMode: type === 'manga' ? 'page' : type === 'unknown' ? 'auto' : 'vertical',
    status: 'unknown',
    author: m.author ? String(m.author) : undefined,
    artist: m.artist ? String(m.artist) : undefined,
    genres: Array.isArray(m.genres) ? m.genres.map(String).slice(0, 20) : [],
    cover: m.coverUrl ? String(m.coverUrl) : undefined,
    originalLanguage: m.language ? String(m.language) : undefined,
  };
}

function mapChapter(sourceId: string, c: any): ProviderChapter | null {
  const url = String(c?.url || '').trim();
  if (!url) return null;
  const numberRaw = c?.number;
  const number = numberRaw === null || numberRaw === undefined || numberRaw === ''
    ? null
    : Number(numberRaw);
  return {
    sourceId: `nyora:${sourceId}`,
    sourceChapterId: JSON.stringify({
      sourceId,
      url,
      branch: c?.branch ?? null,
    }),
    sourceUrl: url,
    number: Number.isFinite(number as number) ? number as number : null,
    label: c?.title ? String(c.title) : undefined,
    language: String(c?.language || 'en'),
    publishedAt: c?.uploadDate ? String(c.uploadDate) : undefined,
  };
}

function makeAdapter(sourceId: string): SourceAdapter {
  const id = `nyora:${sourceId}`;
  return {
    id,
    name: `Nyora — ${sourceName(sourceId)}`,
    role: 'reader',
    production: true,
    configured: (env) => configuredSources(env).includes(sourceId),

    async search(env, q) {
      const u = new URL(`${base(env)}/sources/search`);
      u.searchParams.set('id', sourceId);
      u.searchParams.set('q', q);
      u.searchParams.set('page', '1');
      const data = await fetchJson(u.toString(), {}, 9000, 'nyora');
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      return entries
        .map((x: any) => mapSearchEntry(sourceId, x))
        .filter(Boolean) as ProviderTitle[];
    },

    async getTitle(env, sourceTitleId) {
      const ref = parseRef(sourceTitleId);
      const data = await details(env, sourceId, ref.url);
      return mapDetails(sourceId, data, ref.url);
    },

    async chapters(env, sourceTitleId) {
      const ref = parseRef(sourceTitleId);
      const data = await details(env, sourceId, ref.url);
      const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
      return chapters
        .map((c: any) => mapChapter(sourceId, c))
        .filter(Boolean) as ProviderChapter[];
    },

    async pages(env, sourceTitleId, sourceChapterId) {
      const ref = parseRef(sourceChapterId);
      // Validate that the chapter's source agrees with this adapter.
      if (ref.sourceId !== sourceId) throw new Error('Nyora source mismatch');
      const u = new URL(`${base(env)}/manga/pages`);
      u.searchParams.set('id', sourceId);
      u.searchParams.set('url', ref.url);
      if (ref.branch) u.searchParams.set('branch', ref.branch);
      const data = await fetchJson(u.toString(), {}, 12000, 'nyora');
      const pages = Array.isArray(data?.pages) ? data.pages : [];
      return pages
        .map((p: any, i: number): UnifiedPage | null => {
          const url = String(p?.url || '').trim();
          if (!url) return null;
          return {
            index: Number.isFinite(Number(p?.index)) ? Number(p.index) : i,
            src: url,
            width: Number.isFinite(Number(p?.width)) ? Number(p.width) : undefined,
            height: Number.isFinite(Number(p?.height)) ? Number(p.height) : undefined,
            alt: `Page ${i + 1}`,
          };
        })
        .filter(Boolean) as UnifiedPage[];
    },

    async health(env) {
      const u = new URL(`${base(env)}/sources`);
      const data = await fetchJson(u.toString(), {}, 6000, 'nyora');
      return Array.isArray(data?.sources) || Array.isArray(data?.entries);
    },
  };
}

const adapters = DEFAULT_SOURCES.map(makeAdapter);
for (const adapter of adapters) register(adapter);
