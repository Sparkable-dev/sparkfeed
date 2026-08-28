import { toast } from "sonner"

/**
 * Copy to clipboard, with the fallback that matters.
 *
 * `navigator.clipboard` is undefined on any non-HTTPS origin other than
 * localhost, which includes a LAN address during development and any
 * self-hosted deployment behind plain http. The deprecated `execCommand` path
 * still works there, and silently failing to copy an API key that is shown
 * exactly once is a bad way to find that out.
 */
export async function copyText(
  value: string,
  opts: { successMessage?: string | null; errorMessage?: string } = {},
): Promise<boolean> {
  const ok = await writeToClipboard(value)

  if (ok && opts.successMessage !== null) {
    toast.success(opts.successMessage ?? "Copied")
  } else if (!ok) {
    toast.error(opts.errorMessage ?? "Failed to copy")
  }

  return ok
}

async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through: permission denied, or a non-secure context.
  }

  try {
    const textarea = document.createElement("textarea")
    textarea.value = value
    // Off-screen rather than hidden: an element with display:none cannot be
    // selected, so the copy would be a no-op.
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
