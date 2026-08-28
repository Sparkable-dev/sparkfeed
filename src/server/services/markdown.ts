import { parseHTML } from 'linkedom'

/**
 * Reader HTML is stored as HTML because the web app renders it, but the
 * consumer here is a language model. Markdown costs meaningfully fewer tokens
 * than the equivalent HTML and preserves the structure that matters (headings,
 * lists, links, code), so it is the default for `get_article`.
 *
 * Hand-rolled rather than using `turndown`, which was tried first and cannot
 * ship here: it calls `require()` internally to load its DOM parser, and Nitro
 * bundles the server as ESM where `require` is undefined. That throws at module
 * load, so every request in the deployed app returned 500, not just the MCP
 * ones. `linkedom` is already a dependency (extract.ts uses it for Readability)
 * and is already proven in this bundle.
 *
 * Scope is deliberately narrow: article HTML that has already been through
 * Readability and sanitize-html. It is not a general HTML converter.
 */

/** Inline formatting is applied to text; block elements emit their own lines. */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR',
  'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL',
])

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return ''
  try {
    const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`)
    const root = document.body ?? document.documentElement
    if (!root) return ''
    return tidy(renderChildren(root, { listDepth: 0 }))
  } catch {
    // Never lose the article to a formatting failure.
    return htmlToPlainText(html)
  }
}

interface Ctx {
  listDepth: number
  /** Set inside <pre>, where whitespace is significant and markup is inert. */
  pre?: boolean
}

function renderChildren(node: any, ctx: Ctx): string {
  let out = ''
  for (const child of Array.from(node.childNodes ?? [])) {
    out += renderNode(child, ctx)
  }
  return out
}

function renderNode(node: any, ctx: Ctx): string {
  // Text node
  if (node.nodeType === 3) {
    const text = String(node.textContent ?? '')
    if (ctx.pre) return text
    // Collapse whitespace, but keep a single space so inline runs do not fuse.
    return text.replace(/\s+/g, ' ')
  }

  if (node.nodeType !== 1) return ''

  const tag = String(node.tagName ?? '').toUpperCase()

  switch (tag) {
    case 'SCRIPT':
    case 'STYLE':
    case 'NOSCRIPT':
    case 'IFRAME':
      return ''

    // Images carry no information for a text model, and article HTML is full of
    // tracking pixels and lazy-load placeholders.
    case 'IMG':
    case 'PICTURE':
    case 'SOURCE':
    case 'SVG':
      return ''

    case 'BR':
      return '\n'

    case 'HR':
      return '\n\n---\n\n'

    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const level = Number(tag[1])
      const text = inline(renderChildren(node, ctx))
      return text ? `\n\n${'#'.repeat(level)} ${text}\n\n` : ''
    }

    case 'P':
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'HEADER':
    case 'FOOTER':
    case 'MAIN':
    case 'FIGURE':
    case 'FIGCAPTION':
    case 'ADDRESS': {
      const inner = renderChildren(node, ctx)
      return inner.trim() ? `\n\n${inner.trim()}\n\n` : ''
    }

    case 'BLOCKQUOTE': {
      const inner = tidy(renderChildren(node, ctx))
      if (!inner) return ''
      const quoted = inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')
      return `\n\n${quoted}\n\n`
    }

    case 'PRE': {
      const code = String(node.textContent ?? '').replace(/\n+$/, '')
      if (!code.trim()) return ''
      // Language, when sanitize-html kept the class (`language-ts`).
      const cls = String(node.querySelector?.('code')?.className ?? node.className ?? '')
      const lang = cls.match(/language-([\w-]+)/)?.[1] ?? ''
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`
    }

    case 'CODE': {
      if (ctx.pre) return renderChildren(node, ctx)
      const text = String(node.textContent ?? '').trim()
      if (!text) return ''
      // A backtick inside the span needs a longer fence.
      const fence = text.includes('`') ? '``' : '`'
      const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
      return `${fence}${pad}${text}${pad}${fence}`
    }

    case 'STRONG':
    case 'B': {
      const text = inline(renderChildren(node, ctx))
      return text ? `**${text}**` : ''
    }

    case 'EM':
    case 'I': {
      const text = inline(renderChildren(node, ctx))
      return text ? `*${text}*` : ''
    }

    case 'DEL':
    case 'S': {
      const text = inline(renderChildren(node, ctx))
      return text ? `~~${text}~~` : ''
    }

    case 'A': {
      const text = inline(renderChildren(node, ctx))
      const href = String(node.getAttribute?.('href') ?? '').trim()
      if (!text) return ''
      // A link with no target, or an in-page anchor, is noise in a transcript.
      if (!href || href.startsWith('#')) return text
      return `[${text}](${href})`
    }

    case 'UL':
    case 'OL': {
      const ordered = tag === 'OL'
      const items = Array.from(node.children ?? []).filter(
        (c: any) => String(c.tagName).toUpperCase() === 'LI',
      )
      if (!items.length) return ''

      const indent = '  '.repeat(ctx.listDepth)
      const lines = items.map((li: any, i: number) => {
        const marker = ordered ? `${i + 1}.` : '-'
        const body = tidy(renderChildren(li, { ...ctx, listDepth: ctx.listDepth + 1 }))
        // Continuation lines align under the marker so nested blocks stay in the item.
        const [first = '', ...rest] = body.split('\n')
        const tail = rest
          .map((l) => (l ? `${indent}  ${l}` : ''))
          .join('\n')
        return `${indent}${marker} ${first}${tail ? `\n${tail}` : ''}`
      })
      return `\n\n${lines.join('\n')}\n\n`
    }

    case 'TABLE':
      return renderTable(node, ctx)

    default:
      // Unknown or purely inline wrapper: keep the contents.
      return renderChildren(node, ctx)
  }
}

/** GFM table, when the shape is regular enough to be worth one. */
function renderTable(node: any, ctx: Ctx): string {
  const rows = Array.from(node.querySelectorAll?.('tr') ?? [])
  if (!rows.length) return ''

  const cellsOf = (row: any) =>
    Array.from(row.children ?? [])
      .filter((c: any) => ['TD', 'TH'].includes(String(c.tagName).toUpperCase()))
      .map((c: any) => inline(renderChildren(c, ctx)).replace(/\|/g, '\\|'))

  const parsed = rows.map(cellsOf).filter((r) => r.length)
  if (!parsed.length) return ''

  const width = Math.max(...parsed.map((r) => r.length))
  const pad = (r: Array<string>) => [...r, ...Array(width - r.length).fill('')]

  const [head, ...body] = parsed
  const lines = [
    `| ${pad(head).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map((r) => `| ${pad(r).join(' | ')} |`),
  ]
  return `\n\n${lines.join('\n')}\n\n`
}

/** Flattens a fragment to a single line, for headings, links and table cells. */
function inline(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Collapses the blank lines and stray spacing the block rules emit generously.
 *
 * Fenced code is stepped over rather than cleaned: indentation is meaning
 * inside a code block, and collapsing runs of spaces there silently reflows
 * whatever the article was demonstrating.
 */
function tidy(value: string): string {
  return value
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part, i) => (i % 2 === 1 ? part : squash(part)))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function squash(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
}

export function htmlToPlainText(html: string): string {
  if (!html.trim()) return ''
  try {
    // A full document, not a bare fragment: linkedom does not synthesize
    // <html>/<body> around a fragment, so `document.body` comes back null and
    // every snippet silently renders as an empty string.
    const { document } = parseHTML(
      `<!DOCTYPE html><html><body>${html}</body></html>`,
    )
    const text = document.body?.textContent ?? document.documentElement?.textContent ?? ''
    return text.replace(/\s+/g, ' ').trim()
  } catch {
    // Last resort for malformed markup linkedom refuses to parse.
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }
}

export { BLOCK_TAGS }
