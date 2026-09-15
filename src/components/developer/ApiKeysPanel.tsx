import { useEffect, useState } from "react"
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { DeveloperPage, Section } from "./DeveloperPage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { copyText } from "@/lib/clipboard"
import { DEMO_MODE } from "@/lib/demo"
import { createKey, deleteKey, listKeys } from "@/server/api/key-actions"

interface KeyRow {
  id: string
  name: string
  prefix: string
  scopes: Array<string>
  lastUsedAt: string | null
  createdAt: string | null
}

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<Array<KeyRow>>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  /** The raw key, held only until the reveal dialog closes. */
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<KeyRow | null>(null)

  const load = async () => {
    try {
      const res = await listKeys()
      setKeys(res.keys)
    } catch {
      toast.error("Could not load API keys")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (DEMO_MODE) {
      setLoading(false)
      return
    }
    void load()
  }, [])

  const onCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    try {
      const key = await createKey({ data: { name: name.trim() } })
      setCreateOpen(false)
      setName("")
      // The raw value exists only in this response. Once this dialog closes it
      // is gone, which is why it gets its own step rather than a toast.
      setRevealed(key.key)
      await load()
    } catch (err: any) {
      toast.error(err?.message ?? "Could not create the key")
    } finally {
      setCreating(false)
    }
  }

  const onDelete = async (row: KeyRow) => {
    try {
      await deleteKey({ data: { id: row.id } })
      toast.success(`Revoked "${row.name}"`)
      setPendingDelete(null)
      await load()
    } catch {
      toast.error("Could not revoke the key")
    }
  }

  if (DEMO_MODE) {
    return (
      <DeveloperPage
        title="API keys"
        lead="Keys authenticate the MCP endpoint, and later the REST API."
      >
        <Section title="Not available in demo">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The demo workspace runs on a temporary database that is reset regularly, so keys
            cannot be stored here. The demo MCP endpoint uses a shared read-only key that is
            published in the docs. Sign up for a free workspace to create your own.
          </p>
        </Section>
      </DeveloperPage>
    )
  }

  return (
    <DeveloperPage
      title="API keys"
      lead="Keys authenticate the MCP endpoint, and later the REST API. They are scoped to this workspace."
    >
      <Section
        title="Your keys"
        description="A key is shown once, when it is created. Store it somewhere safe."
        action={
          <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New key
          </Button>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <KeyRound className="size-5 text-muted-foreground dark:text-zinc-600" />
            <p className="text-xs text-muted-foreground">
              No keys yet. Create one to connect an agent.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border dark:divide-zinc-800/60">
            {keys.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {row.prefix}
                    <span className="text-muted-foreground dark:text-zinc-600">…</span>
                  </p>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <p className="text-[11px] text-muted-foreground">
                    {row.lastUsedAt ? `Used ${formatDate(row.lastUsedAt)}` : "Never used"}
                  </p>
                  <p className="text-[10px] text-muted-foreground dark:text-zinc-600">
                    {row.scopes.filter((s) => s !== "mcp").length} scopes
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Revoke ${row.name}`}
                  className="size-8 shrink-0 text-muted-foreground dark:text-zinc-500 hover:text-red-700 dark:hover:text-red-400"
                  onClick={() => setPendingDelete(row)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Create an API key</DialogTitle>
            <DialogDescription>
              Name it after where it will be used, so you can tell keys apart later.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="key-name" className="text-xs">
              Name
            </Label>
            <Input
              id="key-name"
              value={name}
              autoFocus
              placeholder="e.g. Claude Code on my laptop"
              className="mt-1.5"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && !creating) void onCreate()
              }}
            />
          </div>
          <DialogFooter>
            <Button
              className="w-full gap-2"
              disabled={creating || !name.trim()}
              onClick={onCreate}
            >
              {creating && <Loader2 className="size-3.5 animate-spin" />}
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time reveal */}
      <Dialog
        open={revealed !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevealed(null)
            setCopied(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Copy your key now</DialogTitle>
            <DialogDescription>
              This is the only time it will be shown. We store a hash, so it cannot be
              recovered later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-border dark:border-zinc-800 bg-card dark:bg-black/40 p-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground dark:text-zinc-200">
              {revealed}
            </code>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Copy key"
              className="size-7 shrink-0"
              onClick={async () => {
                if (!revealed) return
                const ok = await copyText(revealed, { successMessage: "Key copied" })
                if (ok) setCopied(true)
              }}
            >
              {copied ? <Check className="size-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <p className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300/80">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Treat it like a password. Anyone with this key can read this workspace.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setRevealed(null)
                setCopied(false)
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything using &ldquo;{pendingDelete?.name}&rdquo; will stop working immediately.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 font-medium text-white hover:bg-red-700"
              onClick={() => pendingDelete && onDelete(pendingDelete)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DeveloperPage>
  )
}

function formatDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "recently"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
