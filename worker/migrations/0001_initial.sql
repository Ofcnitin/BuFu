-- BUFU D1 schema. Consolidated into one migration because this rebuild
-- happened before any real deployment (no live D1 instance has run any
-- prior migration against real data yet) — so there is no migration
-- history to preserve, and a single clean schema is easier to audit than
-- several files layered on top of each other. If you HAVE already run an
-- older version of this file against a live D1 instance, don't apply this
-- one as-is; diff it against your current schema first.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  -- Durable (D1-backed, not in-memory) login/register abuse protection.
  -- One row per IP+kind+10-minute bucket; the count is incremented in
  -- place so this table stays small instead of growing one row per request.
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, -- SHA-256 of the bearer token; the raw token is never stored
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Canonical BUFU titles. `id` is a random UUID, generated once and never
-- re-derived from title text, so two different works that happen to share
-- a name can never collide on canonical ID. `canonical_slug` is NOT unique
-- on purpose — see worker/src/canon.ts.
--
-- `type_source` records which source's classification currently backs
-- `type` (manga/manhwa/manhua). A verified-metadata provider's classifier
-- (AniList countryOfOrigin, Jikan/Kitsu/MangaUpdates' own type field) can
-- overwrite a guess that was only ever based on MangaDex's originalLanguage;
-- once a non-MangaDex classification has been recorded, it is treated as
-- authoritative and left alone. See canon.ts's mergeIntoExisting.
CREATE TABLE IF NOT EXISTS titles (
  id TEXT PRIMARY KEY,
  canonical_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'unknown',
  type_source TEXT,
  reading_mode TEXT NOT NULL DEFAULT 'auto',
  content_rating TEXT NOT NULL DEFAULT 'unknown',
  description TEXT,
  author TEXT,
  artist TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  score REAL,
  popularity INTEGER,
  cover_url TEXT,
  genres_json TEXT NOT NULL DEFAULT '[]',
  latest_known_chapter_number REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS title_aliases (
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  source TEXT,
  PRIMARY KEY (title_id, alias_key)
);

-- sourceId/sourceTitleId/sourceUrl kept as three separate columns (never a
-- source ID collapsed into sourceUrl). UNIQUE(source_id,source_title_id)
-- guarantees one provider item can never end up mapped into two different
-- canonical titles.
CREATE TABLE IF NOT EXISTS source_mappings (
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_title_id TEXT NOT NULL,
  source_url TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (title_id, source_id),
  UNIQUE (source_id, source_title_id)
);

-- Canonical chapters, separated from their per-source mappings so that if a
-- second legitimate reader-capable source is ever added, "Source A Chapter
-- 100" and "Source B Chapter 100" can resolve to ONE canonical_chapters row
-- with two source_chapter_mappings rows, instead of two unrelated chapter
-- records. With exactly one production reader source (MangaDex) today this
-- is 1:1 in practice, but the split is real, not a placeholder — see
-- canon.ts's persistChapters for the conservative matching rules (number,
-- volume, normalized label, language, publication date).
-- `number` is nullable — unnumbered/oneshot chapters are never coerced to 0.
CREATE TABLE IF NOT EXISTS canonical_chapters (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  number REAL,
  volume TEXT,
  label TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per (source_id, source_chapter_id): exactly what a specific
-- provider actually serves for a canonical chapter.
CREATE TABLE IF NOT EXISTS source_chapter_mappings (
  chapter_id TEXT NOT NULL REFERENCES canonical_chapters(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_chapter_id TEXT NOT NULL,
  source_url TEXT,
  pages_count INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chapter_id, source_id),
  UNIQUE (source_id, source_chapter_id)
);

CREATE TABLE IF NOT EXISTS source_health (
  source_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL DEFAULT 1,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms REAL NOT NULL DEFAULT 0,
  circuit_open_until TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- chapter_id here is a canonical_chapters.id (no FK — reading progress must
-- survive a chapter row being re-keyed by re-matching, so this is treated
-- as an opaque last-known pointer rather than an enforced reference).
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  chapter_number REAL,
  page_index INTEGER NOT NULL DEFAULT 0,
  scroll_ratio REAL NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, title_id)
);

CREATE TABLE IF NOT EXISTS library (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'reading',
  last_seen_chapter_number REAL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, title_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, title_id)
);

CREATE TABLE IF NOT EXISTS history (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  chapter_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, title_id)
);

CREATE INDEX IF NOT EXISTS idx_titles_title_key ON titles(title_key);
CREATE INDEX IF NOT EXISTS idx_aliases_alias_key ON title_aliases(alias_key);
CREATE INDEX IF NOT EXISTS idx_source_mappings_title ON source_mappings(title_id);
CREATE INDEX IF NOT EXISTS idx_canonical_chapters_title ON canonical_chapters(title_id, number DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_chapter_mappings_chapter ON source_chapter_mappings(chapter_id);
CREATE INDEX IF NOT EXISTS idx_progress_user_updated ON reading_progress(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_user_updated ON library(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created ON bookmarks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_user_updated ON history(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
