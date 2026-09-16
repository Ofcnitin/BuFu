window.BUFU_CONFIG = {
  // Must exactly match the Worker's actual deployed origin, or every
  // request fails at the network layer (DNS/TLS — before CORS is even
  // relevant) with a generic "Failed to fetch". Cloudflare's default
  // *.workers.dev naming is <worker-name>.<account-subdomain>.workers.dev;
  // wrangler.toml names this worker "bufu-api" with no custom route/domain
  // configured, and "ofcnitin" is the account identifier used consistently
  // elsewhere in this repo (the GitHub Pages origin below, the User-Agent
  // URL in worker/src/utils.ts). This was previously "bufu.ofcnitin.workers.dev"
  // (missing "-api") — a real, verified mismatch, not a placeholder guess.
  // If you deploy under a different account subdomain or a custom domain,
  // update this to match — and keep wrangler.toml's ALLOWED_ORIGINS in sync
  // with wherever this file itself is actually served from (e.g. GitHub
  // Pages), not with this value.
  apiBase: "https://bufu-api.ofcnitin.workers.dev",
};
