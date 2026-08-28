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
      <DialogContent showCloseButton className="max-w-sm border-white/10 bg-[#181818] text-white">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-white">
            New Folder
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-0.5 py-4">
          <div className="flex flex-col gap-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave()
              }}
              placeholder="Folder Name…"
              className="h-9 border-white/10 bg-white/5 text-sm text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:ring-offset-0"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2 mt-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={!isPublic ? "default" : "outline"}
                className={`h-9 w-full justify-center gap-2 ${!isPublic ? "bg-white text-black hover:bg-zinc-200" : "bg-transparent border-white/10 text-zinc-400 hover:text-white"}`}
                onClick={() => setIsPublic(false)}
              >
                <Lock className="h-4 w-4" />
                Private
              </Button>
              <Button
                variant={isPublic ? "default" : "outline"}
                className={`h-9 w-full justify-center gap-2 ${isPublic ? "bg-white text-black hover:bg-zinc-200" : "bg-transparent border-white/10 text-zinc-400 hover:text-white"}`}
                onClick={() => setIsPublic(true)}
              >
                <Globe className="h-4 w-4" />
                Public
              </Button>
            </div>
            <p className="text-[11px] text-zinc-500 text-center">
              {!isPublic
                ? "Only you and people with password can view this folder"
                : "Anyone with the link can view this folder"}
            </p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter className="border-t border-white/5 bg-transparent pt-3">
          <Button
            variant="ghost"
            onClick={() => handleClose(false)}
            className="h-8 text-xs text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="h-8 bg-white px-5 text-xs font-semibold text-black hover:bg-zinc-200"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
