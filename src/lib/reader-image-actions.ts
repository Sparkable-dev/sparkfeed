import { toast } from "sonner"

const actionLabels = {
  copy: "Copy image",
  download: "Download image",
  open: "Open original image",
} as const

type ImageAction = keyof typeof actionLabels

const imageMimeExtensions: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
}

function imageUrl(image: HTMLImageElement) {
  return image.currentSrc || image.src
}

async function fetchImage(url: string) {
  const response = await fetch(url, {
    credentials: "omit",
    mode: "cors",
    referrerPolicy: "no-referrer",
  })
  if (!response.ok) throw new Error("Image request failed.")
  const blob = await response.blob()
  if (
    blob.type &&
    !blob.type.startsWith("image/") &&
    blob.type !== "application/octet-stream"
  ) {
    throw new Error("The image host did not return a supported image.")
  }
  return blob
}

async function asPng(blob: Blob) {
  if (blob.type.toLowerCase() === "image/png") return blob

  let bitmap: ImageBitmap | null = null
  let objectUrl: string | null = null
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob)
      const canvas = document.createElement("canvas")
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Image conversion is unavailable.")
      context.drawImage(bitmap, 0, 0)
      const png = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      )
      if (png) return png
      throw new Error("This image format could not be converted for copying.")
    }

    objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("The image could not be decoded."))
      image.src = objectUrl!
    })
    const canvas = document.createElement("canvas")
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Image conversion is unavailable.")
    context.drawImage(image, 0, 0)
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    )
    if (png) return png
    throw new Error("This image format could not be converted for copying.")
  } finally {
    bitmap?.close()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

function filenameFor(image: HTMLImageElement, url: string, blob: Blob) {
  let base = image.alt.trim()
  let urlExtension = ""
  try {
    const path = new URL(url).pathname.split("/").pop() ?? ""
    const match = path.match(/\.([a-z\d]{2,5})$/i)
    if (!base) base = path.replace(/\.[^.]+$/, "")
    urlExtension = match?.[1]?.toLowerCase() ?? ""
  } catch {
    // Keep the descriptive fallback below for unusual image URLs.
  }
  base = (base || "article-image")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
  const extension = imageMimeExtensions[blob.type.toLowerCase()] ?? urlExtension
  return `${base || "article-image"}.${extension || "img"}`
}

function announce(
  status: HTMLElement,
  message: string,
  imageUrl: string,
  success = false
) {
  status.textContent = message
  if (success) {
    toast.success(message)
  } else {
    toast.error(message, {
      action: {
        label: actionLabels.open,
        onClick: () => window.open(imageUrl, "_blank", "noopener,noreferrer"),
      },
    })
  }
}

async function runImageAction(
  action: ImageAction,
  image: HTMLImageElement,
  status: HTMLElement
) {
  const url = imageUrl(image)
  if (!url) return

  if (action === "open") {
    window.open(url, "_blank", "noopener,noreferrer")
    return
  }

  try {
    if (action === "copy") {
      if (
        typeof ClipboardItem === "undefined" ||
        !navigator.clipboard?.write ||
        ClipboardItem.supports?.("image/png") === false
      ) {
        announce(status, "Your browser cannot copy images here. Try Download image.", url)
        return
      }

      // Start the clipboard write in the click handler. Promise-backed data
      // keeps the browser's transient user activation alive while the image loads.
      const png = fetchImage(url).then(asPng)
      const write = navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ])
      await Promise.all([png, write])
      announce(status, "Image copied.", url, true)
      return
    }

    const blob = await fetchImage(url)
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = objectUrl
    link.download = filenameFor(image, url, blob)
    link.style.display = "none"
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    announce(status, "Image downloaded.", url, true)
  } catch (error) {
    const message =
      action === "copy" && error instanceof Error && error.name === "NotAllowedError"
        ? "Your browser blocked clipboard access. Allow copying or use Download image."
        : "Sparkfeed couldn’t load this image for copying or downloading. Open the original image to use your browser’s image options."
    announce(status, message, url)
  }
}

function svgIcon(name: ImageAction) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("width", "16")
  svg.setAttribute("height", "16")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "1.8")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  const paths = {
    copy: "M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z",
    download: "M12 3v12m0 0 4-4m-4 4-4-4M5 17v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3",
    open: "M14 3h7v7m0-7L10 14M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5",
  }
  path.setAttribute("d", paths[name])
  svg.append(path)
  return svg
}

function imageActionTarget(image: HTMLImageElement) {
  return image.closest("a") ?? image.closest("picture") ?? image
}

/** Add keyboard and touch friendly controls to images in sanitized reader HTML. */
export function enhanceReaderImages(container: HTMLElement) {
  const mounted: Array<{ wrapper: HTMLElement; target: Element }> = []
  const images = Array.from(container.querySelectorAll("img"))

  for (const image of images) {
    if (
      image.closest("[data-reader-image-actions]") ||
      image.hidden ||
      image.dataset.readerMediaFailed ||
      !image.isConnected
    )
      continue
    const target = imageActionTarget(image)
    const wrapper = document.createElement("span")
    wrapper.className = "reader-image-action-wrap"
    wrapper.dataset.readerImageActions = "true"
    const theme = image.getAttribute("data-reader-image-theme")
    if (theme) wrapper.setAttribute("data-reader-image-theme", theme)
    target.before(wrapper)
    wrapper.append(target)

    const controls = document.createElement("span")
    controls.className = "reader-image-action-controls"
    controls.dataset.readerImageActionControls = "true"
    const status = document.createElement("span")
    status.className = "sr-only"
    status.setAttribute("role", "status")
    status.setAttribute("aria-live", "polite")
    wrapper.append(controls, status)

    for (const action of ["copy", "download", "open"] as const) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "reader-image-action-button"
      button.setAttribute("aria-label", actionLabels[action])
      button.title = actionLabels[action]
      button.append(svgIcon(action))
      button.addEventListener("click", () => {
        if (button.disabled) return
        button.disabled = true
        button.setAttribute("aria-busy", "true")
        void runImageAction(action, image, status).finally(() => {
          button.disabled = false
          button.removeAttribute("aria-busy")
        })
      })
      controls.append(button)
    }
    mounted.push({ wrapper, target })
  }

  return () => {
    for (const { wrapper, target } of mounted) {
      if (wrapper.isConnected) wrapper.replaceWith(target)
    }
  }
}
