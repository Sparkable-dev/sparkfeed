/**
 * Converts a string to a URL-safe slug.
 * e.g. "Amazon Blogs" → "amazon-blogs", "FAANG" → "faang"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")   // remove non-word chars except spaces and hyphens
    .replace(/[\s_]+/g, "-")    // spaces/underscores → hyphens
    .replace(/-+/g, "-")        // collapse multiple hyphens
}
