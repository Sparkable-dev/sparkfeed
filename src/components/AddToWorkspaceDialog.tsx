import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

/**
 * Name-conflict prompt for copying a shared folder into your own workspace.
 *
 * `add-to-workspace` 409s when you already have a folder by that name, and both
 * the guest path and the signed-in path have to handle it. It used to exist
 * twice, verbatim, in the same file — which is how two copies of a dialog drift
 * apart.
 */
export function AddToWorkspaceDialog({
  open,
  name,
  onNameChange,
  onConfirm,
  onCancel,
}: {
  open: boolean
  name: string
  onNameChange: (name: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="max-w-md border-zinc-800 bg-zinc-900">
        <DialogHeader>
          <DialogTitle className="text-white">
            Folder name already exists
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            You already have a folder with this name in your workspace. Choose a
            different name to add it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <Label className="text-xs tracking-wider text-zinc-500 uppercase">
            Folder name
          </Label>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="border-zinc-700 bg-zinc-800 text-white focus-visible:ring-purple-500"
            placeholder="Enter folder name"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") onConfirm() }}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="border-zinc-700 text-zinc-300"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            className="bg-white text-black hover:bg-zinc-200"
            onClick={onConfirm}
            disabled={!name.trim()}
          >
            Add with this name
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
