import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  Check,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import type { FeedRow, FolderRow } from "@/lib/rss-types"
import type { ArticleRow } from "@/components/ArticleGrid"
import type {GuestShare} from "@/hooks/guest-share-context";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ArticleGrid } from "@/components/ArticleGrid"
import { RSSShell } from "@/components/RSSShell"
import { AddToWorkspaceDialog } from "@/components/AddToWorkspaceDialog"
import {  GuestShareProvider } from "@/hooks/guest-share-context"
import { parseShareSlug } from "@/lib/share-url"
import { DEMO_MODE } from "@/lib/demo"

export const Route = createFileRoute("/sprk/$folderSlug")({
  component: SharedFolderPage,
  /**
   * `?add=1` is the guest's "add this to my workspace" intent surviving a round
   * trip through the login page. Deliberately a flag, never an id: the folder is
   * always the one whose slug is in the path, so this cannot be used to point
   * add-to-workspace at something the visitor is not looking at.
   */
  validateSearch: (search: Record<string, unknown>): { add?: true } =>
    search.add === "1" || search.add === true ? { add: true } : {},
})

const PENDING_ADD_KEY = "sprk_pending_add"
const PENDING_ADD_MAX_AGE_MS = 30 * 60 * 1000

interface SharePayload {
  status?: string
  kind?: "folder" | "feed"
  folder: { id: string; name: string }
  articles: Array<ArticleRow>
  feeds?: Array<{ id: string; name: string; url: string }>
  subfolders?: Array<{ id: string; name: string; articleCount: number }>
  breadcrumbs?: Array<{ id: string; name: string }>
  viewer?: { authenticated: boolean; isOwner: boolean; canAdd: boolean }
}

/**
 * Reshapes the share payload into what RSSShell's `initialData` expects.
 *
 * The endpoint returns one `folder` plus flat `feeds`; the shell wants a
 * `folders` array and feeds that know their parent. Stamping `folderId` onto
 * each feed is load-bearing, not cosmetic — NavFolders groups feeds by it and
 * treats anything without one as a standalone feed, so without this the folder
 * renders empty and every feed falls into "Other Feeds".
 */
function toShellData(payload: SharePayload) {
  const isFeed = payload.kind === "feed"

  if (isFeed) {
    // No synthetic wrapper folder: naming something that does not exist is
    // worse than a single row under "Other Feeds", which is what this becomes.
    const feed = payload.feeds?.[0]
    return {
      folders: [] as Array<FolderRow>,
      feeds: [
        {
          id: payload.folder.id,
          name: payload.folder.name,
          url: feed?.url ?? "",
          folderId: null,
          isShared: true,
        },
      ] as Array<FeedRow>,
      articles: payload.articles,
    }
  }

  const folders: Array<FolderRow> = [
    { id: payload.folder.id, name: payload.folder.name, isShared: true },
    ...(payload.subfolders ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      isShared: true,
    })),
  ]

  const feeds: Array<FeedRow> = (payload.feeds ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    url: f.url,
    folderId: payload.folder.id,
  }))

  return { folders, feeds, articles: payload.articles }
}

// ── Authenticated view — the visitor's own workspace, plus the shared folder ──
function AuthenticatedSharedView({
  data,
  canAdd,
  addedToWorkspace,
  addingToWorkspace,
  onAddToWorkspace,
  renameDialog,
  customName,
  onCustomNameChange,
  onConfirmRename,
  onCancelRename,
}: {
  data: SharePayload
  canAdd: boolean
  addedToWorkspace: boolean
  addingToWorkspace: boolean
  onAddToWorkspace: () => void
  renameDialog: boolean
  customName: string
  onCustomNameChange: (name: string) => void
  onConfirmRename: () => void
  onCancelRename: () => void
}) {
  const [workspaceData, setWorkspaceData] = useState<any>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(true)

  useEffect(() => {
    fetch("/api/workspace-data")
      .then((r) => r.json())
      .then((d) => {
        // `{ error: "Unauthorized" }` is truthy, and RSSShell immediately does
        // initialData.feeds.map(...) — so a bare null check let an error body
        // through and blew up the whole page. Require the shape it needs.
        setWorkspaceData(
          d && Array.isArray(d.folders) && Array.isArray(d.feeds) ? d : null
        )
        setWorkspaceLoading(false)
      })
      .catch(() => setWorkspaceLoading(false))
  }, [])

  if (workspaceLoading) return <LoadingSkeleton />

  // Signed in but their workspace would not load. Falling back to the shared
  // articles alone beats an error page: they came here to read this folder.
  if (!workspaceData) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <ArticleGrid
          articles={data.articles}
          title={data.folder.name}
          onRefreshed={() => {}}
        />
      </div>
    )
  }

  return (
    <>
      <RSSShell
        initialData={workspaceData}
        title={data.folder.name}
        filterArticles={() => data.articles}
        folderId={data.folder.id}
      >
        <div className="flex flex-1 flex-col overflow-hidden">
          {canAdd && !addedToWorkspace && (
            <div className="flex shrink-0 items-center justify-between border-b border-white/5 bg-zinc-900/80 px-4 py-2.5 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 shrink-0 text-yellow-400" fill="currentColor" />
                <span className="text-xs text-zinc-400">
                  You are viewing a shared {data.kind ?? "folder"}
                </span>
                <span className="hidden text-xs text-zinc-600 sm:block">·</span>
                <span className="hidden text-xs font-medium text-zinc-300 sm:block">
                  {data.folder.name}
                </span>
              </div>
              <Button
                size="sm"
                className="h-7 bg-white text-xs font-semibold text-black hover:bg-zinc-200"
                onClick={onAddToWorkspace}
                disabled={addingToWorkspace || addedToWorkspace}
              >
                {addingToWorkspace ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Adding…
                  </>
                ) : addedToWorkspace ? (
                  <>
                    <Check className="mr-1 h-3 w-3" />
                    Added
                  </>
                ) : (
                  <>
                    <Plus className="mr-1 h-3 w-3" />
                    Add to my workspace
                  </>
                )}
              </Button>
            </div>
          )}

          <ArticleGrid
            articles={data.articles}
            title={data.folder.name}
            onRefreshed={() => {}}
          />
        </div>
      </RSSShell>

      <AddToWorkspaceDialog
        open={renameDialog}
        name={customName}
        onNameChange={onCustomNameChange}
        onConfirm={onConfirmRename}
        onCancel={onCancelRename}
      />
    </>
  )
}

// ── Guest view — the real reader UI, read-only ───────────────────────────────
function GuestSharedView({
  data,
  guest,
  renameDialog,
  customName,
  onCustomNameChange,
  onConfirmRename,
  onCancelRename,
}: {
  data: SharePayload
  guest: GuestShare
  renameDialog: boolean
  customName: string
  onCustomNameChange: (name: string) => void
  onConfirmRename: () => void
  onCancelRename: () => void
}) {
  const shellData = useMemo(() => toShellData(data), [data])

  const selectedFeedName = shellData.feeds.find(
    (f) => f.id === guest.selectedFeedId
  )?.name

  return (
    <GuestShareProvider value={guest}>
      <RSSShell
        initialData={shellData}
        title={selectedFeedName ?? data.folder.name}
        // The payload is already the shared set and already capped at 200, so a
        // 15-day default would render a slow-publishing folder near-empty on a
        // first-time visitor's very first impression.
        skipDateFilter
        filterArticles={(articles) =>
          guest.selectedFeedId
            ? articles.filter((a) => a.feedId === guest.selectedFeedId)
            : articles
        }
      />

      <AddToWorkspaceDialog
        open={renameDialog}
        name={customName}
        onNameChange={onCustomNameChange}
        onConfirm={onConfirmRename}
        onCancel={onCancelRename}
      />
    </GuestShareProvider>
  )
}

function LoadingSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 font-sans text-white">
      <header className="sticky top-0 z-40 shrink-0 border-b border-white/10 bg-zinc-950/80 p-4 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4">
          <Skeleton className="h-8 w-32 bg-white/5" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl grow px-8 py-8">
        <Skeleton className="mb-8 h-10 w-64 bg-white/5" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="overflow-hidden border-white/5 bg-[#161616]">
              <CardHeader className="gap-2">
                <Skeleton className="h-6 w-full bg-white/5" />
                <Skeleton className="h-4 w-1/2 bg-white/5" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-16 w-full bg-white/5" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-8 w-24 bg-white/5" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}

// ── Main page component ──────────────────────────────────────────────────────
function SharedFolderPage() {
  const { folderSlug } = Route.useParams()
  const { add } = Route.useSearch()
  const navigate = useNavigate()

  const entityId = parseShareSlug(folderSlug)

  const [data, setData] = useState<SharePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; type: "403" | "generic" } | null>(null)
  const [password, setPassword] = useState("")
  const [privateState, setPrivateState] = useState<{ hasPassword: boolean } | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null)
  const [addedToWorkspace, setAddedToWorkspace] = useState(false)
  const [addingToWorkspace, setAddingToWorkspace] = useState(false)
  const [renameDialog, setRenameDialog] = useState(false)
  const [customName, setCustomName] = useState("")

  const storageKey = `sprk_password_${entityId}`

  /**
   * add-to-workspace verifies the share before copying, so a password-protected
   * folder needs the same header the read used. The visitor already cleared the
   * prompt to be looking at this page, so it is cached.
   */
  const sharePasswordHeader = useCallback((): Record<string, string> => {
    const stored = localStorage.getItem(storageKey)
    return stored ? { "x-share-password": stored } : {}
  }, [storageKey])

  const postAddToWorkspace = useCallback(
    async (customFolderName?: string) => {
      setAddingToWorkspace(true)
      try {
        const res = await fetch("/api/folders/add-to-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...sharePasswordHeader() },
          body: JSON.stringify({
            sharedFolderId: entityId,
            ...(customFolderName ? { customFolderName } : {}),
          }),
        })
        const json = await res.json().catch(() => ({}))

        if (res.status === 401) {
          // Most likely the sign-in did not complete (unverified email, say).
          // Keep the pending intent so the CTA still works on a retry.
          toast.error("Sign in to finish adding this folder")
          return
        }
        if (res.status === 403) {
          toast.error("This folder is no longer shared")
          localStorage.removeItem(PENDING_ADD_KEY)
          return
        }
        if (res.status === 409) {
          const suggested = json.suggestedName || `${data?.folder.name ?? "Folder"} (Shared)`
          setCustomName(suggested)
          setRenameDialog(true)
          return
        }
        if (!res.ok) {
          toast.error("Could not add folder")
          localStorage.removeItem(PENDING_ADD_KEY)
          return
        }

        setAddedToWorkspace(true)
        localStorage.removeItem(PENDING_ADD_KEY)
        toast.success(`"${json.folderName}" added to your workspace`, {
          description: `${json.feedCount} feeds added. Articles will load shortly.`,
          action: { label: "View folder", onClick: () => { window.location.href = "/" } },
        })
      } catch {
        toast.error("Could not add folder")
      } finally {
        setAddingToWorkspace(false)
      }
    },
    [entityId, data?.folder.name, sharePasswordHeader]
  )

  const handleAddToWorkspace = useCallback(() => {
    if (data?.viewer?.authenticated) {
      void postAddToWorkspace()
      return
    }
    // A guest cannot add anything yet. Park the intent and send them to sign in;
    // `?add=1` on the way back is what resumes it.
    try {
      localStorage.setItem(
        PENDING_ADD_KEY,
        JSON.stringify({ entityId, ts: Date.now() })
      )
    } catch {
      // Private browsing. The flow still works — the id comes from the path and
      // the intent from the query string; only the staleness check is lost.
    }
    const back = encodeURIComponent(`/sprk/${folderSlug}?add=1`)
    window.location.href = `/login?redirect=${back}`
  }, [data?.viewer?.authenticated, entityId, folderSlug, postAddToWorkspace])

  const handleAddWithCustomName = () => {
    if (!customName.trim()) return
    setRenameDialog(false)
    void postAddToWorkspace(customName.trim())
  }

  const fetchSharedFolder = async (pass?: string) => {
    setLoading(true)
    setError(null)
    setPrivateState(null)
    setPasswordError(null)

    const finalPass = pass || localStorage.getItem(storageKey) || undefined

    try {
      const headers: Record<string, string> = {}
      if (finalPass) headers["x-share-password"] = finalPass

      const res = await fetch(`/api/shared/${entityId}`, { headers })
      const json = await res.json()

      if (json.status === "not_found") {
        setError({ message: "Link is invalid or has been disabled", type: "403" })
        return
      }

      if (json.status === "private" || json.status === "wrong_password") {
        if (!pass && finalPass) localStorage.removeItem(storageKey)
        setPrivateState({ hasPassword: json.hasPassword ?? true })
        if (pass || (json.status === "wrong_password" && finalPass)) {
          setPasswordError("Incorrect password. Please try again.")
        }
        return
      }

      // One success status now. The endpoint used to short-circuit to
      // "authenticated" for anyone with a session, before it checked whether
      // the folder was shared at all; access is decided by the share, and
      // `viewer` only describes who is looking.
      if (json.status === "public") {
        if (pass) localStorage.setItem(storageKey, pass)
        setData(json)
        return
      }

      // Anything else — including the server's own `status: "error"` — is a
      // failure. Falling through to setData with a body that has no articles
      // used to blank the page instead of showing the error.
      setError({ message: json.error || "An error occurred", type: "generic" })
    } catch {
      setError({ message: "Failed to load folder", type: "generic" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchSharedFolder()
    // Keyed on the entity alone, deliberately. `fetchSharedFolder` is redefined
    // every render, so listing it would refetch the share on each one.
  }, [entityId])

  /**
   * Resume a parked "add to workspace" after the sign-in round trip.
   *
   * `?add=1` is stripped immediately, so refreshing the page cannot add the
   * folder a second time.
   */
  useEffect(() => {
    if (!add || !data?.viewer?.canAdd || addingToWorkspace || addedToWorkspace) return

    let fresh = true
    try {
      const raw = localStorage.getItem(PENDING_ADD_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        fresh =
          parsed.entityId === entityId &&
          Date.now() - Number(parsed.ts) < PENDING_ADD_MAX_AGE_MS
      }
    } catch {
      // Unreadable or unavailable storage: trust the query string.
    }

    void navigate({ to: ".", search: {}, replace: true })
    if (fresh) void postAddToWorkspace()
  }, [add, data?.viewer?.canAdd, addingToWorkspace, addedToWorkspace, entityId, navigate, postAddToWorkspace])

  const guest: GuestShare = useMemo(
    () => ({
      entityId,
      folderSlug,
      kind: data?.kind ?? "folder",
      selectedFeedId,
      selectFeed: setSelectedFeedId,
      addToWorkspace: handleAddToWorkspace,
      adding: addingToWorkspace,
      added: addedToWorkspace,
    }),
    [entityId, folderSlug, data?.kind, selectedFeedId, handleAddToWorkspace, addingToWorkspace, addedToWorkspace]
  )

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    void fetchSharedFolder(password)
  }

  if (loading) return <LoadingSkeleton />

  if (error?.type === "403") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-white">
        <Alert variant="destructive" className="max-w-md border-red-900/50 bg-zinc-900 text-red-400">
          <Lock className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    )
  }

  /*
    The one place a stripped-down page is right: there is nothing shared to
    render, and wrapping a locked door in the full product chrome would imply
    access the visitor does not have.
  */
  if (privateState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-white">
        <Card className="w-full max-w-sm border-zinc-800 bg-zinc-900 shadow-2xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 w-fit rounded-full bg-white/5 p-3">
              <Lock className="h-6 w-6 text-zinc-300" />
            </div>
            <p className="text-lg font-semibold text-white">Private folder</p>
            <p className="text-sm text-zinc-400">
              {privateState.hasPassword
                ? "Enter the password to view it."
                : "This link is not shared, or sharing has been turned off."}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {privateState.hasPassword && (
              <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
                <div className="relative">
                  <KeyRound className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-zinc-800 bg-zinc-950 pl-9 text-white focus-visible:ring-zinc-700"
                    autoFocus
                  />
                </div>
                {passwordError && (
                  <p className="text-center text-xs text-red-400">{passwordError}</p>
                )}
                <Button type="submit" className="w-full bg-white text-black hover:bg-zinc-200">
                  Unlock
                </Button>
              </form>
            )}
            {/* /login bounces straight back to / in demo mode, so offering it
                there would dead-end without explanation. */}
            {!DEMO_MODE && (
              <Button
                variant="outline"
                className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                onClick={() => {
                  window.location.href = `/login?redirect=${encodeURIComponent(`/sprk/${folderSlug}`)}`
                }}
              >
                Sign in to Sparkfeed
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-white">
        <Alert variant="destructive" className="max-w-md border-red-900/50 bg-zinc-900 text-red-400">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!data) return null

  if (data.viewer?.authenticated) {
    return (
      <AuthenticatedSharedView
        data={data}
        canAdd={data.viewer.canAdd}
        addedToWorkspace={addedToWorkspace}
        addingToWorkspace={addingToWorkspace}
        onAddToWorkspace={handleAddToWorkspace}
        renameDialog={renameDialog}
        customName={customName}
        onCustomNameChange={setCustomName}
        onConfirmRename={handleAddWithCustomName}
        onCancelRename={() => setRenameDialog(false)}
      />
    )
  }

  return (
    <GuestSharedView
      data={data}
      guest={guest}
      renameDialog={renameDialog}
      customName={customName}
      onCustomNameChange={setCustomName}
      onConfirmRename={handleAddWithCustomName}
      onCancelRename={() => setRenameDialog(false)}
    />
  )
}
