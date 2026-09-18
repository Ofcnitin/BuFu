# BUFU Product Contract

## Non-negotiable behavior

1. Duplicate titles across providers become one canonical BUFU result
   (`worker/src/canon.ts`) — conservative matching only; two different
   works never get merged just because their names are similar.
2. User progress, library, bookmarks, and history are attached to the
   canonical title/chapter, never to a source-specific ID.
3. MangaDex is BUFU's priority reader source — verified, ToS-documented,
   tried first for every mapped title (`READER_SOURCE_PRIORITY` in
   `worker/src/orchestrator.ts`). When a title also has a mapping to an
   explicitly configured Nyora-backed or self-hosted reader source, BUFU
   falls through to those, in a fixed priority order, on a MangaDex
   failure, timeout, open circuit, *or* a successful-but-empty chapter/page
   response — an empty result from a healthy source is not treated as "the
   answer," since a lower-priority source may still have real content. It
   never falls through to a source that isn't mapped to that exact title,
   and never to one that isn't configured/production — only to
   alternatives you've actually enabled and BUFU has actually verified are
   mapped to this specific work. Only once every mapped source has been
   tried does BUFU fall back to previously persisted chapter data, or show
   an honest unavailable state.
4. Source health is tracked server-side (D1) with a 3-failure circuit
   breaker and a cooldown-then-probe recovery.
5. Manga defaults to page reading; manhwa/manhua default to continuous
   vertical reading, derived from each title's verified original
   language/type — never from its content rating. Users can override.
6. Progress is held in memory immediately, throttled to localStorage, and
   debounced to D1 when authenticated.
7. Secrets (the optional MangaDex token, session tokens) never ship to
   GitHub Pages or appear in an API response.
8. The frontend stays source-agnostic and only ever consumes BUFU's own
   normalized `/api/*` contract — never a provider directly.

## Reader contract

### Page mode (manga)
- keyboard arrows and tap-zone navigation
- page counter, resume by exact page index
- chapter auto-advance at the final page
- progress saved on every page change

### Vertical mode (manhwa/manhua)
- continuous scroll, lazy-loaded images
- current position tracked via IntersectionObserver (the most-visible
  page), not a single scrollTop/scrollHeight snapshot
- resume waits for images up to the target page to load (bounded by a
  timeout), scrolls the target into view, then runs one correction pass
  shortly after to absorb late layout shift from images still loading
- progress throttled/debounced before any sync

### Image failures
Any page image that fails to load is replaced with a retry tile — never a
broken image, never a crashed reader, never lost reading position.

## Failure contract

A title with no reader-capable source mapping shows real metadata with an
honest "not readable yet" state — never a fake page. An invalid explicit
chapter ID shows "Chapter Not Found" — BUFU never silently substitutes a
different chapter. A missing title ID shows "Title Not Found" — never a
silent fallback to another title.
