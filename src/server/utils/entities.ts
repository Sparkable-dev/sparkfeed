/**
 * Decodes HTML entities left over in feed text.
 *
 * The feed parser already decodes the XML layer, so anything still showing as
 * `&#8217;` was **double**-encoded by the publisher: their XML literally
 * contained `&amp;#8217;`, which decodes once to `&#8217;` and stops. The Verge
 * does this on every apostrophe, so headlines rendered as
 * "Elon Musk&#8217;s attempt at an AI Wikipedia".
 *
 * Deliberately a small table rather than a dependency or a DOM parse: this runs
 * per article on the server, the set of entities that show up in headlines is
 * tiny, and `innerHTML` on untrusted text is not something to reach for casually.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
}

export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input

  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      // Surrogates and out-of-range values would throw; leaving the raw text is
      // strictly better than crashing an ingest over one bad character.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
      if (code >= 0xd800 && code <= 0xdfff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    return NAMED[body.toLowerCase()] ?? match
  })
}
