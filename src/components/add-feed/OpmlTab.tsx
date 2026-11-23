import { useRef, useState } from "react"
import {
  ArrowRight,
  ChevronDown,
  Download,
  FileText,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import type { OpmlDestination } from "@/lib/opml"
import type { importOpml, previewOpml } from "@/server/opml"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useWorkspaceScope } from "@/components/WorkspaceDataProvider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { DEMO_MODE } from "@/lib/demo"
import { downloadOpml } from "@/lib/download-opml"
import { MAX_OPML_BYTES } from "@/lib/opml"

type Preview = Extract<
  Awaited<ReturnType<typeof previewOpml>>,
  { status: "ok" }
>
type ImportSummary = Extract<
  Awaited<ReturnType<typeof importOpml>>,
  { status: "ok" }
>

function SkippedEntries({ skipped }: { skipped: Preview["skipped"] }) {
  if (skipped.length === 0) return null
  const groups = new Map<string, Array<string>>()
  for (const { name, reason } of skipped) {
    const names = groups.get(reason)
    if (names) names.push(name)
    else groups.set(reason, [name])
  }
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="group w-full justify-between px-2"
          />
        }
      >
        Skipped entries{" "}
        <ChevronDown className="size-4 group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-40 space-y-3 overflow-auto rounded-md bg-muted/50 p-3">
          {[...groups].map(([reason, names]) => (
            <section key={reason}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {reason}
              </p>
              <ul>
                {names.map((name, i) => (
                  <li key={i} className="py-0.5 break-words">
                    {name}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function OpmlExportButton() {
  const scope = useWorkspaceScope()
  const [busy, setBusy] = useState(false)
  async function download() {
    if (!scope) return
    setBusy(true)
    try {
      const error = await downloadOpml(scope.workspaceId)
      if (error) toast.error(error)
    } catch {
      toast.error("Could not export this workspace's subscriptions. Try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Export all subscriptions"
            disabled={!scope || busy}
            onClick={() => void download()}
          />
        }
      >
        {busy ? <Spinner /> : <Download />}
      </TooltipTrigger>
      <TooltipContent>Export all subscriptions as OPML</TooltipContent>
    </Tooltip>
  )
}

export function OpmlTab({
  onAdded,
  folderId,
}: {
  onAdded: () => void
  folderId?: string | null
}) {
  const scope = useWorkspaceScope()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{ xml: string; data: Preview } | null>(
    null
  )
  const [mode, setMode] = useState<OpmlDestination["kind"]>("preserve")
  const [folderName, setFolderName] = useState("")
  const [existingId, setExistingId] = useState("")
  const [busy, setBusy] = useState<"preview" | "import" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  async function checkFile() {
    if (!file || !scope || DEMO_MODE) return
    if (file.size > MAX_OPML_BYTES) {
      setError("Choose an OPML file up to 5 MB.")
      return
    }
    setPreview(null)
    setSummary(null)
    setError(null)
    setBusy("preview")
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const encoding =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? "utf-16le"
          : bytes[0] === 0xfe && bytes[1] === 0xff
            ? "utf-16be"
            : "utf-8"
      let xml: string
      try {
        xml = new TextDecoder(encoding, { fatal: true }).decode(bytes)
      } catch {
        setError("Save the OPML file as UTF-8 or UTF-16 and try again.")
        return
      }
      const { previewOpml: checkOpml } = await import("@/server/opml")
      const data = await checkOpml({
        data: { workspaceId: scope.workspaceId, xml },
      })
      if (data.status === "error") {
        setError(data.message)
        return
      }
      const selectedFolder = data.workspaceFolders.find(
        ({ id }) => id === folderId
      )
      setMode(
        selectedFolder ? "existing" : data.hasFolders ? "preserve" : "new"
      )
      setExistingId(selectedFolder?.id ?? "")
      setFolderName(
        file.name
          .replace(/\.(?:opml|xml)$/i, "")
          .trim()
          .slice(0, 60) || "Imported feeds"
      )
      setPreview({ xml, data })
    } catch {
      setError(
        "Could not preview this file. Check that you can edit this workspace and try again."
      )
    } finally {
      setBusy(null)
    }
  }

  async function confirmImport() {
    if (!preview || !scope || DEMO_MODE) return
    const destination: OpmlDestination =
      mode === "new"
        ? { kind: mode, name: folderName.trim() }
        : mode === "existing"
          ? { kind: mode, folderId: existingId }
          : { kind: mode }
    setError(null)
    setBusy("import")
    try {
      const { importOpml: importFile } = await import("@/server/opml")
      const result = await importFile({
        data: { workspaceId: scope.workspaceId, xml: preview.xml, destination },
      })
      if (result.status === "error") {
        setError(result.message)
        return
      }
      setPreview(null)
      setSummary(result)
      if (result.added || result.foldersCreated) onAdded()
    } catch {
      setError(
        "Could not import into this workspace. Check that you can edit its sources and try again."
      )
    } finally {
      setBusy(null)
    }
  }

  function pick(files: FileList | null) {
    if (!files?.length || busy || DEMO_MODE) return
    setPreview(null)
    setSummary(null)
    const next = files[0]
    const issue =
      files.length > 1
        ? "Choose one OPML file at a time."
        : next.size > MAX_OPML_BYTES
          ? "Choose an OPML file up to 5 MB."
          : null
    setError(issue)
    setFile(issue ? null : next)
  }

  const plan = preview?.data
  const newFileFolders =
    plan?.folders.filter(({ exists }) => !exists).length ?? 0
  const canImport =
    !!plan &&
    (mode === "preserve"
      ? plan.newFeeds > 0 || newFileFolders > 0
      : plan.newFeeds > 0 &&
        (mode === "new" ? !!folderName.trim() : !!existingId))
  const modes = {
    preserve: "Keep folders from the file",
    new: "Create a new folder",
    existing: "Choose an existing folder",
  }
  return (
    <div className="space-y-4 pb-4">
      <Input
        ref={input}
        type="file"
        className="hidden"
        aria-label="OPML file"
        accept=".opml,.xml,text/x-opml,text/xml,application/xml"
        disabled={!!busy || DEMO_MODE}
        onChange={(e) => {
          pick(e.currentTarget.files)
          e.currentTarget.value = ""
        }}
      />
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(!busy && !DEMO_MODE)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          pick(e.dataTransfer.files)
        }}
        className={dragging ? "rounded-lg ring-2 ring-primary" : "rounded-lg"}
      >
        {!file ? (
          <Button
            variant="outline"
            disabled={!!busy || DEMO_MODE}
            onClick={() => input.current?.click()}
            className="h-auto w-full flex-col gap-2 border-dashed bg-muted/20 py-6"
          >
            <span className="grid size-10 place-items-center rounded-full border">
              <Upload className="size-5" />
            </span>
            <span>Drop an OPML file here</span>
            <span className="text-xs font-normal text-muted-foreground">
              OPML or XML, up to 5 MB
            </span>
            <span className="mt-1 underline underline-offset-4">
              Browse files
            </span>
          </Button>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border p-2">
            <Button
              variant="ghost"
              className="min-w-0 flex-1 justify-start"
              disabled={!!busy || DEMO_MODE}
              onClick={() => input.current?.click()}
              aria-label={"Change file: " + file.name}
              title={"Change file: " + file.name}
            >
              <FileText />
              <span className="truncate">{file.name}</span>
            </Button>
            {!plan && (
              <Button
                size="sm"
                disabled={!scope || !!busy || DEMO_MODE}
                onClick={() => void checkFile()}
              >
                {busy === "preview" ? (
                  <>
                    <Spinner />
                    Checking file…
                  </>
                ) : (
                  <>
                    Preview import
                    <ArrowRight />
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {plan && (
        <div className="space-y-3 rounded-lg border p-3">
          <div role="status" className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {plan.newFeeds} new {plan.newFeeds === 1 ? "feed" : "feeds"}
            </Badge>
            <Badge variant="outline">{plan.skipped.length} skipped</Badge>
          </div>
          <SkippedEntries skipped={plan.skipped} />
          {(plan.newFeeds > 0 || newFileFolders > 0) && (
            <fieldset disabled={busy !== null} className="space-y-2">
              <legend className="font-medium">Import destination</legend>
              <Select
                items={modes}
                value={mode}
                disabled={!!busy}
                onValueChange={(next) => {
                  if (next) {
                    setMode(next)
                    setError(null)
                  }
                }}
              >
                <SelectTrigger
                  aria-label="Import destination"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(modes) as Array<OpmlDestination["kind"]>)
                    .filter(
                      (k) =>
                        k === "new" ||
                        (k === "preserve"
                          ? plan.hasFolders
                          : plan.workspaceFolders.length > 0)
                    )
                    .map((k) => (
                      <SelectItem key={k} value={k}>
                        {modes[k]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {mode === "new" && (
                <Input
                  aria-label="New folder name"
                  maxLength={60}
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                />
              )}
              {mode === "existing" && (
                <Select
                  items={Object.fromEntries(
                    plan.workspaceFolders.map((f) => [f.id, f.name])
                  )}
                  value={existingId || null}
                  disabled={!!busy}
                  onValueChange={(id) => setExistingId(id ?? "")}
                >
                  <SelectTrigger
                    aria-label="Existing folder"
                    className="w-full"
                  >
                    <SelectValue placeholder="Select a folder" />
                  </SelectTrigger>
                  <SelectContent>
                    {plan.workspaceFolders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {mode === "preserve" && (
                <>
                  <p className="text-muted-foreground">
                    Nested folders appear as paths such as News / Local.
                    Matching folders are reused.
                  </p>
                  <ul className="max-h-28 space-y-1 overflow-y-auto text-muted-foreground">
                    {plan.folders.map(({ name, count, exists }) => (
                      <li key={name} className="break-words">
                        {name} · {count} {count === 1 ? "feed" : "feeds"} ·{" "}
                        {exists ? "Existing folder" : "New folder"}
                      </li>
                    ))}
                    {plan.unfiled > 0 && (
                      <li>
                        Unfiled · {plan.unfiled}{" "}
                        {plan.unfiled === 1 ? "feed" : "feeds"}
                      </li>
                    )}
                  </ul>
                </>
              )}
            </fieldset>
          )}
          <Button
            disabled={busy !== null || !canImport}
            onClick={() => void confirmImport()}
          >
            {busy === "import" ? <Spinner /> : <Upload aria-hidden="true" />}
            {busy === "import" ? "Importing…" : "Confirm import"}
          </Button>
        </div>
      )}

      {summary && (
        <div className="space-y-2 rounded-lg border p-3">
          <p role="status">
            {summary.added} {summary.added === 1 ? "feed" : "feeds"} added,{" "}
            {summary.foldersCreated} new{" "}
            {summary.foldersCreated === 1 ? "folder" : "folders"},{" "}
            {summary.skipped.length} skipped.
            {summary.added > 0 && " Articles load in the background."}
          </p>
          <SkippedEntries skipped={summary.skipped} />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
