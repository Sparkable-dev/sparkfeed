import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Camera,
  Check,
  ExternalLink,
  Home,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { useDemoAwareSession } from "@/hooks/useDemoAwareSession"
import { DEMO_MODE } from "@/lib/demo"
import { useWorkspaceCreationPermission } from "@/hooks/use-workspace-creation-permission"
import { requestPasswordReset } from "@/server/email-actions"
import { personalWorkspaceName } from "@/lib/workspaces"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
// Tabs removed
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
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
// Select removed
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
import { AppTopBar } from "@/components/layout/AppTopBar"
import { PersonalBillingTab } from "@/components/settings/PersonalBillingTab"

export const Route = createFileRoute("/_protected/settings")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      tab: (search.tab as string) || "profile",
    }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { data: session, isPending } = useDemoAwareSession()
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const setActiveTab = (newTab: string) => {
    navigate({ to: ".", search: { tab: newTab } } as any)
  }

  const activeTab = tab || "profile"

  if (!mounted || isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const tabLabel =
    activeTab === "workspaces"
      ? "Workspaces"
      : activeTab === "billing"
        ? "Billing"
        : activeTab === "security"
          ? "Security"
          : "Profile"

  return (
    /*
      The two-pane layout below is unchanged; it is just wrapped so the app's
      top bar sits above it. No sidebar trigger — this page has its own left
      pane and no app sidebar to toggle.
    */
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppTopBar
        crumbs={[
          { label: "Home", href: "/", icon: Home },
          { label: "Settings" },
          { label: tabLabel },
        ]}
        showSidebarTrigger={false}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* SIDEBAR NAVIGATION (240px Fixed) */}
        <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ to: "/" })}
              className="mb-4 -ml-2 gap-2 text-muted-foreground hover:text-foreground"
            >
              <Home className="size-4" />
              Back to home
            </Button>
            <h2 className="text-[17px] font-bold text-foreground">Settings</h2>
            <p className="mt-1 text-[11px] font-medium text-muted-foreground">
              Manage your account and workspaces
            </p>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-4">
            <MenuButton
              label="Profile"
              isActive={activeTab === "profile"}
              onClick={() => setActiveTab("profile")}
            />
            <MenuButton
              label="Workspaces"
              isActive={activeTab === "workspaces"}
              onClick={() => setActiveTab("workspaces")}
            />
            <MenuButton
              label="Security"
              isActive={activeTab === "security"}
              onClick={() => setActiveTab("security")}
            />
            <MenuButton
              label="Billing"
              isActive={activeTab === "billing"}
              onClick={() => setActiveTab("billing")}
            />
          </nav>
        </aside>

        {/* MAIN CONTENT AREA */}
        <main className="flex-1 overflow-y-auto bg-background">
          {DEMO_MODE && (
            <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-6 py-3 text-sm text-amber-400">
              <Lock className="h-4 w-4 shrink-0" />
              Demo Mode — settings are read-only. Sign up for a free account to
              manage your profile.
            </div>
          )}
          <div className="mx-auto max-w-4xl space-y-10 p-10">
            {activeTab === "profile" && <ProfileTab session={session} />}
            {activeTab === "workspaces" && <WorkspacesTab />}
            {activeTab === "security" && <SecurityTab />}
            {activeTab === "billing" && <PersonalBillingTab />}
          </div>
        </main>
      </div>
    </div>
  )
}

function MenuButton({
  label,
  isActive,
  onClick,
}: {
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg px-4 py-2.5 text-left text-sm font-bold transition-colors ${
        isActive
          ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
          : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )
}

/* --- VARIATION 1: PROFILE TAB (DYNAMIC) --- */
function ProfileTab({ session }: { session: any }) {
  const initialFirstName = session?.user?.name?.split(" ")[0] || ""
  const initialLastName =
    session?.user?.name?.split(" ").slice(1).join(" ") || ""
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [bio, setBio] = useState("")
  const [loading, setLoading] = useState(false)
  const [isRequestingReset, setIsRequestingReset] = useState(false)

  const isDirty =
    firstName !== initialFirstName || lastName !== initialLastName || bio !== ""

  const handleUpdate = async () => {
    setLoading(true)
    try {
      await authClient.updateUser({ name: `${firstName} ${lastName}`.trim() })
      toast.success("Profile updated successfully")
    } catch {
      toast.error("Failed to update profile")
    } finally {
      setLoading(false)
    }
  }

  const handleRequestReset = async () => {
    if (!session?.user?.email) return
    setIsRequestingReset(true)
    try {
      await requestPasswordReset({ data: session.user.email })
      toast.success("Password reset email sent!")
    } catch {
      toast.error("Failed to send reset email")
    } finally {
      setIsRequestingReset(false)
    }
  }

  return (
    <div className="animate-in space-y-8 transition-all duration-300 fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Profile
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update your personal information and preferences
        </p>
      </div>

      <Card className="border-border shadow-sm">
        <CardContent className="pt-6">
          <Label className="mb-4 block text-sm font-bold text-foreground">
            Profile picture
          </Label>
          <div className="flex items-center gap-6">
            <Avatar className="h-20 w-20 border-2 border-border shadow-sm">
              <AvatarImage src={session?.user?.image} />
              <AvatarFallback className="bg-muted text-2xl font-bold text-foreground">
                {session?.user?.name?.[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                {session?.user?.email}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-9 rounded-md border-border px-4 text-xs font-bold"
              >
                <Camera className="mr-2 h-3.5 w-3.5" /> Upload picture
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardContent className="space-y-6 pt-6">
          <Label className="block text-sm font-bold text-foreground">
            Personal information
          </Label>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                First Name
              </Label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="border-border bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                Last Name
              </Label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="border-border bg-background"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              Email address
            </Label>
            <Input
              value={session?.user?.email}
              className="cursor-not-allowed border-border bg-muted"
              disabled
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              Bio
            </Label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="flex min-h-[100px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              placeholder="Tell us about yourself..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleUpdate}
              disabled={loading || !isDirty || DEMO_MODE}
              className="bg-blue-600 px-6 font-bold text-white hover:bg-blue-700"
            >
              {loading ? "Saving..." : "Save changes"}
            </Button>
            <Button
              variant="outline"
              className="border-border px-6 font-bold"
              onClick={() => {
                setFirstName(initialFirstName)
                setLastName(initialLastName)
                setBio("")
              }}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardContent className="space-y-6 pt-6">
          <Label className="block text-sm font-bold text-foreground">
            Preferences
          </Label>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-foreground">
                Email notifications
              </p>
              <p className="text-xs text-muted-foreground">
                Receive updates about your workspaces
              </p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator className="bg-border/50" />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-foreground">Dark mode</p>
              <p className="text-xs text-muted-foreground">
                Use dark theme across the app
              </p>
            </div>
            <Switch />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <Label className="block text-sm font-bold text-foreground">
            Security
          </Label>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Receive a link to reset your password via email
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRequestReset}
              disabled={isRequestingReset || DEMO_MODE}
              className="border-border font-bold"
            >
              {isRequestingReset ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Reset Password
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border-red-500/20 bg-red-500/5">
        <CardContent className="flex items-center justify-between pt-6">
          <div className="space-y-1">
            <p className="text-sm font-bold text-red-600">Delete Account</p>
            <p className="text-xs text-muted-foreground">
              Permanently delete your account and all associated RSS feeds.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="destructive"
                  className="font-bold"
                  disabled={DEMO_MODE}
                >
                  Delete
                </Button>
              }
            />
            <AlertDialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-bold text-red-500">
                  Delete Account Permanently
                </AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-400">
                  Are you absolutely sure? This will delete your profile, all
                  your workspaces, and all your RSS feeds. This action is
                  irreversible.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    try {
                      const { error } = await authClient.deleteUser()
                      if (error) throw error
                      toast.success("Account deleted")
                      window.location.href = "/login"
                    } catch (err: any) {
                      console.error("Delete user error:", err)
                      toast.error(err.message || "Failed to delete account")
                    }
                  }}
                  className="bg-red-600 font-bold text-white hover:bg-red-700"
                >
                  Delete Account
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}

/* --- VARIATION 2: WORKSPACES TAB (MANDATED DESIGN) --- */
function WorkspacesTab() {
  const { data: session } = authClient.useSession()
  const { data: orgs, isPending } = authClient.useListOrganizations()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newOrgName, setNewOrgName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const workspaceCreation = useWorkspaceCreationPermission()

  const handleCreateWorkspace = async () => {
    if (!newOrgName) return
    setIsCreating(true)
    try {
      await authClient.organization.create({
        name: newOrgName,
        slug: newOrgName.toLowerCase().replace(/\s+/g, "-"),
      })
      toast.success("Workspace created successfully")
      setIsCreateDialogOpen(false)
      setNewOrgName("")
    } catch (error) {
      toast.error("Failed to create workspace")
    } finally {
      setIsCreating(false)
    }
  }

  const handleSwitch = async (id: string | null) => {
    try {
      await authClient.organization.setActive({
        organizationId: id,
      })
      toast.success(id ? "Switched workspace" : "Switched to Personal")
      window.location.href = "/"
    } catch (e) {
      toast.error("Failed to switch workspace")
    }
  }

  if (isPending) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="animate-in space-y-8 transition-all duration-300 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Workspaces
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your workspaces
          </p>
        </div>
        {workspaceCreation.allowed ? (
          <Dialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
          >
            <DialogTrigger
              render={
                <Button
                  className="flex h-10 items-center gap-2 rounded-xl border-0 bg-white px-5 font-bold text-black shadow-sm transition-all hover:bg-zinc-200"
                  disabled={DEMO_MODE}
                  onClick={
                    DEMO_MODE
                      ? (e) => {
                          e.preventDefault()
                          toast.warning("Feature locked in demo mode")
                        }
                      : undefined
                  }
                >
                  <Plus className="h-4 w-4" />
                  Create Workspace
                </Button>
              }
            />
            <DialogContent className="rounded-2xl border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">
                  Create Workspace
                </DialogTitle>
                <DialogDescription className="text-zinc-400">
                  Give your new workspace a name. You can invite team members
                  later.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="name"
                    className="text-sm font-bold text-zinc-300"
                  >
                    Workspace Name
                  </Label>
                  <Input
                    id="name"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="e.g. Engineering Team"
                    className="h-11 border-zinc-800 bg-zinc-900 focus:ring-zinc-700"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreateWorkspace}
                  disabled={isCreating || !newOrgName}
                  className="h-11 w-full rounded-xl bg-zinc-100 font-bold text-zinc-950 hover:bg-zinc-200"
                >
                  {isCreating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Create Workspace
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <div className="grid gap-3">
        {/* PERSONAL WORKSPACE CARD (Always shown) */}
        <WorkspaceCard
          name={personalWorkspaceName(session?.user?.name)}
          slug="personal"
          role="Owner"
          isPersonal
          memberCount={1}
          feedCount={4}
          isActive={!activeOrg}
          onClick={() => handleSwitch(null)}
        />

        {/* DYNAMIC ORGANIZATION CARDS */}
        {orgs?.map((org) => (
          <WorkspaceCard
            key={org.id}
            id={org.id}
            name={org.name}
            slug={org.slug}
            role="Owner"
            memberCount={2}
            feedCount={5}
            isActive={activeOrg?.id === org.id}
            onClick={() => handleSwitch(org.id)}
          />
        ))}

        {/* FALLBACK IF NO ORGS EXIST */}
        {(!orgs || orgs.length === 0) && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-12">
            <Settings className="mb-4 h-10 w-10 text-zinc-700" />
            <h3 className="font-bold text-zinc-300">No workspaces yet</h3>
            <p className="mt-1 mb-6 text-sm text-zinc-500">
              Create a workspace to collaborate with others
            </p>
            <Button
              onClick={() => setIsCreateDialogOpen(true)}
              className="h-9 rounded-lg bg-zinc-800 px-4 text-xs font-bold text-white hover:bg-zinc-700"
            >
              Create your first workspace
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function WorkspaceCard({
  id,
  name,
  slug,
  role,
  memberCount,
  feedCount,
  isPersonal = false,
  isActive = false,
  onClick,
}: {
  id?: string
  name: string
  slug: string
  role: string
  memberCount: number
  feedCount: number
  isPersonal?: boolean
  isActive?: boolean
  onClick: () => void
}) {
  const navigate = useNavigate()
  const isOwner = role.toLowerCase() === "owner"
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false)
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [newName, setNewName] = useState(name)
  const [isRenaming, setIsRenaming] = useState(false)

  return (
    <>
      <Card
        className={`group relative cursor-pointer overflow-hidden rounded-xl border transition-all duration-200 ${
          isActive
            ? "border-blue-500/30 bg-zinc-900 ring-1 ring-blue-500/20"
            : "border-zinc-800/40 bg-transparent hover:border-zinc-700 hover:bg-zinc-900/40"
        }`}
        onClick={onClick}
      >
        {isActive && (
          <div className="absolute top-0 bottom-0 left-0 w-1 bg-blue-500" />
        )}
        <CardContent className="flex items-center justify-between p-3.5 px-4">
          <div
            className="flex items-center gap-3.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Avatar className={`h-9 w-9 border border-black shadow-sm`}>
              <AvatarFallback
                className={`text-xs font-bold text-white ${isOwner ? "bg-purple-600" : "bg-zinc-700"}`}
              >
                {name[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight text-foreground">
                  {name}
                </h3>
                {isActive && (
                  <Badge className="flex h-4 items-center gap-1 border-0 bg-blue-500/10 px-1.5 text-[9px] font-bold text-blue-500">
                    <Check className="h-2.5 w-2.5" />
                    ACTIVE
                  </Badge>
                )}
                <Badge
                  variant="secondary"
                  className={`h-4 border-0 px-1.5 py-0 text-[9px] font-bold tracking-wider uppercase ${isOwner ? "bg-purple-500/10 text-purple-400" : "bg-zinc-800 text-zinc-400"}`}
                >
                  {role}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60">
                <span>{isPersonal ? "Personal Account" : `@${slug}`}</span>
                <span className="opacity-40">·</span>
                <span>{memberCount} members</span>
                <span className="opacity-40">·</span>
                <span>{feedCount} feeds</span>
              </div>
            </div>
          </div>

          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-muted-foreground transition-all hover:bg-zinc-800 hover:text-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                }
              />
              <DropdownMenuContent
                align="end"
                className="w-56 rounded-xl border-zinc-800 bg-zinc-950 p-1.5 shadow-2xl"
              >
                <DropdownMenuItem
                  onClick={() => {
                    onClick()
                    navigate({ to: "/" })
                  }}
                  className="cursor-pointer gap-2.5 rounded-lg p-2.5 transition-colors focus:bg-zinc-900"
                >
                  <ExternalLink className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium">Open Workspace</span>
                </DropdownMenuItem>

                {!isPersonal && (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        navigate({
                          to: "/workspaces/$slug/settings",
                          params: { slug: slug },
                        } as any)
                      }
                      className="cursor-pointer gap-2.5 rounded-lg p-2.5 transition-colors focus:bg-zinc-900"
                    >
                      <Settings className="h-4 w-4 text-zinc-400" />
                      <span className="text-sm font-medium">
                        Workspace Settings
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (!DEMO_MODE) setIsRenameDialogOpen(true)
                        else toast.warning("Feature locked in demo mode")
                      }}
                      className="cursor-pointer gap-2.5 rounded-lg p-2.5 transition-colors focus:bg-zinc-900"
                    >
                      <Pencil className="h-4 w-4 text-zinc-400" />
                      <span className="text-sm font-medium">
                        Rename Workspace
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1 bg-zinc-900" />
                    {isOwner ? (
                      <DropdownMenuItem
                        onClick={() => {
                          if (!DEMO_MODE) setIsDeleteDialogOpen(true)
                          else toast.warning("Feature locked in demo mode")
                        }}
                        className="group/delete cursor-pointer gap-2.5 rounded-lg p-2.5 text-red-500 transition-colors focus:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4 transition-colors group-hover/delete:text-red-400" />
                        <span className="text-sm font-bold">
                          Delete Workspace
                        </span>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() => {
                          if (!DEMO_MODE) setIsLeaveDialogOpen(true)
                          else toast.warning("Feature locked in demo mode")
                        }}
                        className="cursor-pointer gap-2.5 rounded-lg p-2.5 text-yellow-500 transition-colors focus:bg-yellow-500/10"
                      >
                        <LogOut className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          Leave Workspace
                        </span>
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-bold text-red-500">
              Delete Workspace Permanently
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              Are you absolutely sure you want to delete{" "}
              <span className="font-bold text-white">{name}</span>? This action
              will permanently remove all members, feeds, and data associated
              with this workspace.{" "}
              <span className="font-bold text-red-500/80">
                This cannot be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  if (!id) return
                  await authClient.organization.delete({
                    organizationId: id,
                  })
                  toast.success("Workspace deleted")
                  setIsDeleteDialogOpen(false)
                  // Refresh to update the organizations list
                  window.location.reload()
                } catch (e) {
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

      <AlertDialog open={isLeaveDialogOpen} onOpenChange={setIsLeaveDialogOpen}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-bold text-yellow-500">
              Leave Workspace
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              Are you sure you want to leave{" "}
              <span className="font-bold text-white">{name}</span>? You will
              lose access to all shared feeds and resources in this workspace
              immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  if (!id) return
                  await authClient.organization.leave({
                    organizationId: id,
                  })
                  toast.success("Left workspace")
                  setIsLeaveDialogOpen(false)
                } catch (e) {
                  toast.error("Failed to leave workspace")
                }
              }}
              className="bg-yellow-600 font-bold text-white hover:bg-yellow-700"
            >
              Leave Workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent className="rounded-2xl border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              Rename Workspace
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              Enter a new name for your workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label
                htmlFor="rename-name"
                className="text-sm font-bold text-zinc-300"
              >
                Workspace Name
              </Label>
              <Input
                id="rename-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-11 border-zinc-800 bg-zinc-900 focus:ring-zinc-700"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                if (!id || !newName) return
                setIsRenaming(true)
                try {
                  await authClient.organization.update({
                    organizationId: id,
                    data: {
                      name: newName,
                    },
                  })
                  toast.success("Workspace renamed successfully")
                  setIsRenameDialogOpen(false)
                  window.location.reload()
                } catch (error) {
                  toast.error("Failed to rename workspace")
                } finally {
                  setIsRenaming(false)
                }
              }}
              disabled={isRenaming || !newName || newName === name}
              className="h-11 w-full rounded-xl bg-zinc-100 font-bold text-zinc-950 hover:bg-zinc-200"
            >
              {isRenaming ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* --- SECURITY TAB (DYNAMIC) --- */
function SecurityTab() {
  const [sessions, setSessions] = useState<Array<any>>([])

  useEffect(() => {
    authClient.listSessions().then((res) => {
      if (res.data) setSessions(res.data)
    })
  }, [])

  const handleRevoke = async (id: string) => {
    try {
      await authClient.revokeSession({ token: id })
      toast.success("Session revoked")
    } catch {
      toast.error("Failed to revoke session")
    }
  }

  return (
    <div className="animate-in space-y-8 transition-all duration-300 fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Security
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your active sessions and device security
        </p>
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-bold">Active Sessions</CardTitle>
          <CardDescription>
            Devices currently logged into your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessions?.map((s: any) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4"
            >
              <div className="flex items-center gap-4">
                <Monitor
                  className={`h-5 w-5 ${s.isCurrent ? "text-blue-500" : "text-muted-foreground"}`}
                />
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold">
                    {s.userAgent || "Unknown Device"}
                    {s.isCurrent && (
                      <Badge className="h-5 border-0 bg-blue-500/10 px-2 text-[10px] font-bold text-blue-500">
                        CURRENT
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.ipAddress} • Last active{" "}
                    {new Date(s.updatedAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
              {!s.isCurrent && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRevoke(s.id)}
                  className="text-muted-foreground hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
