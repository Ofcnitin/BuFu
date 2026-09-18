# Security/loophole audit — this round

Scope: full read-through of `worker/` (routing, auth, orchestrator, canon,
every adapter) and `frontend/`. SQL injection, XSS, IDOR/ownership, auth,
SSRF, DoS/abuse, and content-safety were all checked. This is already a
well-hardened codebase — parameterized SQL everywhere, consistent
`user_id`-scoped ownership checks on every `/api/me/*` write, consistent
`escapeXml`/`safeImgSrc`/`safeHref` on every dynamic string that reaches
`innerHTML`, a strict `script-src 'self'` CSP, and real race-condition
handling in the title-dedup logic (`canon.ts`). Four real, fixable issues
were found and fixed. Two more are flagged below as product decisions, not
silently changed.

## Fixed

### 1. Explicit opt-in to pornographic content, with no age gate anywhere (highest severity)
`adapters/mangadex.ts`'s chapter-feed request explicitly added
`contentRating[]=erotica` and `contentRating[]=pornographic`. Nothing
downstream (orchestrator, canon, frontend) ever filters on content rating,
and the app has no age-verification screen or adult-content toggle at all
— so any MangaDex-mapped title could serve explicit chapters to any
anonymous visitor. **Fix:** `chapters()` now requests `safe,suggestive`
only, matching a new explicit `safe,suggestive` filter added to
`search()`/`getTitle()` (which previously had no filter at all and relied
on an unstated API default). Content-rating exposure is now an explicit,
safe-by-default choice rather than an accidental one.

### 2. Non-constant-time credential comparison
`auth.ts`'s `login()` compared the computed password hash to the stored
one with plain `!==`. **Fix:** added a `timingSafeEqual` helper (walks the
full length regardless of an early mismatch, so neither content nor length
is a timing signal) and used it for the password-hash check.

### 3. No rate limit on the expensive public fan-out routes
`/api/auth/login|register` were rate-limited; `/api/search`,
`/api/home`, `/api/recommendations`, and the title/chapters/pages routes
were not — despite each fanning out to 5+ third-party providers per call.
Cheap for a caller, expensive against both this Worker's budget and every
upstream provider's shared rate limit. **Fix:** added a `discovery`
IP-bucketed limit (120/10min — high enough for normal browsing, low enough
to blunt scripted abuse) applied to those routes.

### 4. TOCTOU race in the rate limiter itself
`checkRateLimit` did a `SELECT` then a separate `INSERT ... ON CONFLICT`.
Concurrent requests could both read the same under-limit count before
either write landed, letting a short burst slip past the limit by more
than one request. **Fix:** collapsed to a single atomic
`INSERT ... ON CONFLICT ... RETURNING count`, so the increment and the
check can't be raced apart.

## Flagged, not auto-changed (product decisions)

- **`/api/auth/register` reveals account existence** (`409 Account already
  exists`), while `login()`'s own comment explicitly documents avoiding
  exactly this for the login path. This is common practice (GitHub, Google,
  etc. all do it) and changing it means a real UX tradeoff (e.g. an
  always-"check your email" flow), so it wasn't changed unilaterally —
  worth a deliberate decision.
- **Session tokens live in `localStorage`**, not an httpOnly cookie. The
  strict CSP (`script-src 'self'`, no inline scripts) makes classic
  injected-script exfiltration hard, but it's still a weaker boundary than
  httpOnly against any future XSS. A cookie-based session would need CSRF
  protection added in exchange (Bearer tokens don't need it) — a bigger
  auth redesign than this audit's scope.
- **Community-sourced adapters (Nyora, HACHI, Manga Novel API, etc.) carry
  `contentRating: 'unknown'`** — the mangadex.ts fix above doesn't cover
  them, since they expose no rating signal to filter on at all. If BUFU is
  meant to stay a general-audience app, this needs either a real age-gate
  in the frontend or dropping unrated sources from the reader fallback
  chain — a scope decision beyond what this audit changes on its own.

---

# Round 2 — empty-chapter fallback fix, doc accuracy pass, full structural re-audit

## Fixed

### 5. Empty (but successful) chapter/page responses stopped the reader fallback chain
`getChapters`/`getPages` in `orchestrator.ts` distinguished "timed out or
threw" (the `withDeadline` fallback, `null`) from "got a real response,"
but treated *any* real response — including a genuinely empty `[]` — as
"found it, stop here." `[]` is truthy in JS, so a higher-priority source
(typically MangaDex) that successfully responds with zero chapters/pages
for a title permanently shadowed every lower-priority mapped source
(Nyora, HACHI, etc.) on that same title, even when one of them actually
had content. **Fix:** both loops now distinguish three outcomes — `null`
(record failure, keep trying), a genuine empty array (record success,
since the source itself is healthy, but keep trying other mapped
sources), and a non-empty array (the only case that stops the loop and
returns/persists).

### 6. `mangaupdates.ts` never read its own configured base URL
Every other metadata/reader adapter (AniList, Jikan, Kitsu, SHIRO, and
all the `worker/src/adapters/external.ts` bridges) reads
`env.<X>_URL || <hardcoded fallback>`. `mangaupdates.ts` alone hardcoded
its base URL as a module constant and never touched `env.MANGAUPDATES_URL`
— which is declared in the `Env` type and set in `wrangler.toml`'s
`[vars]`, so that variable did nothing. Same category of bug as FIXES.md's
item #2 (a config value with no code path to it), just on a different
adapter. **Fix:** `search`/`getTitle`/`health` now all resolve
`env.MANGAUPDATES_URL || BASE`, matching every sibling adapter's pattern.

## Documentation cleaned

- **`docs.md`** point 3: updated the reader-fallback contract to state
  that BUFU now falls through on a successful-but-empty response too, not
  only on failure/timeout/circuit-open (matches fix #5).
- **`SOURCES.md`**'s "Source safety rules" closing paragraph still said
  *"MangaDex is currently BUFU's only reader-capable source, so there is
  no cross-provider page fallback today"* — directly contradicted by the
  rest of that same file's table (HACHI, Comix API, MangaFire API, Manga
  API/Mangato, Manga Novel API, BatoTo Parser, and every configured Nyora
  source are all listed with `role: reader`) and by `orchestrator.ts`'s
  `READER_SOURCE_PRIORITY`/priority-ordered fallback loop, which only
  makes sense with multiple reader sources. Rewritten to describe the
  actual multi-source priority-ordered fallback, including the fix #5
  behavior.
- **`README.md`** was the most stale doc, not just the two named above:
  - Its "Sources" table claimed MangaDex was BUFU's *only* reader-capable
    source and listed exactly 6 production sources total, omitting every
    optional reader bridge and all 10 Nyora-backed sources entirely
    (`SOURCES.md` already had the correct, current list). Rewritten to
    summarize the always-on sources, the optional URL-gated reader
    bridges, and point to `SOURCES.md` as the source of truth instead of
    duplicating a table that will drift again.
  - Its Cloudflare setup step 1 said to create a D1 database named `bufu`,
    but `wrangler.toml`'s actual `database_name` is `bufu-db-new` — a
    reader following the README literally would run
    `wrangler d1 migrations apply bufu`, which doesn't match the database
    `wrangler.toml` actually declares. Fixed to use the real name and to
    say so explicitly.
  - Its architecture description and deploy step didn't mention that
    `wrangler.toml`'s `[assets]` block also serves the frontend directly
    from the Worker (`run_worker_first = ["/api/*"]`) — the README implied
    GitHub Pages was the only way the frontend gets served. Added a note.
  - "Rights and provider terms" and the intro paragraph still singled out
    MangaDex as *the* reader source; reworded to cover every configured
    reader-capable source.

## Full structural/code re-audit (this round)

- **Imports/exports & adapter registration** — traced every `register()`
  call site (13 static adapters + up to 10 dynamic `nyora:<source>`
  adapters) back to an actual import: `index.ts` imports
  mangadex/anilist/jikan/kitsu/mangaupdates/shiro directly;
  `orchestrator.ts` imports `adapters/registry.ts`, which imports
  `./nyora` and `./external` (registering everything else) as a side
  effect. `aggregators.ts` confirmed to export only a legacy id list and
  call `register()` nowhere — matches what both README and SOURCES.md now
  say. No duplicate adapter ids, no orphaned adapter that's registered but
  never reachable, no adapter referenced by docs that isn't actually
  registered.
- **API routes** — every `apiFetch()` call site in `frontend/app.js`
  cross-checked against `index.ts`'s route table: all match exactly
  (method + path). `/api/recommendations` and `/api/admin/health` exist
  server-side but aren't called by the frontend — confirmed intentional
  (ops/API-consumer routes, `/api/home` is what the frontend actually
  uses for the same pipeline), not dead/missing wiring.
- **Auth** — re-read `auth.ts` end to end post-fix: password/session flow,
  constant-time compare, atomic rate-limit upsert, session expiry/cleanup
  all consistent with the schema in `0001_initial.sql`.
- **CORS** — `corsHeaders()`/`withCors()` unchanged this round; re-verified
  fail-closed behavior and that `ALLOWED_ORIGINS` in `wrangler.toml`
  matches `frontend/config.js`'s `apiBase` and the Worker's own derived
  `workers.dev` origin (`bufu-api.ofcnitin.workers.dev`, from `name =
  "bufu-api"` in `wrangler.toml`) plus the GitHub Pages origin and
  localhost.
- **Rate limiting** — confirmed the `discovery` bucket's regex covers
  exactly `/api/search`, `/api/home`, `/api/recommendations`, and all
  three title/chapters/pages routes, applied before route dispatch and
  after the `OPTIONS` preflight short-circuit (so preflights are never
  throttled).
- **Reader flow** — `getChapters`/`getPages` re-read post-fix; priority
  ordering, circuit-breaker checks, and persistence all still consistent
  with the new three-way (null/empty/non-empty) outcome handling.
- **Frontend ↔ Worker URLs** — `frontend/config.js`'s `apiBase`,
  `wrangler.toml`'s `ALLOWED_ORIGINS` and derived default origin, and the
  `[assets]` dual-serving path all cross-checked against each other (see
  README fixes above).
- **Wrangler configuration** — `[vars]`, `[[d1_databases]]`,
  `[triggers]`, `[assets]` all reviewed; every `env.<X>` reference in
  `worker/src/**/*.ts` cross-checked against the `Env` type in `types.ts`
  and against what `wrangler.toml` actually sets — this is how fix #6
  (`MANGAUPDATES_URL`) was found.
- **Migrations** — `0001_initial.sql` unchanged and still matches every
  query in `auth.ts`/`index.ts`/`canon.ts`, including the new
  `RETURNING`-based upsert in `checkRateLimit` (SQLite/D1 has supported
  `RETURNING` on `INSERT ... ON CONFLICT` since SQLite 3.35).
- **Build/typecheck — actually run, not assumed:**
  - `npm install` at the repo root and inside `worker/` were both
    attempted for real and both failed with `403 Forbidden` from the npm
    registry — this sandbox has no network egress. This is an environment
    limitation, not a project problem; noted explicitly rather than
    silently skipped.
  - Fell back to the project's own `worker/dev-shim/` (built for exactly
    this offline scenario) and ran `tsc --noEmit -p
    dev-shim/tsconfig.offline-shim.json` for real. Result: one error,
    `src/canon.ts(313,15)`, and it's a shim-only artifact — the hand-written
    shim types `D1Result.meta` as `Record<string, unknown>`, and
    `NonNullable<unknown>` collapses to `{}` in TypeScript, which is what
    breaks the `> 0` comparison on `claim.meta?.changes`. The real
    `@cloudflare/workers-types` package types `meta.changes` concretely, so
    this does not reproduce against the genuine toolchain. Confirmed this
    line is untouched by any edit in either audit round.
  - Every file touched in this round (`orchestrator.ts`,
    `adapters/mangaupdates.ts`) produces zero errors, shim or otherwise.
  - `shared/index.ts` typechecked standalone (it's intentionally not
    included in `worker/tsconfig.json` or imported by anything — a typed
    reference doc, confirmed by its own header comment).
  - `frontend/app.js` and `frontend/config.js` both pass `node --check`
    (plain JS, no bundler — matches `frontend/package.json`'s own
    description of the project).
  - Delimiter-balance sanity check (parens/braces/brackets) run on every
    file edited across both audit rounds — all balanced.

## Final GO/NO-GO

**GO**, with one caveat that isn't a code defect:

- All code changes in both audit rounds are typo-checked clean against the
  offline shim, with the single pre-existing shim-only artifact above
  explained and isolated to a line neither round touched.
- No import/export, registration, routing, CORS, or migration
  inconsistency remains open.
- **Caveat:** none of this was verified against the *real*
  `@cloudflare/workers-types` package or a real `wrangler deploy` /
  `wrangler dev`, because this sandbox has no network access to npm. Run
  `npm install` (root) once, then `npm run typecheck` and a real
  `wrangler dev` smoke test, before merging/deploying — that's the one
  remaining step, and it's an environment gap here, not a known issue in
  the code.
