import { useEffect, useState } from "react"
import { Check, CheckCircle, Copy, Eye, EyeOff, KeyRound, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { copyText } from "@/lib/clipboard"
import { buildShareUrl } from "@/lib/share-url"

/**
 * Public-link controls for one folder or feed: the toggle, the link, and the
 * optional password.
 *
 * Extracted from FolderShareModal so the manage-folder page can show the same
 * controls inline instead of behind a dialog, without a second implementation
 * of the same three requests.
 */
export function ShareSettings({
  entityId,
  entityName,
  type = "folder",
  onStateChange,
}: {
  entityId: string
  entityName: string
  type?: "folder" | "feed"
  /** Lets a host page keep its own copy of the share state in sync. */
  onStateChange?: (state: { isShared: boolean; hasPassword: boolean }) => void
}) {

  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hasExistingPassword, setHasExistingPassword] = useState(false)
  const [isLinkEnabled, setIsLinkEnabled] = useState(false)
  const [fetchingPassword, setFetchingPassword] = useState(false)

  const shareUrl =
    typeof window !== "undefined" ? buildShareUrl(entityName, entityId) : ""

  /** Both share routes answer with the same shape; keep local state on it. */
  const applyServerState = (data: { isShared?: boolean; hasPassword?: boolean }) => {
    setIsLinkEnabled(!!data.isShared)
    setHasExistingPassword(!!data.hasPassword)
    onStateChange?.({ isShared: !!data.isShared, hasPassword: !!data.hasPassword })
  }

  const shareEndpoint = type === "feed" ? "/api/feeds/share" : "/api/folders/share"

  // Wire format is the API's, not this component's: folderId/folderName for
  // folders, feedId/feedName for feeds.
  const identity = () =>
    type === "feed"
      ? { feedId: entityId, feedName: entityName }
      : { folderId: entityId, folderName: entityName }

  /**
   * `password` is deliberately omitted unless we mean to change it — the API
   * treats an absent field as "leave it alone" and null as "clear it".
   */
  const postShare = async (body: Record<string, unknown>) => {
    const res = await fetch(shareEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...identity(), ...body }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "Request failed")
    return data as { isShared?: boolean; hasPassword?: boolean }
  }

  useEffect(() => {
    {
      setPassword("")
      setFetchingPassword(true)
      const query =
        type === "feed" ? `feedId=${entityId}` : `folderId=${entityId}`
      fetch(`${shareEndpoint}?${query}`)
        .then(res => res.json())
        .then(applyServerState)
        .catch(() => {})
        .finally(() => setFetchingPassword(false))
    }
  }, [entityId, type])

  const handleToggleLink = async (checked: boolean) => {
    setIsLinkEnabled(checked)
    setLoading(true)
    try {
      // Turning the link off clears the password server-side, so there is no
      // stale credential attached to a link that no longer resolves.
      applyServerState(await postShare({ isShared: checked }))
      toast.success(checked ? "Share link enabled" : "Share link disabled")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update share setting"
      )
      setIsLinkEnabled(!checked)
    } finally {
      setLoading(false)
    }
  }

  const handleSavePassword = async () => {
    setLoading(true)
    try {
      applyServerState(await postShare({ isShared: true, password }))
      toast.success("Password saved")
      setPassword("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save password")
    } finally {
      setLoading(false)
    }
  }

  const handleRemovePassword = async () => {
    setLoading(true)
    try {
      applyServerState(await postShare({ isShared: true, password: null }))
      toast.success("Password removed")
      setPassword("")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove password"
      )
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLink = async () => {
    if (!shareUrl) return
    // copyText, not navigator.clipboard: the latter is undefined on non-HTTPS
    // origins, so this silently failed for anyone self-hosting over plain http.
    const ok = await copyText(shareUrl, { successMessage: "Share link copied" })
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
        <div className="flex flex-col gap-6 py-4">
              {/* TOGGLE */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label htmlFor="share-link-toggle" className="text-sm font-medium">
                    Enable share link
                  </Label>
                </div>
                <Switch
                  id="share-link-toggle"
                  checked={isLinkEnabled}
                  onCheckedChange={handleToggleLink}
                  disabled={loading || fetchingPassword}
                />
              </div>

              {fetchingPassword ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm mt-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Fetching status...
                </div>
              ) : isLinkEnabled && (
                <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-top-2 duration-300 mt-4">
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={shareUrl}
                      className="bg-muted border-border text-foreground font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyLink}
                      disabled={loading}
                      className="bg-muted border-border hover:bg-accent hover:text-foreground shrink-0"
                    >
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>

                  {/* SECTION B/C - Password Protection */}
                  <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/50 p-4">
                    <h4 className="text-sm font-medium text-foreground">Password Protection</h4>

                    {hasExistingPassword ? (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-2 text-green-500 text-sm">
                          <CheckCircle className="h-4 w-4" /> Password is set
                        </div>
                        <Button
                          variant="outline"
                          className="w-full text-destructive border-destructive hover:bg-destructive/10"
                          onClick={handleRemovePassword}
                          disabled={loading}
                        >
                          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Remove Password
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <p className="text-xs text-muted-foreground">
                          Set a password so anyone with the link and password can view this {type}
                        </p>
                        <div className="relative flex items-center">
                          <KeyRound className="absolute left-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder="Enter a secure password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            className="bg-background border-border pl-10 pr-10 focus-visible:ring-ring text-foreground"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 text-muted-foreground hover:text-foreground"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <Button
                          onClick={handleSavePassword}
                          disabled={loading || !password}
                          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Save Password
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
        </div>
  )
}
