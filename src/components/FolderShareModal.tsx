import { Globe } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ShareSettings } from "@/components/folder/ShareSettings"

interface FolderShareModalProps {
  folderId: string
  folderName: string
  /** Unused — ShareSettings reads the real state from the server on mount. */
  isPublic?: boolean
  isOpen: boolean
  type?: "folder" | "feed"
  onClose: () => void
}

/**
 * Dialog chrome around ShareSettings.
 *
 * The controls themselves live in ShareSettings so the manage-folder page can
 * render them inline. Keying the panel on `isOpen` remounts it each time the
 * dialog opens, which is what re-fetches the current share state — the panel
 * loads on mount rather than watching an `isOpen` prop it no longer receives.
 */
export function FolderShareModal({
  folderId,
  folderName,
  isOpen,
  type = "folder",
  onClose,
}: FolderShareModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-border bg-background text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            Share "{folderName}"
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Share this {type} via link. You can optionally protect it with a
            password.
          </DialogDescription>
        </DialogHeader>

        {isOpen && (
          <ShareSettings
            key={`${type}-${folderId}`}
            entityId={folderId}
            entityName={folderName}
            type={type}
          />
        )}

        <div className="mt-2 flex justify-end border-t border-border pt-4">
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
