import { invalidArgument } from './errors'

/**
 * Prefixed public identifiers.
 *
 * Purely a presentation concern: prefixes are added on the way out and stripped
 * on the way in, never stored. The database keeps bare UUIDs, so this needs no
 * migration and does not disturb the web app, which passes raw ids around.
 *
 * The prefix does carry real information though. `articles` and
 * `scraped_articles` are separate tables with disjoint UUID spaces, so
 * `get_article("...")` is ambiguous without one: `art_` and `scr_` are what
 * tell the service which table to read.
 */

export const ID_PREFIXES = {
  folder: 'fld_',
  feed: 'fed_',
  scrapedFeed: 'sfd_',
  article: 'art_',
  scrapedArticle: 'scr_',
  apiKey: 'key_',
  job: 'job_',
  workspace: 'ws_',
} as const

export type IdKind = keyof typeof ID_PREFIXES

export function encodeId(kind: IdKind, raw: string): string {
  return `${ID_PREFIXES[kind]}${raw}`
}

/**
 * Strips and validates a prefix. Throws rather than silently accepting a bare
 * id, so a client that guesses the format gets told, and so an `art_` id can
 * never be routed to the scraped-article table.
 */
export function decodeId(kind: IdKind, value: string): string {
  const prefix = ID_PREFIXES[kind]
  if (!value.startsWith(prefix)) {
    throw invalidArgument(`Expected an id starting with "${prefix}", got "${truncate(value)}".`)
  }
  const raw = value.slice(prefix.length)
  if (!raw) throw invalidArgument(`Id "${truncate(value)}" is missing its identifier.`)
  return raw
}

/**
 * For ids that may address either article table. Returns which table to read
 * along with the bare id.
 */
export function decodeArticleId(value: string): { raw: string; scraped: boolean } {
  if (value.startsWith(ID_PREFIXES.scrapedArticle)) {
    return { raw: decodeId('scrapedArticle', value), scraped: true }
  }
  return { raw: decodeId('article', value), scraped: false }
}

function truncate(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value
}
