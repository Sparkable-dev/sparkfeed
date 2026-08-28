/**
 * Ids for chat threads, generated wherever the conversation starts.
 *
 * Lives in `lib/` rather than beside the chat service because both sides need
 * it: the route mints one before anything has been typed, and the server mints
 * one for a turn that arrived without an id. A value import of anything under
 * `@/server` would pull the database into the browser bundle.
 *
 * The id is minted **before** any row exists, which is the point. Creating the
 * row first would mean a thread in the sidebar for every visit to the AI page,
 * including the ones where nobody says anything. The row appears on the first
 * save instead.
 */
export function newChatId(): string {
  return `cht_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
}

/**
 * Ids assistant-ui minted for itself before the client started sending the
 * URL's id on every turn. Threads saved during that window are keyed on one of
 * these, so the check has to keep letting them through or a conversation the
 * user can see in the sidebar opens as "Not Found".
 */
const LEGACY_LOCAL_ID = /^__LOCALID_[A-Za-z0-9_-]{4,32}$/

/** Cheap shape check, so a hand-typed URL cannot reach the database. */
export function isChatId(value: string): boolean {
  return /^cht_[a-z0-9]{8,32}$/.test(value) || LEGACY_LOCAL_ID.test(value)
}
