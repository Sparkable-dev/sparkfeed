import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

/**
 * Markdown rendered as a document, not as a chat message.
 *
 * `MarkdownText` in `components/assistant-ui/` cannot be reused here: it is
 * `MarkdownTextPrimitive`, which reads the message part it belongs to and has
 * no way to be handed a plain string. Its component map is tied to that too —
 * the `code` renderer calls `useIsMarkdownCodeBlock()`, which needs the
 * assistant-ui markdown context to exist.
 *
 * The typography is deliberately not identical either. A chat message is scanned
 * in a narrow column between other messages; this is a page someone reads, so it
 * gets larger headings, more space between blocks, and links that open away
 * rather than into a hover card.
 */

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-8 mb-3 text-2xl font-semibold tracking-tight first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-7 mb-2.5 text-xl font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-5 mb-1.5 text-sm font-semibold first:mt-0">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-3.5 leading-7 first:mt-0 last:mb-0">{children}</p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-3.5 ms-5 list-disc marker:text-muted-foreground [&>li]:mt-1.5">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3.5 ms-5 list-decimal marker:text-muted-foreground [&>li]:mt-1.5">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-7">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-s-2 border-primary/30 ps-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border/60" />,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  // Tables are the reason a digest is worth a panel at all, so they get room to
  // breathe and their own horizontal scroll rather than widening the page.
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border/60 bg-muted/50 px-3 py-2 text-start font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border/40 px-3 py-2 align-top">
      {children}
    </td>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-3.5 text-[13px] leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) =>
    // react-markdown gives a fenced block's <code> a `language-*` class and an
    // inline one nothing. Only the inline case needs a chip; a block is already
    // inside the styled <pre> above.
    className?.startsWith("language-") ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    ),
}

export function ArtifactMarkdown({ content }: { content: string }) {
  return (
    <div className="mx-auto max-w-[46rem] px-6 py-8 text-[15px] text-foreground">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  )
}
