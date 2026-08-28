"use client"

import { Link, useRouterState } from "@tanstack/react-router"

export function NavMain({
  items,
}: {
  items: Array<{
    title: string
    href?: string
    url?: string
    icon: React.ReactNode
    badge?: React.ReactNode
    exact?: boolean
    isActive?: boolean
    onClick?: () => void
  }>
}) {
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  return (
    <div className="flex flex-col gap-0.5 px-3 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:w-full">
      {items.map((item) => {
        const linkHref = item.href || item.url || "#"
        const isActive =
          item.isActive !== undefined
            ? item.isActive
            : item.exact
              ? pathname === linkHref
              : pathname.startsWith(linkHref)

        const inner = (
          <>
            {/* icon slot — fixed 16px so text always starts at same column */}
            <span className="flex size-4 shrink-0 items-center justify-center text-sidebar-foreground/60 group-data-[active=true]:text-sidebar-accent-foreground">
              {item.icon}
            </span>
            <span className="flex-1 truncate text-sm font-medium leading-none text-sidebar-foreground/80 group-data-[active=true]:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden">
              {item.title}
            </span>
            {item.badge !== undefined && (
              <span className="ml-auto rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
                {item.badge}
              </span>
            )}
          </>
        )

        const cls = `
          group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 transition-colors duration-150
          group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-8!
          ${isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent/60 text-sidebar-foreground/70"}
        `

        if (item.href || item.url) {
          return (
            <Link
              key={item.title}
              to={linkHref}
              data-active={isActive}
              className={cls.trim()}
            >
              {inner}
            </Link>
          )
        }

        return (
          <button
            key={item.title}
            onClick={item.onClick}
            data-active={isActive}
            className={cls.trim()}
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}
