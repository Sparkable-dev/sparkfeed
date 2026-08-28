import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { deleteFeed, updateFeed } from "@/server/rss"
import { UNFILED_DESTINATION } from "@/lib/unfiled"

interface Folder {
  id: string
  name: string
}

interface Feed {
  id: string
  name: string
  url: string
  folderId: string | null
  includeKeywords?: string | null
  excludeKeywords?: string | null
}

interface EditFeedModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: Array<Folder>
  onFeedUpdated: () => void
  editingFeed: Feed | null
}

export function EditFeedModal({
  open,
  onOpenChange,
  folders,
  onFeedUpdated,
  editingFeed,
}: EditFeedModalProps) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [folderId, setFolderId] = useState<string | null>(null)
  const [includeInput, setIncludeInput] = useState("")
  const [excludeInput, setExcludeInput] = useState("")
  const [includeKeywords, setIncludeKeywords] = useState<Array<string>>([])
  const [excludeKeywords, setExcludeKeywords] = useState<Array<string>>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open && editingFeed) {
      setName(editingFeed.name)
      setUrl(editingFeed.url)
      setFolderId(editingFeed.folderId)
      try {
        setIncludeKeywords(editingFeed.includeKeywords ? JSON.parse(editingFeed.includeKeywords) : [])
        setExcludeKeywords(editingFeed.excludeKeywords ? JSON.parse(editingFeed.excludeKeywords) : [])
      } catch {
        setIncludeKeywords([])
        setExcludeKeywords([])
      }
    }
  }, [open, editingFeed])

  const reset = () => {
    setName("")
    setUrl("")
    setFolderId(null)
    setIncludeInput("")
    setExcludeInput("")
    setIncludeKeywords([])
    setExcludeKeywords([])
    setError("")
  }

  const handleClose = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const addKeyword = (
    input: string,
    setInput: (v: string) => void,
    list: Array<string>,
    setList: (v: Array<string>) => void
  ) => {
    const kw = input.trim()
    if (kw && !list.includes(kw)) setList([...list, kw])
    setInput("")
  }

  const handleSave = async () => {
    if (!editingFeed) return
    if (!name.trim()) { setError("Feed name is required"); return }
    if (!url.trim()) { setError("Feed URL is required"); return }
    setSaving(true)
    setError("")
    try {
      const result = await updateFeed({
        data: { id: editingFeed.id, name, url, folderId, includeKeywords, excludeKeywords },
      })

      if (result.status === "error") {
        setError(result.error.message)
        return
      }

      toast.success("Feed updated successfully")
      onFeedUpdated()
      handleClose(false)
    } catch (e: unknown) {
      console.error("[EditFeedModal] Failed to save feed:", e)
      setError("We could not save that feed. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!editingFeed) return
    setDeleting(true)
    try {
      await deleteFeed({ data: { id: editingFeed.id } })
      toast.success("Feed deleted")
      onFeedUpdated()
      setDeleteConfirmOpen(false)
      handleClose(false)
    } catch (e) {
      setError("Failed to delete feed")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        showCloseButton
        className="max-w-md border-white/10 bg-[#1c1c1e] text-white sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-white">
            Edit Feed
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-0.5">
          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-400">Feed Name</label>
            <Input
              id="edit-feed-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError("")
              }}
              placeholder="e.g. OpenAI Blog"
              className={`h-8 border-white/10 bg-white/5 text-xs text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 ${!name.trim() && error ? "border-red-500/50" : ""}`}
            />
          </div>

          {/* URL */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-400">Feed URL</label>
            <Input
              id="edit-feed-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://openai.com/news/rss.xml"
              className="h-8 border-white/10 bg-white/5 text-xs text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20"
            />
          </div>

          {/* Folder */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-400">Folder (optional)</label>
            <Select
              value={folderId ?? "__none__"}
              onValueChange={(v) => setFolderId(v === "__none__" ? null : v ?? null)}
            >
              <SelectTrigger
                id="edit-feed-folder"
                className="h-8 border-white/10 bg-white/5 text-xs text-zinc-300 focus:ring-1 focus:ring-white/20"
              >
                <SelectValue placeholder={UNFILED_DESTINATION} />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-[#1c1c1e] text-zinc-200">
                <SelectItem value="__none__">{UNFILED_DESTINATION}</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Keywords Row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Include Keywords */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-zinc-400">Include Keywords</label>
              <Input
                value={includeInput}
                onChange={(e) => setIncludeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addKeyword(includeInput, setIncludeInput, includeKeywords, setIncludeKeywords)
                  }
                }}
                placeholder="Type + Enter"
                className="h-8 border-white/10 bg-white/5 text-xs text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20"
              />
              <div className="flex flex-wrap gap-1 min-h-[20px]">
                {includeKeywords.map((kw) => (
                  <Badge
                    key={kw}
                    className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-[10px] text-zinc-300 border-none px-2 py-0"
                  >
                    {kw}
                    <button onClick={() => setIncludeKeywords(includeKeywords.filter((k) => k !== kw))} className="ml-0.5">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            {/* Exclude Keywords */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-zinc-400">Exclude Keywords</label>
              <Input
                value={excludeInput}
                onChange={(e) => setExcludeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addKeyword(excludeInput, setExcludeInput, excludeKeywords, setExcludeKeywords)
                  }
                }}
                placeholder="Type + Enter"
                className="h-8 border-white/10 bg-white/5 text-xs text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20"
              />
              <div className="flex flex-wrap gap-1 min-h-[20px]">
                {excludeKeywords.map((kw) => (
                  <Badge
                    key={kw}
                    className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-[10px] text-zinc-300 border-none px-2 py-0"
                  >
                    {kw}
                    <button onClick={() => setExcludeKeywords(excludeKeywords.filter((k) => k !== kw))} className="ml-0.5">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
        </div>

        <DialogFooter className="flex items-center justify-between border-t border-white/5 bg-transparent pt-4">
          <div className="flex-1 text-left">
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleting}
              className="text-xs font-medium text-red-500 hover:text-red-400 transition-colors"
            >
              Delete feed
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleClose(false)}
              className="text-xs text-zinc-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="h-7 bg-white text-xs font-semibold text-black hover:bg-zinc-200"
            >
              {saving ? "Saving…" : "Save Feed"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="border-white/10 bg-[#1c1c1e] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This will permanently delete the feed <strong>{editingFeed?.name}</strong>.
              All articles inside this feed will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white">
              Keep feed
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white font-semibold"
              onClick={(e) => {
                e.preventDefault()
                handleDeleteConfirm()
              }}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
