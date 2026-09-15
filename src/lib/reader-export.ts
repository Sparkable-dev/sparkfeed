import TurndownService from "turndown"

export interface ReaderExportInput {
  html: string
  title: string
  url: string
  image?: string | null
  publishedAt?: Date | string | null
  summary?: boolean
  partial?: boolean
}
export interface ReaderExport {
  html: string
  markdown: string
}

const tags = new Set(
  "p div article section h1 h2 h3 h4 h5 h6 strong b em i del s ul ol li blockquote pre code a img figure figcaption table thead tbody tfoot tr th td br hr".split(
    " "
  )
)
const discard = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "FORM",
  "INPUT",
  "BUTTON",
  "SVG",
  "TEMPLATE",
])
function safeUrl(value: string | null, base: string, image = false) {
  if (!value?.trim()) return null
  try {
    const url = new URL(value, base)
    return (image
      ? ["https:", "http:"]
      : ["https:", "http:", "mailto:", "tel:"]
    ).includes(url.protocol)
      ? url.href
      : null
  } catch {
    return null
  }
}

/** Rebuild a detached document. No publisher attributes or Reader UI are copied. */
export function buildReaderExport(input: ReaderExportInput): ReaderExport {
  const source = document.createElement("template")
  source.innerHTML = input.html
  const output = document.implementation.createHTMLDocument("")
  const body = output.body
  const element = (tag: string, text?: string) => {
    const node = output.createElement(tag)
    if (text) node.textContent = text
    return node
  }
  const normalize = (node: Node): Node | null => {
    if (node.nodeType === 3)
      return output.createTextNode(node.textContent ?? "")
    if (!(node instanceof Element) || discard.has(node.tagName)) return null
    // The extractor marks paired alternatives; export one stable, light variant.
    if (node.getAttribute("data-reader-image-theme") === "dark") return null
    if (
      ["VIDEO", "AUDIO", "IFRAME", "OBJECT", "EMBED"].includes(node.tagName)
    ) {
      const link = element(
        "a",
        `View ${node.tagName.toLowerCase()} on original page`
      )
      const href = safeUrl(
        node.getAttribute("src") ||
          node.querySelector("source")?.getAttribute("src") ||
          input.url,
        input.url
      )
      if (href) link.setAttribute("href", href)
      return link
    }
    const tag = node.tagName.toLowerCase()
    const clean = tags.has(tag) ? element(tag) : output.createDocumentFragment()
    if (clean instanceof Element) {
      if (tag === "a") {
        const href = safeUrl(node.getAttribute("href"), input.url)
        if (href) clean.setAttribute("href", href)
      }
      if (tag === "img") {
        const candidates = [
          node.getAttribute("data-src"),
          node.getAttribute("data-original"),
          node.getAttribute("data-lazy-src"),
          node.getAttribute("src"),
        ]
        const responsive =
          node.getAttribute("data-srcset") ||
          node.getAttribute("srcset") ||
          node
            .closest("picture")
            ?.querySelector("source[srcset]")
            ?.getAttribute("srcset")
        candidates.push(
          ...(responsive
            ?.split(",")
            .map((part) => part.trim().split(/\s+/)[0]) ?? [])
        )
        const src = candidates
          .map((value) => safeUrl(value, input.url, true))
          .find(Boolean)
        if (!src) return output.createTextNode(node.getAttribute("alt") || "")
        clean.setAttribute("src", src)
        clean.setAttribute("alt", node.getAttribute("alt") || "")
      }
      for (const attr of tag === "ol"
        ? ["start"]
        : tag === "li"
          ? ["value"]
          : ["th", "td"].includes(tag)
            ? ["colspan", "rowspan"]
            : []) {
        const value = node.getAttribute(attr)
        if (value && /^\d+$/.test(value)) clean.setAttribute(attr, value)
      }
      if (tag === "code" || tag === "pre") {
        const language = node
          .getAttribute("class")
          ?.match(/(?:^|\s)language-([\w-]+)/)?.[1]
        if (language) clean.setAttribute("class", `language-${language}`)
      }
    }
    node.childNodes.forEach((child) => {
      const result = normalize(child)
      if (result) clean.appendChild(result)
    })
    return clean
  }
  const content = element("div")
  source.content.childNodes.forEach((node) => {
    const clean = normalize(node)
    if (clean) content.append(clean)
  })
  if (!content.textContent?.trim() && !content.querySelector("img"))
    throw new Error("No Reader content to copy")
  const firstHeading = content.querySelector("h1")
  if (firstHeading) {
    const before = output.createRange()
    before.setStart(content, 0)
    before.setEndBefore(firstHeading)
    const preceding = before.cloneContents()
    if (
      !preceding.textContent?.trim() &&
      !preceding.querySelector("img") &&
      firstHeading.textContent?.replace(/\s+/g, " ").trim() ===
        input.title.replace(/\s+/g, " ").trim()
    )
      firstHeading.remove()
  }
  if (input.title.trim()) body.append(element("h1", input.title))
  const attribution = element("p")
  const link = element("a", input.url)
  const url = safeUrl(input.url, input.url)
  if (url) link.setAttribute("href", url)
  attribution.append("Source: ", link)
  body.append(attribution)
  if (input.publishedAt) {
    const date = new Date(input.publishedAt)
    if (Number.isFinite(date.getTime()))
      body.append(element("p", `Published: ${date.toISOString().slice(0, 10)}`))
  }
  if (input.summary || input.partial)
    body.append(
      element(
        "p",
        input.summary
          ? "Summary only. Open the original for the complete article."
          : "This saved article may be incomplete. Open the original for the complete article."
      )
    )
  const hero = safeUrl(input.image ?? null, input.url, true)
  if (
    hero &&
    !Array.from(content.querySelectorAll("img")).some(
      (img) => img.getAttribute("src") === hero
    )
  ) {
    const img = element("img")
    img.setAttribute("src", hero)
    img.setAttribute("alt", input.title)
    body.append(img)
  }
  body.append(...Array.from(content.childNodes))
  for (const pre of body.querySelectorAll("pre[class]")) {
    const code = pre.querySelector("code")
    if (code && !code.className) code.className = pre.className
  }
  const converter = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  })
  converter.addRule("strike", {
    filter: ["del", "s"],
    replacement: (text) => `~~${text}~~`,
  })
  converter.addRule("caption", {
    filter: "figcaption",
    replacement: (text) => `\n\n${text}\n\n`,
  })
  converter.addRule("table", {
    filter: "table",
    replacement: (_text, node) => {
      const rows = Array.from(node.querySelectorAll("tr")).filter(
        (row) => row.closest("table") === node
      )
      const cells = rows.map((row) =>
        Array.from(row.children).filter((cell) =>
          ["TH", "TD"].includes(cell.tagName)
        )
      )
      const simple =
        cells.length > 0 &&
        cells[0].length > 0 &&
        cells.every(
          (row) =>
            row.length === cells[0].length &&
            row.every(
              (cell) =>
                !cell.hasAttribute("colspan") &&
                !cell.hasAttribute("rowspan") &&
                !cell.querySelector("p,ul,ol,pre,table")
            )
        ) &&
        cells[0].every((cell) => cell.tagName === "TH")
      const render = (cell: Element) =>
        converter
          .turndown(cell.innerHTML)
          .replace(/\n/g, " ")
          .replace(/\|/g, "\\|")
      if (!simple)
        return (
          "\n\n" +
          cells
            .map(
              (row, i) =>
                `Row ${i + 1}:\n` +
                row
                  .map(
                    (cell) =>
                      `- ${converter.turndown(cell.innerHTML).replace(/\n/g, "\n  ")}`
                  )
                  .join("\n")
            )
            .join("\n\n") +
          "\n\n"
        )
      const lines = cells.map((row) => `| ${row.map(render).join(" | ")} |`)
      lines.splice(1, 0, `| ${cells[0].map(() => "---").join(" | ")} |`)
      return "\n\n" + lines.join("\n") + "\n\n"
    },
  })
  return { html: body.innerHTML, markdown: converter.turndown(body.innerHTML) }
}
