# BUFU

### Discover. Track. Read.

BUFU is a dark-themed manga, manhwa, and manhua discovery and reading platform designed around a unified catalog experience.

It brings together metadata from multiple legitimate providers, intelligently merges duplicate titles into canonical entries, and provides a MangaDex-powered reading experience where chapters are available.

BUFU also includes personal libraries, bookmarks, reading history, and synchronized reading progress for authenticated users.

---

## ✨ Features

* 🔎 **Unified Search** — Search across multiple manga and manhwa metadata providers.
* 🧩 **Canonical Deduplication** — Multiple provider entries are merged into a single canonical title.
* 📚 **MangaDex Reader** — Read available chapters directly through MangaDex.
* 🏠 **Home Discovery** — Trending and recommended titles in a cinematic interface.
* 🧭 **Explore** — Browse and discover titles from multiple sources.
* ❤️ **Library** — Save titles for quick access.
* 🔖 **Bookmarks** — Keep track of titles and reading activity.
* 🕘 **Reading History** — Automatically maintain your reading history.
* 📖 **Reading Progress** — Resume chapters from where you left off.
* ☁️ **Cross-device Sync** — Library, bookmarks, history, and progress sync for signed-in users.
* 🛡️ **Security-focused Authentication** — Opaque bearer sessions with hashed tokens.
* 📱 **Responsive UI** — Designed for desktop and smaller screens.
* ⚡ **Static Frontend** — No frontend framework or build step required.

---

## 🎨 Design

BUFU follows a cinematic dark UI inspired by modern manga/manhwa reading platforms.

### Visual System

* Near-black application shell
* Red primary accent
* Compact sidebar navigation
* Large cinematic cover artwork
* High-contrast typography
* Card-based discovery interface
* Dedicated Home, Explore, and Library experiences

The interface is intentionally lightweight while keeping the focus on artwork and content discovery.

---

## 🏗️ Architecture

```text
                    ┌─────────────────────┐
                    │    GitHub Pages     │
                    │      Frontend       │
                    │   Static SPA        │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Cloudflare Worker  │
                    │      REST API       │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
       ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
       │  Providers  │  │ Orchestrator │  │ Cloudflare  │
       │             │  │             │  │     D1      │
       └─────────────┘  └─────────────┘  └─────────────┘
```

### Project Structure

```text
BUFU/
│
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── config.js
│
├── worker/
│   ├── src/
│   │   ├── adapters/
│   │   ├── orchestrator.ts
│   │   ├── auth.ts
│   │   └── ...
│   │
│   ├── migrations/
│   │   └── 0001_initial.sql
│   │
│   └── wrangler.toml
│
├── shared/
│   └── domain types
│
└── public/
    └── assets/
        └── bufu-mark.png
```

---

## 🌐 Data Sources

BUFU uses multiple providers for different parts of the discovery experience.

| Provider                | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| **MangaDex**            | Metadata, chapters, page images and reading |
| **AniList**             | Metadata, search and trending               |
| **Jikan / MyAnimeList** | Metadata, search and top manga              |
| **Kitsu**               | Metadata and search                         |
| **MangaUpdates**        | Metadata, search and title details          |
| **SHIRO**               | Recommendations                             |

### Reader Availability

MangaDex is currently BUFU's **reader-capable source**.

If a title exists in the metadata catalog but does not have a valid MangaDex mapping, BUFU does not fabricate a reader experience.

Instead, the title is displayed with its available metadata and clearly marked:

> **Not readable yet**

This keeps the discovery experience honest and avoids presenting unavailable content as readable.

---

## 🔄 Source Orchestration

Provider adapters are located in:

```text
worker/src/adapters/
```

The orchestration layer is responsible for:

1. Querying supported providers
2. Normalizing provider responses
3. Matching equivalent titles
4. Creating canonical title records
5. Maintaining provider-to-title mappings
6. Selecting available chapters
7. Handling provider failures
8. Returning a unified response to the frontend

This allows BUFU to treat several external sources as a single catalog.

---

## 🚫 Disabled Sources

Some providers were investigated during development but are intentionally **not enabled in production**.

These include:

* Manga-Novel
* Comick Source
* MangaHook
* AIO Webtoon Downloader
* Manganato
* MangaK

They are excluded because BUFU could not verify a suitable public API or documented integration for production use.

They are therefore not part of the search, recommendation, or reader fallback chain.

---

# 🔐 Authentication & Security

BUFU uses bearer-token authentication for sessions.

```http
Authorization: Bearer <token>
```

### Session Design

* Tokens are generated using cryptographically secure randomness.
* The raw session token is **not stored in the database**.
* Only the SHA-256 token digest is stored.
* Tokens are returned only during authentication.
* `/api/auth/me` returns the authenticated user without exposing the token.
* Logging out immediately invalidates the session.
* Expired sessions are rejected server-side.
* Session expiration is checked independently of client-side state.

### XSS Protection

Because bearer tokens are accessible to frontend JavaScript, preventing XSS is an important part of the architecture.

BUFU sanitizes external and user-controlled values before they reach:

```text
innerHTML
href
src
```

The frontend uses dedicated helpers such as:

```text
escapeXml()
safeImgSrc()
safeHref()
```

A restrictive Content Security Policy is also configured as additional defense-in-depth.

---

## 🍪 Why Bearer Tokens Instead of Cookies?

The current deployment separates the frontend and API across different origins:

```text
GitHub Pages
      │
      └──► Cloudflare Worker
```

Using cross-site cookies can introduce browser privacy and tracking-prevention issues.

BUFU therefore uses explicit bearer authentication for the current architecture.

If the frontend and API are later deployed under the same registrable domain, the authentication model can be migrated to:

```text
HttpOnly
Secure
SameSite=Strict
```

cookies, removing the need for JavaScript-readable session tokens.

---

# 🗄️ Database

BUFU uses **Cloudflare D1** for persistent application data.

The database stores information such as:

* Canonical titles
* Alternative titles
* Provider mappings
* Chapters
* Users
* Sessions
* Libraries
* Bookmarks
* Reading history
* Reading progress
* Provider health information

The initial database schema is located at:

```text
worker/migrations/0001_initial.sql
```

---

# ☁️ Cloudflare Setup

## 1. Create the D1 database

Create a Cloudflare D1 database named:

```text
bufu
```

Add the generated database ID to:

```text
worker/wrangler.toml
```

---

## 2. Apply the migration

From the project root:

```bash
npx wrangler d1 migrations apply bufu \
  --remote \
  --config worker/wrangler.toml
```

---

## 3. Optional MangaDex Token

BUFU can communicate with MangaDex without an access token for the endpoints it currently uses.

If authentication is required for your deployment, configure the secret:

```bash
wrangler secret put MANGADEX_ACCESS_TOKEN
```

The token remains server-side and is never exposed to the frontend.

---

## 4. Deploy the Worker

```bash
wrangler deploy --config worker/wrangler.toml
```

After deployment, copy the Worker URL.

---

## 5. Configure the Frontend

Update:

```text
frontend/config.js
```

with your deployed Worker API URL.

Example:

```javascript
const config = {
    apiBase: "https://your-worker.example.workers.dev"
};
```

---

# 💻 Running the Frontend Locally

BUFU's frontend is intentionally a plain static application.

There is:

* No React
* No build system
* No bundler
* No Node.js requirement for the frontend

Start a local HTTP server:

```bash
cd frontend
python -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

> Make sure `frontend/config.js` points to a deployed Worker if you want the application to communicate with the backend.

Without an API connection, BUFU intentionally displays a **not connected** state instead of loading fake/demo data.

---

# ⚙️ Configuration

The Worker configuration contains the public provider endpoints for:

```text
AniList
Jikan
Kitsu
SHIRO
MangaUpdates
```

These providers are keyless in the current implementation.

Configure:

```text
ALLOWED_ORIGINS
```

to include your actual frontend origin.

For local development, you can allow:

```text
http://localhost:5173
```

alongside your production GitHub Pages origin.

---

# 📖 Reader Flow

When a user opens a title:

```text
Title
  │
  ▼
Canonical Record
  │
  ▼
Provider Mapping
  │
  ▼
MangaDex Mapping
  │
  ├── Available ──► Chapter List ──► Reader
  │
  └── Missing ────► "Not readable yet"
```

BUFU never falls back to an unverified source simply to make a title appear readable.

---

# 🧠 Canonical Catalog

One of BUFU's core concepts is **canonical-title deduplication**.

The same manga can appear under different:

* Provider IDs
* Titles
* Alternative titles
* Language variations
* Metadata structures

Instead of displaying every provider entry separately, BUFU maps them toward a canonical title.

```text
AniList ───────┐
Jikan ─────────┤
Kitsu ────────►├──► Canonical Title
MangaUpdates ──┤
MangaDex ──────┘
```

This gives users a cleaner catalog while preserving provider-specific mappings behind the scenes.

---

# ❤️ User Data

For authenticated users, BUFU can synchronize:

```text
Library
Bookmarks
Reading History
Reading Progress
```

This allows a user to continue using the same account across supported devices.

---

# 🩺 Provider Health

The backend maintains provider health information so external API problems can be handled without treating the entire BUFU application as unavailable.

This is particularly useful for a multi-provider architecture where individual services may experience:

* Rate limits
* Temporary downtime
* API errors
* Response changes
* Network failures

---

# ⚠️ Rights & Provider Terms

BUFU is designed to access providers through their public interfaces and documented APIs.

However, provider policies and terms can change.

Before deploying BUFU publicly:

1. Review each provider's current terms.
2. Confirm that your intended usage is permitted.
3. Respect applicable rate limits.
4. Follow provider attribution requirements where applicable.
5. Remove or disable integrations that no longer comply with provider policies.

> This project documentation is not legal advice.

---

# 🚀 Deployment Overview

A typical production deployment looks like:

```text
                    BUFU
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
    GitHub Pages          Cloudflare Worker
      Frontend                  API
                                │
                         ┌──────┴──────┐
                         │             │
                         ▼             ▼
                   Cloudflare D1   Providers
```

### Frontend

Deploy the `frontend/` directory to:

* GitHub Pages
* Any static hosting provider

### Backend

Deploy `worker/` using:

```bash
wrangler deploy
```

### Database

Use Cloudflare D1 for production persistence.

---

# 🛠️ Tech Stack

### Frontend

* HTML
* CSS
* JavaScript
* Hash-based routing
* GitHub Pages

### Backend

* TypeScript
* Cloudflare Workers
* REST API

### Database

* Cloudflare D1
* SQLite

### External Data

* MangaDex
* AniList
* Jikan
* Kitsu
* MangaUpdates
* SHIRO

---

# 📌 Project Status

BUFU is structured as a production-oriented multi-provider manga discovery application.

Current architecture includes:

* [x] Multi-provider metadata
* [x] Canonical title mapping
* [x] MangaDex reader integration
* [x] Search and discovery
* [x] Library
* [x] Bookmarks
* [x] Reading history
* [x] Reading progress
* [x] Cross-device user data
* [x] Cloudflare Worker API
* [x] Cloudflare D1 persistence
* [x] Session authentication
* [x] Provider health tracking
* [x] Static GitHub Pages frontend

---

# 🤝 Contributing

Contributions are welcome.

Before submitting a change:

1. Create a fork.
2. Create a feature branch.
3. Make your changes.
4. Test the frontend and Worker locally.
5. Keep provider integrations within their documented APIs and terms.
6. Submit a pull request with a clear description of the change.

---

# 📄 License

See the project's `LICENSE` file for licensing information.

---

## BUFU

**A unified place to discover, track, and read manga.**
