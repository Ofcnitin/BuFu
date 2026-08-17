# BUFU Product Contract

## Non-negotiable behavior

1. Duplicate titles across providers become one canonical BUFU result
   (`worker/src/canon.ts`) — conservative matching only; two different
   works never get merged just because their names are similar.
2. User progress, library, bookmarks, and history are attached to the
   canonical title/chapter, never to a source-specific ID.
3. MangaDex is currently BUFU's only reader-capable source. A MangaDex
   failure is reported as an honest unavailable state — never silently
   routed to an unverified or unauthorized source.
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
