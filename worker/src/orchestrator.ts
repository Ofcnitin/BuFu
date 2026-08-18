import { canonicalizeTitle, getCanonicalTitle, persistChapters } from './canon';
import { productionSources, sourceList } from './adapters/registry';
import type { CanonicalChapter, CanonicalTitle, Env, ProviderTitle, UnifiedPage } from './types';
import { nowIso, withDeadline } from './utils';

const PER_PROVIDER_DEADLINE_MS = 6000;
const COOLDOWN_MS = 5 * 60 * 1000;

// ── Source health / circuit breaker ──────────────────────────────────────
// Failure 1 → still usable. Failure 2 → still usable. Failure 3 → circuit
// opens for COOLDOWN_MS. After cooldown, exactly one probe call is allowed
// through; success closes the circuit, another failure extends the cooldown.
async function isCircuitOpen(env: Env, sourceId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT circuit_open_until FROM source_health WHERE source_id=?').bind(sourceId).first<{ circuit_open_until: string | null }>();
  if (!row?.circuit_open_until) return false;
  return new Date(row.circuit_open_until).getTime() > Date.now();
}

export async function recordHealth(env: Env, sourceId: string, success: boolean, latencyMs: number): Promise<void> {
  const row = await env.DB.prepare('SELECT * FROM source_health WHERE source_id=?').bind(sourceId).first<any>();
  const prevFailures = row?.consecutive_failures || 0;
  const prevSuccess = row?.success_count || 0;
  const prevFailureCount = row?.failure_count || 0;
  const prevAvg = row?.avg_latency_ms || 0;
  const nextFailures = success ? 0 : prevFailures + 1;
  const avg = prevAvg ? (prevAvg * 0.7 + latencyMs * 0.3) : latencyMs;
  let circuitOpenUntil: string | null = success ? null : row?.circuit_open_until || null;
  if (!success && nextFailures >= 3) circuitOpenUntil = new Date(Date.now() + COOLDOWN_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO source_health(source_id,ok,consecutive_failures,success_count,failure_count,avg_latency_ms,circuit_open_until,checked_at)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(source_id) DO UPDATE SET ok=excluded.ok, consecutive_failures=excluded.consecutive_failures,
       success_count=excluded.success_count, failure_count=excluded.failure_count, avg_latency_ms=excluded.avg_latency_ms,
       circuit_open_until=excluded.circuit_open_until, checked_at=excluded.checked_at`
  ).bind(sourceId, success ? 1 : 0, nextFailures, prevSuccess + (success ? 1 : 0), prevFailureCount + (success ? 0 : 1), avg, circuitOpenUntil, nowIso()).run();
}

async function callWithHealth<T>(env: Env, sourceId: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  if (await isCircuitOpen(env, sourceId)) return fallback;
  const start = Date.now();
  try {
    const value = await fn();
    await recordHealth(env, sourceId, true, Date.now() - start);
    return value;
  } catch {
    await recordHealth(env, sourceId, false, Date.now() - start);
    return fallback;
  }
}

function toWire(t: CanonicalTitle) {
  return {
    id: t.id, slug: t.slug, title: t.title, altTitles: t.altTitles, description: t.description,
    type: t.type, contentRating: t.contentRating, readingMode: t.readingMode, status: t.status,
    author: t.author, artist: t.artist, genres: t.genres, score: t.score, popularity: t.popularity,
    cover: t.cover, sources: t.sourceMappings.map(m => m.sourceId),
    readable: t.sourceMappings.some(m => sourceList.find(a => a.id === m.sourceId)?.role === 'reader'),
  };
}

/** Search: aggregates every configured production metadata+reader source, each
 *  under its own deadline so one slow provider can't hold up the response;
 *  successful providers still contribute even if another times out or errors. */
export async function searchAll(env: Env, q: string): Promise<ReturnType<typeof toWire>[]> {
  const providers = productionSources(env).filter(a => a.search && (a.role === 'metadata' || a.role === 'reader'));
  const results = await Promise.all(providers.map(a =>
    callWithHealth(env, a.id, () => withDeadline(a.search!(env, q), PER_PROVIDER_DEADLINE_MS, [] as ProviderTitle[]), [] as ProviderTitle[])
  ));
  const seen = new Map<string, CanonicalTitle>();
  for (const list of results) {
    for (const p of list) {
      try {
        const canonical = await canonicalizeTitle(env, p);
        seen.set(canonical.id, canonical);
      } catch { /* one bad record shouldn't fail the whole search */ }
    }
  }
  return [...seen.values()].map(toWire);
}

/** Recommendations: SHIRO's real, verified output is just a title name — it
 *  is never treated as a finished BUFU title. Its name (and any AniList/Jikan
 *  trending picks) go through the same canonicalizeTitle() merge as search
 *  results, so a SHIRO pick that matches an existing MangaDex-backed
 *  canonical title becomes readable, and one that doesn't still appears as
 *  metadata/discovery-only (toWire's `readable` flag reflects that honestly —
 *  never fabricated as readable). */
export async function recommendations(env: Env, category = 'action'): Promise<ReturnType<typeof toWire>[]> {
  const shiro = sourceList.find(a => a.id === 'shiro' && a.production && a.configured(env));
  const anilist = sourceList.find(a => a.id === 'anilist' && a.production && a.configured(env));
  const jikan = sourceList.find(a => a.id === 'jikan' && a.production && a.configured(env));

  const [shiroSeeds, anilistTop, jikanTop] = await Promise.all([
    shiro?.recommendations ? callWithHealth(env, 'shiro', () => withDeadline(shiro.recommendations!(env, category), PER_PROVIDER_DEADLINE_MS, [] as ProviderTitle[]), [] as ProviderTitle[]) : Promise.resolve([]),
    anilist?.recommendations ? callWithHealth(env, 'anilist', () => withDeadline(anilist.recommendations!(env, category), PER_PROVIDER_DEADLINE_MS, [] as ProviderTitle[]), [] as ProviderTitle[]) : Promise.resolve([]),
    jikan?.recommendations ? callWithHealth(env, 'jikan', () => withDeadline(jikan.recommendations!(env, category), PER_PROVIDER_DEADLINE_MS, [] as ProviderTitle[]), [] as ProviderTitle[]) : Promise.resolve([]),
  ]);

  // Enrich bare SHIRO name-seeds against a real metadata provider so they
  // aren't shown with empty cover/description/author when a match exists.
  // Bounded concurrency (not sequential, not unlimited): a handful of
  // enrichment lookups run at once under a single global deadline, so 8
  // seeds at up to ~4s each can never add up to ~30s on Home. Whatever
  // hasn't resolved by the deadline is returned as its bare seed instead of
  // blocking the response — an enrichment miss degrades gracefully rather
  // than holding up the page.
  const ENRICH_CONCURRENCY = 3;
  const ENRICH_GLOBAL_DEADLINE_MS = 6000;
  const seeds = shiroSeeds.slice(0, 8);
  const enrichedSeeds: ProviderTitle[] = new Array(seeds.length);
  const enrichOne = async (seed: ProviderTitle, i: number) => {
  // SHIRO recommendations are already enriched against MangaDex in
  // shiro.ts when a matching title is found.
  // Only use Jikan as a fallback for seeds that still have no cover.
  if (seed.cover || seed.sourceId !== 'shiro') {
    enrichedSeeds[i] = seed;
    return;
  }

  if (jikan?.search) {
    try {
      const matches = await jikan.search(env, seed.title);
      const exact = matches.find(
        m => m.title.toLowerCase() === seed.title.toLowerCase()
      );
      enrichedSeeds[i] = exact || seed;
      return;
    } catch {
      /* fall through to bare seed */
    }
  }

  enrichedSeeds[i] = seed;
};
  const runPool = async () => {
    let next = 0;
    const workers = Array.from({ length: Math.min(ENRICH_CONCURRENCY, seeds.length) }, async () => {
      while (next < seeds.length) {
        const i = next++;
        await enrichOne(seeds[i], i);
      }
    });
    await Promise.all(workers);
  };
  await withDeadline(runPool(), ENRICH_GLOBAL_DEADLINE_MS, undefined as any);
  // Anything the deadline cut off still has its bare seed as a fallback.
  for (let i = 0; i < seeds.length; i++) if (!enrichedSeeds[i]) enrichedSeeds[i] = seeds[i];

  const seen = new Map<string, CanonicalTitle>();
  for (const p of [...enrichedSeeds, ...anilistTop, ...jikanTop]) {
    try {
      const canonical = await canonicalizeTitle(env, p);
      seen.set(canonical.id, canonical);
    } catch { /* skip unmatchable record */ }
  }
  const ranked = [...seen.values()].sort((a, b) => ((b.popularity || 0) + (b.score || 0) * 1000) - ((a.popularity || 0) + (a.score || 0) * 1000));
  return ranked.slice(0, 24).map(toWire);
}

export async function getTitleById(env: Env, id: string) {
  const t = await getCanonicalTitle(env, id);
  return t ? toWire(t) : null;
}

type ChapterWire = { id: string; number: number | null; volume?: string; label?: string; language: string; publishedAt?: string; pagesCount?: number };

/** Chapters come only from reader-role production sources with an actual
 *  mapping for this canonical title. If the live fetch fails, previously
 *  persisted rows are returned as a graceful degrade — never fake content.
 *  If there is genuinely no reader-capable source mapped and nothing
 *  persisted, this returns an honest empty list. `pagesCount` is read off
 *  whichever source_chapter_mappings row happens to have one, since a
 *  canonical chapter can (in the future) have more than one mapping. */
export async function getChapters(env: Env, titleId: string): Promise<ChapterWire[]> {
  const title = await getCanonicalTitle(env, titleId);
  if (!title) return [];
  const readerMapping = title.sourceMappings.find(m => sourceList.find(a => a.id === m.sourceId)?.role === 'reader');
  if (readerMapping) {
    const adapter = sourceList.find(a => a.id === readerMapping.sourceId && a.production && a.configured(env) && a.chapters);
    if (adapter && !(await isCircuitOpen(env, adapter.id))) {
      const start = Date.now();
      try {
        const chapters = await withDeadline(adapter.chapters!(env, readerMapping.sourceTitleId), 9000, null as any);
        if (chapters) {
          await recordHealth(env, adapter.id, true, Date.now() - start);
          await persistChapters(env, titleId, chapters.map((c: any) => ({ ...c })));
        } else {
          await recordHealth(env, adapter.id, false, Date.now() - start);
        }
      } catch {
        await recordHealth(env, adapter.id, false, Date.now() - start);
      }
    }
  }
  const rows = await env.DB.prepare(
    `SELECT c.id,c.number,c.volume,c.label,c.language,c.published_at, MAX(m.pages_count) as pages_count
     FROM canonical_chapters c LEFT JOIN source_chapter_mappings m ON m.chapter_id=c.id
     WHERE c.title_id=? GROUP BY c.id ORDER BY c.number DESC, c.published_at DESC`
  ).bind(titleId).all<any>();
  return (rows.results || []).map((r: any) => ({
    id: r.id, number: r.number, volume: r.volume || undefined, label: r.label || undefined,
    language: r.language, publishedAt: r.published_at || undefined, pagesCount: r.pages_count ?? undefined,
  }));
}

/** Resolves the "latest" placeholder to a real, persisted chapter id, or
 *  null if the title has no chapters at all yet. Explicitly computed —
 *  never assumed from array/provider order. Numbered chapters win over
 *  unnumbered ones (the highest number, tie-broken by volume then most
 *  recent publish date); only when every chapter is unnumbered/special do
 *  we fall back to the most recently published one. */
export function pickLatestChapter(chapters: ChapterWire[]): ChapterWire | null {
  if (!chapters.length) return null;
  const numbered = chapters.filter(c => typeof c.number === 'number');
  const pool = numbered.length ? numbered : chapters;
  let best = pool[0];
  for (const c of pool.slice(1)) {
    const cNum = c.number ?? -Infinity, bNum = best.number ?? -Infinity;
    if (cNum !== bNum) { if (cNum > bNum) best = c; continue; }
    const cVol = Number(c.volume) || -Infinity, bVol = Number(best.volume) || -Infinity;
    if (cVol !== bVol) { if (cVol > bVol) best = c; continue; }
    const cDate = c.publishedAt ? Date.parse(c.publishedAt) : -Infinity;
    const bDate = best.publishedAt ? Date.parse(best.publishedAt) : -Infinity;
    if (cDate > bDate) best = c;
  }
  return best;
}

export async function resolveLatestChapterId(env: Env, titleId: string): Promise<string | null> {
  const chapters = await getChapters(env, titleId);
  return pickLatestChapter(chapters)?.id || null;
}

/** Pages: honest failure if the mapped reader source can't serve this
 *  chapter — never a silently-substituted chapter and never fake pages. */
export async function getPages(env: Env, titleId: string, chapterId: string): Promise<UnifiedPage[] | null> {
  const chapter = await env.DB.prepare('SELECT id FROM canonical_chapters WHERE id=? AND title_id=?').bind(chapterId, titleId).first<{ id: string }>();
  if (!chapter) return null;
  const title = await getCanonicalTitle(env, titleId);
  if (!title) return null;
  // Prefer whichever mapped source is actually a production reader for
  // this title, so a stray mapping row from a disabled source is never used.
  const mappingRows = await env.DB.prepare('SELECT source_id,source_chapter_id FROM source_chapter_mappings WHERE chapter_id=?').bind(chapterId).all<{ source_id: string; source_chapter_id: string }>();
  for (const m of mappingRows.results || []) {
    const adapter = sourceList.find(a => a.id === m.source_id && a.production && a.configured(env) && a.pages);
    if (!adapter) continue;
    const titleMapping = title.sourceMappings.find(sm => sm.sourceId === m.source_id);
    if (!titleMapping) continue;
    if (await isCircuitOpen(env, adapter.id)) continue;
    const start = Date.now();
    try {
      const pages = await withDeadline(adapter.pages!(env, titleMapping.sourceTitleId, m.source_chapter_id), 9000, null as any);
      await recordHealth(env, adapter.id, !!pages, Date.now() - start);
      if (pages) return pages;
    } catch {
      await recordHealth(env, adapter.id, false, Date.now() - start);
    }
  }
  return null;
}

/** Probes health for every configured production source. Called from the
 *  cron trigger (see index.ts's scheduled handler) — this is the only
 *  proactive background work BUFU does; chapter/page data is otherwise
 *  fetched on demand, not polled in bulk, to stay a light, well-behaved
 *  client of every provider. */
export async function probeAllSourceHealth(env: Env): Promise<void> {
  const providers = productionSources(env).filter(a => a.health);
  await Promise.all(providers.map(a => callWithHealth(env, a.id, () => a.health!(env), false)));
}
