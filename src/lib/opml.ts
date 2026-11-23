export const MAX_OPML_BYTES = 5 * 1024 * 1024

export type OpmlDestination =
  | { kind: "preserve" }
  | { kind: "new"; name: string }
  | { kind: "existing"; folderId: string }
