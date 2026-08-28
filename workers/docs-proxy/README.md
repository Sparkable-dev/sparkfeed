# sparkfeed-docs-proxy

A Cloudflare Worker that makes the documentation site live at
**`sparkfeed.dev/docs`** (a subpath) instead of a subdomain. A subpath keeps all
SEO link equity on the apex domain; a subdomain (`docs.sparkfeed.dev`) is treated
by search engines as a largely separate site.

```
Browser ── sparkfeed.dev/        ──▶ landing (Railway)        [direct, proxied by Cloudflare]
Browser ── sparkfeed.dev/docs/*  ──▶ this Worker ──▶ docs.sparkfeed.dev (docs Railway service)
```

The docs Astro app is already built with `base: '/docs'` and
`site: 'https://sparkfeed.dev'`, so its pages, assets, and canonical URLs are all
under `/docs`. The Worker forwards the path unchanged, so no rewriting is needed.

---

## One-time setup

### Phase 1 — point the docs service at `docs.sparkfeed.dev` (do this first)

1. **Railway → docs service → Settings → Networking → Custom Domain** and add
   `docs.sparkfeed.dev`. Railway shows a CNAME target like
   `abc123.up.railway.app`.
2. **Cloudflare → DNS** for the `sparkfeed.dev` zone: add a `CNAME`
   record `docs` → that Railway target. **Proxied (orange cloud) is fine and is
   the current setup**; DNS-only (grey) also works. With orange cloud, make sure
   SSL/TLS mode is **Full** (required for Railway behind Cloudflare).
3. Wait for Railway to show the domain **Active**, then verify the origin works
   on its own:
   - `https://docs.sparkfeed.dev/docs/getting-started/introduction` loads the docs.
   - `https://docs.sparkfeed.dev/` 404s with "base path set to /docs" — that is
     EXPECTED. The app only serves under `/docs`.

Do not move on until `.../docs/...` verifies. The Worker just points at this origin.

### Phase 2 — deploy the Worker

Prerequisites: the `sparkfeed.dev` zone is on this Cloudflare account and the apex
is proxied (orange cloud) with **SSL/TLS mode = Full** (already the case, since
the landing site works).

```bash
cd workers/docs-proxy
npm install
npx wrangler login                 # or: export CLOUDFLARE_API_TOKEN=...
# set your account id once (or uncomment account_id in wrangler.toml):
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy
```

`wrangler deploy` uploads the Worker and binds the routes
`sparkfeed.dev/docs` and `sparkfeed.dev/docs/*` automatically (from
`wrangler.toml`).

### Verify

- `https://sparkfeed.dev/docs` and `.../docs/getting-started/introduction` load the docs.
- `https://sparkfeed.dev/` still loads the landing site.
- Docs styles/scripts under `/docs/_astro/...` load, and Starlight search works.

---

## Configuration

- **`DOCS_ORIGIN`** (in `wrangler.toml` `[vars]`): the hostname that serves the
  docs. Defaults to `https://docs.sparkfeed.dev`. Change it if the origin moves.
- **Routes**: edit the `routes` array in `wrangler.toml` to change the subpath.

## Notes

- `docs.sparkfeed.dev` stays publicly reachable as the origin. Because the docs
  emit canonical URLs at `https://sparkfeed.dev/docs/...`, search engines
  consolidate on the apex. If you later want to hide the subdomain entirely, we
  can switch the Worker origin to the raw `*.up.railway.app` host and 301-redirect
  `docs.sparkfeed.dev` to `sparkfeed.dev/docs`.
- This Worker is independent of the Railway deploys; redeploying landing or docs
  does not require redeploying the Worker.
