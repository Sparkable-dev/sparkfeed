import * as React from "react"
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Search,
  Settings,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getInvitations,
  getWorkspaceMembers,
  inviteUser,
  revokeInvite,
} from "@/server/email-actions"

interface WorkspaceSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string | null
}

export function WorkspaceSettingsModal({
  open,
  onOpenChange,
  organizationId,
}: WorkspaceSettingsModalProps) {
  const { data: activeOrg } = authClient.useActiveOrganization()
  const { data: activeMember } = authClient.useActiveMember()
  const [members, setMembers] = React.useState<Array<any>>([])
  const [invitations, setInvitations] = React.useState<Array<any>>([])
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [isLeaving, setIsLeaving] = React.useState(false)
  const [showInviteForm, setShowInviteForm] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")

  // New states for confirmation and inviting
  const [isInviting, setIsInviting] = React.useState(false)
  const [confirmationType, setConfirmationType] = React.useState<
    "leave" | "delete" | null
  >(null)
  const [confirmText, setConfirmText] = React.useState("")
  const [inviteEmail, setInviteEmail] = React.useState("")
  const [inviteError, setInviteError] = React.useState<string | null>(null)
  const [revokingId, setRevokingId] = React.useState<string | null>(null)
  const [inviteRole, setInviteRole] = React.useState<"admin" | "member">(
    "member"
  )
  const [isEditingName, setIsEditingName] = React.useState(false)
  const [newName, setNewName] = React.useState(activeOrg?.name || "")
  const [newSlug, setNewSlug] = React.useState(activeOrg?.slug || "")
  const [newLogo, setNewLogo] = React.useState<string | null>(
    activeOrg?.logo || null
  )
  const [isUpdatingOrg, setIsUpdatingOrg] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (activeOrg) {
      setNewName(activeOrg.name)
      setNewSlug(activeOrg.slug || "")
      setNewLogo(activeOrg.logo || null)
    }
  }, [activeOrg])

  // Reliable role detection using the active member hook
  const role = activeMember?.role
  const canDelete = role === "owner" || role === "admin"
  const canLeave = role === "member" || role === "admin"

  React.useEffect(() => {
    if (open && organizationId) {
      // List Members using our reliable server function
      getWorkspaceMembers({ data: organizationId })
        .then((res) => {
          if (res && Array.isArray(res)) {
            setMembers(res)
          }
        })
        .catch((err) => {
          console.error("[ERROR] getWorkspaceMembers failed:", err)
        })

      // Better Auth Organization owns invitation storage and authorization.
      getInvitations({ data: organizationId })
        .then((res) => {
          if (res && Array.isArray(res)) {
            setInvitations(res)
          }
        })
        .catch((err) => {
          console.error("[ERROR] getInvitations failed:", err)
        })
    }
  }, [open, organizationId])

  const handleDelete = async () => {
    if (!activeOrg || confirmText !== activeOrg?.name) return
    setIsDeleting(true)
    try {
      const { error } = await authClient.organization.delete({
        organizationId: activeOrg.id,
      })
      if (error) throw error

      toast.success("Workspace deleted")
      window.location.href = "/"
    } catch (err: any) {
      toast.error(err.message || "Failed to delete workspace")
    } finally {
      setIsDeleting(false)
    }
  }

  const handleLeave = async () => {
    if (!activeOrg || confirmText !== activeOrg?.name) return
    setIsLeaving(true)
    try {
      const { error } = await authClient.organization.leave({
        organizationId: activeOrg.id,
      })
      if (error) throw error

      toast.success("Left workspace")
      window.location.href = "/"
    } catch (err: any) {
      toast.error(err.message || "Failed to leave workspace")
    } finally {
      setIsLeaving(false)
    }
  }

  const handleSendInvitations = async () => {
    if (!inviteEmail.trim() || !activeOrg) return

    setIsInviting(true)
    const email = inviteEmail.trim()

    if (!email.includes("@")) {
      setInviteError("Please enter a valid email address")
      setIsInviting(false)
      return
    }

    try {
      await inviteUser({
        data: {
          email,
          workspaceId: activeOrg.id,
          role: inviteRole,
        },
      })
      toast.success(`Invitation sent to ${email}`)
      setInviteEmail("")
      setInviteError(null)
      setShowInviteForm(false)

      // Refresh invitations list
      const res = await getInvitations({ data: activeOrg.id })
      if (res) setInvitations(res)
    } catch (err: any) {
      setInviteError(err.message || "Failed to send invitation")
    } finally {
      setIsInviting(false)
    }
  }

  const handleRevoke = async (inviteId: string) => {
    setRevokingId(inviteId)
    try {
      await revokeInvite({ data: { inviteId } })
      toast.success("Invitation revoked")
      const res = await getInvitations({
        data: activeOrg!.id,
      })
      if (res) setInvitations(res)
    } catch (e) {
      toast.error("Failed to revoke invitation")
    } finally {
      setRevokingId(null)
    }
  }

  const handleUpdateOrg = async () => {
    if (!activeOrg || !newName.trim()) return
    setIsUpdatingOrg(true)
    try {
      const { error } = await authClient.organization.update({
        organizationId: activeOrg.id,
        data: {
          name: newName,
          slug: newSlug,
          logo: newLogo === null ? "" : newLogo || undefined,
        },
      })
      if (error) throw error
      toast.success("Organization updated")
      setIsEditingName(false)
      // Force reload to sync changes across all components like TeamSwitcher
      window.location.reload()
    } catch (err: any) {
      toast.error(err.message || "Failed to update organization")
    } finally {
      setIsUpdatingOrg(false)
    }
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File is too large. Max 10MB.")
        return
      }
      const reader = new FileReader()
      reader.onloadend = () => {
        setNewLogo(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  if (!activeOrg && organizationId) return null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-[90vw] flex-row overflow-hidden rounded-xl border-white/5 border-zinc-900 bg-black p-0 shadow-[0_20px_50px_rgba(0,0,0,0.8)] sm:max-w-[900px]">
          <Tabs
            defaultValue="general"
            className="flex h-[650px] w-full flex-row overflow-hidden"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
            }}
          >
            {/* Sidebar */}
            <div className="flex h-full w-[200px] shrink-0 flex-col border-r border-zinc-900 p-4">
              {/* Header with Avatar + Name */}
              <div className="mt-2 mb-8 flex flex-col gap-2.5 px-2">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 rounded-lg border border-zinc-800 shadow-sm">
                    <AvatarImage src={activeOrg?.logo || ""} />
                    <AvatarFallback className="rounded-lg bg-zinc-800 text-sm font-bold text-zinc-400">
                      {activeOrg?.name?.[0]?.toUpperCase() || "O"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-base font-bold text-zinc-100">
                    {activeOrg?.name || "Workspace"}
                  </span>
                </div>
                <span className="text-xs leading-none font-medium text-zinc-500">
                  Manage your workspace
                </span>
              </div>

              <TabsList className="flex h-auto flex-col items-stretch gap-1 bg-transparent p-0">
                <TabsTrigger
                  value="general"
                  className="w-full justify-start gap-3 rounded-md border-none px-3 py-2.5 text-sm font-semibold text-zinc-400 shadow-none transition-all hover:bg-white/10 hover:text-white data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  <Settings className="h-4 w-4" />
                  General
                </TabsTrigger>
                <TabsTrigger
                  value="members"
                  className="w-full justify-start gap-3 rounded-md border-none px-3 py-2.5 text-sm font-semibold text-zinc-400 shadow-none transition-all hover:bg-white/10 hover:text-white data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  <Users className="h-4 w-4" />
                  Members
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Content Area */}
            <div
              className="custom-scrollbar flex h-full flex-1 flex-col overflow-y-auto"
              style={{ padding: "0px" }}
            >
              <div className="flex-1 p-10 pt-8">
                <style>{`
              .custom-scrollbar::-webkit-scrollbar {
                width: 4px;
              }
              .custom-scrollbar::-webkit-scrollbar-track {
                background: transparent;
              }
              .custom-scrollbar::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 10px;
              }
              .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.2);
              }
            `}</style>

                {/* General Tab */}
                <TabsContent
                  value="general"
                  className="m-0 space-y-8 outline-none"
                >
                  <div className="pb-1">
                    <h3 className="text-xl font-bold text-zinc-100">General</h3>
                  </div>

                  <div className="space-y-8">
                    {/* Organization Profile Row */}
                    <div className="flex flex-col items-start gap-6 md:flex-row md:gap-0">
                      <div className="w-full pt-2 md:w-1/3">
                        <p className="text-sm font-semibold text-zinc-200">
                          Organization Profile
                        </p>
                      </div>
                      <div className="w-full flex-1">
                        {isEditingName ? (
                          <div className="animate-in space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-sm duration-200 zoom-in-95">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm text-[10px] font-bold tracking-widest text-zinc-100 uppercase">
                                Update profile
                              </h4>
                            </div>

                            {/* Logo Section */}
                            <div className="space-y-4">
                              <Label className="text-[11px] font-bold tracking-widest text-zinc-500 uppercase">
                                Logo
                              </Label>
                              <div className="flex items-center gap-6">
                                <div className="group relative">
                                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border-2 border-zinc-800 bg-zinc-900 shadow-lg transition-all group-hover:border-zinc-700">
                                    {newLogo ? (
                                      <img
                                        src={newLogo}
                                        alt="Logo"
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <span className="text-xl font-bold text-zinc-600">
                                        {newName?.[0]?.toUpperCase() || "O"}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="flex items-center gap-3">
                                    <input
                                      type="file"
                                      ref={fileInputRef}
                                      className="hidden"
                                      accept="image/*"
                                      onChange={handleLogoUpload}
                                    />
                                    <Button
                                      variant="outline"
                                      onClick={() =>
                                        fileInputRef.current?.click()
                                      }
                                      className="h-9 rounded-xl border-zinc-800 bg-white/5 px-4 text-xs font-bold text-zinc-200 transition-all hover:bg-white/10"
                                    >
                                      Upload
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      onClick={() => setNewLogo(null)}
                                      className="h-9 rounded-xl px-4 text-xs font-bold text-red-500 transition-all hover:bg-red-500/10 hover:text-red-400"
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                  <p className="text-[10px] font-medium text-zinc-500">
                                    Recommended size 1:1, up to 10MB.
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Name Section */}
                            <div className="space-y-1.5">
                              <Label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                                Name
                              </Label>
                              <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                className="h-9 rounded-lg border-zinc-800 bg-zinc-950/50 text-sm focus:ring-blue-500/20"
                              />
                            </div>

                            {/* Slug Section */}
                            <div className="space-y-1.5">
                              <Label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                                Slug
                              </Label>
                              <Input
                                value={newSlug}
                                onChange={(e) => setNewSlug(e.target.value)}
                                className="h-9 rounded-lg border-zinc-800 bg-zinc-950/50 text-sm focus:ring-blue-500/20"
                              />
                            </div>

                            <div className="flex justify-end gap-3 border-t border-zinc-800/50 pt-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setIsEditingName(false)
                                  setNewName(activeOrg?.name || "")
                                  setNewSlug(activeOrg?.slug || "")
                                  setNewLogo(activeOrg?.logo || null)
                                }}
                                className="h-8 px-4 text-xs font-bold text-zinc-500 transition-colors hover:text-white"
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={handleUpdateOrg}
                                disabled={
                                  isUpdatingOrg ||
                                  !newName.trim() ||
                                  (newName === activeOrg?.name &&
                                    newSlug === activeOrg?.slug &&
                                    newLogo === activeOrg?.logo)
                                }
                                className="h-8 rounded-lg bg-zinc-100 px-6 font-bold text-black shadow-xl transition-all hover:bg-white disabled:opacity-40"
                              >
                                {isUpdatingOrg ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  "Save"
                                )}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="group flex items-center justify-between py-1">
                            <div className="flex items-center gap-4">
                              <Avatar className="h-10 w-10 rounded-lg border border-zinc-800 shadow-sm">
                                <AvatarImage src={activeOrg?.logo || ""} />
                                <AvatarFallback className="rounded-lg bg-zinc-800 text-xs font-bold text-zinc-400">
                                  {activeOrg?.name?.[0]?.toUpperCase() || "O"}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col">
                                <p className="text-sm font-bold text-zinc-100">
                                  {activeOrg?.name || "Workspace"}
                                </p>
                                <p className="text-[11px] font-medium text-zinc-500">
                                  /{activeOrg?.slug || ""}
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              onClick={() => setIsEditingName(true)}
                              className="h-9 rounded-lg px-4 text-[13px] font-bold text-zinc-300 transition-all hover:bg-white/10 hover:text-white"
                            >
                              Update profile
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator className="bg-zinc-900" />

                    {/* Leave Organization Row */}
                    {canLeave && (
                      <>
                        <div className="flex flex-col items-center gap-6 py-2 md:flex-row md:gap-0">
                          <div className="w-full md:w-1/3">
                            <p className="text-sm font-semibold text-zinc-200">
                              Leave organization
                            </p>
                          </div>
                          <div className="w-full flex-1 text-left">
                            <Button
                              variant="ghost"
                              onClick={() => setConfirmationType("leave")}
                              className="h-8 rounded-lg px-3 text-xs font-bold text-red-500 transition-all hover:bg-red-500/10 hover:text-red-400"
                            >
                              Leave organization
                            </Button>
                          </div>
                        </div>
                        <Separator className="bg-zinc-900" />
                      </>
                    )}

                    {/* Delete Organization Row */}
                    {canDelete && (
                      <div className="flex flex-col items-center gap-6 py-2 md:flex-row md:gap-0">
                        <div className="w-full md:w-1/3">
                          <p className="text-sm font-semibold text-zinc-200">
                            Delete organization
                          </p>
                        </div>
                        <div className="w-full flex-1 text-left">
                          <Button
                            variant="ghost"
                            onClick={() => setConfirmationType("delete")}
                            className="h-8 rounded-lg px-3 text-xs font-bold text-red-500 transition-all hover:bg-red-500/10 hover:text-red-400"
                          >
                            Delete organization
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Members Tab */}
                <TabsContent
                  value="members"
                  className="m-0 space-y-6 outline-none"
                >
                  <div className="pb-2">
                    <h3 className="text-xl font-bold text-zinc-100">Members</h3>
                  </div>

                  <Tabs defaultValue="list" className="w-full space-y-6">
                    <TabsList className="h-10 w-full justify-start gap-8 rounded-none border-b border-zinc-800/30 bg-transparent p-0">
                      <TabsTrigger
                        value="list"
                        className="h-full rounded-none border-b-2 border-transparent px-0 text-sm font-medium text-zinc-500 transition-all hover:text-zinc-300 data-[state=active]:border-blue-500 data-[state=active]:!bg-transparent data-[state=active]:font-bold data-[state=active]:text-white data-[state=active]:!shadow-none"
                      >
                        Members
                      </TabsTrigger>
                      {canDelete && (
                        <TabsTrigger
                          value="invitations"
                          className="h-full gap-2 rounded-none border-b-2 border-transparent px-0 text-sm font-medium text-zinc-500 transition-all hover:text-zinc-300 data-[state=active]:border-blue-500 data-[state=active]:!bg-transparent data-[state=active]:font-bold data-[state=active]:text-white data-[state=active]:!shadow-none"
                        >
                          Invitations
                          <Badge className="h-4.5 border-0 bg-zinc-800 px-1.5 text-[10px] font-bold text-zinc-500">
                            {invitations.length}
                          </Badge>
                        </TabsTrigger>
                      )}
                    </TabsList>

                    <TabsContent value="list" className="m-0 space-y-6">
                      {/* Toolbar */}
                      <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                          <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                          <Input
                            placeholder="Search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-9 rounded-lg border-zinc-800 bg-zinc-900/50 pl-9 text-sm focus-visible:ring-blue-500/20"
                          />
                        </div>
                        <Button
                          onClick={() => setShowInviteForm(!showInviteForm)}
                          className="h-9 rounded-lg bg-zinc-100 px-4 text-xs font-bold text-black transition-all hover:bg-zinc-200"
                        >
                          Invite
                        </Button>
                      </div>

                      {/* Invite Form */}
                      {showInviteForm && (
                        <div className="animate-in space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 duration-300 slide-in-from-top-2">
                          <div className="flex flex-col items-end gap-3 md:flex-row">
                            <div className="flex-1 space-y-1.5">
                              <Label className="ml-1 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                                Invite Member
                              </Label>
                              <Input
                                placeholder="email@example.com"
                                value={inviteEmail}
                                onChange={(e) => {
                                  setInviteEmail(e.target.value)
                                  setInviteError(null)
                                }}
                                className="h-9 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-200 focus-visible:ring-blue-500/20"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label className="ml-1 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                                Role
                              </Label>
                              <DropdownMenu modal={false}>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      variant="outline"
                                      className="h-9 w-[110px] justify-between rounded-lg border-zinc-800 bg-zinc-950 px-4 text-xs font-bold text-zinc-400 hover:bg-zinc-900 hover:text-white"
                                    >
                                      {inviteRole.charAt(0).toUpperCase() +
                                        inviteRole.slice(1)}
                                      <ChevronDown className="ml-2 h-3 w-3 opacity-40" />
                                    </Button>
                                  }
                                />
                                <DropdownMenuContent className="border-zinc-800 bg-zinc-950 text-zinc-400">
                                  <DropdownMenuItem
                                    onClick={() => setInviteRole("admin")}
                                    className="cursor-pointer text-xs font-bold hover:text-white"
                                  >
                                    Admin
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => setInviteRole("member")}
                                    className="cursor-pointer text-xs font-bold hover:text-white"
                                  >
                                    Member
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setShowInviteForm(false)
                                  setInviteEmail("")
                                  setInviteError(null)
                                }}
                                className="h-9 px-4 text-xs font-bold text-zinc-400 hover:bg-white/5 hover:text-white"
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={handleSendInvitations}
                                disabled={isInviting || !inviteEmail.trim()}
                                className="h-9 rounded-lg bg-zinc-100 px-6 text-xs font-bold text-black shadow-lg transition-all hover:bg-white active:scale-95 disabled:opacity-40"
                              >
                                {isInviting ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  "Send Invite"
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {inviteError && (
                        <div className="flex items-center gap-2 px-1">
                          <p className="text-xs text-amber-400">
                            {inviteError}
                          </p>
                        </div>
                      )}

                      {/* Table Header */}
                      <div className="grid grid-cols-3 border-b border-zinc-900 px-4 py-1.5 text-[9px] font-bold tracking-widest text-zinc-500 uppercase">
                        <div>User</div>
                        <div>Joined</div>
                        <div>Role</div>
                      </div>

                      {/* Member List */}
                      <div className="space-y-0 divide-y divide-zinc-900/50">
                        {Array.isArray(members) &&
                          members
                            .filter((m) => {
                              const searchLower = searchQuery.toLowerCase()
                              const userName = m.user?.name?.toLowerCase() || ""
                              const userEmail =
                                m.user?.email?.toLowerCase() || ""
                              return (
                                userName.includes(searchLower) ||
                                userEmail.includes(searchLower)
                              )
                            })
                            .map((member) => (
                              <div
                                key={member.id}
                                className="group grid grid-cols-3 items-center px-4 py-3 transition-colors hover:bg-white/[0.02]"
                              >
                                <div className="flex min-w-0 flex-col">
                                  <p className="truncate text-xs font-semibold text-zinc-200">
                                    {member.user?.name ||
                                      member.user?.email?.split("@")[0] ||
                                      "Unknown User"}
                                  </p>
                                  <p className="truncate text-[10px] text-zinc-500">
                                    {member.user?.email || "No email"}
                                  </p>
                                </div>
                                <div className="text-[11px] text-zinc-500">
                                  {new Date().toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </div>
                                <div>
                                  <Badge className="h-4.5 border border-zinc-800 bg-zinc-800/50 px-1.5 text-[9px] font-black tracking-tight text-zinc-400 uppercase">
                                    {member.role}
                                  </Badge>
                                </div>
                              </div>
                            ))}

                        {members.length === 0 && (
                          <div className="mt-4 rounded-xl border border-dashed border-zinc-800 py-20 text-center">
                            <p className="text-sm font-medium text-zinc-500">
                              No members to display
                            </p>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="invitations" className="m-0 space-y-6">
                      {invitations.length > 0 ? (
                        <>
                          {/* Table Header */}
                          <div className="grid grid-cols-12 border-b border-zinc-900 px-4 py-2 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                            <div className="col-span-5">Invitee</div>
                            <div className="col-span-2">Role</div>
                            <div className="col-span-3">Status</div>
                            <div className="col-span-2 text-right">Action</div>
                          </div>

                          <div className="space-y-0 divide-y divide-zinc-900/50">
                            {invitations.map((invite) => (
                              <div
                                key={invite.id}
                                className="group grid grid-cols-12 items-center px-4 py-4 transition-colors hover:bg-white/[0.02]"
                              >
                                <div className="col-span-5 flex min-w-0 flex-col">
                                  <p className="truncate text-xs font-semibold text-zinc-200">
                                    {invite.email}
                                  </p>
                                </div>

                                <div className="col-span-2">
                                  <Badge className="h-4.5 border border-zinc-800 bg-zinc-800/50 px-1.5 text-[9px] font-black tracking-tight text-zinc-400 uppercase">
                                    {invite.role}
                                  </Badge>
                                </div>

                                <div className="col-span-3">
                                  <Badge className="h-4.5 border-0 bg-blue-500/10 px-1.5 text-[9px] font-bold text-blue-400 uppercase">
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
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-zinc-800 py-20 text-center">
                          <p className="text-sm font-medium text-zinc-500">
                            No pending invitations
                          </p>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </TabsContent>
              </div>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Modals/Dialogs for Confirmation moved outside of Dialog to prevent DOM errors */}
      <AlertDialog
        open={confirmationType === "leave"}
        onOpenChange={(isOpen) => !isOpen && setConfirmationType(null)}
      >
        <AlertDialogContent className="overflow-hidden rounded-2xl border-none border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl sm:max-w-[400px]">
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-50 p-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <AlertDialogTitle className="text-xl font-bold text-zinc-900">
                Leave organization
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-[13px] leading-relaxed text-zinc-500">
              Are you sure you want to leave{" "}
              <span className="font-bold text-zinc-900">{activeOrg?.name}</span>
              ? You will lose access to all shared resources in this workspace.
            </AlertDialogDescription>

            <div className="space-y-3 pt-2">
              <p className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                Type workspace name to confirm
              </p>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={activeOrg?.name}
                className="h-10 rounded-xl border-zinc-200 bg-zinc-50/50 text-sm focus-visible:ring-red-500/10"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-zinc-100 bg-zinc-50/50 p-4 px-6">
            <AlertDialogCancel className="m-0 h-9 border-none bg-transparent px-4 font-semibold text-zinc-500 shadow-none hover:bg-transparent hover:text-zinc-900">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeave}
              disabled={isLeaving || confirmText !== activeOrg?.name}
              className="m-0 flex h-9 items-center justify-center rounded-lg border-none bg-red-600 px-4 font-bold text-white shadow-sm transition-all hover:bg-red-700 active:scale-95"
            >
              {isLeaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Leaving...
                </>
              ) : (
                "Leave Organization"
              )}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmationType === "delete"}
        onOpenChange={(isOpen) => !isOpen && setConfirmationType(null)}
      >
        <AlertDialogContent className="overflow-hidden rounded-2xl border-none border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl sm:max-w-[400px]">
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-50 p-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <AlertDialogTitle className="text-xl font-bold text-zinc-900">
                Delete organization
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-[13px] leading-relaxed text-zinc-500">
              Are you sure you want to delete{" "}
              <span className="font-bold text-zinc-900">{activeOrg?.name}</span>
              ? This will permanently delete all feeds, folders, and member
              associations.
            </AlertDialogDescription>

            <div className="space-y-3 pt-2">
              <p className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                Type workspace name to confirm
              </p>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={activeOrg?.name}
                className="h-10 rounded-xl border-zinc-200 bg-zinc-50/50 text-sm focus-visible:ring-red-500/10"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-zinc-100 bg-zinc-50/50 p-4 px-6">
            <AlertDialogCancel className="m-0 h-9 border-none bg-transparent px-4 font-semibold text-zinc-500 shadow-none hover:bg-transparent hover:text-zinc-900">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting || confirmText !== activeOrg?.name}
              className="m-0 flex h-9 items-center justify-center rounded-lg border-none bg-red-600 px-4 font-bold text-white shadow-sm transition-all hover:bg-red-700 active:scale-95"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Organization"
              )}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
