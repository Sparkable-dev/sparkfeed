import { slugify } from "./slugify"

/**
 * Builds the public URL for a shared folder or feed.
 *
 * Shape is `/sprk/<name-slug>-<uuid>`. Only the uuid resolves — the reader
 * parses it back out with `split("-").slice(-5).join("-")`, which relies on the
 * v4 uuid being exactly five hyphen-delimited groups. The slug is decorative,
 * so renaming a folder changes the pretty part of the URL but does not break
 * existing links.
 *
 * Used `slugify`, not an inline `.replace(/\s+/g, "-")`. The inline version
 * this replaces only collapsed whitespace, so a folder named "A/B Co." produced
 * a URL containing a slash — which splits into two path segments and never
 * matches the single-segment `$folderSlug` param.
 */
/**
 * Separates the decorative slug from the id.
 *
 * `slugify` strips everything outside `[a-z0-9-]`, so a tilde can never appear
 * in the name half and the split is unambiguous. The old format joined them
 * with a hyphen and recovered the id by taking the last five hyphen-delimited
 * groups — which only works if the id happens to be shaped like a v4 uuid.
 * That holds for anything `randomUUID()` produced but not for seeded ids, so
 * demo share links resolved to a nonexistent folder.
 */
const ID_SEPARATOR = "~"

const UUID_SUFFIX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function buildSharePath(name: string, id: string): string {
  const slug = slugify(name)
  return slug ? `/sprk/${slug}${ID_SEPARATOR}${id}` : `/sprk/${id}`
}

/** Absolute variant, for anything the user copies. Browser only. */
export function buildShareUrl(name: string, id: string): string {
  return `${window.location.origin}${buildSharePath(name, id)}`
}

/**
 * Recovers the entity id from a share slug.
 *
 * Falls back to the uuid-suffix rule so every link handed out before the
 * separator existed keeps working.
 */
export function parseShareSlug(slug: string): string {
  const sep = slug.lastIndexOf(ID_SEPARATOR)
  if (sep !== -1) return slug.slice(sep + 1)

  const uuid = slug.match(UUID_SUFFIX)
  if (uuid) return uuid[0]

  // No separator and no uuid: the whole thing is the id (a share path built
  // for an entity whose name slugified to nothing).
  return slug
}
