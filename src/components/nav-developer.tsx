"use client"

import { useEffect, useState } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronRight, Code2, KeyRound, Plug, Webhook } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

import { useSidebar } from "@/components/ui/sidebar"

interface DevItem {
  title: string
  href: string
  icon: React.ReactNode
  soon?: boolean
}

const ITEMS: Array<DevItem> = [
  { title: "MCP", href: "/developer/mcp", icon: <Plug className="size-3.5" /> },
  { title: "API keys", href: "/developer/keys", icon: <KeyRound className="size-3.5" /> },
  { title: "Webhooks", href: "/developer/webhooks", icon: <Webhook className="size-3.5" />, soon: true },
]

/**
 * The Developer section in the sidebar footer.
 *
 * Sits above the account menu rather than in SidebarContent so it reads as
 * chrome rather than as another folder of the user's content. It is hidden
 * entirely in icon-collapsed mode (the whole footer region is), which is why
 * there is no icon-only variant here.
 *
 * Starts open when the current route is inside it, so a page refresh does not
 * hide where you are.
 */
export function NavDeveloper() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const sectionActive = pathname.startsWith("/developer")
  const [open, setOpen] = useState(sectionActive)
  const { isMobile, setOpenMobile } = useSidebar()
  useEffect(() => { if (sectionActive) setOpen(true) }, [sectionActive])

  return (
    <div className="mb-1 px-1 group-data-[collapsible=icon]:hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className={`group/dev flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150 ${
                sectionActive
                  ? "text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60"
              }`}
            />
          }
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-sidebar-foreground/60">
            <Code2 className="size-4" />
          </span>
          <span className="flex-1 truncate text-left text-sm font-medium leading-none">
            Developer
          </span>
          <ChevronRight
            className={`size-3.5 shrink-0 text-sidebar-foreground/30 transition-transform duration-200 ${
              open ? "rotate-90" : ""
            }`}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-sidebar-border pb-1 pl-3">
            {ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href)

              if (item.soon) {
                return (
                  <span
                    key={item.title}
                    aria-disabled="true"
                    className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/35"
                  >
                    {item.icon}
                    <span className="flex-1 truncate leading-none">{item.title}</span>
                    <span className="rounded bg-sidebar-accent px-1 py-0.5 text-[9px] font-semibold tracking-wide uppercase">
                      Soon
                    </span>
                  </span>
                )
              }

              return (
                <Link
                  key={item.title}
                  to={item.href}
                  onClick={() => { if (isMobile) setOpenMobile(false) }}
                  data-active={isActive}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150 ${
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/90"
                  }`}
                >
                  {item.icon}
                  <span className="flex-1 truncate leading-none">{item.title}</span>
                </Link>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
