/**
 * The mark on a source we read from a page rather than from a feed.
 *
 * Small on purpose. It is not a warning — a watched page works, and most of the
 * time you will not think about it — but it is a different promise: a feed is
 * what a site publishes for readers, while this is us parsing someone's HTML
 * and hoping the layout holds. When such a source goes quiet, that difference
 * is the first thing worth knowing, and nothing else on the row says it.
 *
 * One component so the sidebar and /sources cannot drift apart about what the
 * mark means or what colour it is.
 */
export function PageSourceDot({ className }: { className?: string }) {
  return (
    <span
      title="No feed on this site — we read its page and watch for new posts."
      aria-label="Read from a page"
      className={`inline-block size-1.5 shrink-0 rounded-full bg-amber-400/70 ${className ?? ""}`}
    />
  )
}
