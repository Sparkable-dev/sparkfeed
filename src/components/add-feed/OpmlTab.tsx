import { useId, useState } from "react"
import { Download, Upload } from "lucide-react"
import type { OpmlDestination } from "@/lib/opml"
import type { importOpml, previewOpml } from "@/server/opml"
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
  return (
    <details>
      <summary className="cursor-pointer font-medium">Skipped entries</summary>
      <ul className="mt-2 max-h-36 list-disc space-y-1 overflow-y-auto pl-5 text-muted-foreground">
        {skipped.map(({ name, reason }, index) => (
          <li key={index} className="break-words">
            {name} · {reason}
          </li>
        ))}
      </ul>
    </details>
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
  const fileId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{ xml: string; data: Preview } | null>(
    null
  )
  const [mode, setMode] = useState<OpmlDestination["kind"]>("preserve")
  const [folderName, setFolderName] = useState("")
  const [existingId, setExistingId] = useState("")
  const [busy, setBusy] = useState<"preview" | "import" | "export" | null>(null)
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

  async function download() {
    if (!scope) return
    setError(null)
    setBusy("export")
    try {
      setError(await downloadOpml(scope.workspaceId))
    } catch {
      setError("Could not export this workspace's subscriptions. Try again.")
    } finally {
      setBusy(null)
    }
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
  const selectClass =
    "block h-8 w-full rounded-lg border border-input bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <div className="space-y-4 pb-3">
      <div className="space-y-2">
        <label htmlFor={fileId} className="block font-medium">
          OPML file
        </label>
        <Input
          id={fileId}
          type="file"
          accept=".opml,.xml,text/x-opml,text/xml,application/xml"
          disabled={busy !== null || DEMO_MODE}
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null)
            setPreview(null)
            setSummary(null)
            setError(null)
          }}
        />
        {!plan && (
          <Button
            variant="outline"
            disabled={!scope || !file || busy !== null || DEMO_MODE}
            onClick={() => void checkFile()}
          >
            {busy === "preview" && <Spinner />}
            {busy === "preview" ? "Checking file…" : "Preview import"}
          </Button>
        )}
      </div>

      {plan && (
        <div className="space-y-3 rounded-lg border p-3">
          <p role="status">
            {plan.newFeeds} new {plan.newFeeds === 1 ? "feed" : "feeds"},{" "}
            {plan.skipped.length} skipped.
          </p>
          <SkippedEntries skipped={plan.skipped} />
          {(plan.newFeeds > 0 || newFileFolders > 0) && (
            <fieldset disabled={busy !== null} className="space-y-2">
              <legend className="font-medium">Import destination</legend>
              <select
                aria-label="Import destination"
                className={selectClass}
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as OpmlDestination["kind"])
                  setError(null)
                }}
              >
                {plan.hasFolders && (
                  <option value="preserve">Keep folders from the file</option>
                )}
                <option value="new">Create a new folder</option>
                {plan.workspaceFolders.length > 0 && (
                  <option value="existing">Choose an existing folder</option>
                )}
              </select>
              {mode === "new" && (
                <Input
                  aria-label="New folder name"
                  maxLength={60}
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                />
              )}
              {mode === "existing" && (
                <select
                  aria-label="Existing folder"
                  className={selectClass}
                  value={existingId}
                  onChange={(event) => setExistingId(event.target.value)}
                >
                  <option value="" disabled>
                    Select a folder
                  </option>
                  {plan.workspaceFolders.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
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

      <div className="border-t pt-4">
        <Button
          variant="outline"
          disabled={!scope || busy !== null}
          onClick={() => void download()}
        >
          {busy === "export" ? <Spinner /> : <Download aria-hidden="true" />}
          {busy === "export" ? "Exporting…" : "Export all subscriptions"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
