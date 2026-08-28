import type { ReactNode } from "react"

/**
 * Shared chrome for the Developer pages.
 *
 * These render inside RSSShell's content slot, which normally holds the article
 * grid, so they supply their own page padding and max width.
 */
export function DeveloperPage({
  title,
  lead,
  children,
}: {
  title: string
  lead: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{lead}</p>
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  )
}

export function Section({
  title,
  description,
  children,
  action,
}: {
  title: string
  description?: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
