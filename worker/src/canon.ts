import type { CanonicalTitle, Env, ProviderChapter, ProviderTitle } from './types';
import { normalizeKey, nowIso, slugify, uuid } from './utils';

// ── Canonical title matching ─────────────────────────────────────────────
// Priority, per spec: (1) exact source ID already mapped, (2) exact
// normalized title, (3) known alias, (4) alternate title, (5) supporting
// metadata (author/type/language) as a tie-breaker, (6) conservative fuzzy
// matching as a last resort, gated on the same author/type corroboration as
// (5) — never on string similarity alone. We never merge on vague
// similarity alone, and when normalized-title matches are ambiguous
// (multiple distinct existing canonical titles share the exact same
// normalized title, with nothing to disambiguate them) we deliberately do
// NOT merge — a duplicate canonical title is a much smaller problem than
// silently combining two different works. Canonical IDs are
// crypto.randomUUID()s, generated once and never re-derived from title
// text, so two different works that happen to share a name can never
// collide.

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
    aliases: (aliasRows.results || []).map((a: { alias: string }) => a.alias),
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
  // title_aliases' primary key is (title_id, alias_key), NOT alias_key alone —
  // two different canonical titles can legitimately share the same alias (a
  // common alternate spelling, a short/ambiguous alt title, etc). A bare
  // `LIMIT 1` here is exactly the arbitrary-match this project must never do:
  // it would pick whichever row happened to be inserted first and silently
  // merge an unrelated title into it. Only auto-match when every row sharing
  // this alias_key points at the same title_id — otherwise treat it as
  // unresolved and let the caller fall through to fuzzy/creation logic.
  const rows = await env.DB.prepare('SELECT DISTINCT title_id FROM title_aliases WHERE alias_key=?').bind(aliasKey).all<{ title_id: string }>();
  const ids = rows.results || [];
  return ids.length === 1 ? ids[0].title_id : null;
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

  // 6. conservative fuzzy — only within a length/first-letter-narrowed pool,
  // high similarity threshold, AND at least one independent corroborating
  // signal (matching author, or matching a non-unknown type). String
  // similarity alone was previously sufficient here, which is exactly the
  // "The Beginning After the End" vs "The Beginning After the End: ..."
  // false-merge risk — two different works can be lexically near-identical.
  // A false merge silently corrupts the catalog; a missed merge just leaves
  // a recoverable duplicate. With no corroborating signal available on
  // either side, we deliberately do not fuzzy-merge at all.
  if (!canonicalId && titleKey.length >= 4) {
    const pool = await env.DB.prepare(
      "SELECT id,title_key,author,type FROM titles WHERE substr(title_key,1,1)=? AND length(title_key) BETWEEN ? AND ?"
    ).bind(titleKey[0], titleKey.length - 3, titleKey.length + 3).all<{ id: string; title_key: string; author: string | null; type: string }>();
    let best: { id: string; sim: number } | null = null;
    for (const row of pool.results || []) {
      const sim = similarity(titleKey, row.title_key);
      if (sim < 0.93) continue;
      const authorAgrees = !!(p.author && row.author && normalizeKey(p.author) === normalizeKey(row.author));
      const typeAgrees = !!(p.type !== 'unknown' && row.type !== 'unknown' && p.type === row.type);
      if (!authorAgrees && !typeAgrees) continue;
      if (!best || sim > best.sim) best = { id: row.id, sim };
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
// classification. Every other provider's classification is also not
// equally trustworthy: AniList's countryOfOrigin is a direct, structured
// field; Jikan/Kitsu/MangaUpdates each infer from their own listing type;
// SHIRO's seeds are unresolved until MangaDex-matched (see shiro.ts — an
// unresolved seed's type is intentionally 'unknown', never treated as
// confirmed). A classification is overwritten when the incoming source is
// strictly more confident than whatever set the current type, or when the
// same source is reaffirming its own earlier call — never when a
// lower-or-equal-confidence source disagrees, so a single low-confidence
// guess can't get "locked in" against a later, better source, and two
// equally-confident sources can't flip-flop against each other.
const SOURCE_TYPE_CONFIDENCE: Record<string, number> = {
  mangadex: 0, shiro: 0, kitsu: 1, jikan: 1, mangaupdates: 1, anilist: 2,
};
function shouldAdoptType(existingTypeSource: string | null, incomingSourceId: string): boolean {
  if (!existingTypeSource) return true;
  if (existingTypeSource === incomingSourceId) return true;
  const existingConf = SOURCE_TYPE_CONFIDENCE[existingTypeSource] ?? 1;
  const incomingConf = SOURCE_TYPE_CONFIDENCE[incomingSourceId] ?? 1;
  return incomingConf > existingConf;
}

async function mergeIntoExisting(env: Env, titleId: string, p: ProviderTitle, titleKey: string): Promise<void> {
  // Guard: a source mapping (source_id, source_title_id) is the ground
  // truth that "this exact provider record is this exact canonical work" —
  // once established it must be immutable, never silently moved by a later
  // title/alias/fuzzy resolution. In normal operation this can't trigger:
  // canonicalizeTitle's step 1 (exact source lookup) always resolves to
  // whatever this mapping already points to before steps 2–6 ever run, so
  // titleId here should already equal existingMapping.title_id. This check
  // is the load-bearing backstop against that invariant ever breaking —
  // from a future matching-logic change, an ID-format mismatch between two
  // calls for "the same" provider record, or anything else that lets a
  // stale/fuzzy resolution reach this function with the wrong titleId. If
  // it ever fires, the existing mapping wins and nothing is written.
  //
  // This SELECT-then-act check is still a TOCTOU window on its own — a
  // second concurrent request for this exact (source_id, source_title_id)
  // could run its own SELECT before either has written anything, see no
  // conflict, and reach the upsert below with a *different* titleId. The
  // upsert's WHERE clause (see below) is what actually closes that window
  // at the database level; this early check is a cheap pre-filter for the
  // common non-racing case, not the sole line of defense.
  const existingMapping = await env.DB.prepare(
    'SELECT title_id FROM source_mappings WHERE source_id=? AND source_title_id=?'
  ).bind(p.sourceId, p.sourceTitleId).first<{ title_id: string }>();
  if (existingMapping && existingMapping.title_id !== titleId) {
    console.error(`canon: refused to reassign source mapping ${p.sourceId}/${p.sourceTitleId} from ${existingMapping.title_id} to ${titleId} — leaving it untouched`);
    return;
  }

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

  // Atomic claim, enforced by SQLite/D1 itself rather than by the app-level
  // check above: the WHERE clause on the DO UPDATE makes the write a no-op
  // whenever the existing row's title_id isn't already ours, so a second
  // request racing past the pre-check with a *different* titleId can only
  // ever refresh a mapping it already owns — it can never steal one that a
  // concurrent request just established for someone else. This is what
  // "safe at the database level" actually means here: the invariant holds
  // even if two isolates run this function for the same provider record at
  // the exact same moment.
  await env.DB.prepare(
    `INSERT INTO source_mappings(title_id,source_id,source_title_id,source_url,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(source_id,source_title_id) DO UPDATE SET source_url=excluded.source_url, updated_at=excluded.updated_at
     WHERE source_mappings.title_id = excluded.title_id`
  ).bind(titleId, p.sourceId, p.sourceTitleId, p.sourceUrl || null, nowIso()).run();

  // Re-verify after the write: if the row still doesn't belong to titleId,
  // this request lost the race (someone else's insert landed first and the
  // WHERE clause above correctly refused to overwrite it). The metadata
  // UPDATE just above already ran against titleId's own row, which is
  // harmless — it's still a real, independently-valid canonical title —
  // but this provider record's aliases must never attach to a title it
  // doesn't actually map to, so stop before adding them.
  const after = await env.DB.prepare(
    'SELECT title_id FROM source_mappings WHERE source_id=? AND source_title_id=?'
  ).bind(p.sourceId, p.sourceTitleId).first<{ title_id: string }>();
  if (!after || after.title_id !== titleId) {
    console.error(`canon: lost a concurrent claim for ${p.sourceId}/${p.sourceTitleId} to ${after?.title_id ?? 'unknown'} — not attaching its aliases to ${titleId}`);
    return;
  }

  for (const alt of [p.title, ...p.altTitles]) {
    const key = normalizeKey(alt);
    if (!key || key === titleKey) continue;
    await env.DB.prepare('INSERT OR IGNORE INTO title_aliases(title_id,alias,alias_key,source) VALUES(?,?,?,?)').bind(titleId, alt, key, p.sourceId).run();
  }
}

/** Creates a brand-new canonical title for a provider record that none of
 *  canonicalizeTitle's steps 1–6 matched to anything existing.
 *
 *  The concurrency hazard: step 1's "is this exact source ID already
 *  mapped?" read (findCandidateByExactSource) and this function's own
 *  INSERTs are two separate round trips, not one atomic operation. Two
 *  simultaneous requests processing the *same* provider record (the same
 *  sourceId+sourceTitleId — e.g. two users searching the same query at the
 *  same moment, or a live search racing the scheduled stale-library
 *  refresh) can both miss that read, and both reach here, and without a
 *  DB-level guard both would create their own canonical title row for what
 *  is verifiably one work — an unrecoverable duplicate, not just a
 *  cosmetic one, since "verified identity" is exactly the case the spec
 *  above calls out.
 *
 *  The fix leans on the schema's existing UNIQUE(source_id,source_title_id)
 *  constraint on source_mappings, which SQLite/D1 enforces atomically
 *  regardless of how many isolates are racing: only one INSERT for a given
 *  identity can ever succeed. `ON CONFLICT ... DO NOTHING` turns the
 *  loser's insert into a detectable no-op (via `meta.changes`) instead of a
 *  thrown constraint error, so the loser can clean up its now-orphaned
 *  titles row (nothing else references it yet — the mapping insert that
 *  would have is exactly what just failed) and adopt the winner's
 *  canonical title instead of returning a duplicate. This never touches
 *  the ambiguous/fuzzy-match logic above — it only ever fires when two
 *  requests agree, byte-for-byte, on the exact same provider identity. */
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

  const claim = await env.DB.prepare(
    `INSERT INTO source_mappings(title_id,source_id,source_title_id,source_url,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(source_id,source_title_id) DO NOTHING`
  ).bind(id, p.sourceId, p.sourceTitleId, p.sourceUrl || null, nowIso()).run();

  const won = (claim.meta?.changes ?? 0) > 0;
  if (!won) {
    // Lost the race: a concurrent request already claimed this exact
    // identity for a different canonical title. Discard the orphan we just
    // created — it has no source_mappings row (that insert is precisely
    // what just no-op'd) and no aliases yet, so a plain delete is a
    // complete, safe rollback — and merge this provider record's metadata
    // and aliases into the winner instead of returning a duplicate.
    await env.DB.prepare('DELETE FROM titles WHERE id=?').bind(id).run();
    const winnerId = await findCandidateByExactSource(env, p.sourceId, p.sourceTitleId);
    if (winnerId) {
      await mergeIntoExisting(env, winnerId, p, titleKey);
      const winner = await loadTitleRow(env, winnerId);
      if (winner) return winner;
    }
    // Vanishingly unlikely (the winner would have to be deleted between our
    // conflicting insert and this read) — fall through and create fresh
    // rather than throw.
    return createCanonicalTitle(env, p, titleKey);
  }

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
