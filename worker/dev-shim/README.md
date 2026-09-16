# Offline dev shim — NOT part of the production build

Everything in this folder exists only because this rebuild happened in a
sandbox with no network access, so `npm install` and `wrangler types`
could not run and the real `@cloudflare/workers-types` package could not
be fetched.

`cf-shim.d.ts` hand-declares the minimal subset of the Cloudflare Workers
runtime types (D1Database, D1PreparedStatement, ScheduledEvent, and the
Env-adjacent ambient globals) needed to `tsc --noEmit` the worker source.
It is deliberately small and almost certainly incomplete/imprecise
compared to the real generated types — it is a stand-in for offline syntax
and basic type-flow checking only, not a substitute for a real build.

`tsconfig.offline-shim.json` points `tsc --noEmit` at this shim instead of
`@cloudflare/workers-types`. The real `worker/tsconfig.json` is unchanged
and still references the genuine package — use that (after a real
`npm install` and, ideally, `wrangler types`) for the actual build.

Delete this folder once you've run the real toolchain; it has no purpose
after that.
