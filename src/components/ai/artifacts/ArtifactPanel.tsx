import * as React from "react"
import {
  BookOpenIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  GlobeIcon,
  Loader2Icon,
  NewspaperIcon,
  XIcon,
} from "lucide-react"
import { ArtifactMarkdown } from "./ArtifactMarkdown"
import {
  ArticleReader,
  ReaderControls,
  useArticleContent,
} from "./ArticleReader"
import { isArticle, useArtifactPanel } from "./artifact-context"
import { ReportPanel } from "./ReportPanel"
import {
  ArtifactKindIcon,
  artifactFilename,
  artifactKindLabel,
  artifactMeta,
} from "./artifact-meta"
import type { ArticleArtifact, AuthoredArtifact } from "./artifact-context"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"
import { cn } from "@/lib/utils"

type View = "preview" | "code"

/**
 * The document panel.
 *
 * Renders nothing when no artifact is open, so the layout in `SparkChat` can
 * mount it unconditionally and let the presence of an artifact decide the
 * width of the thread beside it.
 */
export function ArtifactPanel() {
  const panel = useArtifactPanel()
  if (!panel?.artifact) return null

  // Keyed on the id so switching between two artifacts resets the view toggle
  // rather than carrying "code" over onto a document you have not seen yet.
  if (isArticle(panel.artifact)) {
    return (
      <ArticlePanelBody
        key={panel.artifact.id}
        artifact={panel.artifact}
        onClose={panel.close}
      />
    )
  }

  if (panel.artifact.kind === "report") {
    return (
      <ReportPanel
        artifact={panel.artifact}
        onRemove={panel.removeFromReport}
        onClose={panel.close}
      />
    )
  }

  return (
    <ArtifactPanelBody
      key={panel.artifact.id}
      artifact={panel.artifact}
      onClose={panel.close}
    />
  )
}

/**
 * The article variant of the panel.
 *
 * A separate component rather than more branches in the one below, because
 * almost nothing is shared: an article has no source to toggle to and nothing
 * to download, its "code" view is the publisher's live page, and its controls
 * are the reader's font and width. Folding two panels into one had every line
 * asking which of them it was in.
 */
function ArticlePanelBody({
  artifact,
  onClose,
}: {
  artifact: ArticleArtifact
  onClose: () => void
}) {
  const { loading, error, content } = useArticleContent(artifact.source)
  const [view, setView] = React.useState<"read" | "live">("read")

  // The publisher's own page, only when its headers allow being framed.
  const canLive = Boolean(content?.canEmbed && content.url)
  const active = canLive ? view : "read"

  return (
    <aside
      className="fixed inset-0 z-40 flex min-w-0 flex-1 flex-col bg-background md:static md:z-0 md:border-s md:border-border/60"
      aria-label={`Article: ${artifact.title}`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/50 bg-muted/50 text-muted-foreground">
          <NewspaperIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {content?.title ?? artifact.title}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {/* "loading…" only while it is. On failure the body says what went
                wrong; a header still claiming to be loading contradicts it. */}
            {content?.domain ?? (loading ? "loading…" : "could not be read")}
            {content?.byline ? ` · ${content.byline}` : ""}
          </p>
        </div>

        <TooltipIconButton
          tooltip="Open in a new tab"
          disabled={!content?.url}
          onClick={() => {
            if (content?.url) window.open(content.url, "_blank", "noopener")
          }}
        >
          <ExternalLinkIcon />
        </TooltipIconButton>
        <TooltipIconButton tooltip="Close" onClick={onClose}>
          <XIcon />
        </TooltipIconButton>
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-1.5">
        <ViewTab
          active={active === "read"}
          onClick={() => setView("read")}
          icon={<BookOpenIcon className="size-3.5" />}
          label="Read"
        />
        <ViewTab
          active={active === "live"}
          disabled={!canLive}
          onClick={() => setView("live")}
          icon={<GlobeIcon className="size-3.5" />}
          label="Live"
        />
        {/* Reader settings belong to the reading view and nowhere else. */}
        {active === "read" ? (
          <div className="ms-auto">
            <ReaderControls />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
        {active === "live" && content?.url ? (
          /*
            `allow-same-origin` is present here and absent from the artifact
            frame below, and the difference is deliberate. This is the
            publisher's own page loaded from their origin — same-origin means
            *their* origin, not ours, so it gets its own cookies and storage and
            renders as they intended. An artifact is model-written HTML served
            from a blank document, where same-origin would mean ours.
          */
          <iframe
            title={`Live page: ${content.domain}`}
            src={content.url}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer-when-downgrade"
            className="size-full border-0 bg-white"
          />
        ) : (
          <ArticleReader
            title={artifact.title}
            content={content}
            loading={loading}
            error={error}
          />
        )}
      </div>
    </aside>
  )
}

function ArtifactPanelBody({
  artifact,
  onClose,
}: {
  artifact: AuthoredArtifact
  onClose: () => void
}) {
  const { title, kind, content, streaming } = artifact
  const [view, setView] = React.useState<View>("preview")

  /*
    An HTML preview cannot stream. `srcDoc` replaces the whole document on every
    change, so a page being written re-parses from scratch several times a
    second and the reader watches it flash through broken intermediate states.
    Source is the honest view while it is being typed; the preview arrives when
    there is a page to show.

    Markdown has no such problem — it is re-rendered, not reloaded — so it
    previews live.
  */
  const forceCode = kind === "html" && streaming
  const active: View = forceCode ? "code" : view

  const wasStreaming = React.useRef(streaming)
  React.useEffect(() => {
    if (wasStreaming.current && !streaming) setView("preview")
    wasStreaming.current = streaming
  }, [streaming])

  return (
    <aside
      // Full screen on a phone, a real column from md up. The chat is unusable
      // squeezed beside a document on a narrow screen, so it steps aside.
      className="fixed inset-0 z-40 flex min-w-0 flex-1 flex-col bg-background md:static md:z-0 md:border-s md:border-border/60"
      aria-label={`Document: ${title}`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/50 bg-muted/50 text-muted-foreground">
          <ArtifactKindIcon kind={kind} className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {artifactKindLabel(kind)} · {artifactMeta(kind, content)}
            {streaming ? " · writing…" : ""}
          </p>
        </div>

        <CopyButton content={content} />
        <TooltipIconButton
          tooltip="Download"
          onClick={() => download(artifact)}
          disabled={!content}
        >
          <DownloadIcon />
        </TooltipIconButton>
        <TooltipIconButton tooltip="Close" onClick={onClose}>
          <XIcon />
        </TooltipIconButton>
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-1.5">
        <ViewTab
          active={active === "preview"}
          disabled={forceCode}
          onClick={() => setView("preview")}
          icon={<EyeIcon className="size-3.5" />}
          label="Preview"
        />
        <ViewTab
          active={active === "code"}
          onClick={() => setView("code")}
          icon={<CodeIcon className="size-3.5" />}
          label={kind === "html" ? "Code" : "Markdown"}
        />
        {streaming ? (
          <span className="ms-auto inline-flex items-center gap-1.5 pe-1 text-[11px] text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            {forceCode ? "Preview when finished" : "Live"}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
        {active === "preview" ? (
          <Preview kind={kind} title={title} content={content} />
        ) : (
          <pre className="h-full overflow-auto p-4 font-mono text-[13px] leading-relaxed text-foreground">
            <code>{content}</code>
          </pre>
        )}
      </div>
    </aside>
  )
}

function Preview({
  kind,
  title,
  content,
}: {
  kind: AuthoredArtifact["kind"]
  title: string
  content: string
}) {
  if (!content) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        Nothing to show yet.
      </div>
    )
  }

  if (kind === "markdown") {
    return (
      <div className="h-full overflow-auto bg-background">
        <ArtifactMarkdown content={content} />
      </div>
    )
  }

  /*
    `sandbox` without `allow-same-origin` is the whole safety story here: the
    frame gets an opaque origin, so the page cannot read this document, its
    cookies, or the session behind them — and it cannot call the app's own API
    with the user's credentials. `allow-scripts` alone is safe for that reason;
    adding `allow-same-origin` beside it would undo the sandbox entirely, which
    is the classic mistake.

    Model-written HTML is not hostile, but it is not reviewed either, and it is
    assembled from whatever the model read in an article this morning.
  */
  return (
    <iframe
      title={`Preview of ${title}`}
      srcDoc={content}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      referrerPolicy="no-referrer"
      className="size-full border-0 bg-white"
    />
  )
}

function ViewTab({
  active,
  disabled,
  onClick,
  icon,
  label,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <TooltipIconButton
      tooltip={copied ? "Copied" : "Copy source"}
      disabled={!content}
      onClick={() => {
        void navigator.clipboard.writeText(content).then(() => setCopied(true))
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </TooltipIconButton>
  )
}

function download({ kind, title, content }: AuthoredArtifact) {
  const blob = new Blob([content], {
    type: kind === "html" ? "text/html" : "text/markdown",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = artifactFilename(kind, title)
  link.click()
  // Revoking immediately can beat the download on some browsers; a tick is
  // enough and the object is small.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
