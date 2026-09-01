import { createFileRoute, redirect } from "@tanstack/react-router"
import { Lock } from "lucide-react"
import type { SettingsSection } from "@/components/settings/SettingsNavigation"
import { RSSShell } from "@/components/RSSShell"
import { AccountSettings } from "@/components/settings/AccountSettings"
import { SecuritySettings } from "@/components/settings/SecuritySettings"
import { SettingsNavigation } from "@/components/settings/SettingsNavigation"
import { WorkspaceHub } from "@/components/settings/WorkspaceHub"
import { useDemoAwareSession } from "@/hooks/useDemoAwareSession"
import { DEMO_MODE } from "@/lib/demo"
import { getAllData } from "@/server/rss"

export const Route = createFileRoute("/_protected/settings")({
  loader: () => getAllData(),
  validateSearch: (search: Record<string, unknown>) => {
    const requested = String(search.tab || "profile")
    const tab: SettingsSection | "billing" = [
      "profile",
      "security",
      "workspaces",
      "billing",
    ].includes(requested)
      ? (requested as SettingsSection | "billing")
      : "profile"
    return { tab }
  },
  beforeLoad: ({ search }) => {
    if (search.tab === "billing") {
      throw redirect({
        to: "/settings/workspaces/$slug",
        params: { slug: "personal" },
        search: { section: "billing" },
      } as never)
    }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const data = Route.useLoaderData()
  const { data: session, isPending } = useDemoAwareSession()
  const { tab } = Route.useSearch()
  const active = tab === "billing" ? "workspaces" : tab

  return (
    <RSSShell
      initialData={{
        folders: data.folders,
        feeds: data.feeds,
        articles: data.articles as never,
        degraded: data.degraded,
      }}
      title="Settings"
    >
      <div className="min-w-0 flex-1 pb-10">
        {DEMO_MODE ? (
          <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-400 sm:px-6">
            <Lock className="size-4 shrink-0" />
            Demo mode is read-only.
          </div>
        ) : null}

        <SettingsNavigation active={active} />

        <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-10">
          {isPending ? (
            <div className="space-y-3" aria-label="Loading settings">
              <div className="h-44 animate-pulse rounded-xl border bg-muted/25" />
              <div className="h-28 animate-pulse rounded-xl border bg-muted/25" />
            </div>
          ) : (
            <>
              {active === "profile" ? (
                <AccountSettings session={session} />
              ) : null}
              {active === "security" ? (
                <SecuritySettings session={session} />
              ) : null}
              {active === "workspaces" ? <WorkspaceHub /> : null}
            </>
          )}
        </div>
      </div>
    </RSSShell>
  )
}
