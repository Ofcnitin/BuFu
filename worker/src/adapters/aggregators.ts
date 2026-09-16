// ── Disabled-by-design: NOT part of the production source list ──────────
// This file intentionally does NOT call register() for anything below, so
// none of these ever appear in registry.ts's sourceList — they cannot
// participate in search, recommendations, chapters, or page fallback no
// matter what env vars are set. That's enforced structurally, not just by
// omission.
//
// Why: Manga-Novel, Comick Source, MangaHook, AIO Webtoon Downloader,
// Manganato, and MangaK have no verified, documented public API. The
// pre-rebuild version of this file invented endpoint paths, request
// shapes, and response fields for all six — none of that was ever
// confirmed against real documentation, because none of these projects
// publish any. Shipping fabricated integrations to unauthorized
// scanlation aggregators is exactly what this rebuild was asked to
// remove.
//
// If one of these (or a similar project) is ever legitimately verified —
// official docs, a stable public endpoint, and clarity on its content
// licensing/permissions — a real adapter can be written against that
// verified contract and registered in registry.ts the same way
// worker/src/adapters/mangadex.ts is. Nothing here should be used as a
// starting point for that; it was never verified in the first place.

export const disabledSourceIds = [
  'manga-novel',
  'comick-source',
  'mangahook',
  'aio-webtoon',
  'manganato',
  'mangak',
] as const;
