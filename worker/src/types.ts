// ── BUFU canonical data model ────────────────────────────────────────────
// A "canonical" title/chapter is BUFU's own record, built by merging one or
// more provider results. `sourceMappings` is how a canonical record relates
// back to the providers that contributed to it — sourceId/sourceTitleId/
// sourceUrl are kept as three distinct fields (never collapse an ID into a
// URL string) so a mapping can be looked up, re-derived into a URL, or
// re-verified independently.

export type MediaType = 'manga' | 'manhwa' | 'manhua' | 'unknown';
// Kept separate from MediaType on purpose — see adapters/mangadex.ts for why
// content rating must never be used to infer manga/manhwa/manhua.
export type ContentRating = 'safe' | 'suggestive' | 'erotica' | 'pornographic' | 'unknown';
export type ReadingMode = 'page' | 'vertical' | 'auto';
export type PublicationStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'unknown';

export type SourceTitleMapping = {
  sourceId: string;
  sourceTitleId: string;
  sourceUrl?: string;
};

export type SourceChapterMapping = {
  sourceId: string;
  sourceChapterId: string;
  sourceUrl?: string;
};

// What an adapter hands back for one provider hit, before canonicalization.
// Distinct from CanonicalTitle: this is single-source, not yet merged, and
// carries exactly one sourceId/sourceTitleId pair rather than a mapping list.
export type ProviderTitle = {
  sourceId: string;
  sourceTitleId: string;
  sourceUrl?: string;
  title: string;
  altTitles: string[];
  description?: string;
  type: MediaType;
  contentRating: ContentRating;
  readingMode: ReadingMode;
  status: PublicationStatus;
  author?: string;
  artist?: string;
  genres: string[];
  score?: number;
  popularity?: number;
  cover?: string;
  year?: number;
  originalLanguage?: string;
};

export type CanonicalTitle = {
  id: string; // stable, collision-safe (crypto.randomUUID()); never re-derived from title text
  slug: string;
  title: string;
  altTitles: string[];
  aliases: string[];
  description?: string;
  type: MediaType;
  contentRating: ContentRating;
  readingMode: ReadingMode;
  status: PublicationStatus;
  author?: string;
  artist?: string;
  genres: string[];
  score?: number;
  popularity?: number;
  cover?: string;
  sourceMappings: SourceTitleMapping[];
  latestKnownChapterNumber?: number;
  // Which source's classification currently backs `type` — see
  // canon.ts's mergeIntoExisting for how this gates future overwrites.
  typeSource?: string;
  updatedAt: string;
};

export type ProviderChapter = {
  sourceId: string;
  sourceChapterId: string;
  sourceUrl?: string;
  number: number | null; // null = unnumbered/oneshot; never coerced to 0
  volume?: string;
  label?: string;
  language: string;
  publishedAt?: string;
  pagesCount?: number;
  external?: boolean; // MangaDex "externalUrl" chapters point off-platform; never treated as readable
};

export type CanonicalChapter = {
  id: string; // stable, collision-safe
  titleId: string;
  number: number | null;
  volume?: string;
  label?: string;
  language: string;
  publishedAt?: string;
  pagesCount?: number;
  sourceMappings: SourceChapterMapping[];
};

export type UnifiedPage = { index: number; src: string; width?: number; height?: number; alt: string };

export type SourceResult<T> = {
  sourceId: string;
  value?: T;
  error?: string;
  status?: number;
  latencyMs?: number;
};

export type Env = {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  MANGADEX_ACCESS_TOKEN?: string;
  ANILIST_URL?: string;
  JIKAN_URL?: string;
  KITSU_URL?: string;
  SHIRO_URL?: string;
  MANGAUPDATES_URL?: string;
  SESSION_SECRET?: string;
};
