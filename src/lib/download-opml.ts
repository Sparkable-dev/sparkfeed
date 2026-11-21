import { slugify } from "./slugify"

export async function downloadOpml(workspaceId: string, folderId?: string) {
  const { exportOpml } = await import("@/server/opml")
  const result = await exportOpml({ data: { workspaceId, folderId } })
  if (result.status === "error") return result.message

  const url = URL.createObjectURL(
    new Blob([result.xml], { type: "text/x-opml;charset=utf-8" })
  )
  const link = document.createElement("a")
  link.href = url
  const name = result.folderName
    ? slugify(result.folderName) || "folder"
    : "subscriptions"
  link.download = "sparkfeed-" + name + ".opml"
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return null
}
