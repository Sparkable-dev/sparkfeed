import { describe, expect, it } from "vitest"
import { recordPublisherCooldown, withHostLimit } from "../host-limit"

describe("publisher download limits", () => {
  it("honors publisher cooldowns without sleeping or issuing another request", async () => {
    recordPublisherCooldown("https://limited.test", "120")
    await expect(
      withHostLimit("https://limited.test", async () => "unexpected")
    ).rejects.toThrow("429")
    recordPublisherCooldown("https://limited.test", "60", Date.now() - 120_000)
    await expect(
      withHostLimit("https://limited.test", async () => "allowed")
    ).resolves.toBe("allowed")
  })
  it("bounds one host while allowing another to progress", async () => {
    let active = 0,
      peak = 0
    const tasks = Array.from({ length: 12 }, () =>
      withHostLimit("https://example.test/feed", async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
      })
    )
    await expect(
      withHostLimit("https://other.test/feed", async () => 7)
    ).resolves.toBe(7)
    await Promise.all(tasks)
    expect(peak).toBe(3)
  })
  it("removes cancelled waiters and releases permits after failures", async () => {
    const releases: Array<() => void> = []
    const running = Array.from({ length: 3 }, () =>
      withHostLimit(
        "https://cancel.test",
        () => new Promise<void>((resolve) => releases.push(resolve))
      )
    )
    const controller = new AbortController()
    const pending = withHostLimit(
      "https://cancel.test",
      async () => "unexpected",
      controller.signal
    )
    controller.abort(new Error("cancelled"))
    await expect(pending).rejects.toThrow("cancelled")
    releases.forEach((r) => r())
    await Promise.all(running)
    await expect(
      withHostLimit("https://cancel.test", async () => {
        throw new Error("failed")
      })
    ).rejects.toThrow("failed")
    await expect(
      withHostLimit("https://cancel.test", async () => "ok")
    ).resolves.toBe("ok")
  })
})
