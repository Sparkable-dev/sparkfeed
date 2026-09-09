/**
 * Run an async worker over a list, N at a time, keeping the input order.
 *
 * Lifted out of `discover.ts` when the bulk-add path needed the same thing.
 * Order preservation is the part worth stating: results are written back by
 * index rather than pushed, so a slow item does not move ahead of a fast one
 * and the caller can zip results against inputs.
 *
 * Shared by feed ingestion, discovery, image enrichment, and website extraction.
 */
export async function mapWithConcurrency<TItem, TResult>(
  items: Array<TItem>,
  limit: number,
  worker: (item: TItem) => Promise<TResult>,
): Promise<Array<TResult>> {
  const results = new Array<TResult>(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++
        if (i >= items.length) return
        results[i] = await worker(items[i])
      }
    }),
  )
  return results
}
