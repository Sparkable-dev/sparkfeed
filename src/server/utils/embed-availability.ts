import { safeFetch } from "./fetch"

export type EmbedAvailability = "allowed" | "blocked" | "unknown"

function matchesSource(source: string, parent: URL, page: URL): boolean | null {
  if (source === "'self'") return parent.origin === page.origin
  if (source === "*") return true
  if (/^https?:$/.test(source))
    return (
      parent.protocol === source ||
      (source === "http:" && parent.protocol === "https:")
    )
  try {
    const match = source.match(
      /^(?:(https?):\/\/)?(\*\.)?([^/:]+)(?::(\*|\d+))?\/?$/i
    )
    if (!match) return null
    const [, scheme, wildcard, host, port] = match
    const protocol = `${scheme || page.protocol.slice(0, -1)}:`.toLowerCase()
    if (
      parent.protocol !== protocol &&
      !(protocol === "http:" && parent.protocol === "https:")
    )
      return false
    const hostname = parent.hostname.toLowerCase()
    if (
      host !== "*" && (wildcard
        ? !hostname.endsWith(`.${host.toLowerCase()}`)
        : hostname !== host.toLowerCase())
    )
      return false
    if (port === "*") return true
    return (
      (parent.port || (parent.protocol === "https:" ? "443" : "80")) ===
      (port || (parent.protocol === "https:" ? "443" : "80"))
    )
  } catch {
    return null
  }
}

/** Evaluate all enforced policies; one denying policy is enough to prevent framing. */
export function embedPolicy(
  headers: Headers,
  pageUrl: string,
  parentOrigin: string
): EmbedAvailability {
  const page = new URL(pageUrl)
  const parent = new URL(parentOrigin)
  const policies = (headers.get("content-security-policy") || "").split(",")
  let hasAncestors = false
  let uncertain = false
  for (const policy of policies) {
    const directive = policy
      .split(";")
      .map((s) => s.trim())
      .find((s) => /^frame-ancestors(?:\s|$)/i.test(s))
    if (!directive) continue
    hasAncestors = true
    const sources = directive.split(/\s+/).slice(1)
    if (
      sources.length === 0 ||
      (sources.length === 1 && sources[0] === "'none'")
    )
      return "blocked"
    const matches = sources
      .filter((s) => s !== "'none'")
      .map((s) => matchesSource(s, parent, page))
    if (matches.includes(true)) continue
    if (matches.includes(null)) uncertain = true
    else return "blocked"
  }
  // An enforced frame-ancestors directive supersedes X-Frame-Options.
  if (hasAncestors) return uncertain ? "unknown" : "allowed"
  const xfo =
    headers
      .get("x-frame-options")
      ?.toLowerCase()
      .split(",")
      .map((s) => s.trim()) || []
  if (xfo.includes("deny")) return "blocked"
  if (xfo.includes("sameorigin"))
    return parent.origin === page.origin ? "allowed" : "blocked"
  return xfo.length ? "unknown" : "allowed"
}

export async function inspectEmbedAvailability(
  url: string,
  parentOrigin: string
) {
  try {
    // GET reflects the iframe's request method. Stop after headers, without parsing
    // the page or coupling Live to Reader extraction. Redirects remain SSRF checked.
    const res = await safeFetch(url, { method: "GET", timeoutMs: 5000 })
    try {
      const availability = res.ok
        ? embedPolicy(res.headers, res.url || url, parentOrigin)
        : "unknown"
      return { availability, canEmbed: availability !== "blocked" }
    } finally {
      await res.body?.cancel().catch(() => {})
    }
  } catch {
    // A server request failure does not prove that the user's browser cannot embed it.
    return { availability: "unknown" as const, canEmbed: true }
  }
}
