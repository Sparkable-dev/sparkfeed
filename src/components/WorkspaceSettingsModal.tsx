import * as React from "react"
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Search,
  Settings,
  Users
} from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
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
import { cleanDuplicateInvites, getInvitations, getWorkspaceMembers, inviteUser, revokeInvite } from "@/server/email-actions"

interface WorkspaceSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string | null
}

export function WorkspaceSettingsModal({ open, onOpenChange, organizationId }: WorkspaceSettingsModalProps) {
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
  const [confirmationType, setConfirmationType] = React.useState<'leave' | 'delete' | null>(null)
  const [confirmText, setConfirmText] = React.useState("")
  const [inviteEmail, setInviteEmail] = React.useState("")
  const [inviteError, setInviteError] = React.useState<string | null>(null)
  const [revokingId, setRevokingId] = React.useState<string | null>(null)
  const [inviteRole, setInviteRole] = React.useState<"admin" | "member" | "viewer">("member")
  const [isEditingName, setIsEditingName] = React.useState(false)
  const [newName, setNewName] = React.useState(activeOrg?.name || "")
  const [newSlug, setNewSlug] = React.useState(activeOrg?.slug || "")
  const [newLogo, setNewLogo] = React.useState<string | null>(activeOrg?.logo || null)
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
      getWorkspaceMembers({ data: organizationId }).then(res => {
        if (res && Array.isArray(res)) {
          setMembers(res)
        }
      }).catch(err => {
        console.error("[ERROR] getWorkspaceMembers failed:", err)
      })

      // List Invitations from our custom table after cleaning duplicates
      cleanDuplicateInvites({ data: organizationId })
        .then(() => getInvitations({ data: organizationId }))
        .then(res => {
          if (res && Array.isArray(res)) {
            setInvitations(res)
          }
        }).catch(err => {
          console.error("[ERROR] getInvitations failed:", err)
        })
    }
  }, [open, organizationId])

  const handleDelete = async () => {
    if (!activeOrg || confirmText !== activeOrg?.name) return
    setIsDeleting(true)
    try {
      const { error } = await authClient.organization.delete({
        organizationId: activeOrg.id
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
        organizationId: activeOrg.id
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

    if (!email.includes('@')) {
      setInviteError("Please enter a valid email address")
      setIsInviting(false)
      return
    }

    try {
      await inviteUser({
        data: {
          email,
          workspaceId: activeOrg.id,
          role: inviteRole
        }
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
        data: activeOrg!.id
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
          logo: newLogo === null ? "" : (newLogo || undefined)
        }
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
      <DialogContent className="sm:max-w-[900px] w-[90vw] p-0 overflow-hidden bg-black border-zinc-900 shadow-[0_20px_50px_rgba(0,0,0,0.8)] rounded-xl border-white/5 max-h-[85vh] flex flex-row">

        <Tabs defaultValue="general" className="w-full flex flex-row h-[650px] overflow-hidden" style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch' }}>
          {/* Sidebar */}
          <div className="w-[200px] border-r border-zinc-900 p-4 flex flex-col shrink-0 h-full">
            {/* Header with Avatar + Name */}
            <div className="flex flex-col gap-2.5 mb-8 px-2 mt-2">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 rounded-lg border border-zinc-800 shadow-sm">
                  <AvatarImage src={activeOrg?.logo || ""} />
                  <AvatarFallback className="bg-zinc-800 text-zinc-400 text-sm font-bold rounded-lg">
                    {activeOrg?.name?.[0]?.toUpperCase() || "O"}
                  </AvatarFallback>
                </Avatar>
                <span className="text-base font-bold text-zinc-100 truncate">{activeOrg?.name || "Workspace"}</span>
              </div>
              <span className="text-xs text-zinc-500 font-medium leading-none">Manage your workspace</span>
            </div>

            <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1 items-stretch">
              <TabsTrigger
                value="general"
                className="w-full justify-start gap-3 rounded-md px-3 py-2.5 transition-all font-semibold text-sm data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-sm text-zinc-400 hover:bg-white/10 hover:text-white border-none shadow-none"
              >
                <Settings className="w-4 h-4" />
                General
              </TabsTrigger>
              <TabsTrigger
                value="members"
                className="w-full justify-start gap-3 rounded-md px-3 py-2.5 transition-all font-semibold text-sm data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-sm text-zinc-400 hover:bg-white/10 hover:text-white border-none shadow-none"
              >
                <Users className="w-4 h-4" />
                Members
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto h-full custom-scrollbar flex flex-col" style={{ padding: '0px' }}>
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
            <TabsContent value="general" className="m-0 space-y-8 outline-none">
              <div className="pb-1">
                <h3 className="text-xl font-bold text-zinc-100">General</h3>
              </div>

              <div className="space-y-8">
                {/* Organization Profile Row */}
                <div className="flex flex-col md:flex-row gap-6 md:gap-0 items-start">
                  <div className="w-full md:w-1/3 pt-2">
                    <p className="text-sm font-semibold text-zinc-200">Organization Profile</p>
                  </div>
                  <div className="flex-1 w-full">
                    {isEditingName ? (
                      <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 space-y-6 shadow-sm animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold text-zinc-100 uppercase tracking-widest text-[10px]">Update profile</h4>
                        </div>

                        {/* Logo Section */}
                        <div className="space-y-4">
                          <Label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Logo</Label>
                          <div className="flex items-center gap-6">
                            <div className="relative group">
                              <div className="h-16 w-16 rounded-xl border-2 border-zinc-800 bg-zinc-900 flex items-center justify-center overflow-hidden shadow-lg transition-all group-hover:border-zinc-700">
                                {newLogo ? (
                                  <img src={newLogo} alt="Logo" className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-xl font-bold text-zinc-600">{newName?.[0]?.toUpperCase() || "O"}</span>
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
                                  onClick={() => fileInputRef.current?.click()}
                                  className="h-9 px-4 rounded-xl border-zinc-800 bg-white/5 text-xs font-bold hover:bg-white/10 transition-all text-zinc-200"
                                >
                                  Upload
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => setNewLogo(null)}
                                  className="h-9 px-4 rounded-xl text-xs font-bold text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                                >
                                  Remove
                                </Button>
                              </div>
                              <p className="text-[10px] text-zinc-500 font-medium">Recommended size 1:1, up to 10MB.</p>
                            </div>
                          </div>
                        </div>

                        {/* Name Section */}
                        <div className="space-y-1.5">
                          <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Name</Label>
                          <Input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="bg-zinc-950/50 border-zinc-800 h-9 text-sm focus:ring-blue-500/20 rounded-lg"
                          />
                        </div>

                        {/* Slug Section */}
                        <div className="space-y-1.5">
                          <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Slug</Label>
                          <Input
                            value={newSlug}
                            onChange={(e) => setNewSlug(e.target.value)}
                            className="bg-zinc-950/50 border-zinc-800 h-9 text-sm focus:ring-blue-500/20 rounded-lg"
                          />
                        </div>

                        <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800/50">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setIsEditingName(false);
                              setNewName(activeOrg?.name || "");
                              setNewSlug(activeOrg?.slug || "");
                              setNewLogo(activeOrg?.logo || null);
                            }}
                            className="text-xs font-bold text-zinc-500 hover:text-white h-8 px-4 transition-colors"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleUpdateOrg}
                            disabled={isUpdatingOrg || !newName.trim() || (newName === activeOrg?.name && newSlug === activeOrg?.slug && newLogo === activeOrg?.logo)}
                            className="bg-zinc-100 hover:bg-white text-black font-bold h-8 px-6 rounded-lg shadow-xl transition-all disabled:opacity-40"
                          >
                            {isUpdatingOrg ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between group py-1">
                        <div className="flex items-center gap-4">
                          <Avatar className="h-10 w-10 rounded-lg border border-zinc-800 shadow-sm">
                            <AvatarImage src={activeOrg?.logo || ""} />
                            <AvatarFallback className="bg-zinc-800 text-zinc-400 text-xs font-bold rounded-lg">
                              {activeOrg?.name?.[0]?.toUpperCase() || "O"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <p className="text-sm font-bold text-zinc-100">{activeOrg?.name || "Workspace"}</p>
                            <p className="text-[11px] text-zinc-500 font-medium">/{activeOrg?.slug || ""}</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          onClick={() => setIsEditingName(true)}
                          className="text-zinc-300 hover:text-white px-4 h-9 rounded-lg font-bold text-[13px] hover:bg-white/10 transition-all"
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
                    <div className="flex flex-col md:flex-row py-2 gap-6 md:gap-0 items-center">
                      <div className="w-full md:w-1/3">
                        <p className="text-sm font-semibold text-zinc-200">Leave organization</p>
                      </div>
                      <div className="flex-1 w-full text-left">
                        <Button
                          variant="ghost"
                          onClick={() => setConfirmationType('leave')}
                          className="text-red-500 hover:text-red-400 px-3 h-8 rounded-lg font-bold text-xs hover:bg-red-500/10 transition-all"
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
                  <div className="flex flex-col md:flex-row py-2 gap-6 md:gap-0 items-center">
                    <div className="w-full md:w-1/3">
                      <p className="text-sm font-semibold text-zinc-200">Delete organization</p>
                    </div>
                    <div className="flex-1 w-full text-left">
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmationType('delete')}
                        className="text-red-500 hover:text-red-400 px-3 h-8 rounded-lg font-bold text-xs hover:bg-red-500/10 transition-all"
                      >
                        Delete organization
                      </Button>
                    </div>
                  </div>
                )}

              </div>
            </TabsContent>

            {/* Members Tab */}
            <TabsContent value="members" className="m-0 space-y-6 outline-none">
              <div className="pb-2">
                <h3 className="text-xl font-bold text-zinc-100">Members</h3>
              </div>

              <Tabs defaultValue="list" className="w-full space-y-6">
                  <TabsList className="bg-transparent h-10 p-0 gap-8 justify-start border-b border-zinc-800/30 w-full rounded-none">
                    <TabsTrigger
                      value="list"
                      className="data-[state=active]:!bg-transparent data-[state=active]:text-white data-[state=active]:!shadow-none border-b-2 border-transparent data-[state=active]:border-blue-500 rounded-none h-full px-0 text-sm font-medium text-zinc-500 transition-all hover:text-zinc-300 data-[state=active]:font-bold"
                    >
                      Members
                    </TabsTrigger>
                    {canDelete && (
                      <TabsTrigger
                        value="invitations"
                        className="data-[state=active]:!bg-transparent data-[state=active]:text-white data-[state=active]:!shadow-none border-b-2 border-transparent data-[state=active]:border-blue-500 rounded-none h-full px-0 text-sm font-medium text-zinc-500 transition-all hover:text-zinc-300 data-[state=active]:font-bold gap-2"
                      >
                        Invitations
                        <Badge className="bg-zinc-800 text-zinc-500 border-0 h-4.5 px-1.5 text-[10px] font-bold">{invitations.length}</Badge>
                      </TabsTrigger>
                    )}
                  </TabsList>

                <TabsContent value="list" className="m-0 space-y-6">
                  {/* Toolbar */}
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                      <Input
                        placeholder="Search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 h-9 bg-zinc-900/50 border-zinc-800 rounded-lg text-sm focus-visible:ring-blue-500/20"
                      />
                    </div>
                    <Button
                      onClick={() => setShowInviteForm(!showInviteForm)}
                      className="bg-zinc-100 hover:bg-zinc-200 text-black font-bold text-xs h-9 px-4 rounded-lg transition-all"
                    >
                      Invite
                    </Button>
                  </div>

                  {/* Invite Form */}
                  {showInviteForm && (
                    <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4 space-y-4 animate-in slide-in-from-top-2 duration-300">
                      <div className="flex flex-col md:flex-row items-end gap-3">
                        <div className="flex-1 space-y-1.5">
                          <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Invite Member</Label>
                          <Input
                            placeholder="email@example.com"
                            value={inviteEmail}
                            onChange={(e) => {
                              setInviteEmail(e.target.value)
                              setInviteError(null)
                            }}
                            className="h-9 bg-zinc-950 border-zinc-800 rounded-lg text-sm text-zinc-200 focus-visible:ring-blue-500/20"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Role</Label>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="outline" className="h-9 bg-zinc-950 border-zinc-800 rounded-lg text-xs font-bold text-zinc-400 hover:bg-zinc-900 hover:text-white px-4 w-[110px] justify-between">
                                  {inviteRole.charAt(0).toUpperCase() + inviteRole.slice(1)}
                                  <ChevronDown className="h-3 w-3 ml-2 opacity-40" />
                                </Button>
                              }
                            />
                            <DropdownMenuContent className="bg-zinc-950 border-zinc-800 text-zinc-400">
                              <DropdownMenuItem onClick={() => setInviteRole("admin")} className="text-xs font-bold hover:text-white cursor-pointer">Admin</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setInviteRole("member")} className="text-xs font-bold hover:text-white cursor-pointer">Member</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setInviteRole("viewer")} className="text-xs font-bold hover:text-white cursor-pointer">Viewer</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            onClick={() => { setShowInviteForm(false); setInviteEmail(""); setInviteError(null); }}
                            className="text-zinc-400 hover:text-white hover:bg-white/5 font-bold text-xs h-9 px-4"
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleSendInvitations}
                            disabled={isInviting || !inviteEmail.trim()}
                            className="bg-zinc-100 hover:bg-white text-black font-bold text-xs h-9 px-6 rounded-lg transition-all shadow-lg active:scale-95 disabled:opacity-40"
                          >
                            {isInviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send Invite"}
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
                  <div className="grid grid-cols-3 px-4 py-1.5 text-[9px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-900">
                    <div>User</div>
                    <div>Joined</div>
                    <div>Role</div>
                  </div>

                  {/* Member List */}
                  <div className="space-y-0 divide-y divide-zinc-900/50">
                    {Array.isArray(members) && members
                      .filter(m => {
                        const searchLower = searchQuery.toLowerCase();
                        const userName = m.user?.name?.toLowerCase() || "";
                        const userEmail = m.user?.email?.toLowerCase() || "";
                        return userName.includes(searchLower) || userEmail.includes(searchLower);
                      })
                      .map((member) => (
                        <div key={member.id} className="grid grid-cols-3 items-center px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                          <div className="flex flex-col min-w-0">
                            <p className="text-xs font-semibold text-zinc-200 truncate">
                              {member.user?.name || member.user?.email?.split('@')[0] || "Unknown User"}
                            </p>
                            <p className="text-[10px] text-zinc-500 truncate">{member.user?.email || "No email"}</p>
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                          <div>
                            <Badge className="bg-zinc-800/50 text-zinc-400 border border-zinc-800 text-[9px] font-black tracking-tight px-1.5 h-4.5 uppercase">
                              {member.role}
                            </Badge>
                          </div>
                        </div>
                      ))}

                    {members.length === 0 && (
                      <div className="py-20 text-center border border-dashed border-zinc-800 rounded-xl mt-4">
                        <p className="text-sm text-zinc-500 font-medium">No members to display</p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="invitations" className="m-0 space-y-6">
                  {invitations.length > 0 ? (
                    <>
                      {/* Table Header */}
                      <div className="grid grid-cols-12 px-4 py-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-900">
                        <div className="col-span-5">Invitee</div>
                        <div className="col-span-2">Role</div>
                        <div className="col-span-3">Status</div>
                        <div className="col-span-2 text-right">Action</div>
                      </div>

                      <div className="space-y-0 divide-y divide-zinc-900/50">
                        {invitations.map((invite) => (
                          <div key={invite.id} className="grid grid-cols-12 items-center px-4 py-4 hover:bg-white/[0.02] transition-colors group">

                            <div className="col-span-5 flex flex-col min-w-0">
                              <p className="text-xs font-semibold text-zinc-200 truncate">
                                {invite.email}
                              </p>
                            </div>

                            <div className="col-span-2">
                              <Badge className="bg-zinc-800/50 text-zinc-400 border border-zinc-800 text-[9px] font-black tracking-tight px-1.5 h-4.5 uppercase">
                                {invite.role}
                              </Badge>
                            </div>

                            <div className="col-span-3">
                              <Badge className="bg-blue-500/10 text-blue-400 border-0 text-[9px] font-bold px-1.5 h-4.5 uppercase">
                                Pending
                              </Badge>
                            </div>

                            <div className="col-span-2 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRevoke(invite.id)}
                                disabled={revokingId === invite.id}
                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 text-xs px-3 border border-red-500/20 rounded-lg"
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
                    <div className="py-20 text-center border border-dashed border-zinc-800 rounded-xl">
                      <p className="text-sm text-zinc-500 font-medium">No pending invitations</p>
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
    <AlertDialog open={confirmationType === 'leave'} onOpenChange={(isOpen) => !isOpen && setConfirmationType(null)}>
      <AlertDialogContent className="bg-white border-zinc-200 text-zinc-900 rounded-2xl p-0 sm:max-w-[400px] shadow-2xl overflow-hidden border-none">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-full">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <AlertDialogTitle className="text-xl font-bold text-zinc-900">
              Leave organization
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-zinc-500 text-[13px] leading-relaxed">
            Are you sure you want to leave <span className="text-zinc-900 font-bold">{activeOrg?.name}</span>? You will lose access to all shared resources in this workspace.
          </AlertDialogDescription>

          <div className="space-y-3 pt-2">
            <p className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">Type workspace name to confirm</p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={activeOrg?.name}
              className="bg-zinc-50/50 border-zinc-200 h-10 rounded-xl text-sm focus-visible:ring-red-500/10"
            />
          </div>
        </div>

        <div className="bg-zinc-50/50 p-4 px-6 flex justify-end gap-3 border-t border-zinc-100">
          <AlertDialogCancel className="h-9 px-4 text-zinc-500 hover:text-zinc-900 font-semibold hover:bg-transparent bg-transparent border-none shadow-none m-0">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleLeave}
            disabled={isLeaving || confirmText !== activeOrg?.name}
            className="h-9 px-4 font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-all active:scale-95 border-none m-0 rounded-lg flex items-center justify-center"
          >
            {isLeaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Leaving...
              </>
            ) : (
              "Leave Organization"
            )}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={confirmationType === 'delete'} onOpenChange={(isOpen) => !isOpen && setConfirmationType(null)}>
      <AlertDialogContent className="bg-white border-zinc-200 text-zinc-900 rounded-2xl p-0 sm:max-w-[400px] shadow-2xl overflow-hidden border-none">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-full">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <AlertDialogTitle className="text-xl font-bold text-zinc-900">
              Delete organization
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-zinc-500 text-[13px] leading-relaxed">
            Are you sure you want to delete <span className="text-zinc-900 font-bold">{activeOrg?.name}</span>? This will permanently delete all feeds, folders, and member associations.
          </AlertDialogDescription>

          <div className="space-y-3 pt-2">
            <p className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">Type workspace name to confirm</p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={activeOrg?.name}
              className="bg-zinc-50/50 border-zinc-200 h-10 rounded-xl text-sm focus-visible:ring-red-500/10"
            />
          </div>
        </div>

        <div className="bg-zinc-50/50 p-4 px-6 flex justify-end gap-3 border-t border-zinc-100">
          <AlertDialogCancel className="h-9 px-4 text-zinc-500 hover:text-zinc-900 font-semibold hover:bg-transparent bg-transparent border-none shadow-none m-0">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting || confirmText !== activeOrg?.name}
            className="h-9 px-4 font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-all active:scale-95 border-none m-0 rounded-lg flex items-center justify-center"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
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
