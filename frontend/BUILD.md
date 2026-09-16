# `tailwind.css` — precompiled, not fetched at runtime

The frontend is still plain static HTML/CSS/JS with no framework and no
bundler for `app.js` itself — that hasn't changed. The one addition is
`tailwind.css`, a **precompiled, checked-in artifact** built from
`tailwind.config.js` against `index.html` + `app.js`.

## Why this exists instead of the Tailwind Play CDN

Earlier revisions loaded Tailwind from `https://cdn.tailwindcss.com` and set
its config via an inline `<script>` block. That worked, but forced the CSP
to carry `'unsafe-inline'` in `script-src` (for the inline config block) and
trust a third-party CDN script with full page access — both real XSS-surface
increases, on the same page that holds the session bearer token in
`localStorage`.

Precompiling removes both: `tailwind.css` is a static file loaded via a
normal same-origin `<link rel="stylesheet">`, so `script-src` in
`index.html`'s CSP is just `'self'` — no CDN, no inline script, nothing to
carry `'unsafe-inline'` for on the script side. (`style-src` still needs
`'unsafe-inline'` — see the CSP comment in `index.html` — for legitimate
per-element inline styles like progress-bar widths and card aspect ratios,
which are data values, not a fixed class set a static stylesheet could
express instead. That's an unrelated, unavoidable need, not a Tailwind
artifact.)

## Regenerating it

Only needed when `app.js` or `index.html` start using a Tailwind class that
isn't already in `tailwind.css` — the build is a content scan, so any new
class needs a rebuild before it'll actually render.

```
cd frontend
npx tailwindcss -c tailwind.config.js -i tailwind.src.css -o tailwind.css --minify
```

(`tailwind.src.css` is just `@tailwind base; @tailwind components; @tailwind
utilities;` — create it if it's missing.) Requires network access to fetch
the `tailwindcss` package the first time; after that it's fully offline.
Commit the regenerated `tailwind.css` — it's a build artifact, not a
generated-at-request-time asset, so it belongs in version control like any
other checked-in static file this project already ships.

## Known limitation to watch for

`aspect-[N/M]` arbitrary-value classes (e.g. `aspect-[3/4]`) do **not**
compile with this Tailwind build (verified: v3.4.19) even though other
arbitrary values (`w-[100px]`, `shadow-[0_4px_20px_rgba(0,0,0,.06)]`, etc.)
compile fine. Use an inline `style="aspect-ratio:3/4"` instead — that's what
the two existing aspect-ratio spots in `app.js` (the card cover and the
title detail cover) do.
