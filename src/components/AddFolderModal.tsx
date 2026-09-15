import { useState } from "react"
import { Globe, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createFolder } from "@/server/rss"

/**
 * Creating an empty folder, with its sharing settings.
 *
 * Kept separate from the Add-sources dialog on purpose. That dialog creates a
 * folder as a side effect of putting feeds in it and deliberately does not ask
 * about sharing — this is the flow for someone who wants a folder itself.
 */
interface AddFolderModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The created folder. `createFolder` may return a suffixed name — "News (2)"
   * when "News" was taken — so the caller cannot assume it got what it asked
   * for.
   */
  onFolderCreated: (folder: { id: string; name: string }) => void
}

export function AddFolderModal({
  open,
  onOpenChange,
  onFolderCreated,
}: AddFolderModalProps) {
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [isPublic, setIsPublic] = useState(false)

  const handleClose = (v: boolean) => {
    if (!v) {
      setName("")
      setError("")
      setIsPublic(false)
    }
    onOpenChange(v)
  }

  const handleSave = async () => {
    if (!name.trim()) { setError("Folder name is required"); return }
    setSaving(true)
    setError("")
    try {
      const folder = await createFolder({ data: { name } })

      // Share settings. `folder.name`, not `name`: the server suffixes a name
      // that was already taken, and sharing the wrong label would show the
      // wrong title to anyone opening the link.
      await fetch("/api/folders/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: folder.id,
          folderName: folder.name,
          isShared: isPublic,
        }),
      })

      onFolderCreated(folder)
      handleClose(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create folder")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent showCloseButton className="max-w-sm border-border bg-popover text-foreground">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-foreground">
            New folder
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-0.5 py-4">
          <div className="flex flex-col gap-1">
            <Input
              aria-label="Folder name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave()
              }}
              placeholder="Folder Name…"
              className="h-9 border-border bg-muted/50 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2 mt-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={!isPublic ? "default" : "outline"}
                className={`h-9 w-full justify-center gap-2 ${!isPublic ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-transparent border-border text-muted-foreground hover:text-foreground"}`}
                aria-pressed={!isPublic}
                onClick={() => setIsPublic(false)}
              >
                <Lock className="h-4 w-4" />
                Private
              </Button>
              <Button
                variant={isPublic ? "default" : "outline"}
                className={`h-9 w-full justify-center gap-2 ${isPublic ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-transparent border-border text-muted-foreground hover:text-foreground"}`}
                aria-pressed={isPublic}
                onClick={() => setIsPublic(true)}
              >
                <Globe className="h-4 w-4" />
                Public
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              {!isPublic
                ? "Only you and people with password can view this folder"
                : "Anyone with the link can view this folder"}
            </p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter className="border-t border-border bg-transparent pt-3">
          <Button
            variant="ghost"
            onClick={() => handleClose(false)}
            className="h-8 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="h-8 bg-primary px-5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
