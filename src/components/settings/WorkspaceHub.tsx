import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  ArrowUpRight,
  Building2,
  Check,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  Send,
  Settings2,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import type {
  TeamRequestSummary,
  WorkspaceSummary,
} from "@/server/workspace-management"
import { authClient } from "@/lib/auth-client"
import { DEMO_MODE } from "@/lib/demo"
import {
  getWorkspaceOverview,
  leaveWorkspace,
  submitTeamWorkspaceRequest,
} from "@/server/workspace-management"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface WorkspaceOverview {
  workspaces: Array<WorkspaceSummary>
  edition: "community" | "cloud"
  canCreateWorkspace: boolean
  activeRequest: TeamRequestSummary | null
  latestRequest: TeamRequestSummary | null
}

const demoOverview: WorkspaceOverview = {
  edition: "cloud",
  canCreateWorkspace: false,
  activeRequest: null,
  latestRequest: null,
  workspaces: [
    {
      id: "demo-personal",
      type: "personal",
      slug: "personal",
      name: "Guest's workspace",
      logo: null,
      role: "owner",
      plan: "personal_plus",
      planLabel: "Personal+",
      accessState: "active",
      memberCount: 1,
      pendingInvitations: 0,
      feedCount: 12,
      isActive: true,
    },
    {
      id: "demo-team",
      type: "organization",
      slug: "research-team",
      name: "Research team",
      logo: null,
      role: "owner",
      plan: "pro",
      planLabel: "Pro",
      accessState: "active",
      memberCount: 4,
      pendingInvitations: 1,
      feedCount: 28,
      isActive: false,
    },
  ],
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function requestStatusLabel(status: TeamRequestSummary["status"]) {
  if (status === "in_review") return "In review"
  return status[0].toUpperCase() + status.slice(1)
}

export function WorkspaceHub() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<WorkspaceOverview | null>(
    DEMO_MODE ? demoOverview : null
  )
  const [loading, setLoading] = useState(!DEMO_MODE)
  const [requestOpen, setRequestOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState("")
  const [expectedSeats, setExpectedSeats] = useState("5")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    if (DEMO_MODE) return
    setLoading(true)
    try {
      setOverview(await getWorkspaceOverview())
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load workspaces."
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const teams = useMemo(
    () =>
      overview?.workspaces.filter((row) => row.type === "organization") ?? [],
    [overview]
  )
  const trackedRequest = overview?.activeRequest || overview?.latestRequest

  const manage = (workspace: WorkspaceSummary) => {
    navigate({
      to: "/settings/workspaces/$slug",
      params: { slug: workspace.slug },
      search: {
        section: workspace.type === "personal" ? "billing" : "general",
      },
    } as never)
  }

  const openWorkspace = async (workspace: WorkspaceSummary) => {
    if (DEMO_MODE) return
    setBusy(`open:${workspace.id}`)
    try {
      await authClient.organization.setActive({
        organizationId: workspace.type === "personal" ? null : workspace.id,
      })
      window.location.href = "/"
    } catch {
      toast.error("Could not open that workspace.")
      setBusy(null)
    }
  }

  const submitRequest = async () => {
    const seats = Number(expectedSeats)
    if (!workspaceName.trim() || !Number.isInteger(seats)) return
    setBusy("request")
    try {
      await submitTeamWorkspaceRequest({
        data: { workspaceName, expectedSeats: seats, message },
      })
      toast.success("Team workspace request sent.")
      setRequestOpen(false)
      setWorkspaceName("")
      setExpectedSeats("5")
      setMessage("")
      await load()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send the request."
      )
    } finally {
      setBusy(null)
    }
  }

  const createCommunityWorkspace = async () => {
    const name = workspaceName.trim()
    if (!name) return
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    setBusy("create")
    try {
      const result = await authClient.organization.create({ name, slug })
      if (result.error) throw new Error(result.error.message)
      toast.success("Workspace created.")
      setCreateOpen(false)
      setWorkspaceName("")
      await load()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create workspace."
      )
    } finally {
      setBusy(null)
    }
  }

  const leave = async (workspace: WorkspaceSummary) => {
    if (DEMO_MODE) return
    setBusy(`leave:${workspace.id}`)
    try {
      await leaveWorkspace({ data: { organizationId: workspace.id } })
      toast.success("You left the workspace.")
      await load()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not leave workspace."
      )
    } finally {
      setBusy(null)
    }
  }

  if (loading || !overview) {
    return (
      <div className="space-y-3" aria-label="Loading workspaces">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="h-[76px] animate-pulse rounded-xl border bg-muted/25"
          />
        ))}
      </div>
    )
  }

  return (
    <section className="space-y-6" aria-labelledby="workspace-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1
            id="workspace-heading"
            className="text-xl font-semibold tracking-tight"
          >
            Workspaces
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a workspace or manage its people and plan.
          </p>
        </div>

        {overview.edition === "cloud" ? (
          <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
            <DialogTrigger
              render={
                <Button
                  disabled={Boolean(overview.activeRequest) || DEMO_MODE}
                  className="w-full sm:w-auto"
                >
                  <Send className="size-4" />
                  Request team workspace
                </Button>
              }
            />
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Request a team workspace</DialogTitle>
                <DialogDescription>
                  Tell us the size of your team. Sparkable will review and set
                  up the workspace.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="team-workspace-name">Workspace name</Label>
                  <Input
                    id="team-workspace-name"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    maxLength={80}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-workspace-seats">Expected people</Label>
                  <Input
                    id="team-workspace-seats"
                    type="number"
                    min={2}
                    max={500}
                    value={expectedSeats}
                    onChange={(event) => setExpectedSeats(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-workspace-note">What do you need?</Label>
                  <Textarea
                    id="team-workspace-note"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={2000}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => void submitRequest()}
                  disabled={
                    busy !== null ||
                    workspaceName.trim().length < 2 ||
                    Number(expectedSeats) < 2
                  }
                >
                  {busy === "request" && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Send request
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : overview.canCreateWorkspace ? (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger
              render={
                <Button className="w-full sm:w-auto" disabled={DEMO_MODE}>
                  <Plus className="size-4" />
                  Create workspace
                </Button>
              }
            />
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create a workspace</DialogTitle>
                <DialogDescription>
                  You can update its logo and URL after creation.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Label htmlFor="community-workspace-name">Workspace name</Label>
                <Input
                  id="community-workspace-name"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  maxLength={80}
                />
              </div>
              <DialogFooter>
                <Button
                  onClick={() => void createCommunityWorkspace()}
                  disabled={busy !== null || workspaceName.trim().length < 2}
                >
                  {busy === "create" && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Create workspace
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {trackedRequest ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
            <Send className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {trackedRequest.workspaceName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Request status: {requestStatusLabel(trackedRequest.status)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="divide-y">
          {overview.workspaces.map((workspace) => {
            const canManage =
              workspace.type === "personal" || workspace.role !== "editor"
            return (
              <article
                key={`${workspace.type}:${workspace.id}`}
                className="group flex flex-col gap-4 px-4 py-4 transition-colors hover:bg-muted/25 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <Avatar className="size-11 shrink-0 rounded-xl border">
                    <AvatarImage src={workspace.logo || undefined} alt="" />
                    <AvatarFallback className="rounded-xl text-xs font-semibold">
                      {initials(workspace.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold">
                        {workspace.name}
                      </h2>
                      {workspace.isActive ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 text-[10px]"
                        >
                          <Check className="size-3" />
                          Active
                        </Badge>
                      ) : null}
                      {workspace.accessState !== "active" ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] capitalize"
                        >
                          {workspace.accessState.replace("_", " ")}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="capitalize">{workspace.role}</span>
                      <span aria-hidden="true">·</span>
                      <span>{workspace.planLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{workspace.feedCount} feeds</span>
                      {workspace.type === "organization" ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3" />
                            {workspace.memberCount}
                            {workspace.pendingInvitations > 0
                              ? ` + ${workspace.pendingInvitations} pending`
                              : ""}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openWorkspace(workspace)}
                    disabled={busy !== null || DEMO_MODE}
                  >
                    {busy === `open:${workspace.id}` ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowUpRight className="size-4" />
                    )}
                    Open
                  </Button>
                  {canManage ? (
                    <Button size="sm" onClick={() => manage(workspace)}>
                      <Settings2 className="size-4" />
                      Manage
                    </Button>
                  ) : null}
                  {workspace.type === "organization" ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`More actions for ${workspace.name}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {canManage ? (
                          <DropdownMenuItem onClick={() => manage(workspace)}>
                            <Building2 className="size-4" />
                            Workspace settings
                          </DropdownMenuItem>
                        ) : null}
                        {workspace.role !== "owner" ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => void leave(workspace)}
                            >
                              <LogOut className="size-4" />
                              Leave workspace
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </div>

      {teams.length === 0 &&
      overview.edition === "cloud" &&
      !overview.activeRequest ? (
        <div className="rounded-xl border border-dashed px-5 py-8 text-center">
          <Building2 className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No team workspaces yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            Request one when you are ready to share sources and research with a
            team.
          </p>
        </div>
      ) : null}
    </section>
  )
}
