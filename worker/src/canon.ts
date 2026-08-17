import type { CanonicalTitle, Env, ProviderChapter, ProviderTitle } from './types';
import { normalizeKey, nowIso, slugify, uuid } from './utils';

// ── Canonical title matching ─────────────────────────────────────────────
// Priority, per spec: (1) exact source ID already mapped, (2) exact
// normalized title, (3) known alias, (4) alternate title, (5) supporting
// metadata (author/type/language) as a tie-breaker, (6) conservative fuzzy
// matching as a last resort. We never merge on vague similarity alone, and
// when normalized-title matches are ambiguous (multiple distinct existing
// canonical titles share the exact same normalized title, with nothing to
// disambiguate them) we deliberately do NOT merge — a duplicate canonical
// title is a much smaller problem than silently combining two different
// works. Canonical IDs are crypto.randomUUID()s, generated once and never
// re-derived from title text, so two different works that happen to share
// a name can never collide.

function similarity(a: string, b: string): number {
  // Conservative Levenshtein-ratio, only ever used to disambiguate among an
  // already-narrowed candidate set — never as a first pass over everything.
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const dp = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) dp[j] = j;
  for (let i = 1; i <= la; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return 1 - dp[lb] / Math.max(la, lb);
}

type TitleRow = {
  id: string; canonical_slug: string; title: string; title_key: string; type: string; type_source: string | null;
  reading_mode: string; description: string | null; author: string | null; artist: string | null;
  status: string | null; content_rating: string | null; score: number | null; popularity: number | null;
  cover_url: string | null; genres_json: string; latest_known_chapter_number: number | null; updated_at: string;
};

async function loadTitleRow(env: Env, id: string): Promise<CanonicalTitle | null> {
  const row = await env.DB.prepare('SELECT * FROM titles WHERE id=?').bind(id).first<TitleRow>();
  if (!row) return null;
  const aliasRows = await env.DB.prepare('SELECT alias FROM title_aliases WHERE title_id=?').bind(id).all<{ alias: string }>();
  const mapRows = await env.DB.prepare('SELECT source_id,source_title_id,source_url FROM source_mappings WHERE title_id=?').bind(id).all<any>();
  let genres: string[] = [];
  try { genres = JSON.parse(row.genres_json || '[]'); } catch { genres = []; }
  return {
    id: row.id, slug: row.canonical_slug, title: row.title, altTitles: [],
    aliases: (aliasRows.results || []).map(a => a.alias),
    description: row.description || undefined, type: row.type as any,
    contentRating: (row.content_rating as any) || 'unknown',
    readingMode: row.reading_mode as any, status: (row.status as any) || 'unknown',
    author: row.author || undefined, artist: row.artist || undefined, genres,
    score: row.score ?? undefined, popularity: row.popularity ?? undefined, cover: row.cover_url || undefined,
    sourceMappings: (mapRows.results || []).map((m: any) => ({ sourceId: m.source_id, sourceTitleId: m.source_title_id, sourceUrl: m.source_url || undefined })),
    latestKnownChapterNumber: row.latest_known_chapter_number ?? undefined,
    typeSource: row.type_source || undefined,
    updatedAt: row.updated_at,
  };
}

async function findCandidateByExactSource(env: Env, sourceId: string, sourceTitleId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT title_id FROM source_mappings WHERE source_id=? AND source_title_id=?').bind(sourceId, sourceTitleId).first<{ title_id: string }>();
  return row?.title_id || null;
}

async function findCandidatesByTitleKey(env: Env, titleKey: string): Promise<TitleRow[]> {
  const rows = await env.DB.prepare('SELECT * FROM titles WHERE title_key=?').bind(titleKey).all<TitleRow>();
  return rows.results || [];
}
async function findCandidateByAlias(env: Env, aliasKey: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT title_id FROM title_aliases WHERE alias_key=? LIMIT 1').bind(aliasKey).first<{ title_id: string }>();
  return row?.title_id || null;
}

/** Resolves (or creates) the canonical title a ProviderTitle belongs to, and persists the mapping. */
export async function canonicalizeTitle(env: Env, p: ProviderTitle): Promise<CanonicalTitle> {
  const titleKey = normalizeKey(p.title);

  // 1. exact source ID already mapped
  let canonicalId = await findCandidateByExactSource(env, p.sourceId, p.sourceTitleId);

  // 2 & 5. exact normalized title, disambiguated by author/type when ambiguous
  if (!canonicalId) {
    const candidates = await findCandidatesByTitleKey(env, titleKey);
    if (candidates.length === 1) {
      canonicalId = candidates[0].id;
    } else if (candidates.length > 1) {
      const scored = candidates.filter(c =>
        (p.author && c.author && normalizeKey(c.author) === normalizeKey(p.author)) ||
        (c.type !== 'unknown' && c.type === p.type)
      );
      if (scored.length === 1) canonicalId = scored[0].id;
      // else: genuinely ambiguous — fall through and create a new canonical title
    }
  }

  // 3. known alias
  if (!canonicalId) canonicalId = await findCandidateByAlias(env, titleKey);

  // 4. alternate titles, checked against both title_key and alias_key
  if (!canonicalId) {
    for (const alt of p.altTitles) {
      const altKey = normalizeKey(alt);
      if (!altKey) continue;
      const byTitle = await findCandidatesByTitleKey(env, altKey);
      if (byTitle.length === 1) { canonicalId = byTitle[0].id; break; }
      const byAlias = await findCandidateByAlias(env, altKey);
      if (byAlias) { canonicalId = byAlias; break; }
    }
  }

  // 6. conservative fuzzy — only within a length/first-letter-narrowed pool, high threshold
  if (!canonicalId && titleKey.length >= 4) {
    const pool = await env.DB.prepare(
      "SELECT id,title_key FROM titles WHERE substr(title_key,1,1)=? AND length(title_key) BETWEEN ? AND ?"
    ).bind(titleKey[0], titleKey.length - 3, titleKey.length + 3).all<{ id: string; title_key: string }>();
    let best: { id: string; sim: number } | null = null;
    for (const row of pool.results || []) {
      const sim = similarity(titleKey, row.title_key);
      if (sim >= 0.93 && (!best || sim > best.sim)) best = { id: row.id, sim };
    }
    if (best) canonicalId = best.id;
  }

  if (canonicalId) {
    await mergeIntoExisting(env, canonicalId, p, titleKey);
    return (await loadTitleRow(env, canonicalId))!;
  }
  return createCanonicalTitle(env, p, titleKey);
}

// MangaDex's `type` is derived only from originalLanguage (see
// adapters/mangadex.ts) — a supporting signal, not a verified media-type
// classification. AniList (countryOfOrigin), Jikan/Kitsu/MangaUpdates (each
// provider's own manga/manhwa/manhua field) are treated as stronger,
// independently-sourced signals. A classification is overwritten only when
// it hasn't been set yet, when it currently traces back to MangaDex's
// language guess, or when the same source is reaffirming its own earlier
// call — never when two different non-MangaDex providers disagree, so we
// don't flip-flop between two "verified" sources with different opinions.
function shouldAdoptType(existingTypeSource: string | null, incomingSourceId: string): boolean {
  return !existingTypeSource || existingTypeSource === 'mangadex' || existingTypeSource === incomingSourceId;
}

async function mergeIntoExisting(env: Env, titleId: string, p: ProviderTitle, titleKey: string): Promise<void> {
  const existing = await env.DB.prepare('SELECT * FROM titles WHERE id=?').bind(titleId).first<TitleRow>();
  if (!existing) return;
  let genres: string[] = [];
  try { genres = JSON.parse(existing.genres_json || '[]'); } catch {}
  const mergedGenres = Array.from(new Set([...genres, ...p.genres])).slice(0, 24);
  const adoptType = p.type !== 'unknown' && shouldAdoptType(existing.type_source, p.sourceId);
  await env.DB.prepare(
    `UPDATE titles SET
       description=COALESCE(?,description), author=COALESCE(?,author), artist=COALESCE(?,artist),
       status=CASE WHEN status IS NULL OR status='unknown' THEN ? ELSE status END,
       content_rating=CASE WHEN content_rating IS NULL OR content_rating='unknown' THEN ? ELSE content_rating END,
       score=COALESCE(?,score), popularity=COALESCE(?,popularity), cover_url=COALESCE(?,cover_url),
       genres_json=?, type=CASE WHEN ? THEN ? ELSE type END, type_source=CASE WHEN ? THEN ? ELSE type_source END,
       updated_at=?
     WHERE id=?`
  ).bind(
    p.description || null, p.author || null, p.artist || null, p.status, p.contentRating,
    p.score ?? null, p.popularity ?? null, p.cover || null, JSON.stringify(mergedGenres),
    adoptType ? 1 : 0, p.type, adoptType ? 1 : 0, p.sourceId,
    nowIso(), titleId
  ).run();

  await env.DB.prepare(
    `INSERT INTO source_mappings(title_id,source_id,source_title_id,source_url,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(source_id,source_title_id) DO UPDATE SET title_id=excluded.title_id, source_url=excluded.source_url, updated_at=excluded.updated_at`
  ).bind(titleId, p.sourceId, p.sourceTitleId, p.sourceUrl || null, nowIso()).run();

  for (const alt of [p.title, ...p.altTitles]) {
    const key = normalizeKey(alt);
    if (!key || key === titleKey) continue;
    await env.DB.prepare('INSERT OR IGNORE INTO title_aliases(title_id,alias,alias_key,source) VALUES(?,?,?,?)').bind(titleId, alt, key, p.sourceId).run();
  }
}

async function createCanonicalTitle(env: Env, p: ProviderTitle, titleKey: string): Promise<CanonicalTitle> {
  const id = uuid(); // collision-safe: random, never derived from title text
  const slug = slugify(p.title);
  await env.DB.prepare(
    `INSERT INTO titles(id,canonical_slug,title,title_key,type,type_source,reading_mode,description,author,artist,status,content_rating,score,popularity,cover_url,genres_json,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, slug, p.title, titleKey, p.type, p.type !== 'unknown' ? p.sourceId : null, p.readingMode, p.description || null, p.author || null, p.artist || null,
    p.status, p.contentRating, p.score ?? null, p.popularity ?? null, p.cover || null, JSON.stringify(p.genres || []), nowIso()
  ).run();
  await env.DB.prepare('INSERT INTO source_mappings(title_id,source_id,source_title_id,source_url,updated_at) VALUES(?,?,?,?,?)')
    .bind(id, p.sourceId, p.sourceTitleId, p.sourceUrl || null, nowIso()).run();
  for (const alt of p.altTitles) {
    const key = normalizeKey(alt);
    if (!key || key === titleKey) continue;
    await env.DB.prepare('INSERT OR IGNORE INTO title_aliases(title_id,alias,alias_key,source) VALUES(?,?,?,?)').bind(id, alt, key, p.sourceId).run();
  }
  return (await loadTitleRow(env, id))!;
}

export async function getCanonicalTitle(env: Env, id: string): Promise<CanonicalTitle | null> {
  return loadTitleRow(env, id);
}

type ChapterCandidate = { id: string; number: number | null; volume: string | null; label: string | null; language: string };
const normLabel = (v?: string | null) => (v || '').toLowerCase().trim().replace(/\s+/g, ' ');

/** Finds an existing canonical chapter this provider chapter should attach
 *  to, or null if a new canonical chapter should be created. Conservative
 *  on purpose: same title, same language, same number (or same normalized
 *  label when both are unnumbered/special), and — when both sides state a
 *  volume — the same volume. Genuinely different specials (different
 *  labels, no shared number) are never merged. */
async function findMatchingChapter(env: Env, titleId: string, c: ProviderChapter): Promise<string | null> {
  const rows = await env.DB.prepare(
    'SELECT id,number,volume,label,language FROM canonical_chapters WHERE title_id=? AND language=?'
  ).bind(titleId, c.language).all<ChapterCandidate>();
  const candidates = rows.results || [];
  const incomingLabel = normLabel(c.label);
  for (const row of candidates) {
    if (typeof c.number === 'number' && typeof row.number === 'number') {
      if (row.number !== c.number) continue;
    } else if (c.number === null && row.number === null) {
      // Both unnumbered — only the same special/oneshot if the labels agree.
      if (!incomingLabel || normLabel(row.label) !== incomingLabel) continue;
    } else {
      continue; // one numbered, one not — never merge
    }
    // Volume is a further, non-decisive check: only rejects a match when
    // BOTH sides state a volume and they disagree.
    if (c.volume && row.volume && String(c.volume) !== String(row.volume)) continue;
    return row.id;
  }
  return null;
}

/** Persists provider chapters into canonical_chapters + source_chapter_mappings.
 *  A provider chapter first checks whether it's already mapped from this exact
 *  (sourceId, sourceChapterId) — if so it updates that mapping and its parent
 *  canonical row directly. Otherwise it runs conservative matching
 *  (findMatchingChapter) against this title's existing canonical chapters
 *  before deciding to create a new one. With exactly one production reader
 *  source (MangaDex) today this resolves 1:1 in practice, but the structure
 *  is real: a second legitimate reader source would merge into the same
 *  canonical_chapters rows instead of producing parallel chapter lists. */
export async function persistChapters(env: Env, titleId: string, chapters: ProviderChapter[]): Promise<void> {
  let maxNumber: number | null = null;
  for (const c of chapters) {
    if (c.external) continue; // never persist externally-hosted chapters as readable
    const existingMapping = await env.DB.prepare(
      'SELECT chapter_id FROM source_chapter_mappings WHERE source_id=? AND source_chapter_id=?'
    ).bind(c.sourceId, c.sourceChapterId).first<{ chapter_id: string }>();

    let chapterId = existingMapping?.chapter_id || await findMatchingChapter(env, titleId, c);
    if (!chapterId) {
      chapterId = uuid();
      await env.DB.prepare(
        `INSERT INTO canonical_chapters(id,title_id,number,volume,label,language,published_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?)`
      ).bind(chapterId, titleId, c.number, c.volume || null, c.label || null, c.language, c.publishedAt || null, nowIso()).run();
    } else {
      // Refresh the canonical row from whichever provider reports it most
      // recently — COALESCE keeps a previously-known volume/label/date if
      // this pass doesn't have one, rather than blanking it out.
      await env.DB.prepare(
        `UPDATE canonical_chapters SET number=?, volume=COALESCE(?,volume), label=COALESCE(?,label),
           published_at=COALESCE(?,published_at), updated_at=? WHERE id=?`
      ).bind(c.number, c.volume || null, c.label || null, c.publishedAt || null, nowIso(), chapterId).run();
    }

    await env.DB.prepare(
      `INSERT INTO source_chapter_mappings(chapter_id,source_id,source_chapter_id,source_url,pages_count,updated_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(source_id,source_chapter_id) DO UPDATE SET
         chapter_id=excluded.chapter_id, source_url=excluded.source_url,
         pages_count=excluded.pages_count, updated_at=excluded.updated_at`
    ).bind(chapterId, c.sourceId, c.sourceChapterId, c.sourceUrl || null, c.pagesCount ?? null, nowIso()).run();

    if (typeof c.number === 'number' && (maxNumber === null || c.number > maxNumber)) maxNumber = c.number;
  }
  if (maxNumber !== null) {
    await env.DB.prepare('UPDATE titles SET latest_known_chapter_number=MAX(COALESCE(latest_known_chapter_number,0),?) WHERE id=?').bind(maxNumber, titleId).run();
  }
}
