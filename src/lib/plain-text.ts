/**
 * A feed summary as readable text.
 *
 * `description` is usually a plain snippet and occasionally raw markup, because
 * it comes from whichever of `contentSnippet` or `summary` the feed happened to
 * provide. Every surface that renders it needs the same treatment, so it lives
 * here rather than being reimplemented per component.
 *
 * The tags become a space rather than nothing: `<p>One</p><p>Two</p>` collapsing
 * to "OneTwo" is a worse failure than a stray gap.
 *
 * This is for legibility, not safety. The result is always used as text content
 * and never as markup, and it is not an HTML sanitiser — see `sanitizeArticleHtml`
 * for the one place where markup is actually rendered.
 */
export function toPlainText(value: string | null | undefined): string {
  if (!value) return ""
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
