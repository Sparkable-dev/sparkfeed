import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ArrowLeft, Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import type { WorkspaceDetail } from "@/server/workspace-management"
import { RSSShell } from "@/components/RSSShell"
import { PersonalBillingTab } from "@/components/settings/PersonalBillingTab"
import { SettingsNavigation } from "@/components/settings/SettingsNavigation"
import { TeamBillingPanel } from "@/components/settings/TeamBillingPanel"
import { WorkspaceGeneralSettings } from "@/components/settings/WorkspaceGeneralSettings"
import { WorkspacePeopleTable } from "@/components/settings/WorkspacePeopleTable"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DEMO_MODE } from "@/lib/demo"
import { personalWorkspaceName } from "@/lib/workspaces"
import { getAllData } from "@/server/rss"
import { getWorkspaceDetail } from "@/server/workspace-management"

type WorkspaceSection = "general" | "people" | "billing"

const demoDetail: WorkspaceDetail = {
  id: "demo-team",
  slug: "research-team",
  name: "Research team",
  logo: null,
  role: "owner",
  plan: "pro",
  planLabel: "Pro",
  accessState: "active",
  billingStatus: "active",
  billingSource: "manual",
  seatCapacity: 6,
  usedSeats: 5,
  sourceCapacity: 300,
  feedCount: 28,
  currentPeriodEnd: null,
  openBillingRequest: null,
  people: [
    {
      id: "demo-owner",
      kind: "member",
      name: "Guest User",
      email: "guest@sparkfeed.app",
      image: null,
      role: "owner",
      activityAt: "2026-08-31T10:00:00.000Z",
      status: "active",
      isCurrentUser: true,
    },
    {
      id: "demo-admin",
      kind: "member",
      name: "Maya Chen",
      email: "maya@example.com",
      image: null,
      role: "admin",
      activityAt: "2026-08-29T10:00:00.000Z",
      status: "active",
      isCurrentUser: false,
    },
    {
      id: "demo-editor",
      kind: "member",
      name: "Noah Williams",
      email: "noah@example.com",
      image: null,
      role: "editor",
      activityAt: "2026-08-27T10:00:00.000Z",
      status: "active",
      isCurrentUser: false,
    },
    {
      id: "demo-invite",
      kind: "invitation",
      name: "priya",
      email: "priya@example.com",
      image: null,
      role: "editor",
      activityAt: "2026-08-30T10:00:00.000Z",
      status: "pending",
      isCurrentUser: false,
    },
  ],
}

export const Route = createFileRoute("/_protected/settings_/workspaces/$slug")({
  validateSearch: (search: Record<string, unknown>) => {
    const value = String(search.section || "general")
    const section: WorkspaceSection = ["general", "people", "billing"].includes(
      value
    )
      ? (value as WorkspaceSection)
      : "general"
    return { section }
  },
  loader: async ({ params }) => {
    const data = await getAllData()
    const detail =
      params.slug === "personal"
        ? null
        : DEMO_MODE
          ? { ...demoDetail, slug: params.slug }
          : await getWorkspaceDetail({ data: params.slug })
    return { data, detail }
  },
  component: WorkspaceSettingsPage,
})

function initials(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function WorkspaceSettingsPage() {
  const loader = Route.useLoaderData()
  const { slug } = Route.useParams()
  const { section } = Route.useSearch()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<WorkspaceDetail | null>(loader.detail)
  const [loading, setLoading] = useState(false)
  const personal = slug === "personal"
  const activeSection: WorkspaceSection = personal
    ? "billing"
    : detail?.role !== "owner" && section === "billing"
      ? "general"
      : section

  const refresh = async () => {
    if (personal || DEMO_MODE) return
    setLoading(true)
    try {
      setDetail(await getWorkspaceDetail({ data: slug }))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not refresh workspace."
      )
    } finally {
      setLoading(false)
    }
  }

  const setSection = (next: WorkspaceSection) => {
    navigate({
      to: "/settings/workspaces/$slug",
      params: { slug },
      search: { section: next },
      replace: true,
    } as never)
  }

  return (
    <RSSShell
      initialData={{
        folders: loader.data.folders,
        feeds: loader.data.feeds,
        articles: loader.data.articles as never,
        degraded: loader.data.degraded,
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
        <SettingsNavigation active="workspaces" />

        <main className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-10">
          <Button
            variant="ghost"
            size="sm"
            className="mb-5 -ml-2 text-muted-foreground"
            onClick={() =>
              navigate({
                to: "/settings",
                search: { tab: "workspaces" },
              } as never)
            }
          >
            <ArrowLeft className="size-4" />
            Workspaces
          </Button>

          <header className="mb-6 flex items-center gap-3">
            <Avatar className="size-12 rounded-xl border">
              <AvatarImage src={detail?.logo || undefined} alt="" />
              <AvatarFallback className="rounded-xl text-sm font-semibold">
                {initials(
                  personal
                    ? personalWorkspaceName("Personal")
                    : detail?.name || "Workspace"
                )}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">
                  {personal ? "Personal workspace" : detail?.name}
                </h1>
                {detail ? (
                  <Badge variant="secondary">{detail.planLabel}</Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {personal
                  ? "Plan, invoices, and subscription settings."
                  : `${detail?.role || "member"} access`}
              </p>
            </div>
            {loading ? (
              <Loader2 className="ml-auto size-4 animate-spin" />
            ) : null}
          </header>

          {!personal && detail ? (
            <nav
              aria-label="Workspace settings sections"
              className="mb-6 flex gap-1 overflow-x-auto border-b pb-3"
            >
              {(
                [
                  { id: "general", label: "General" },
                  { id: "people", label: "People" },
                  ...(detail.role === "owner"
                    ? [{ id: "billing", label: "Billing" }]
                    : []),
                ] as Array<{ id: WorkspaceSection; label: string }>
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={activeSection === item.id ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                  className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                    activeSection === item.id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          ) : null}

          {personal ? <PersonalBillingTab /> : null}
          {!personal && detail && activeSection === "general" ? (
            <WorkspaceGeneralSettings
              workspace={detail}
              onUpdated={async (nextSlug) => {
                if (nextSlug !== slug) {
                  navigate({
                    to: "/settings/workspaces/$slug",
                    params: { slug: nextSlug },
                    search: { section: "general" },
                    replace: true,
                  } as never)
                  return
                }
                await refresh()
              }}
              onDeleted={() =>
                navigate({
                  to: "/settings",
                  search: { tab: "workspaces" },
                  replace: true,
                } as never)
              }
            />
          ) : null}
          {!personal && detail && activeSection === "people" ? (
            <WorkspacePeopleTable workspace={detail} onChanged={refresh} />
          ) : null}
          {!personal && detail && activeSection === "billing" ? (
            <TeamBillingPanel workspace={detail} onChanged={refresh} />
          ) : null}
        </main>
      </div>
    </RSSShell>
  )
}
