// Reference types mirroring the Worker's actual `/api/*` JSON shape (see
// orchestrator.ts's `toWire()` and index.ts's route handlers for the
// source of truth). Neither the frontend (plain JS, no bundler/imports)
// nor the Worker (worker/src/types.ts is self-contained) currently import
// this package — it exists as a typed reference for anything built
// against the BUFU API later, not as a dependency of either app today.

export type MediaType = 'manga' | 'manhwa' | 'manhua' | 'unknown';
export type ContentRating = 'safe' | 'suggestive' | 'erotica' | 'pornographic' | 'unknown';
export type ReadingMode = 'page' | 'vertical' | 'auto';
export type PublicationStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'unknown';

/** GET /api/title/:id, /api/search, /api/recommendations */
export type WireTitle = {
  id: string;
  slug: string;
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
  sources: string[];
  /** True only when a reader-capable source (MangaDex today) is actually
   *  mapped to this title — never true for metadata-only discovery. */
  readable: boolean;
};

/** GET /api/title/:id/chapters */
export type WireChapter = {
  id: string;
  number: number | null;
  volume?: string;
  label?: string;
  language: string;
  publishedAt?: string;
  pagesCount?: number;
};

/** GET /api/title/:id/chapter/:chapterId/pages */
export type WirePage = { index: number; src: string; width?: number; height?: number; alt: string };

export type LibraryStatus = 'reading' | 'completed' | 'on-hold' | 'dropped' | 'plan-to-read';

export type ReadingProgress = {
  titleId: string;
  chapterId: string;
  chapterNumber: number | null;
  pageIndex: number;
  scrollRatio: number;
  completed: boolean;
  updatedAt: string;
};
