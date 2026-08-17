// Best-effort, in-isolate rate limiting for outbound calls to third-party
// providers. Cloudflare Workers isolates are ephemeral and can be recycled
// or run concurrently across edge locations, so this is NOT a durable,
// globally-accurate limiter — a correct one would need Durable Objects or a
// KV/D1-backed counter. This module exists to keep BUFU a well-behaved
// client of each provider's documented limit within a single isolate's
// lifetime, not to guarantee the limit is never exceeded fleet-wide.

type Bucket = { timestamps: number[]; windowMs: number; max: number };
const buckets = new Map<string, Bucket>();

/** Verified/documented limits as of the research done for this rebuild:
 *  - mangadex: ~5 req/s general limit (api.mangadex.org/docs/2-limitations)
 *  - mangadex-athome: 40 req/min specifically for /at-home/server/{id}
 *  - anilist: currently degraded to 30 req/min (docs.anilist.co/guide/rate-limiting)
 *  - jikan: 60 req/min, 3 req/s (docs.api.jikan.moe)
 *  - kitsu: no documented public rate limit found; self-imposed conservative cap
 *  - mangaupdates: no documented public rate limit found; self-imposed conservative cap
 *  - shiro: provider states "no restrictions... FOR NOW"; self-imposed conservative
 *    cap anyway, since "no limit today" isn't a documented guarantee.
 */
const LIMITS: Record<string, { max: number; windowMs: number }> = {
  mangadex: { max: 5, windowMs: 1000 },
  'mangadex-athome': { max: 40, windowMs: 60_000 },
  anilist: { max: 30, windowMs: 60_000 },
  jikan: { max: 3, windowMs: 1000 },
  kitsu: { max: 3, windowMs: 1000 },
  mangaupdates: { max: 5, windowMs: 1000 },
  shiro: { max: 3, windowMs: 1000 },
};

function getBucket(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    const limit = LIMITS[key] || { max: 5, windowMs: 1000 };
    b = { timestamps: [], windowMs: limit.windowMs, max: limit.max };
    buckets.set(key, b);
  }
  return b;
}

/** Waits (if needed) until the bucket has room, then reserves a slot. */
export async function throttle(key: string): Promise<void> {
  const b = getBucket(key);
  for (;;) {
    const now = Date.now();
    b.timestamps = b.timestamps.filter(t => now - t < b.windowMs);
    if (b.timestamps.length < b.max) {
      b.timestamps.push(now);
      return;
    }
    const oldest = b.timestamps[0];
    const wait = Math.max(0, b.windowMs - (now - oldest)) + 5;
    await new Promise(r => setTimeout(r, Math.min(wait, 2000)));
  }
}
