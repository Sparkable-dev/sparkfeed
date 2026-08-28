/**
 * sparkfeed-docs-proxy
 *
 * Reverse-proxies `sparkfeed.dev/docs*` to the docs site so the documentation
 * lives at a SUBPATH (sparkfeed.dev/docs) instead of a subdomain. A subpath
 * consolidates SEO link equity on the apex domain; a subdomain is treated by
 * search engines as a largely separate site.
 *
 * Route  (see wrangler.toml): sparkfeed.dev/docs and sparkfeed.dev/docs/*
 * Origin (DOCS_ORIGIN var):   https://docs.sparkfeed.dev  (docs Railway service)
 *
 * The docs app is built with Astro `base: '/docs'`, so it already expects and
 * serves the `/docs` prefix. We forward the path and query unchanged and only
 * swap the host, so no path rewriting is needed.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = new URL(env.DOCS_ORIGIN)

    // Point the request at the docs origin. Keep the /docs/... path + query.
    // Setting url.hostname makes fetch send the correct Host header and SNI,
    // so Railway routes the request to the docs service.
    url.protocol = origin.protocol
    url.hostname = origin.hostname
    url.port = origin.port

    const proxied = new Request(url.toString(), request)
    proxied.headers.set("X-Forwarded-Host", "sparkfeed.dev")
    proxied.headers.set("X-Forwarded-Proto", "https")

    // Do not auto-follow redirects; pass them to the browser. But never leak the
    // origin host: rewrite any Location that points at docs.sparkfeed.dev back to
    // the apex so users always stay on sparkfeed.dev/docs.
    const res = await fetch(proxied, { redirect: "manual" })

    const location = res.headers.get("Location")
    if (location && location.includes(origin.hostname)) {
      const headers = new Headers(res.headers)
      headers.set("Location", location.split(origin.hostname).join("sparkfeed.dev"))
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    }

    return res
  },
}
