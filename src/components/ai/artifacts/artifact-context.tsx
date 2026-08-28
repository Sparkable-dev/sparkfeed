import * as React from "react"
import type { ArtifactKind } from "@/server/ai/artifacts"

/**
 * Which artifact the side panel is showing.
 *
 * The panel does not own the document — the message thread does, in the tool
 * call's streaming arguments. This context holds only a *pointer* plus the last
 * snapshot the card pushed, which is what lets a document keep filling in while
 * you watch it: the card re-renders on every partial argument, sees it is the
 * open one, and syncs.
 *
 * Keyed on `toolCallId`, so two artifacts in one conversation are two
 * documents, and re-opening an older one shows that one rather than the newest.
 */

/** A document the model wrote, arriving as the tool call's arguments. */
export interface AuthoredArtifact {
  /** The tool call's id — stable for the life of the message. */
  id: string
  kind: ArtifactKind
  title: string
  content: string
  /** True while the model is still writing it. */
  streaming: boolean
}

/**
 * An article to read, which the *client* fetches.
 *
 * The panel holds a pointer, not the text. An article is often far longer than
 * the reply that mentioned it, and putting it in the conversation would mean
 * every following turn paid for it again — the same reasoning that keeps the
 * artifact tool from echoing its own document back. So the card carries an id
 * or a URL, and the panel resolves it on open.
 */
export interface ArticleArtifact {
  id: string
  kind: "article"
  title: string
  source:
    | { type: "workspace"; articleId: string }
    | { type: "url"; url: string }
}

/**
 * One thing filed into the report.
 *
 * A block list rather than accumulated markdown. Appending text would flatten a
 * chart into a picture of itself the moment it was filed, and there would be no
 * way to remove one item afterwards — the two things a report is for.
 */
export interface ReportBlock {
  id: string
  kind: "chart" | "note"
  title: string
  /** The line that says what this block shows. */
  summary: string
  chart?: {
    shape: "series" | "bars"
    points: Array<{ label: string; value: number }>
    unit: string
    total: string
    delta: string | null
  }
}

/**
 * The report being assembled, which is a panel rather than a document.
 *
 * One per conversation, and it survives the panel being closed — it is the
 * thing being built, not a view of something else.
 */
export interface ReportArtifact {
  id: "report"
  kind: "report"
  title: string
  blocks: Array<ReportBlock>
}

/**
 * One thing this conversation produced, as the assets dock lists it.
 *
 * It carries the document rather than a pointer to it, which is a deliberate
 * second copy of something the message part already holds. Opening by id alone
 * meant handing the panel an empty artifact and waiting for the owning card to
 * notice and fill it in — a frame of "Nothing to show yet" on every open, and
 * nothing at all if that card ever stopped being mounted. The text is already
 * in memory; a reference to it is not worth a race.
 *
 * `kind` is the artifact's kind today because documents are what the model can
 * make. An image would register the same way, from whatever card renders it.
 */
export interface ConversationAsset {
  /** The tool call's id. Stable, so re-registering replaces rather than adds. */
  id: string
  kind: ArtifactKind
  title: string
  /** "1,204 words", "38 lines" — whatever the card shows under the title. */
  meta: string
  content: string
  streaming: boolean
}

export type OpenArtifact = AuthoredArtifact | ArticleArtifact | ReportArtifact

/** Narrowing helper, since `kind` is the discriminant in three places. */
export function isArticle(artifact: OpenArtifact): artifact is ArticleArtifact {
  return artifact.kind === "article"
}

interface ArtifactContextValue {
  artifact: OpenArtifact | null
  open: (artifact: OpenArtifact) => void
  /**
   * Refreshes the open document. Ignored if `artifact.id` is not the open one,
   * and only ever called for an authored artifact — an article does not stream.
   */
  sync: (artifact: AuthoredArtifact) => void
  close: () => void

  /**
   * Everything this conversation has produced, oldest first.
   *
   * Collected from the cards rather than from the message list: a card already
   * knows its own title, kind and size, and reading them back out of the
   * transcript would mean a second parser for the same tool arguments.
   */
  assets: Array<ConversationAsset>
  /** Called by a card as it renders. Idempotent — same id replaces in place. */
  registerAsset: (asset: ConversationAsset) => void

  /** How many blocks are filed, for the badge on every Add to report button. */
  reportSize: number
  /**
   * Whether a block is already filed — asked by cards, which need the answer
   * whether or not the report happens to be the panel currently open.
   */
  isInReport: (blockId: string) => boolean
  /** Files a block and opens the report, so the action has a visible result. */
  addToReport: (block: ReportBlock) => void
  removeFromReport: (blockId: string) => void
  openReport: () => void
}

const ArtifactContext = React.createContext<ArtifactContextValue | null>(null)

/**
 * Where a conversation's report lives between visits.
 *
 * Local storage rather than the database, and per thread rather than per user.
 * A report is a working set — the two charts out of six that were worth keeping
 * — assembled while reading one conversation, and its whole value is being
 * there when you come back to that conversation an hour later. That is a
 * browser-shaped problem, and the blocks are a few hundred bytes of numbers the
 * server already has.
 *
 * It is not a document. `create_artifact` is the tool for something to keep and
 * share; this is a clipboard you can close by accident, which is exactly why it
 * needs to survive being closed.
 */
const reportKey = (threadId: string) => `sparkfeed.report.${threadId}`

function loadReport(threadId: string | undefined): Array<ReportBlock> {
  if (!threadId || typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(reportKey(threadId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // Anything could be under that key — an older shape of this feature, or a
    // hand-edited value. A malformed report should be an empty one, never a
    // crash on the way into the page.
    return Array.isArray(parsed) ? (parsed as Array<ReportBlock>) : []
  } catch {
    return []
  }
}

export function ArtifactProvider({
  threadId,
  children,
}: {
  /** Scopes the saved report. Omitted outside a real conversation (tests). */
  threadId?: string
  children: React.ReactNode
}): React.ReactElement {
  const [artifact, setArtifact] = React.useState<OpenArtifact | null>(null)

  const open = React.useCallback(
    (next: OpenArtifact) => setArtifact(next),
    []
  )
  const close = React.useCallback(() => setArtifact(null), [])

  /*
    `sync` returns the *same object* when nothing has changed, and that is not a
    micro-optimisation — it is what stops the two components spinning.

    The card syncs from an effect that depends on the context value; the context
    value changes whenever the artifact does. Storing a freshly built object on
    every sync therefore meant: new state → new context value → effect fires →
    new state, forever, with no chunk of stream needed to keep it going. React
    bails out of a re-render when a setter returns the identical reference, so
    comparing the fields here is what breaks the cycle.
  */
  const sync = React.useCallback((next: AuthoredArtifact) => {
    setArtifact((current) => {
      if (!current || current.id !== next.id || isArticle(current)) return current
      const same =
        current.title === next.title &&
        current.kind === next.kind &&
        current.content === next.content &&
        current.streaming === next.streaming
      return same ? current : next
    })
  }, [])

  const [assets, setAssets] = React.useState<Array<ConversationAsset>>([])

  /*
    Same identity trick as `sync`, and for the same reason. A card registers
    from an effect; if registering always produced a new array, the context
    value would change, the effect would fire again, and the two would spin
    without a byte of stream to keep them going. Returning `current` unchanged
    when nothing has actually changed is what stops that.
  */
  const registerAsset = React.useCallback((asset: ConversationAsset) => {
    setAssets((current) => {
      const index = current.findIndex((a) => a.id === asset.id)
      if (index === -1) return [...current, asset]

      const existing = current[index]
      const same =
        existing.title === asset.title &&
        existing.kind === asset.kind &&
        existing.content === asset.content &&
        existing.streaming === asset.streaming
      if (same) return current

      const next = [...current]
      next[index] = asset
      return next
    })
  }, [])

  /*
    The report is its own state, not an artifact that happens to be open. It
    outlives every panel it appears in: file a chart, close the panel, read
    three more articles, file another — and it is still the same report.

    Read from storage lazily, so the initial render already has the saved blocks
    and the badge never flashes empty before an effect fills it in.
  */
  const [blocks, setBlocks] = React.useState<Array<ReportBlock>>(() =>
    loadReport(threadId)
  )

  // Reload when the conversation changes. In practice the whole chat is keyed on
  // the thread and remounts, but a provider that silently carried one
  // conversation's report into another would be a bad surprise if that changed.
  React.useEffect(() => {
    setBlocks(loadReport(threadId))
  }, [threadId])

  React.useEffect(() => {
    if (!threadId || typeof window === "undefined") return
    try {
      if (blocks.length === 0) window.localStorage.removeItem(reportKey(threadId))
      else window.localStorage.setItem(reportKey(threadId), JSON.stringify(blocks))
    } catch {
      // A full or disabled store costs the user their saved report, not their
      // conversation. Nothing here is worth an error in front of them.
    }
  }, [threadId, blocks])

  // `blocks: []` in the artifact and not a snapshot: the value below rebuilds an
  // open report from live state, so a placeholder is the honest thing to store.
  // Putting a copy here instead gave the panel a list that stopped updating.
  const openReport = React.useCallback(() => {
    setArtifact({ id: "report", kind: "report", title: "Report", blocks: [] })
  }, [])

  const addToReport = React.useCallback((block: ReportBlock) => {
    // Filing the same chart twice is a mis-click, not an intention.
    setBlocks((current) =>
      current.some((b) => b.id === block.id) ? current : [...current, block]
    )
    setArtifact({ id: "report", kind: "report", title: "Report", blocks: [] })
  }, [])

  const removeFromReport = React.useCallback((blockId: string) => {
    setBlocks((current) => current.filter((b) => b.id !== blockId))
  }, [])

  const value = React.useMemo<ArtifactContextValue>(
    () => ({
      // The open report is rebuilt from live blocks rather than from the
      // snapshot taken when it was opened, so filing a block while it is on
      // screen shows up immediately.
      artifact:
        artifact?.kind === "report" ? { ...artifact, blocks } : artifact,
      open,
      sync,
      close,
      assets,
      registerAsset,
      reportSize: blocks.length,
      isInReport: (blockId: string) => blocks.some((b) => b.id === blockId),
      addToReport,
      removeFromReport,
      openReport,
    }),
    [
      artifact,
      assets,
      blocks,
      open,
      sync,
      close,
      registerAsset,
      addToReport,
      removeFromReport,
      openReport,
    ]
  )

  return (
    <ArtifactContext.Provider value={value}>{children}</ArtifactContext.Provider>
  )
}

/**
 * Returns `null` outside a provider rather than throwing.
 *
 * The artifact card is rendered by the toolkit, which the tests and any future
 * embedding of the thread can mount without the panel. A card that cannot open
 * a panel should show its summary and no button, not take the page down.
 */
export function useArtifactPanel(): ArtifactContextValue | null {
  return React.useContext(ArtifactContext)
}
