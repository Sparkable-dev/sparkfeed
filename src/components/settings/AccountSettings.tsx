import { useEffect, useRef, useState } from "react"
import { AlertTriangle, BellRing, Camera, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { DEMO_MODE } from "@/lib/demo"
import {
  getAccountDeletionState,
  getAccountNotificationPreferences,
  updateAccountNotificationPreferences,
} from "@/server/account-actions"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
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

interface AccountSettingsProps {
  session: any
}

interface OwnedWorkspace {
  id: string
  name: string
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function AccountSettings({ session }: AccountSettingsProps) {
  const user = session?.user
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initialName = user?.name?.trim() || ""
  const [savedName, setSavedName] = useState(initialName)
  const [name, setName] = useState(initialName)
  const [image, setImage] = useState<string | null>(user?.image || null)
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [notificationPreferences, setNotificationPreferences] = useState({
    workspaceActivity: true,
    productUpdates: false,
  })
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true)
  const [savingNotification, setSavingNotification] = useState<
    "workspaceActivity" | "productUpdates" | null
  >(null)
  const [ownedWorkspaces, setOwnedWorkspaces] = useState<Array<OwnedWorkspace>>(
    []
  )
  const [isLoadingDeletionState, setIsLoadingDeletionState] = useState(true)
  const [deletionStateError, setDeletionStateError] = useState(false)
  const [personalPlusActive, setPersonalPlusActive] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const isDirty = name.trim() !== savedName || pendingImage !== null
  const deletionBlocked =
    isLoadingDeletionState ||
    deletionStateError ||
    personalPlusActive ||
    ownedWorkspaces.length > 0

  useEffect(() => {
    let cancelled = false

    if (DEMO_MODE) {
      setIsLoadingDeletionState(false)
    } else {
      getAccountDeletionState()
        .then((result) => {
          if (cancelled) return
          setOwnedWorkspaces(result.ownedWorkspaces)
          setPersonalPlusActive(result.personalPlusActive)
          setDeletionStateError(false)
        })
        .catch(() => {
          if (!cancelled) setDeletionStateError(true)
        })
        .finally(() => {
          if (!cancelled) setIsLoadingDeletionState(false)
        })
    }

    if (DEMO_MODE) {
      setIsLoadingNotifications(false)
    } else {
      getAccountNotificationPreferences()
        .then((preferences) => {
          if (!cancelled) setNotificationPreferences(preferences)
        })
        .catch(() => {
          if (!cancelled)
            toast.error("We couldn't load your notification settings.")
        })
        .finally(() => {
          if (!cancelled) setIsLoadingNotifications(false)
        })
    }

    return () => {
      cancelled = true
    }
  }, [])

  const handleImageChange = (file?: File) => {
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Choose a JPG, PNG, or WebP image.")
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Choose an image smaller than 2 MB.")
      return
    }

    const reader = new FileReader()
    reader.onload = () => setPendingImage(String(reader.result))
    reader.onerror = () => toast.error("We couldn't read that image.")
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    const nextName = name.trim()
    if (!nextName) {
      toast.error("Enter your name.")
      return
    }

    setIsSaving(true)
    try {
      const result = await authClient.updateUser({
        name: nextName,
        ...(pendingImage ? { image: pendingImage } : {}),
      })
      if (result.error) throw new Error(result.error.message)
      setSavedName(nextName)
      if (pendingImage) setImage(pendingImage)
      setPendingImage(null)
      toast.success("Profile updated")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "We couldn't update your profile."
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setName(savedName)
    setPendingImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleNotificationChange = async (
    key: "workspaceActivity" | "productUpdates",
    value: boolean
  ) => {
    const previous = notificationPreferences
    const next = { ...previous, [key]: value }
    setNotificationPreferences(next)
    setSavingNotification(key)
    try {
      await updateAccountNotificationPreferences({ data: next })
    } catch {
      setNotificationPreferences(previous)
      toast.error("We couldn't save your notification settings.")
    } finally {
      setSavingNotification(null)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const result = await authClient.deleteUser()
      if (result.error) throw new Error(result.error.message)
      toast.success("Account deleted")
      window.location.href = "/sign-in"
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "We couldn't delete your account."
      )
      setIsDeleting(false)
    }
  }

  return (
    <div className="animate-in space-y-7 duration-300 fade-in">
      <Card className="gap-0 overflow-hidden py-0 shadow-sm">
        <CardHeader className="border-b px-5 py-4 sm:px-6">
          <h1 className="font-semibold">Profile</h1>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
            <form
              className="space-y-5 p-5 sm:p-6 lg:border-r"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSave()
              }}
            >
              <Field className="gap-1.5">
                <FieldLabel htmlFor="account-name">Full name</FieldLabel>
                <Input
                  id="account-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  disabled={DEMO_MODE}
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="account-email">Email address</FieldLabel>
                <Input
                  id="account-email"
                  value={user?.email || ""}
                  disabled
                  className="bg-muted/50"
                />
                <FieldDescription>
                  Used to sign in. It cannot be changed here.
                </FieldDescription>
              </Field>
            </form>

            <aside
              className="flex flex-col items-center justify-center bg-muted/15 p-6 text-center"
              onDragOver={(event) => {
                if (!DEMO_MODE) event.preventDefault()
              }}
              onDrop={(event) => {
                if (DEMO_MODE) return
                event.preventDefault()
                handleImageChange(event.dataTransfer.files?.[0])
              }}
            >
              <input
                ref={fileInputRef}
                id="account-avatar"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => handleImageChange(event.target.files?.[0])}
                disabled={DEMO_MODE}
              />
              <div className="flex flex-col items-center text-center">
                <button
                  type="button"
                  className="group relative rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={DEMO_MODE}
                  aria-label="Change profile picture"
                >
                  <Avatar className="size-24 rounded-2xl border bg-background shadow-sm transition group-hover:brightness-75 group-focus-visible:brightness-75">
                    <AvatarImage src={pendingImage || image || ""} alt={name} />
                    <AvatarFallback className="rounded-2xl text-2xl font-semibold">
                      {initials(name || user?.email || "S")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/70 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Camera className="mr-1.5 size-4" />
                    Change
                  </span>
                </button>
                <p className="mt-4 font-semibold">{name || "Your name"}</p>
                <p className="mt-1 text-sm break-all text-muted-foreground">
                  {user?.email}
                </p>
                <p className="mt-4 max-w-56 text-xs leading-5 text-muted-foreground">
                  Drop or select a JPG, PNG, or WebP. Maximum 2 MB.
                </p>
              </div>
            </aside>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col-reverse items-stretch justify-end gap-2 border-t bg-muted/15 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
          <Button
            variant="ghost"
            onClick={handleReset}
            disabled={!isDirty || isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!isDirty || isSaving || DEMO_MODE}
          >
            {isSaving && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </CardFooter>
      </Card>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-start gap-3 border-b px-5 py-4 sm:px-6">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <BellRing className="size-4" />
          </div>
          <div>
            <h2 className="font-semibold">Notifications</h2>
          </div>
        </div>
        <div className="divide-y">
          <div className="flex items-start justify-between gap-5 px-5 py-4 sm:items-center sm:px-6">
            <div>
              <label
                htmlFor="workspace-activity-notifications"
                className="text-sm font-medium"
              >
                Workspace activity
              </label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Invitations and workspace updates.
              </p>
            </div>
            <Switch
              id="workspace-activity-notifications"
              checked={notificationPreferences.workspaceActivity}
              onCheckedChange={(checked) =>
                void handleNotificationChange("workspaceActivity", checked)
              }
              disabled={
                DEMO_MODE ||
                isLoadingNotifications ||
                savingNotification !== null
              }
              aria-label="Workspace activity emails"
            />
          </div>
          <div className="flex items-start justify-between gap-5 px-5 py-4 sm:items-center sm:px-6">
            <div>
              <label
                htmlFor="product-update-notifications"
                className="text-sm font-medium"
              >
                Product updates
              </label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                New features and improvements.
              </p>
            </div>
            <Switch
              id="product-update-notifications"
              checked={notificationPreferences.productUpdates}
              onCheckedChange={(checked) =>
                void handleNotificationChange("productUpdates", checked)
              }
              disabled={
                DEMO_MODE ||
                isLoadingNotifications ||
                savingNotification !== null
              }
              aria-label="Product update emails"
            />
          </div>
        </div>
        <p className="border-t bg-muted/15 px-5 py-3 text-xs leading-5 text-muted-foreground sm:px-6">
          Security and billing emails stay on.
        </p>
      </section>

      <section className="overflow-hidden rounded-xl border border-destructive/25 bg-destructive/[0.025]">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              <h2 className="font-semibold">Delete account</h2>
            </div>
            {isLoadingDeletionState ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Checking your workspaces…
              </p>
            ) : deletionStateError ? (
              <p className="mt-2 text-sm text-destructive">
                We couldn't verify your workspaces. Reload the page before
                trying again.
              </p>
            ) : personalPlusActive ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Cancel Personal+ and wait for your personal workspace to return
                to Free before deleting your account. This prevents a provider
                subscription from continuing after the account is gone.
              </p>
            ) : ownedWorkspaces.length > 0 ? (
              <div className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
                <p>
                  You must assign another owner or delete these workspaces
                  before you can delete your account. Leave any other team
                  workspaces you no longer need.
                </p>
                <ul className="list-disc pl-5 text-foreground">
                  {ownedWorkspaces.map((workspace) => (
                    <li key={workspace.id}>{workspace.name}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Deletes your account and personal workspace. Team workspaces
                stay intact.
              </p>
            )}
          </div>

          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="destructive"
                  disabled={deletionBlocked || DEMO_MODE}
                  className="w-full shrink-0 sm:w-auto"
                >
                  Delete account
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your personal workspace and account data will be permanently
                  deleted. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void handleDelete()}
                  disabled={isDeleting}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  {isDeleting && <Loader2 className="size-4 animate-spin" />}
                  Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </div>
  )
}
