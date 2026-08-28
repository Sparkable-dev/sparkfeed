import { FileTextIcon, GlobeIcon } from "lucide-react"
import type { ArtifactKind } from "@/server/ai/artifacts"

/**
 * The two facts the card and the panel header both need, in one place so they
 * cannot disagree about what a document is called or how big it is.
 */

export function ArtifactKindIcon({
  kind,
  className,
}: {
  kind: ArtifactKind
  className?: string
}) {
  const Icon = kind === "html" ? GlobeIcon : FileTextIcon
  return <Icon className={className} />
}

export function artifactKindLabel(kind: ArtifactKind): string {
  return kind === "html" ? "Web page" : "Document"
}

/**
 * Lines for a page, words for prose.
 *
 * A word count on minified-ish HTML is meaningless, and a line count on a
 * digest tells the reader nothing about how long it takes to read. Each kind
 * gets the measure someone would actually use for it.
 */
export function artifactMeta(kind: ArtifactKind, content: string): string {
  if (!content) return kind === "html" ? "empty page" : "empty document"

  if (kind === "html") {
    const lines = content.split(/\r?\n/).length
    return `${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"}`
  }

  const words = content.trim().split(/\s+/).length
  return `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`
}

/** Suggested filename for the download button. */
export function artifactFilename(kind: ArtifactKind, title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document"
  return `${slug}.${kind === "html" ? "html" : "md"}`
}
