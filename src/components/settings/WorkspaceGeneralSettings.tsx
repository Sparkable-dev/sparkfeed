import { useEffect, useRef, useState } from "react"
import { ImagePlus, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { WorkspaceDetail } from "@/server/workspace-management"
import { DEMO_MODE } from "@/lib/demo"
import {
  deleteWorkspace,
  updateWorkspaceIdentity,
} from "@/server/workspace-management"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function initials(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

async function logoDataUrl(file: File): Promise<string> {
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
    throw new Error("Use a PNG, JPG, or WebP image.")
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("The image must be 2 MB or smaller.")
  }
  if (typeof createImageBitmap === "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error("Could not read the image."))
      reader.readAsDataURL(file)
    })
  }
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not process the image.")
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL("image/webp", 0.86)
}

export function WorkspaceGeneralSettings({
  workspace,
  onUpdated,
  onDeleted,
}: {
  workspace: WorkspaceDetail
  onUpdated: (slug: string) => Promise<void> | void
  onDeleted: () => Promise<void> | void
}) {
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  const [logo, setLogo] = useState(workspace.logo || "")
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(workspace.name)
    setSlug(workspace.slug)
    setLogo(workspace.logo || "")
  }, [workspace])

  const chooseLogo = async (file?: File) => {
    if (!file) return
    setBusy("logo")
    try {
      setLogo(await logoDataUrl(file))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not use that image."
      )
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy("save")
    try {
      const result = await updateWorkspaceIdentity({
        data: {
          organizationId: workspace.id,
          name,
          slug,
          logo,
        },
      })
      toast.success("Workspace updated.")
      await onUpdated(result.slug)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update workspace."
      )
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy("delete")
    try {
      await deleteWorkspace({
        data: { organizationId: workspace.id, confirmation },
      })
      toast.success("Workspace deleted.")
      await onDeleted()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete workspace."
      )
    } finally {
      setBusy(null)
    }
  }

  const dirty =
    name !== workspace.name ||
    slug !== workspace.slug ||
    logo !== (workspace.logo || "")
  const planMustEnd =
    (workspace.plan === "pro" || workspace.plan === "enterprise") &&
    workspace.billingStatus !== "canceled"

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-5 p-5 sm:p-6">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Name</Label>
              <Input
                id="workspace-name"
                value={name}
                disabled={DEMO_MODE}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-slug">Workspace URL</Label>
              <div className="flex items-center rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/20">
                <span className="shrink-0 pl-3 text-sm text-muted-foreground">
                  /settings/workspaces/
                </span>
                <input
                  id="workspace-slug"
                  value={slug}
                  disabled={DEMO_MODE}
                  onChange={(event) =>
                    setSlug(event.target.value.toLowerCase())
                  }
                  maxLength={48}
                  className="h-9 min-w-0 flex-1 bg-transparent px-1 pr-3 text-sm outline-none"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens.
              </p>
            </div>
          </div>

          <div className="border-t p-5 sm:p-6 md:border-t-0 md:border-l">
            <Label>Logo</Label>
            <button
              type="button"
              disabled={DEMO_MODE}
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                void chooseLogo(event.dataTransfer.files[0])
              }}
              className="mt-3 flex w-full flex-col items-center rounded-xl border border-dashed p-5 text-center transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Avatar className="size-20 rounded-2xl border">
                <AvatarImage src={logo || undefined} alt="" />
                <AvatarFallback className="rounded-2xl text-lg font-semibold">
                  {busy === "logo" ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    initials(name || workspace.name)
                  )}
                </AvatarFallback>
              </Avatar>
              <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium">
                <ImagePlus className="size-4" />
                Drop or choose an image
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                PNG, JPG, or WebP. Maximum 2 MB.
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void chooseLogo(event.target.files?.[0])}
            />
            {logo ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full text-muted-foreground"
                disabled={DEMO_MODE}
                onClick={() => setLogo("")}
              >
                Remove logo
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4 sm:px-6">
          <Button
            variant="ghost"
            disabled={!dirty || busy !== null}
            onClick={() => {
              setName(workspace.name)
              setSlug(workspace.slug)
              setLogo(workspace.logo || "")
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={
              DEMO_MODE || !dirty || busy !== null || name.trim().length < 2
            }
            onClick={() => void save()}
          >
            {busy === "save" && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </section>

      {workspace.role === "owner" ? (
        <section className="rounded-xl border border-destructive/25 bg-destructive/[0.025] p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-semibold text-destructive">
                Delete workspace
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                {planMustEnd
                  ? "Request plan cancellation from Billing before deleting this workspace."
                  : "This removes its people, sources, articles, API keys, and chat history."}
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="destructive"
                    disabled={DEMO_MODE || planMustEnd || busy !== null}
                    className="w-full shrink-0 sm:w-auto"
                  >
                    <Trash2 className="size-4" />
                    Delete workspace
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Enter the workspace name to confirm. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={workspace.name}
                  aria-label="Workspace name confirmation"
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={confirmation !== workspace.name || busy !== null}
                    onClick={() => void remove()}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    {busy === "delete" && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    Delete permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>
      ) : null}
    </div>
  )
}
