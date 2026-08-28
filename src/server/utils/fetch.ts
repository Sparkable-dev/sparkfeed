/**
 * Outbound HTTP for user-supplied URLs.
 *
 * Every URL that reaches this module came from a text box, so it is treated as
 * hostile: it must be a public http(s) address, the request must time out, and
 * the response must be size-capped. Redirects are followed manually so each hop
 * is re-checked; automatic redirect following would let a public URL bounce to
 * 169.254.169.254 and defeat the guard entirely.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

export class ResponseTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Response exceeded ${maxBytes} bytes`)
    this.name = 'ResponseTooLargeError'
  }
}

export type SafeFetchOptions = Omit<RequestInit, 'redirect'> & {
  timeoutMs?: number
  maxBytes?: number
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
])

/** Hostnames that never resolve to anything routable on the public internet. */
function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (BLOCKED_HOSTNAMES.has(h)) return true
  return h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b, c] = parts
  if (a === 0) return true // "this network"
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  // Only these two /24s are reserved, NOT all of 192.0.0.0/16. Blocking the
  // whole /16 took out real sites: github.blog lives on 192.0.66.2.
  if (a === 192 && b === 0 && c === 0) return true // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true // TEST-NET-1
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

/**
 * Extracts the IPv4 address out of an IPv4-mapped IPv6 address.
 *
 * WHATWG URL normalizes `::ffff:10.0.0.1` to the hex form `::ffff:a00:1`, so
 * matching on dotted-quad text alone silently lets private addresses through.
 */
function ipv4FromMapped(addr: string): string | null {
  const m = addr.match(/^::ffff:(.+)$/)
  if (!m) return null

  const rest = m[1]
  if (rest.includes('.')) return rest

  const groups = rest.split(':')
  if (groups.length > 2) return null

  const hi = groups.length === 2 ? parseInt(groups[0], 16) : 0
  const lo = parseInt(groups[groups.length - 1], 16)
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null

  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.')
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (addr === '::' || addr === '::1') return true // unspecified, loopback
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb'))
    return true // link-local fe80::/10
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true // unique local fc00::/7
  if (addr.startsWith('ff')) return true // multicast

  const mapped = ipv4FromMapped(addr)
  if (mapped) return isPrivateIPv4(mapped)

  return false
}

function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return isPrivateIPv4(ip)
  if (family === 6) return isPrivateIPv6(ip)
  return true // not a recognisable IP, treat as unsafe
}

/**
 * Validates a single URL: http(s) only, no credentials, and no hostname that
 * resolves into private address space. Throws BlockedUrlError otherwise.
 */
export async function assertPublicUrl(input: string | URL): Promise<URL> {
  let url: URL
  try {
    url = input instanceof URL ? input : new URL(input)
  } catch {
    throw new BlockedUrlError('That does not look like a valid URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('Only http and https URLs are supported.')
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('URLs with embedded credentials are not allowed.')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isBlockedHostname(hostname)) {
    throw new BlockedUrlError('That address is not reachable from Sparkfeed.')
  }

  // Literal IP: check directly. Hostname: resolve and check every answer, so a
  // domain that points at a private address cannot slip through.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new BlockedUrlError('That address is not reachable from Sparkfeed.')
    }
    return url
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true })
  } catch {
    throw new BlockedUrlError(`Could not resolve ${hostname}.`)
  }

  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new BlockedUrlError('That address is not reachable from Sparkfeed.')
  }

  return url
}

/**
 * Fetch with a timeout, a public-address check on every redirect hop, and no
 * automatic redirect following.
 *
 * The returned Response body has NOT been size-capped; prefer safeFetchText,
 * which does. Use this directly only for HEAD requests or header inspection.
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes: _maxBytes, signal, ...init } = options

  let current = await assertPublicUrl(url)
  const deadline = AbortSignal.timeout(timeoutMs)
  const abortSignal = signal ? AbortSignal.any([signal, deadline]) : deadline

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, ...init.headers },
      redirect: 'manual',
      signal: abortSignal,
    })

    if (res.status < 300 || res.status > 399) return res

    const location = res.headers.get('location')
    if (!location) return res

    // Drain the redirect body so the socket can be reused.
    await res.body?.cancel().catch(() => {})

    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      throw new BlockedUrlError('This site redirected to an invalid URL.')
    }
    current = await assertPublicUrl(next)
  }

  throw new BlockedUrlError('Too many redirects.')
}

/**
 * safeFetch plus a hard cap on how much of the body is read. Streams and aborts
 * past maxBytes instead of buffering an unbounded response into memory.
 */
export async function safeFetchText(
  url: string,
  options: SafeFetchOptions = {},
): Promise<{ res: Response; text: string; contentType: string; finalUrl: string }> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const res = await safeFetch(url, options)

  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new ResponseTooLargeError(maxBytes)
  }

  const text = res.body ? await readCapped(res.body, maxBytes) : ''

  return {
    res,
    text,
    contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
    finalUrl: res.url || url,
  }
}

async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let received = 0
  let out = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) throw new ResponseTooLargeError(maxBytes)
      out += decoder.decode(value, { stream: true })
    }
    out += decoder.decode()
  } finally {
    reader.releaseLock()
    await body.cancel().catch(() => {})
  }

  return out
}

const FEED_CONTENT_TYPES = ['xml', 'rss', 'atom', 'json']

/** True when a content-type plausibly carries a feed. Empty types pass: plenty of feeds are served as text/plain or with no type at all. */
export function looksLikeFeedContentType(contentType: string): boolean {
  if (!contentType) return true
  if (contentType.includes('text/html')) return false
  return FEED_CONTENT_TYPES.some((t) => contentType.includes(t)) || contentType.includes('text/plain')
}
