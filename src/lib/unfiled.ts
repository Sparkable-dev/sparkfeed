/**
 * What feeds that are in no folder are called.
 *
 * They had four names. The sidebar called the section "Other Feeds", /sources
 * called the same bucket "Not in a folder", the charts called it "No folder",
 * and the pickers offered "No folder" as a destination — so a feed could be
 * moved to one place and then found under three different headings, none of
 * which was obviously the place it had been put.
 *
 * It is not a folder and must never be presented as one: it cannot be renamed,
 * shared, nested or deleted, and giving it a folder-shaped name invites all
 * four. "Other feeds" says what it is — the rest of them — without implying a
 * row in the folders table.
 */
export const UNFILED_LABEL = "Other feeds"

/**
 * The same bucket, named as a destination.
 *
 * "Move to Other feeds" reads as a folder called "Other feeds"; "Move out of
 * any folder" is what actually happens. A picker is the one place where naming
 * the absence beats naming the bucket.
 */
export const UNFILED_DESTINATION = "No folder"
