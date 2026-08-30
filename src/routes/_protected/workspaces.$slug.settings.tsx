import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import {
  ChevronLeft,
  CreditCard,
  Link as LinkIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { authClient, useSession } from "@/lib/auth-client"
import {
  getInvitations,
  inviteUser,
  revokeInvite,
} from "@/server/email-actions"
import { AppTopBar } from "@/components/layout/AppTopBar"

export const Route = createFileRoute("/_protected/workspaces/$slug/settings")({
  component: WorkspaceSettingsPage,
})

function WorkspaceSettingsPage() {
  const { slug } = useParams({ from: "/_protected/workspaces/$slug/settings" })
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState("members")
  const { data: orgs, isPending } = authClient.useListOrganizations()
  const currentOrg = orgs?.find((o) => o.slug === slug)
  const { data: session } = useSession()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!currentOrg && slug !== "personal") {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background p-4 text-center">
        <h2 className="text-xl font-bold">Workspace not found</h2>
        <p className="mt-2 text-muted-foreground">
          The workspace you are looking for does not exist or you don't have
          access.
        </p>
        <Button
          className="mt-4"
          onClick={() =>
            navigate({ to: "/settings", search: { tab: "workspaces" } } as any)
          }
        >
          Back to Settings
        </Button>
      </div>
    )
  }

  const tabLabel =
    activeTab === "members"
      ? "Members"
      : activeTab === "billing"
        ? "Billing"
        : "General"

  return (
    /*
      The page's own `h-16` bar held nothing but a name and an avatar, and
      named neither the workspace nor the tab. Replaced with the app's bar,
      which does both and carries the command palette; the identity block moves
      into the right slot.
    */
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppTopBar
        crumbs={[
          { label: "Workspaces" },
          { label: currentOrg?.name ?? "Workspace" },
          { label: tabLabel },
        ]}
        showSidebarTrigger={false}
        actions={[
          {
            kind: "custom",
            id: "workspace-user",
            node: (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-300">
                  {session?.user?.name}
                </span>
                <Avatar className="size-7 border border-zinc-800 bg-zinc-900">
                  <AvatarFallback className="text-[10px] font-bold text-zinc-500">
                    {session?.user?.name?.[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
            ),
          },
        ]}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-6">
            <Button
              variant="ghost"
              size="sm"
              className="mb-6 h-8 w-full justify-start gap-2 px-2 text-muted-foreground hover:text-foreground"
              onClick={() =>
                navigate({
                  to: "/settings",
                  search: { tab: "workspaces" },
                } as any)
              }
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="text-xs font-bold">Back to Workspaces</span>
            </Button>

            <div className="flex flex-col gap-1 px-2">
              <h2 className="text-lg font-bold tracking-tight">Organization</h2>
              <p className="text-xs text-muted-foreground">
                Manage your organization.
              </p>
            </div>
          </div>

          <nav className="mt-2 flex flex-1 flex-col gap-1 p-3">
            <Button
              variant="ghost"
              onClick={() => setActiveTab("general")}
              className={`w-full justify-start gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                activeTab === "general"
                  ? "bg-zinc-800 text-white hover:bg-zinc-800"
                  : "text-muted-foreground hover:bg-zinc-900 hover:text-foreground"
              }`}
            >
              <Settings className="h-4 w-4" />
              General
            </Button>
            <Button
              variant="ghost"
              onClick={() => setActiveTab("members")}
              className={`w-full justify-start gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                activeTab === "members"
                  ? "bg-zinc-800 text-white hover:bg-zinc-800"
                  : "text-muted-foreground hover:bg-zinc-900 hover:text-foreground"
              }`}
            >
              <Users className="h-4 w-4" />
              Members
            </Button>
            <Button
              variant="ghost"
              onClick={() => setActiveTab("billing")}
              className={`w-full justify-start gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                activeTab === "billing"
                  ? "bg-zinc-800 text-white hover:bg-zinc-800"
                  : "text-muted-foreground hover:bg-zinc-900 hover:text-foreground"
              }`}
            >
              <CreditCard className="h-4 w-4" />
              Billing
            </Button>
          </nav>
        </aside>

        <main className="flex flex-1 flex-col overflow-y-auto bg-background">
          <div className="mx-auto w-full max-w-4xl p-10">
            {activeTab === "general" && <GeneralSettings org={currentOrg} />}
            {activeTab === "members" && <MembersSection org={currentOrg} />}
            {activeTab === "billing" && (
              <div className="animate-in space-y-6 duration-300 fade-in">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    Billing
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Manage your plan and subscription
                  </p>
                </div>
                <Card className="border-border shadow-sm">
                  <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                    Billing settings will be available soon.
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function GeneralSettings({ org }: { org: any }) {
  const [name, setName] = useState(org?.name || "")
  const [slug, setSlug] = useState(org?.slug || "")
  const [loading, setLoading] = useState(false)

  const handleUpdate = async () => {
    if (!org) return
    setLoading(true)
    try {
      await authClient.organization.update({
        organizationId: org.id,
        data: { name, slug },
      })
      toast.success("Workspace updated successfully")

      // If slug changed, we need to navigate to the new URL
      if (slug !== org.slug) {
        window.location.href = `/workspaces/${slug}/settings`
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update workspace")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="animate-in space-y-10 duration-300 fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          General
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your workspace details
        </p>
      </div>

      <Card className="border-border shadow-sm">
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-2">
            <Label className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              Workspace Name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-border bg-background"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              Workspace Slug
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                sparkfeed.com/
              </span>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="flex-1 border-border bg-background"
              />
            </div>
          </div>
          <div className="pt-2">
            <Button
              onClick={handleUpdate}
              disabled={loading}
              className="bg-blue-600 px-6 font-bold text-white hover:bg-blue-700"
            >
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Thicker Separator */}
      <div className="py-4">
        <div className="h-px w-full bg-zinc-800 shadow-[0_0_10px_rgba(0,0,0,0.5)]" />
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-bold text-red-500">Danger Zone</h3>
          <p className="text-xs text-muted-foreground">
            Destructive actions for this workspace
          </p>
        </div>

        <Card className="rounded-2xl border-red-500/20 bg-red-500/5">
          <CardContent className="flex items-center justify-between pt-6">
            <div className="space-y-1">
              <p className="text-sm font-bold text-red-600">Delete Workspace</p>
              <p className="text-xs text-muted-foreground">
                Permanently delete this workspace and all its data.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="destructive" className="font-bold">
                    Delete Workspace
                  </Button>
                }
              />
              <AlertDialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-bold text-red-500">
                    Delete Workspace Permanently
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-zinc-400">
                    Are you absolutely sure? This will delete{" "}
                    <span className="font-bold text-white">{org?.name}</span>.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        await authClient.organization.delete({
                          organizationId: org.id,
                        })
                        toast.success("Workspace deleted")
                        window.location.href = "/settings"
                      } catch {
                        toast.error("Failed to delete workspace")
                      }
                    }}
                    className="bg-red-600 font-bold text-white hover:bg-red-700"
                  >
                    Delete Workspace
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MembersSection({ org }: { org: any }) {
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member")
  const [isInviting, setIsInviting] = useState(false)
  const { data: activeOrg, isPending } = authClient.useActiveOrganization()
  const members = activeOrg?.members
  const { data: session } = useSession()
  const currentUserRole = members?.find(
    (m: any) => m.user.email === session?.user?.email
  )?.role
  const canInvite = currentUserRole === "owner" || currentUserRole === "admin"

  const [invitations, setInvitations] = useState<Array<any>>([])
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [activeInviteTab, setActiveInviteTab] = useState("members")
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  const loadInvitations = async () => {
    if (!org?.id) return
    setLoadingInvites(true)
    try {
      const res = await getInvitations({ data: org.id })
      setInvitations(res)
      if (isInitialLoad && res.length > 0) {
        setActiveInviteTab("pending")
        setIsInitialLoad(false)
      }
    } catch (e) {
      console.error("Failed to load invitations", e)
    } finally {
      setLoadingInvites(false)
    }
  }

  useEffect(() => {
    loadInvitations()
  }, [org?.id])

  const handleSendInvite = async () => {
    if (!inviteEmail || !org) return
    setIsInviting(true)
    try {
      await inviteUser({
        data: { email: inviteEmail, workspaceId: org.id, role: inviteRole },
      })
      toast.success(`Invitation sent to ${inviteEmail}`)
      setInviteEmail("")
      setInviteError(null)
      await loadInvitations()
      setActiveInviteTab("pending")
    } catch (error: any) {
      setInviteError(error.message || "Failed to send invitation")
    } finally {
      setIsInviting(false)
    }
  }

  const handleRevoke = async (inviteId: string) => {
    setRevokingId(inviteId)
    try {
      await revokeInvite({ data: { inviteId } })
      toast.success("Invitation revoked")
      await loadInvitations()
    } catch (e) {
      toast.error("Failed to revoke invitation")
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div className="animate-in space-y-8 duration-500 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Members
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage who has access to {org?.name}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 rounded-lg border-zinc-800 bg-zinc-950 px-4 font-medium text-zinc-400 hover:text-white"
        >
          <LinkIcon className="h-3.5 w-3.5" />
          Invite Link
        </Button>
      </div>

      {canInvite && (
        <Card className="border border-zinc-800/60 bg-transparent p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Input
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value)
                  setInviteError(null)
                }}
                className="h-10 border-zinc-800 bg-zinc-900/50 text-sm placeholder:text-zinc-600 focus:ring-zinc-700"
              />
            </div>
            <div className="w-40">
              <Select
                value={inviteRole}
                onValueChange={(val) =>
                  setInviteRole(val === "admin" ? "admin" : "member")
                }
              >
                <SelectTrigger className="h-10 border-zinc-800 bg-zinc-900/50 text-sm focus:ring-zinc-700">
                  <SelectValue placeholder="Select Role" />
                </SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-950">
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleSendInvite}
              disabled={isInviting || !inviteEmail}
              className="h-10 rounded-lg bg-white px-6 text-sm font-bold text-black hover:bg-zinc-200"
            >
              {isInviting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Send Invite
            </Button>
          </div>
        </Card>
      )}
      {inviteError && (
        <div className="-mt-2 flex items-center gap-2 px-1">
          <p className="text-xs text-amber-400">{inviteError}</p>
        </div>
      )}

      <Tabs
        value={activeInviteTab}
        onValueChange={setActiveInviteTab}
        className="w-full"
      >
        <TabsList className="h-auto w-full justify-start gap-8 rounded-none border-b border-zinc-800/60 bg-transparent p-0">
          <TabsTrigger
            value="members"
            className="rounded-none border-b-2 border-transparent bg-transparent px-0 py-3 text-sm font-semibold text-zinc-500 data-[state=active]:border-white data-[state=active]:bg-transparent data-[state=active]:text-white"
          >
            Members
          </TabsTrigger>
          <TabsTrigger
            value="pending"
            className="flex items-center gap-2 rounded-none border-b-2 border-transparent bg-transparent px-0 py-3 text-sm font-semibold text-zinc-500 data-[state=active]:border-white data-[state=active]:bg-transparent data-[state=active]:text-white"
          >
            Pending Invitations
            <Badge className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-400 hover:bg-zinc-800">
              {invitations.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <div className="divide-y divide-zinc-800/60">
            {isPending && (
              <div className="py-10 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
              </div>
            )}
            {members?.map((member: any) => (
              <MemberRow
                key={member.id}
                member={member}
                orgId={org.id}
                isOwner={member.role === "owner"}
              />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <div className="divide-y divide-zinc-800/60">
            {loadingInvites && (
              <div className="py-10 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
              </div>
            )}
            {!loadingInvites && invitations.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-sm text-zinc-500">No pending invitations</p>
              </div>
            )}
            {!loadingInvites && invitations.length > 0 && (
              <div className="w-full">
                <div className="grid grid-cols-12 gap-4 border-b border-zinc-800/60 py-3 text-xs font-bold tracking-wider text-muted-foreground uppercase">
                  <div className="col-span-5">Email</div>
                  <div className="col-span-2">Role</div>
                  <div className="col-span-3">Status</div>
                  <div className="col-span-2 text-right">ACTION</div>
                </div>
                <div className="divide-y divide-zinc-800/60">
                  {invitations.map((invite) => (
                    <div
                      key={invite.id}
                      className="grid grid-cols-12 items-center gap-4 py-4"
                    >
                      <div className="col-span-5 truncate text-sm font-bold text-foreground">
                        {invite.email}
                      </div>
                      <div className="col-span-2 text-xs tracking-wider text-zinc-500 uppercase">
                        {invite.role}
                      </div>
                      <div className="col-span-3">
                        <Badge className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-blue-400 uppercase">
                          Pending
                        </Badge>
                      </div>
                      <div className="col-span-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevoke(invite.id)}
                          disabled={revokingId === invite.id}
                          className="h-7 rounded-lg border border-red-500/20 px-3 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        >
                          {revokingId === invite.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Revoke"
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function MemberRow({
  member,
  orgId,
  isOwner = false,
}: {
  member: any
  orgId: string
  isOwner?: boolean
}) {
  const name = member.user.name || "Unknown"
  const email = member.user.email
  const initials = name
    .split(" ")
    .map((n: any) => n[0])
    .join("")
    .toUpperCase()
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)

  const handleUpdateRole = async (newRole: string) => {
    try {
      await authClient.organization.updateMemberRole({
        memberId: member.id,
        role: newRole as any,
        organizationId: orgId,
      })
      toast.success("Role updated")
    } catch {
      toast.error("Failed to update role")
    }
  }

  return (
    <>
      <div className="group flex items-center justify-between py-4 transition-all duration-200">
        <div className="flex items-center gap-4">
          <Avatar className="h-9 w-9 rounded-full border border-zinc-800 bg-zinc-900">
            <AvatarFallback className="text-[10px] font-bold text-zinc-500">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-0.5">
            <p className="text-sm leading-none font-bold text-foreground">
              {name}
            </p>
            <p className="text-xs text-zinc-500">{email}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Badge
            className={`border-0 px-2.5 py-0.5 text-[10px] font-black tracking-widest uppercase ${isOwner ? "bg-purple-500/10 text-purple-400" : "bg-zinc-800 text-zinc-400"}`}
          >
            {member.role}
          </Badge>
          <DropdownMenu modal={true}>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-zinc-500 hover:text-white"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              }
            />
            <DropdownMenuContent
              align="end"
              className="w-48 border-zinc-800 bg-zinc-950 p-1.5 shadow-2xl"
            >
              <DropdownMenuItem
                onSelect={() =>
                  handleUpdateRole(member.role === "owner" ? "member" : "owner")
                }
                className="cursor-pointer gap-2 rounded-lg p-2 transition-colors focus:bg-zinc-900"
              >
                <Pencil className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-sm font-medium">Change Role</span>
              </DropdownMenuItem>
              {!isOwner && (
                <>
                  <DropdownMenuSeparator className="my-1 bg-zinc-900" />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault()
                      setShowRemoveDialog(true)
                    }}
                    className="cursor-pointer gap-2.5 rounded-lg p-2 text-red-500 transition-colors focus:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="text-sm font-bold">Remove</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-bold text-red-500">
              Remove Member
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              Are you sure you want to remove{" "}
              <span className="font-bold text-white">{name}</span>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await authClient.organization.removeMember({
                    memberIdOrEmail: member.id,
                    organizationId: orgId,
                  })
                  toast.success("Member removed")
                  setShowRemoveDialog(false)
                } catch {
                  toast.error("Failed to remove member")
                }
              }}
              className="bg-red-600 font-bold text-white hover:bg-red-700"
            >
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
