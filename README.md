# BUFU

BUFU is a dark, red-accent manga/manhwa/manhua discovery and reading app: a
unified catalog built from several legitimate providers, canonical-title
deduplication, a MangaDex-backed reader, and reading progress/library/
bookmarks/history that sync across devices for signed-in users.

The visual system follows the original BUFU design reference: a near-black
shell, compact left navigation, red primary accent, cinematic cover cards,
Home / Explore / Library flows.

## Architecture

- `frontend/` — GitHub Pages-ready static SPA (hash routing, no server or
  build step required; it's plain HTML/CSS/JS on purpose)
- `worker/` — Cloudflare Worker API + D1 schema
- `shared/` — shared domain types
- `public/assets/bufu-mark.png` — BUFU mark

```
GitHub Pages (frontend)
        │
        ▼
Cloudflare Worker  ──▶  canonical source orchestration (worker/src/orchestrator.ts)
        │
        ▼
Cloudflare D1 (canonical titles, aliases, source mappings, chapters,
               users/sessions, library/bookmarks/history/progress, source health)
```

## Sources — what's actually connected, and why

Every adapter in `worker/src/adapters/` was written against real,
documented behavior researched for this build (see comments at the top of
each file for what was verified and against what).

**Production (in `worker/src/adapters/registry.ts`'s `sourceList`, gated by
an explicit `production: true` flag):**

| Source | Role | What it provides |
|---|---|---|
| MangaDex | reader + metadata | search, title detail, chapters, page images — BUFU's only reader-capable source |
| AniList | metadata | search, genre-based trending |
| Jikan (MyAnimeList) | metadata | search, top-manga |
| Kitsu | metadata | search |
| MangaUpdates | metadata | search, title detail |
| SHIRO | recommendation | a single manhwa name per call (verified live — see `adapters/shiro.ts`), enriched against the metadata providers before display |

**Explicitly disabled, not part of the production source list:**
Manga-Novel, Comick Source, MangaHook, AIO Webtoon Downloader, Manganato,
MangaK. `worker/src/adapters/aggregators.ts` documents why (no verified
public API for any of them) and does not call `register()` for any of
them — they cannot enter search, recommendations, or the reader fallback
chain no matter what env vars are set.

A title discovered only through a metadata provider (no MangaDex mapping)
is shown normally with real metadata, and its detail page says so plainly
("Not readable yet") instead of ever faking a reader.

## Cloudflare setup

1. Create a D1 database named `bufu`.
2. Put its ID into `worker/wrangler.toml` (`database_id`).
3. Run the migration: `npx wrangler d1 migrations apply bufu --remote --config worker/wrangler.toml`
4. Set the MangaDex secret (optional — see below): `wrangler secret put MANGADEX_ACCESS_TOKEN`
5. Deploy: `wrangler deploy --config worker/wrangler.toml`
6. Point `frontend/config.js`'s `apiBase` at the deployed Worker URL.

`wrangler.toml`'s `[vars]` already has real base URLs for AniList, Jikan,
Kitsu, SHIRO, and MangaUpdates (all public, all keyless) and
`ALLOWED_ORIGINS` set to the production GitHub Pages origin plus
localhost — update these if your origin differs.

`MANGADEX_ACCESS_TOKEN` is optional: every MangaDex endpoint BUFU calls
(search, manga detail, chapter feed, at-home page URLs) works
unauthenticated per MangaDex's public docs. Only set it if you have a
reason to send an authenticated MangaDex request — never required for the
app to function, and never sent to the frontend.

## Session security

BUFU authenticates with a bearer token (opaque random 32-byte token, sent
as `Authorization: Bearer <token>`), not an `HttpOnly` cookie. This is a
deliberate tradeoff, not an oversight:

- The frontend (GitHub Pages) and the API (a Cloudflare Worker on a
  different domain) are on different origins/eTLD+1s. A cookie-based
  session here would need `SameSite=None; Secure`, which many browsers'
  tracking-prevention modes (Safari ITP, Firefox ETP) throttle or evict for
  cross-site requests — that would make sessions unreliable for a real
  slice of users. A bearer token sent explicitly on every request doesn't
  depend on third-party-cookie behavior at all.
- The raw token is **never** persisted server-side — only its SHA-256
  digest is stored in `sessions.token_hash` (see `worker/src/auth.ts`), so a
  leaked D1 export can't be replayed as a session.
- The token is never logged, never echoed back in any API response body
  except once, at login/register, and never exposed by any other endpoint
  (`/api/auth/me` returns the user, not the token).
- Logout deletes the session row immediately (`worker/src/auth.ts`'s
  `logout`), and `currentUser` deletes-and-rejects any session past
  `expires_at` rather than trusting client-side expiry.
- Because the token is readable by any script on the page, XSS is the
  real risk this design accepts — which is why `frontend/app.js` routes
  every provider/user-supplied string through `escapeXml`/`safeImgSrc`/
  `safeHref` before it ever reaches `innerHTML` or an `href`/`src`, and
  `frontend/index.html` sets a restrictive Content-Security-Policy as
  defense-in-depth.

If a same-registrable-domain deployment (API and frontend under the same
eTLD+1, e.g. `app.example.com` and `api.example.com`) is set up later,
switching to an `HttpOnly; Secure; SameSite=Strict` cookie becomes
straightforward and removes the token-readable-by-JS tradeoff entirely.

## D1 schema

One consolidated migration, `worker/migrations/0001_initial.sql` — see
its header comment for why this rebuild didn't try to layer new
migrations on top of the pre-rebuild schema.

## Local frontend

The frontend is intentionally static — no build step, no framework:

```bash
cd frontend
python -m http.server 5173
```

Then open `http://localhost:5173`. Without `frontend/config.js`'s
`apiBase` set to a deployed Worker, every page shows an honest "not
connected" state — there is no offline demo/fixture data baked into the
production app.

## Rights and provider terms

BUFU only ever accesses each provider through its own public API, within
whatever terms that provider publishes, and only ever presents a title as
readable when a real reader-capable source (MangaDex) is mapped to it.
Verify each provider's current terms yourself before a public deployment —
this README is not legal advice, and provider terms can change.
