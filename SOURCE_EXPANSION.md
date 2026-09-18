# Expanded reader-source integration

BuFu now has an additive reader adapter layer for:
- Nyora-backed sources (keyless, active by default)
- HACHI
- Comix API
- MangaFire API
- Manga API / Mangato
- Manga Mapper
- Manga Novel API
- BatoTo Parser wrapper

## Important runtime detail

The Cloudflare Worker cannot directly execute arbitrary Python runtimes or
Node packages that require Node-only APIs. Therefore:

- Nyora is integrated through its documented REST contract using the Worker
  `fetch()` API. No npm dependency or API key is required.
- HACHI, Comix API, MangaFire API, Manga API, Manga Mapper and Manga Novel API
  are self-hosted/community services. They are integrated as optional HTTP
  adapters and activate only when their URL is configured.
- BatoTo Parser is a Python library. `BATO_PARSER_URL` is intentionally a URL
  to a small HTTP wrapper around the Python parser rather than trying to run
  Python inside the Cloudflare Worker.

## Existing workflow

Nothing in the frontend reader, authentication, canonical title model,
chapter persistence, D1 schema, or existing MangaDex adapter was replaced.
Every new source produces BuFu's existing `ProviderTitle`,
`ProviderChapter`, and `UnifiedPage` types and enters the existing
orchestrator/circuit-breaker path.

## Current default Nyora coverage

The default Nyora source list deliberately excludes MangaDex because BuFu
already has its native MangaDex reader. The Nyora adapters cover additional
source IDs such as Bato, Comick, MangaFreak, MangaFire, MangaWorld, Asura,
WeebCentral, MangaBuddy, MangaPark and MangaKakalot when those source IDs are
available on the configured Nyora helper.

The list is controlled by `NYORA_SOURCES` and can be changed without code
changes. `wrangler.toml`'s default value intentionally matches
`nyora.ts`'s own `DEFAULT_SOURCES` (no `mangadex` entry) — an earlier draft
of that default var included `mangadex`, which would have been silently
inert (nyora.ts never registers a `nyora:mangadex` adapter at all) and
contradicted this section.

All Nyora-backed sources share one rate-limit bucket (`ratelimit.ts`'s
`nyora` key), not a bucket per source id, since every one of them resolves
to the same `NYORA_BASE_URL` origin.

## Reader-source priority

With MangaDex plus up to ten Nyora-backed sources (and any of the optional
self-hosted bridges below) all able to hold a reader-role mapping on the
same canonical title, `orchestrator.ts` always prefers MangaDex — BuFu's
one first-party, ToS-verified reader source — and only falls through to the
others, in a fixed order, when MangaDex has no mapping or its live fetch
fails. See `READER_SOURCE_PRIORITY` in `worker/src/orchestrator.ts`.

## Known limitation: Manga Mapper is not currently reachable

`manga-mapper`'s endpoints are keyed on a MangaDex chapter/page id — it's
designed as an alternate page host for a title BuFu already reads via
MangaDex, not a standalone searchable source. Its `search()` correctly
returns nothing for that reason, but that also means the orchestrator can
never create a mapping that would let its `chapters()`/`pages()` be called.
It's registered with `production: false` until a real "alternate host for
an existing MangaDex mapping" path exists — setting `MANGA_MAPPER_URL`
currently has no effect. See the comment above it in
`worker/src/adapters/external.ts`.

## API-key status

None of the added adapters introduces an API-key requirement. Nyora uses its
public cloud helper; the other adapters use URLs pointing to self-hosted
community services. If one of those services requires its own credentials,
those credentials belong to that service and should not be hard-coded into
BuFu.
