# BUFU source matrix

| Provider | Adapter id | Role | Credentials | Status |
|---|---|---|---|---|
| MangaDex | `mangadex` | reader + metadata | none required (optional secret, never required) | Production |
| AniList | `anilist` | metadata | none | Production |
| Jikan / MyAnimeList | `jikan` | metadata | none | Production |
| Kitsu | `kitsu` | metadata | none | Production |
| MangaUpdates | `mangaupdates` | metadata | none | Production |
| SHIRO | `shiro` | recommendation (discovery-only — a bare title name, nothing else; see `worker/src/adapters/shiro.ts`) | none | Production |
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
- MangaDex is currently BUFU's only reader-capable source, so there is no
  cross-provider *page* fallback today — a MangaDex failure is reported
  honestly rather than silently routed to an unverified/unauthorized
  scanlation source. If a second legitimate reader-capable source is ever
  verified and added, the circuit-breaker/fallback plumbing in
  `orchestrator.ts` is what it would plug into.
