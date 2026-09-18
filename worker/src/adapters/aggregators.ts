/**
 * Legacy disabled-source list.
 *
 * The old rebuild contained speculative adapters for these projects. They
 * remain listed here only as historical IDs; the real implementations now
 * live in nyora.ts and external.ts and are guarded by explicit configuration.
 */
export const legacyDisabledSourceIds = [
  'manga-novel',
  'comick-source',
  'mangahook',
  'aio-webtoon',
  'manganato',
  'mangak',
] as const;
