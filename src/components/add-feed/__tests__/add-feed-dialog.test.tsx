// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FeedCandidate } from "@/server/rss"
import { feedSignals } from "@/server/utils/feed-signals"

/**
 * The dialog, without a server.
 *
 * What is pinned here is the behaviour the old modal could not do at all —
 * creating a folder with a single feed ticked — and the two judgements that
 * decide what the user ends up subscribed to: a comments feed must not arrive
 * pre-ticked, and a feed you already have must not be tickable.
 */

const previewFeed = vi.fn()
const discoverFeeds = vi.fn()
const resolveFeedBatch = vi.fn()
const createFeeds = vi.fn()

vi.mock("@/server/rss", () => ({
  MAX_BATCH_URLS: 8,
  previewFeed: (...args: Array<unknown>) => previewFeed(...args),
  discoverFeeds: (...args: Array<unknown>) => discoverFeeds(...args),
  resolveFeedBatch: (...args: Array<unknown>) => resolveFeedBatch(...args),
  createFeeds: (...args: Array<unknown>) => createFeeds(...args),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

/*
  The repo's .env sets VITE_DEMO_MODE, and vitest loads it — so without this
  every Add button is disabled by the demo gate and half of these tests pass
  for the wrong reason. `the demo gate` below re-enables it deliberately.
*/
vi.mock("@/lib/demo", () => ({ DEMO_MODE: false }))

const { AddFeedDialog } = await import("../AddFeedDialog")

function candidate(over: Partial<FeedCandidate> & { url: string }): FeedCandidate {
  const items = over.itemCount === 0 ? [] : [{ title: "A post", isoDate: new Date().toISOString() }]
  return {
    title: "Example Blog",
    itemCount: 1,
    sampleTitles: ["A post"],
    section: null,
    kind: "primary",
    alreadyAdded: false,
    identity: over.url,
    signals: feedSignals({
      requestedUrl: over.url,
      finalUrl: over.url,
      feed: { title: over.title ?? "Example Blog", items },
    }),
    ...over,
  }
}

const FOLDERS = [{ id: "f1", name: "AI Research" }]

function renderDialog(props: Partial<Parameters<typeof AddFeedDialog>[0]> = {}) {
  return render(
    <AddFeedDialog
      open
      onOpenChange={() => {}}
      options={{}}
      folders={FOLDERS}
      onAdded={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  discoverFeeds.mockResolvedValue({ status: "ok", feeds: [] })
  createFeeds.mockResolvedValue({
    status: "ok",
    folderId: null,
    added: [{ id: "1", url: "https://example.com/feed", name: "Example Blog" }],
    skipped: [],
    failed: [],
  })
})

afterEach(cleanup)

async function findFeeds(user: ReturnType<typeof userEvent.setup>, feeds: Array<FeedCandidate>) {
  previewFeed.mockResolvedValue({
    status: "ok",
    origin: "https://example.com",
    siteName: "Example Blog",
    feeds,
  })
  await user.type(screen.getByLabelText("Site or feed address"), "example.com")
  await user.click(screen.getByRole("button", { name: "Find" }))
  // The select-all box, not the site name: the name appears in the results
  // header as well as on the row, so it is not a unique anchor.
  await screen.findByLabelText("Select every feed")
}

describe("what arrives ticked", () => {
  it("ticks an ordinary feed and offers to add it", async () => {
    const user = userEvent.setup()
    renderDialog()
    await findFeeds(user, [candidate({ url: "https://example.com/feed" })])

    expect(screen.getByRole("button", { name: "Add 1 feed" })).toBeTruthy()
  })

  it("leaves a comments feed for the user to choose", async () => {
    // The single biggest source of bad adds: WordPress advertises this beside
    // the real feed and it looks identical.
    const user = userEvent.setup()
    renderDialog()
    await findFeeds(user, [
      candidate({ url: "https://example.com/feed" }),
      candidate({
        url: "https://example.com/comments/feed/",
        title: "Comments on: Example Blog",
        kind: "section",
      }),
    ])

    expect(screen.getByText("Comments")).toBeTruthy()
    // One of the two, not both.
    expect(screen.getByRole("button", { name: "Add 1 feed" })).toBeTruthy()
  })

  it("will not let you add a feed you already have", async () => {
    const user = userEvent.setup()
    renderDialog()
    await findFeeds(user, [
      candidate({ url: "https://example.com/feed", alreadyAdded: true, title: "Example Blog" }),
    ])

    expect(screen.getByText("Already added")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true)
  })
})

describe("the destination", () => {
  it("creates a folder with a single feed ticked", async () => {
    // Impossible in the old modal: its folder-creation branch only appeared
    // once more than one feed was selected.
    const user = userEvent.setup()
    renderDialog()
    await findFeeds(user, [candidate({ url: "https://example.com/feed" })])

    await user.click(screen.getByLabelText("Folder"))
    await user.click(await screen.findByRole("option", { name: "New folder…" }))

    const input = await screen.findByLabelText("New folder name")
    await user.clear(input)
    await user.type(input, "Reading")
    await user.click(screen.getByRole("button", { name: "Add 1 feed" }))

    await waitFor(() => expect(createFeeds).toHaveBeenCalled())
    expect(createFeeds.mock.calls[0][0].data.destination).toEqual({
      kind: "new",
      name: "Reading",
    })
  })

  it("pre-fills the new folder with the site's name", async () => {
    // So the common case — one site, one folder named after it — is two clicks
    // and no typing.
    const user = userEvent.setup()
    renderDialog()
    await findFeeds(user, [candidate({ url: "https://example.com/feed" })])

    await user.click(screen.getByLabelText("Folder"))
    await user.click(await screen.findByRole("option", { name: "New folder…" }))

    expect(await screen.findByLabelText("New folder name")).toHaveProperty("value", "Example Blog")
  })

  it("cannot be submitted with a blank new folder name", async () => {
    // Guards against creating a folder called "" when the field is emptied.
    const user = userEvent.setup()
    renderDialog()
    await findFeeds(user, [candidate({ url: "https://example.com/feed" })])

    await user.click(screen.getByLabelText("Folder"))
    await user.click(await screen.findByRole("option", { name: "New folder…" }))
    await user.clear(await screen.findByLabelText("New folder name"))

    expect(screen.getByRole("button", { name: "Add 1 feed" })).toHaveProperty("disabled", true)
  })

  it("starts on the folder it was opened for", () => {
    renderDialog({ options: { folderId: "f1" } })
    expect(screen.getByLabelText("Folder").textContent).toContain("AI Research")
  })
})

describe("the two tabs", () => {
  it("keeps the destination and the selection when you switch", async () => {
    // Selection is shared on purpose: "paste a site, then paste a list, put it
    // all in one folder" is the reason this is one dialog and not two.
    const user = userEvent.setup()
    renderDialog()
    await findFeeds(user, [candidate({ url: "https://example.com/feed" })])

    await user.click(screen.getByLabelText("Folder"))
    await user.click(await screen.findByRole("option", { name: "AI Research" }))

    await user.click(screen.getByRole("tab", { name: "Paste a list" }))

    expect(screen.getByRole("button", { name: "Add 1 feed" })).toBeTruthy()
    expect(screen.getByLabelText("Folder").textContent).toContain("AI Research")
  })

  it("opens straight onto the bulk tab when asked", () => {
    renderDialog({ options: { tab: "bulk" } })
    expect(screen.getByLabelText("Addresses, one per line")).toBeTruthy()
  })
})
