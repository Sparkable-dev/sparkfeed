import {  encodeCursor } from './pagination'
import type {Cursor} from './pagination';

/**
 * A hard ceiling on how much any one response can be.
 *
 * Enforced here, inside the service, rather than in the transport. If the
 * transport truncated after the fact, `next_cursor` would already point past
 * the rows it dropped and the agent would silently lose them.
 *
 * 50KB rather than the 100KB in the spec: a `CallToolResult` conventionally
 * carries the payload twice, once as `structuredContent` and once as text, so
 * the wire cost is double whatever is counted here.
 */
export const MAX_RESPONSE_BYTES = 50_000

export interface BudgetResult<T> {
  items: Array<T>
  truncated: boolean
  nextCursor: string | null
  hint?: string
}

/**
 * Trims a page to fit the byte ceiling, cutting at an item boundary and
 * re-deriving the cursor from the last item that survived.
 *
 * Always keeps at least one item. A single oversized row is better returned and
 * visibly large than silently dropped, and `get_article` has its own character
 * cap for the case where one row really is the problem.
 */
export function withBudget<T>(
  items: Array<T>,
  opts: {
    nextCursor: string | null
    cursorOf: (item: T) => Cursor
    maxBytes?: number
  },
): BudgetResult<T> {
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES
  let used = 0

  for (let i = 0; i < items.length; i++) {
    used += Buffer.byteLength(JSON.stringify(items[i]), 'utf8') + 1 // +1 for the comma
    if (used > maxBytes && i > 0) {
      const kept = items.slice(0, i)
      return {
        items: kept,
        truncated: true,
        nextCursor: encodeCursor(opts.cursorOf(kept[kept.length - 1])),
        hint:
          `Response exceeded ${maxBytes} bytes and was truncated to ${kept.length} items. ` +
          `Call again with the cursor, or narrow the query with folder_id, feed_id or since.`,
      }
    }
  }

  return { items, truncated: false, nextCursor: opts.nextCursor }
}
