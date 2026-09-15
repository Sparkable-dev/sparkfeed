import type { ReaderExport, ReaderExportInput } from "./reader-export"

export function prepareReaderExport(
  input: ReaderExportInput
): Promise<ReaderExport> {
  return import("./reader-export").then(({ buildReaderExport }) =>
    buildReaderExport(input)
  )
}

/** Start the write before yielding user activation, including on Safari. */
export function writeReaderClipboard(
  payload: Promise<ReaderExport>
): Promise<"rich" | "markdown"> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const html = payload.then(
      (value) => new Blob([value.html], { type: "text/html" })
    )
    const markdown = payload.then(
      (value) => new Blob([value.markdown], { type: "text/plain" })
    )
    // Some browsers reject before consuming the promised data.
    void html.catch(() => {})
    void markdown.catch(() => {})
    return navigator.clipboard
      .write([new ClipboardItem({ "text/html": html, "text/plain": markdown })])
      .then(() => "rich")
  }
  // A fresh-click retry uses prepared text if asynchronous conversion loses activation.
  return payload
    .then((value) => navigator.clipboard.writeText(value.markdown))
    .then(() => "markdown")
}
