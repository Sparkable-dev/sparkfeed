import { SaxesParser } from "saxes"
import { MAX_OPML_BYTES } from "@/lib/opml"

interface Subscription {
  name: string
  url: string
}

export interface OpmlIssue {
  name: string
  reason: string
}

interface ParsedOpml {
  feeds: Array<Subscription & { folder: string | null }>
  emptyFolders: Set<string>
  hasFolders: boolean
  skipped: Array<OpmlIssue>
}

type Frame =
  | { kind: "root" | "body" | "ignore" }
  | { kind: "folder"; path: Array<string>; name: string; hasChildren: boolean }

export class OpmlDocumentError extends Error {}

export function opmlSubscriptionKey(value: string): string {
  try {
    const url = new URL(value)
    // Fragments are local to the reader. Path, query, and scheme identify the feed.
    url.hash = ""
    return url.href
  } catch {
    return value.trim()
  }
}

function subscriptionUrl(value: string): string | null {
  const url = value.trim()
  if (!/^https?:\/\/[^/]/i.test(url) || /[\s\\]/u.test(url)) return null
  try {
    const { username, password } = new URL(url)
    return username || password ? null : url
  } catch {
    return null
  }
}

export function parseOpmlDocument(xml: string): ParsedOpml {
  if (Buffer.byteLength(xml, "utf8") > MAX_OPML_BYTES)
    throw new OpmlDocumentError("Choose an OPML file up to 5 MB.")

  const parser = new SaxesParser({ xmlns: true })
  const stack: Array<Frame> = []
  const result: ParsedOpml = {
    feeds: [],
    emptyFolders: new Set(),
    hasFolders: false,
    skipped: [],
  }
  let hasBody = false

  parser.on("error", () => {
    throw new OpmlDocumentError("The file contains malformed XML.")
  })
  parser.on("doctype", () => {
    throw new OpmlDocumentError(
      "OPML files with a document type declaration are unsupported."
    )
  })
  parser.on("opentag", (tag) => {
    const parent = stack.at(-1)
    const core = !tag.uri || tag.uri === "http://opml.org/spec2"
    if (!parent) {
      if (tag.local !== "opml" || !core)
        throw new OpmlDocumentError("Choose an OPML subscription file.")
      stack.push({ kind: "root" })
      return
    }
    if (parent.kind === "root" && tag.local === "body" && core) {
      if (hasBody)
        throw new OpmlDocumentError("The OPML file has more than one body.")
      hasBody = true
      stack.push({ kind: "body" })
      return
    }
    if (
      !core ||
      tag.local !== "outline" ||
      (parent.kind !== "body" && parent.kind !== "folder")
    ) {
      stack.push({ kind: "ignore" })
      return
    }

    if (parent.kind === "folder") parent.hasChildren = true
    const attr = (name: string) => tag.attributes[name]?.value ?? ""
    const text = attr("text")
    const title = attr("title")
    const name = (text.trim() && text) || (title.trim() && title) || ""
    const type = attr("type").trim().toLowerCase()
    const rawUrl = attr("xmlUrl") || attr("xmlurl")
    const path = parent.kind === "folder" ? parent.path : []

    let reason: string | undefined
    if (attr("isComment").trim().toLowerCase() === "true")
      reason = "Commented outline"
    else if (type === "include" || type === "link") reason = "Linked outline"
    else if (rawUrl || ["rss", "atom", "rdf", "json", "feed"].includes(type)) {
      const url = subscriptionUrl(rawUrl)
      if (url)
        result.feeds.push({
          name: name || new URL(url).hostname,
          url,
          folder: path.join(" / ") || null,
        })
      else reason = "Missing or invalid feed URL"
    } else if (!type || type === "folder") {
      if (path.length >= 64)
        throw new OpmlDocumentError("The OPML folders are nested too deeply.")
      if (name) result.hasFolders = true
      stack.push({
        kind: "folder",
        path: name ? [...path, name] : path,
        name,
        hasChildren: false,
      })
      return
    } else reason = "Unsupported outline type"

    if (reason)
      result.skipped.push({ name: name || "Untitled outline", reason })
    stack.push({ kind: "ignore" })
  })
  parser.on("closetag", () => {
    const frame = stack.pop()
    if (frame?.kind === "folder" && frame.name && !frame.hasChildren)
      result.emptyFolders.add(frame.path.join(" / "))
  })

  parser.write(xml).close()
  if (!hasBody)
    throw new OpmlDocumentError("The OPML file is missing its body.")
  return result
}

function escapeXml(value: string): string {
  return (
    value
      // Database text may include characters unavailable in XML 1.0.
      .replace(
        // eslint-disable-next-line no-control-regex
        /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,
        "\uFFFD"
      )
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("\t", "&#9;")
      .replaceAll("\n", "&#10;")
      .replaceAll("\r", "&#13;")
  )
}

export function serializeOpmlDocument(
  folders: Array<{ id: string; name: string }>,
  feeds: Array<Subscription & { folderId: string | null }>
): string {
  const byFolder = new Map<string | null, Array<Subscription>>([
    [null, []],
    ...folders.map(({ id }): [string, Array<Subscription>] => [id, []]),
  ])
  for (const feed of feeds)
    (byFolder.get(feed.folderId) ?? byFolder.get(null)!).push(feed)

  const feedLine = ({ name, url }: Subscription) => {
    const title = escapeXml(name)
    return `<outline type="rss" text="${title}" title="${title}" xmlUrl="${escapeXml(url)}"/>`
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head><title>Sparkfeed subscriptions</title></head>",
    "  <body>",
  ]
  for (const { id, name } of folders) {
    const title = escapeXml(name)
    lines.push(`    <outline text="${title}" title="${title}">`)
    for (const feed of byFolder.get(id)!) lines.push(`      ${feedLine(feed)}`)
    lines.push("    </outline>")
  }
  for (const feed of byFolder.get(null)!) lines.push(`    ${feedLine(feed)}`)
  lines.push("  </body>", "</opml>", "")
  return lines.join("\n")
}
