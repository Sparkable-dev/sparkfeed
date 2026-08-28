import { z } from "zod"
import { getWorkspaceInfo, listFeeds, listFolders } from "../services/workspace"
import { getArticle, searchArticles } from "../services/articles"
import { setArticleFlag } from "../services/curation"
import { findFeeds, verifyFeed } from "../services/discovery"
import { readUrl } from "../services/reader"
import { CHART_METRICS, buildChart } from "../services/charts"
import { addFeed, createFolder, moveFeed } from "../services/sources-write"
import { MAX_LIMIT } from "../services/pagination"
import type { ChartMetric } from "../services/charts"
import type { ApiPrincipal, Scope } from "../api/principal"
import type { AutonomyId } from "@/config/autonomy"
import { AUTONOMY_RANK } from "@/config/autonomy"

/**
 * Every tool Spark AI has, defined once.
 *
 * This file exists because there are two consumers — the MCP server at
 * `/api/mcp` (for Claude Desktop, Cursor and friends) and the in-app chat's AI
 * SDK tool map — and a tool defined twice is a tool that drifts. The
 * registration code in `mcp/tools/index.ts` used to *be* the definitions;
 * adding a second consumer by copy-paste would have guaranteed the two
 * gradually disagreed about names, schemas and scopes.
 *
 * `description` is the highest-leverage text in this file. It is the only thing
 * the model reads when deciding which tool to call, and vague descriptions are
 * the main cause of wrong-tool selection.
 *
 * Deliberately absent: a "list recent items for one feed" tool. It would
 * overlap `search_articles({feed_id})` exactly, and overlapping tools are worse
 * than a missing one — the model picks between them badly.
 */

export interface ToolAnnotations {
  readOnlyHint: boolean
  destructiveHint?: boolean
  idempotentHint: boolean
  /** Whether the tool may reach the public internet. */
  openWorldHint: boolean
}

/**
 * How a tool is exposed over HTTP.
 *
 * The REST surface at `/api/v1` is generated from these rather than written by
 * hand, which is what keeps it, the MCP tool list and the OpenAPI document
 * describing the same thing. Adding a tool adds an endpoint and a documented
 * operation; there is no second place to remember to update.
 *
 * `path` may contain a single `{param}` segment. It is merged into the args
 * object before validation, so `inputSchema` stays the one description of a
 * tool's input regardless of whether the value arrived in the path, the query
 * string or a JSON body.
 */
export interface ToolHttp {
  method: "GET" | "POST" | "PATCH"
  /** Relative to `/api/v1`, e.g. `/articles/{id}`. */
  path: string
  /** Where non-path arguments come from. Reads use the query string. */
  paramsIn: "query" | "body"
}

export interface ToolDef<TArgs = any, TResult = any> {
  name: string
  title: string
  description: string
  /** Consumed verbatim by both MCP's `inputSchema` and AI SDK's `tool()`. */
  inputSchema: z.ZodType<TArgs>
  annotations: ToolAnnotations
  scope?: Scope
  /** The least permissive autonomy level that may run this tool. */
  minAutonomy: AutonomyId
  /** REST binding. Every tool has one — see ToolHttp. */
  http: ToolHttp
  run: (principal: ApiPrincipal, args: TArgs) => Promise<TResult>
  /** One-line human summary; MCP puts it in `content`, chat logs it. */
  summarize: (result: TResult) => string
}

function def<TArgs, TResult>(d: ToolDef<TArgs, TResult>): ToolDef {
  return d as ToolDef
}

const articleIds = z
  .array(z.string())
  .min(1)
  .max(100)
  .describe('Article ids from search_articles, e.g. ["art_abc123"].')

export const TOOL_REGISTRY: Array<ToolDef> = [
  // ── Orientation ────────────────────────────────────────────────────────
  def({
    name: "get_workspace_info",
    title: "Get workspace info",
    description:
      "Overview of the whole workspace: how many folders, feeds and articles there are, how " +
      "much is unread, which folders and feeds are busiest, and which feeds are failing. Call " +
      "this first for any question about the size, shape or health of the workspace — it " +
      'answers "how many feeds do I have" completely, so no follow-up calls are needed.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    },
    scope: "workspace:read",
    minAutonomy: "read-only",
    http: { method: "GET", path: "/workspace", paramsIn: "query" },
    run: (p) => getWorkspaceInfo(p),
    summarize: (r) =>
      `${r.counts.feeds} feeds in ${r.counts.folders} folders, ${r.counts.unread} unread.`,
  }),

  def({
    name: "list_folders",
    title: "List folders",
    description:
      "Every folder, with its parent folder, feed count and unread count. Use this to describe " +
      "how the workspace is organised, or to find a folder id before filtering or writing. " +
      "Cheap; returns no article content.",
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    },
    scope: "workspace:read",
    minAutonomy: "read-only",
    http: { method: "GET", path: "/folders", paramsIn: "query" },
    run: (p) => listFolders(p),
    summarize: (r) => `${r.folders.length} folders.`,
  }),

  def({
    name: "list_feeds",
    title: "List feeds",
    description:
      "Feed sources with their folder, recent volume, unread count, last fetch time and last " +
      'error. Includes both RSS feeds and scraped sites. Use it to answer "what am I ' +
      'subscribed to" or to find a feed id.',
    inputSchema: z.object({
      folder_id: z
        .string()
        .optional()
        .describe('Restrict to one folder, e.g. "fld_abc123".'),
      limit: z.number().int().optional().describe("Default 100, max 200."),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    },
    scope: "workspace:read",
    minAutonomy: "read-only",
    http: { method: "GET", path: "/feeds", paramsIn: "query" },
    run: (p, a: { folder_id?: string; limit?: number }) =>
      listFeeds(p, { folderId: a.folder_id, limit: a.limit }),
    summarize: (r) => `${r.feeds.length} feeds.`,
  }),

  // ── Reading ────────────────────────────────────────────────────────────
  def({
    name: "search_articles",
    title: "Search articles",
    description:
      "Search the workspace, or omit `query` to get the most recent articles — which is the " +
      'right call for "what is new in X". Also the way to list one feed\'s latest items: pass ' +
      "feed_id. Returns titles, sources, dates and a short snippet only; use get_article for " +
      "the full text of one piece.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe("Free-text search over title and summary."),
      folder_id: z.string().optional(),
      feed_id: z.string().optional(),
      since: z
        .string()
        .optional()
        .describe('ISO date, or relative like "7d" or "24h".'),
      until: z.string().optional().describe('ISO date, or relative like "7d".'),
      favorites_only: z.boolean().optional(),
      unread_only: z.boolean().optional(),
      limit: z
        .number()
        .int()
        .optional()
        .describe(`Default 20, max ${MAX_LIMIT}.`),
      cursor: z
        .string()
        .optional()
        .describe("next_cursor from a previous call."),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    },
    scope: "articles:read",
    minAutonomy: "read-only",
    http: { method: "GET", path: "/articles", paramsIn: "query" },
    run: (p, a: Record<string, any>) =>
      searchArticles(p, {
        query: a.query,
        folderId: a.folder_id,
        feedId: a.feed_id,
        since: a.since,
        until: a.until,
        favoritesOnly: a.favorites_only,
        unreadOnly: a.unread_only,
        limit: a.limit,
        cursor: a.cursor,
      }),
    summarize: (r) =>
      `${r.articles.length} articles${r.next_cursor ? ", more available (use next_cursor)" : ""}.`,
  }),

  def({
    name: "get_article",
    title: "Get article",
    description:
      "The full text of one article, as markdown by default. The only way to read a whole " +
      "post, and deliberately one article per call. Served from cache when available, " +
      "otherwise fetched and extracted on demand. Use this before summarising or quoting.",
    inputSchema: z.object({
      id: z
        .string()
        .describe('Article id from search_articles, e.g. "art_abc123".'),
      format: z.enum(["markdown", "text", "html"]).optional(),
      max_chars: z
        .number()
        .int()
        .optional()
        .describe("Default 50000, max 80000."),
      offset: z
        .number()
        .int()
        .optional()
        .describe("Continue a long article from here."),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    scope: "articles:read",
    minAutonomy: "read-only",
    http: { method: "GET", path: "/articles/{id}", paramsIn: "query" },
    run: (
      p,
      a: { id: string; format?: any; max_chars?: number; offset?: number }
    ) =>
      getArticle(p, {
        id: a.id,
        format: a.format,
        maxChars: a.max_chars,
        offset: a.offset,
      }),
    summarize: (r) =>
      `"${r.title}" — ${r.word_count} words${r.truncated ? ", truncated (use next_offset)" : ""}.`,
  }),

  // ── Discovery ──────────────────────────────────────────────────────────
  def({
    name: "find_feeds",
    title: "Find feeds",
    description:
      "Find RSS feeds the workspace does not have yet. Give a `topic` to search a curated " +
      "catalogue of quality sources, or a `url` to scan a specific site for its feeds. " +
      "Returns sample headlines so the user can judge a source before subscribing, and marks " +
      "anything already subscribed. Use this before add_feed.",
    inputSchema: z.object({
      topic: z
        .string()
        .optional()
        .describe('What to look for, e.g. "climate tech".'),
      url: z
        .string()
        .optional()
        .describe('A site to scan, e.g. "https://theverge.com".'),
      limit: z.number().int().optional().describe("Default 8, max 20."),
    }),
    // Only the `url` branch reaches the internet, but the annotation has to
    // describe the tool's worst case, not its cheapest one.
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    scope: "workspace:read",
    minAutonomy: "read-only",
    http: { method: "GET", path: "/discover", paramsIn: "query" },
    run: (p, a: { topic?: string; url?: string; limit?: number }) =>
      findFeeds(p, { topic: a.topic, url: a.url, limit: a.limit }),
    summarize: (r) => `${r.feeds.length} candidate feeds.`,
  }),

  def({
    name: "verify_feed",
    title: "Verify a feed URL",
    description:
      "Check one address and report whether it is really an RSS or Atom feed, by fetching and " +
      "parsing it. Returns the feed's title, how many items it carries, its posting rate, when " +
      "it last published, its latest headlines, and whether this workspace already subscribes. " +
      "Use this when the user pastes a URL, or before recommending a feed you have not seen — " +
      "`find_feeds` searches for candidates, this one confirms a specific address. " +
      "A URL that is not a feed comes back with `valid: false` and a reason, which is an answer, " +
      "not a failure: say so plainly and suggest what to try instead.",
    inputSchema: z.object({
      url: z
        .string()
        .describe(
          'The address to check, e.g. "https://bair.berkeley.edu/blog/feed.xml". A homepage works too.'
        ),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    scope: "workspace:read",
    minAutonomy: "read-only",
    http: { method: "GET", path: "/discover/verify", paramsIn: "query" },
    run: (p, a: { url: string }) => verifyFeed(p, a),
    summarize: (r) =>
      r.valid
        ? `${r.title ?? r.url} — ${r.item_count} items.`
        : `Not a feed: ${r.reason}`,
  }),

  def({
    name: "read_url",
    title: "Read a web page",
    description:
      "Fetch a public web page and read its main article text. Use this when the user pastes a " +
      "link, or asks about a specific page that is not in their feeds. For an article that IS in " +
      "the workspace, use `get_article` with its id instead — that one reuses cached text and " +
      "does not refetch. " +
      "A page that cannot be extracted (a paywall, a login, an app shell) comes back with " +
      '`source_quality: "failed"` and no content: say you could not read it rather than ' +
      "guessing at what it said.",
    inputSchema: z.object({
      url: z
        .string()
        .describe("The page to read, e.g. https://example.com/some-article."),
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    scope: "articles:read",
    /*
      `ask`, unlike every other read tool.

      Not because reading a public page is dangerous — it writes nothing and
      reveals nothing about the workspace — but because it is the one read that
      makes the server reach an address chosen from the conversation. Keeping it
      off the read-only level means an unattended agent cannot be talked into
      fetching a sequence of URLs by something it read in an article.
    */
    minAutonomy: "ask",
    http: { method: "GET", path: "/read", paramsIn: "query" },
    run: (p, a: { url: string }) => readUrl(p, a),
    summarize: (r) =>
      r.source_quality === "extracted"
        ? `${r.title ?? r.domain} — ${r.word_count} words.`
        : `Could not extract ${r.domain}.`,
  }),

  def({
    name: "chart_workspace",
    title: "Chart the workspace",
    description:
      "Draw one of four charts of the user's reading, as a card they can file into a report: " +
      "`articles_over_time` (daily volume), `posting_cadence` (which day of the week is busiest), " +
      "`unread_by_folder` (where the backlog is), `top_sources` (which feeds post most). " +
      "The result carries a one-line summary — say that, and let the chart show the shape. " +
      "Do not describe every bar; the user can see them.",
    inputSchema: z.object({
      metric: z
        .enum(CHART_METRICS)
        .describe("Which chart. Pick the one that answers the question asked."),
      days: z
        .number()
        .int()
        .optional()
        .describe("History for the time-based metrics. Default 30, max 365."),
      limit: z
        .number()
        .int()
        .optional()
        .describe("Bars to show for the rankings. Default 8, max 20."),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    },
    scope: "workspace:read",
    minAutonomy: "read-only",
    http: { method: "GET", path: "/charts", paramsIn: "query" },
    run: (p, a: { metric: ChartMetric; days?: number; limit?: number }) =>
      buildChart(p, a),
    summarize: (r) => r.summary,
  }),

  // ── Writing ────────────────────────────────────────────────────────────
  def({
    name: "add_feed",
    title: "Add feed",
    description:
      "Subscribe to a feed and import its recent articles. Accepts a feed URL or a site " +
      "homepage — the feed is resolved either way. Confirm the source with the user first " +
      "unless they named it explicitly.",
    inputSchema: z.object({
      url: z.string().describe("Feed URL or site homepage."),
      folder_id: z
        .string()
        .optional()
        .describe('Folder to file it under, e.g. "fld_abc123".'),
      name: z.string().optional().describe("Override the feed title."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    scope: "feeds:write",
    minAutonomy: "ask",
    http: { method: "POST", path: "/feeds", paramsIn: "body" },
    run: (p, a: { url: string; folder_id?: string; name?: string }) =>
      addFeed(p, { url: a.url, folderId: a.folder_id, name: a.name }),
    summarize: (r) =>
      `Added "${r.feed.name}" with ${r.articles_imported} articles.`,
  }),

  def({
    name: "create_folder",
    title: "Create folder",
    description: "Create a folder, optionally nested inside an existing one.",
    inputSchema: z.object({
      name: z.string().min(1),
      parent_id: z
        .string()
        .optional()
        .describe('Nest inside this folder, e.g. "fld_abc123".'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scope: "feeds:write",
    minAutonomy: "ask",
    http: { method: "POST", path: "/folders", paramsIn: "body" },
    run: (p, a: { name: string; parent_id?: string }) =>
      createFolder(p, { name: a.name, parentId: a.parent_id }),
    summarize: (r) => `Created folder "${r.folder.name}".`,
  }),

  def({
    name: "move_feed",
    title: "Move feed",
    description:
      "Move a feed into a different folder. Pass folder_id as null to move it to the top level.",
    inputSchema: z.object({
      feed_id: z.string().describe('Feed id, e.g. "fed_abc123".'),
      folder_id: z
        .string()
        .nullable()
        .describe("Destination folder, or null for top level."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    scope: "feeds:write",
    minAutonomy: "ask",
    http: { method: "PATCH", path: "/feeds/{feed_id}", paramsIn: "body" },
    run: (p, a: { feed_id: string; folder_id: string | null }) =>
      moveFeed(p, { feedId: a.feed_id, folderId: a.folder_id }),
    summarize: (r) => `Moved "${r.feed.name}".`,
  }),

  def({
    name: "mark_read",
    title: "Mark read",
    description:
      "Mark articles read or unread. Accepts up to 100 ids so a triage pass is one call. Note " +
      "read state is shared across the whole workspace, so this affects every member.",
    inputSchema: z.object({ article_ids: articleIds, state: z.boolean() }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    scope: "articles:write",
    minAutonomy: "ask",
    http: { method: "POST", path: "/articles/read", paramsIn: "body" },
    run: (p, a: { article_ids: Array<string>; state: boolean }) =>
      setArticleFlag(p, "isUsed", a.article_ids, a.state),
    summarize: (r) => `Updated ${r.updated} articles.`,
  }),

  def({
    name: "set_favorite",
    title: "Set favorite",
    description:
      "Mark or unmark articles as favourites. Accepts up to 100 ids.",
    inputSchema: z.object({ article_ids: articleIds, state: z.boolean() }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    scope: "articles:write",
    minAutonomy: "ask",
    http: { method: "POST", path: "/articles/favorite", paramsIn: "body" },
    run: (p, a: { article_ids: Array<string>; state: boolean }) =>
      setArticleFlag(p, "isFavorite", a.article_ids, a.state),
    summarize: (r) => `Updated ${r.updated} articles.`,
  }),
]

/**
 * Which tools a caller may use.
 *
 * Two independent gates, and the order matters conceptually: the principal's
 * scopes are the ceiling (what this session is allowed to do at all), and
 * autonomy only ever narrows below it. A client that sends `autonomy: "auto"`
 * therefore cannot unlock anything its session does not already permit — which
 * is why the demo principal, holding only read scopes, stays read-only no
 * matter what the request claims.
 */
export function allowedTools(
  principal: ApiPrincipal,
  autonomy: AutonomyId = "auto"
): Array<ToolDef> {
  const ceiling = AUTONOMY_RANK[autonomy]
  return TOOL_REGISTRY.filter(
    (t) =>
      (!t.scope || principal.scopes.includes(t.scope)) &&
      ceiling >= AUTONOMY_RANK[t.minAutonomy]
  )
}

export function getTool(name: string): ToolDef | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name)
}
