/** Bounds publisher downloads across discovery, ingestion and optional images. */
const hosts = new Map<string, { running: number; waiting: Array<() => void> }>()
const MAX_PER_HOST = 3
const MAX_WAITING = 64
const cooldowns = new Map<string, number>()

export function recordPublisherCooldown(
  url: string,
  retryAfter: string | null,
  now = Date.now()
): void {
  const seconds = Number(retryAfter)
  const until =
    retryAfter && Number.isFinite(seconds)
      ? now + seconds * 1000
      : Date.parse(retryAfter ?? "")
  const duration = Math.min(
    60 * 60_000,
    Math.max(60_000, Number.isFinite(until) ? until - now : 60_000)
  )
  for (const [host, expires] of cooldowns)
    if (expires <= now) cooldowns.delete(host)
  if (cooldowns.size >= 1000) cooldowns.delete(cooldowns.keys().next().value!)
  cooldowns.set(new URL(url).hostname, now + duration)
}

export async function withHostLimit<T>(
  url: string,
  work: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const key = new URL(url).hostname
  const cooldown = cooldowns.get(key)
  if (cooldown && cooldown > Date.now())
    throw new Error("Publisher returned 429; retry later.")
  if (cooldown) cooldowns.delete(key)
  const state = hosts.get(key) ?? { running: 0, waiting: [] }
  hosts.set(key, state)
  if (signal?.aborted) {
    if (!state.running && !state.waiting.length) hosts.delete(key)
    throw signal.reason
  }
  if (state.running >= MAX_PER_HOST) {
    if (state.waiting.length >= MAX_WAITING)
      throw new Error("Publisher request queue is full. Try again later.")
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener("abort", abort)
        resolve()
      }
      const abort = () => {
        const i = state.waiting.indexOf(start)
        if (i >= 0) state.waiting.splice(i, 1)
        reject(signal?.reason)
      }
      state.waiting.push(start)
      signal?.addEventListener("abort", abort, { once: true })
    })
  } else state.running++
  try {
    signal?.throwIfAborted()
    if ((cooldowns.get(key) ?? 0) > Date.now())
      throw new Error("Publisher returned 429; retry later.")
    return await work()
  } finally {
    const next = state.waiting.shift()
    if (next) next()
    else {
      state.running--
      if (!state.running) hosts.delete(key)
    }
  }
}
