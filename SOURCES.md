# BUFU source matrix

| Provider | Adapter id | Role | Credentials | Status |
|---|---|---|---|---|
| MangaDex | `mangadex` | reader + metadata | none required (optional secret, never required) | Production |
| AniList | `anilist` | metadata | none | Production |
| Jikan / MyAnimeList | `jikan` | metadata | none | Production |
| Kitsu | `kitsu` | metadata | none | Production |
| MangaUpdates | `mangaupdates` | metadata | none | Production |
| SHIRO | `shiro` | recommendation (discovery-only — a bare title name, nothing else; see `worker/src/adapters/shiro.ts`) | none | Production |
| Nyora-backed sources | `nyora:<source>` | reader + search + chapters + page images | none; configurable source list | Production by default |
| HACHI | `hachi` | optional multi-source reader bridge | URL only | Enabled when `HACHI_URL` is set |
| Comix API | `comix-api` | optional reader bridge + page images | URL only | Enabled when `COMIX_API_URL` is set |
| MangaFire API | `mangafire-api` | optional reader bridge + page images | URL only | Enabled when `MANGAFIRE_API_URL` is set |
| Manga API / Mangato | `manga-api` | optional reader bridge | URL only | Enabled when `MANGATO_API_URL` is set |
| Manga Mapper | `manga-mapper` | optional chapter/page bridge | URL only | **Not wired.** Registered but `production: false` — its endpoints are keyed on a MangaDex chapter/page id and it's meant as an alternate page host for existing MangaDex mappings, but nothing in the orchestrator can reach it that way yet (see the comment above it in `worker/src/adapters/external.ts`). Setting `MANGA_MAPPER_URL` currently has no effect. |
| Manga Novel API | `manga-novel-api` | optional unified reader bridge | URL only | Enabled when `MANGA_NOVEL_API_URL` is set |
| BatoTo Parser | `bato-parser` | optional reader bridge to a Python parser wrapper | URL only | Enabled when `BATO_PARSER_URL` is set |
| Manga-Novel API | `manga-novel` | — | — | **Disabled.** No verified public API. Not registered; cannot enter search, recommendations, or reader fallback. |
| Comick Source API | `comick-source` | — | — | **Disabled**, same reason. |
| MangaHook API | `mangahook` | — | — | **Disabled**, same reason. |
| AIO Webtoon Downloader | `aio-webtoon` | — | — | **Disabled**, same reason. |
| Manganato API | `manganato` | — | — | **Disabled**, same reason. |
| MangaK | `mangak` | — | — | **Disabled** — no verified official API interface. |

"Production" means the adapter has `production: true` in `registry.ts` and
is registered — see `worker/src/adapters/registry.ts` and
`worker/src/orchestrator.ts`, which only ever fan out to
`productionSources(env)`.

Every production adapter's comment block states exactly what was verified
and where — no endpoint shape, field, or limit here was guessed.

## Source safety rules

- A provider is never called directly from the frontend — only from the Worker.
- Source health (success/failure/consecutive-failure/circuit state) is
  recorded in D1 (`source_health` table) and checked before every call.
- Three consecutive failures opens a source's circuit for 5 minutes; after
  cooldown, one probe call is allowed through before the circuit fully closes.
- One canonical title can hold several source mappings
  (`source_mappings`, keyed uniquely per provider item).
- MangaDex is BUFU's first-class, always-on reader source and is tried
  first for any mapped title (`READER_SOURCE_PRIORITY` in
  `orchestrator.ts`), but it is not the only reader-capable source: every
  optional self-hosted/community bridge above (HACHI, Comix API,
  MangaFire API, Manga API/Mangato, Manga Novel API, BatoTo Parser) and
  every configured Nyora-backed source registers with `role: 'reader'`
  and `production: true`. When a title has a mapping to more than one of
  these, `getChapters`/`getPages` walk them in priority order (MangaDex
  first, everything else after, in a stable order) and keep trying the
  next mapped source on a failure, a timeout, an open circuit, *or* a
  successful-but-empty response — not just a failure. Only when every
  mapped source has been tried does BUFU fall back to whatever chapter
  data is already persisted, or report the title honestly unavailable.
  It never silently routes to a source that isn't mapped to that exact
  title, and never to one that isn't configured/production.
