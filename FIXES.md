# Fixes applied to the expanded-sources build

This file documents every issue found in the "expanded manga sources"
upload and exactly what changed to fix it. Your original `BuFu-main`
(GitHub) project was never touched — this is a separate copy.

## 0. HACHI titles could never actually be read (the big one)

This is the most serious bug in the batch — worse than #6 below, because
it doesn't fail loudly, it fails *silently*. HACHI fans out to 3
sub-sources (Comick, MangaFreak, MangaWorld) but only **one** adapter is
registered for all of them: `id: 'hachi'`. The titles/chapters it found
were stamped with a *namespaced* id instead — `hachi:comick`,
`hachi:mangafreak`, `hachi:mangaworld` — none of which match any
registered adapter's `id`.

Every place BuFu decides "is this source actually readable" does
`sourceList.find(a => a.id === storedSourceId)`:
- the `readable` badge on a title (`toWire()` in `orchestrator.ts`)
- picking which mapped source to fetch chapters from (`getChapters`)
- picking which mapped source to fetch pages from (`getPages`)

All three would silently fail to find `'hachi:comick'` in `sourceList`
(only `'hachi'` is there) and just skip it — so a HACHI-discovered title
would show up in search with real metadata, but permanently display "not
readable yet," and its chapters/pages could never be fetched, no matter
how `HACHI_URL` was configured. It would have looked broken in a way
that's very hard to diagnose from the outside — "search finds it, but it
never opens" — rather than an obvious startup error.

**Fix:** `chapters()`/`pages()` already correctly recover *which*
sub-source to call from the `<source>|<id>` prefix baked into
`sourceTitleId` — they never actually needed the namespaced `sourceId` to
route correctly. So the fix is minimal: stamp titles/chapters with the
adapter's real id (`'hachi'`) instead of `hachi:${source}`, matching every
other adapter's own id.

## 1. Nyora sub-sources could hammer the shared host

You registered 10 separate Nyora-backed adapters (`nyora:bato`,
`nyora:comick`, ...), and each one called `fetchJson(..., \`nyora:${sourceId}\`)`
— a **different** rate-limit key per source. `ratelimit.ts`'s throttle is
keyed per-string with a default fallback of 5 req/s for any key it doesn't
recognize, so all 10 adapters got their *own independent* 5 req/s
allowance even though they all hit the exact same origin
(`NYORA_BASE_URL`). One search could burst ~50 req/s at a single shared
community API — the opposite of "well-behaved client," and a good way to
get rate-limited or blocked.

**Fix:** every Nyora call now shares one `'nyora'` throttle key, and
`ratelimit.ts` has an explicit `nyora` bucket (5 req/s, same conservative
style as the `kitsu`/`mangaupdates` entries).

Worth noting: nyora.ts itself does NOT have the HACHI bug above — it
correctly registers one real adapter object *per* sub-source
(`id: nyora:${sourceId}`), so its stamped sourceIds always match a real
registered adapter. HACHI was the only adapter that mixed "one shared
adapter object" with "namespaced per-sub-source data."

## 2. `wrangler.toml`'s default source list contradicted the code

`nyora.ts`'s own `DEFAULT_SOURCES` (and `SOURCE_EXPANSION.md`) say Nyora's
default list "deliberately excludes MangaDex." But `wrangler.toml`'s
default `NYORA_SOURCES` var started with `"mangadex,bato,comick,..."`.
Since `nyora.ts` only ever builds adapters for entries in its own
`DEFAULT_SOURCES` array, that `mangadex` entry never did anything — it was
just a dead, misleading value in your default config.

**Fix:** removed it from the default `NYORA_SOURCES` in `wrangler.toml`.

## 3. No priority when a title has more than one working reader source

Before this build, MangaDex was the *only* reader-role source, so
`getChapters`/`getPages` in `orchestrator.ts` could get away with picking
"whichever mapping the database happens to return first" — there was only
ever one. Now a title can have MangaDex **and** several Nyora/self-hosted
mappings at once, and that same unordered pick was still there: an
unreliable community scraper could silently be tried (and shown) ahead of
a perfectly good MangaDex mapping, and which one "won" could vary between
requests since the SQL had no `ORDER BY`.

**Fix:** added a `READER_SOURCE_PRIORITY` (MangaDex = 0, everything else
= 100) in `orchestrator.ts`. `getChapters` now tries every mapped reader
source in priority order until one actually returns chapters (not just
the first one, and not giving up if a higher-priority source is
circuit-broken or times out). `getPages` sorts its existing fallback loop
the same way.

## 4. HACHI and Manga Novel API searches were structured to time out

Both adapters looped over their sub-sources with a plain `for...of` +
`await` — one request at a time. Each individual request has its own
9-10s timeout, but `orchestrator.ts`'s `searchAll()` wraps the *whole*
`search()` call in a single 6-second deadline. Three sequential requests
at up to 9-10s each almost never finishes inside 6 seconds, so in
practice these two sources would time out on nearly every real search,
and after 3 consecutive timeouts their circuit breaker would open and
disable them for 5 minutes at a time — they'd have looked "configured"
but rarely actually worked.

**Fix:** both now fan out with `Promise.allSettled` so the sub-source
requests run concurrently, and one failing sub-source doesn't lose the
others' results.

## 5. BatoTo Parser passed the wrong kind of id to its own endpoints

BatoTo Parser's `/details` and `/pages` endpoints are URL-keyed
(`?url=...`) — its own adapter code assumes this (`u.searchParams.set('url', id)`).
But `search()` mapped results with the same generic `mapGenericTitle`/
`mapChapter` helpers used by the *id*-keyed adapters (HACHI, Comix API,
etc.), which extract `id ?? slug ?? ...` first and only carry the URL as a
side field. So `chapters()`/`pages()` would usually receive an id or slug
where the wrapper expected a URL.

**Fix:** added `mapBatoTitle`/`mapBatoChapter`, specific to this adapter,
that keep the manga/chapter URL itself as `sourceTitleId`/
`sourceChapterId` (and drop any entry with no URL, rather than silently
mapping it to something the wrapper can't look up).

## 6. Manga Mapper was registered as "Production" but was unreachable

Manga Mapper's endpoints are keyed on a *MangaDex* chapter/page id
(`/mangadex/chapters/{id}`) — it's meant as an alternate page host for a
title BuFu already reads via MangaDex, not a standalone source. Its
`search()` correctly returns `[]` for that reason — but that also means
`canonicalizeTitle()` can never create a mapping row for it, which is the
only way `getChapters`/`getPages` ever look up an adapter's `chapters()`/
`pages()` in the first place. As registered (`production: true`), it
would have shown up as a working "Production" source in `SOURCES.md`
while being structurally impossible to reach — even with
`MANGA_MAPPER_URL` set.

**Fix:** set `production: false` with a comment explaining exactly why,
and updated `SOURCES.md`/`SOURCE_EXPANSION.md` to say plainly that it's
not wired yet, instead of listing it as live. It's still registered, so
re-enabling it later (once there's a real "alternate host for an existing
MangaDex mapping" path in the orchestrator) is a one-line, visible
change — same pattern the project already uses for the legacy disabled
aggregators.

## 7. `docs.md`'s invariant contradicted itself

The expansion edited `docs.md`'s item 3 to mention Nyora-backed sources,
but left the very next sentence unchanged: "A MangaDex failure is
reported as an honest unavailable state — never silently routed to an
unverified or unauthorized source." That's no longer accurate once a
title can also have a mapped fallback reader — and it directly
contradicted the sentence right before it in the same paragraph.

**Fix:** reworded item 3 to accurately describe the real, fixed behavior:
MangaDex is tried first; a failure falls through only to sources that are
(a) explicitly configured, (b) production, and (c) actually mapped to
that exact title — never to an unmapped or unconfigured source, and never
invented.

## What I checked and left alone

- Ran `tsc --noEmit` against both the original upload and this fixed copy
  (with a stand-in tsconfig, since `@cloudflare/workers-types` isn't
  installed in this environment) — both come back clean apart from two
  expected errors for Cloudflare-only globals (`D1Database`,
  `ScheduledEvent`) that resolve once you `npm install` for real.
- D1 schema (`worker/migrations/0001_initial.sql`) has no `source_id`
  constraint, so the new source ids need no migration.
- The frontend is fully source-agnostic (just counts "N connected
  sources"), so none of this needed a frontend change.
- `worker/src/adapters/utils.ts` is dead/unused code duplicating
  `worker/src/utils.ts` — pre-existing in your original project, not
  something the expansion introduced, so left as-is rather than folded
  into this change set.
