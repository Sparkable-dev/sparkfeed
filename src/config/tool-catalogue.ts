import {
  BarChart3,
  BookOpenText,
  FileText,
  FolderTree,
  Globe,
  Radar,
  Rss,
  Star,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { AutonomyId } from "./autonomy"

/**
 * What Spark AI can actually do, grouped for humans.
 *
 * The eleven workspace tools live in `src/server/tools/registry.ts`, which the
 * client cannot import — it reaches the services layer and the database. So
 * this file is the client's view of that list: the same tools, named the way a
 * reader would describe them rather than the way the model calls them. The
 * twelfth, `create_artifact`, is chat-only and lives in `src/server/ai/`.
 *
 * Two rules keep it from becoming a lie:
 *
 *  1. `tools` holds real registry names, and a test asserts the two sides cover
 *     each other exactly. A tool added to the registry and not to a group fails
 *     the suite rather than quietly going undocumented here.
 *  2. `minAutonomy` mirrors the registry's own value for every tool in the
 *     group, so the "needs Ask" hint on a row is the same rule the server
 *     enforces, not a second guess at it.
 *
 * There are no switches. Which tools the model gets is decided by the autonomy
 * pill next to this menu and by the session's scopes on the server; a per-tool
 * toggle would be a control that silently does nothing. Each row instead drops
 * a worked example into the composer, which is what someone opening a menu
 * called "Tools" is usually trying to find out.
 */

export interface CapabilityGroup {
  id: string
  label: string
  /** One line, shown under the label. */
  description: string
  icon: LucideIcon
  /** Tool names from the registry. Kept honest by tool-catalogue.test.ts. */
  tools: Array<string>
  /** The least permissive autonomy level that may run every tool here. */
  minAutonomy: AutonomyId
  /** Dropped into the composer when the row is picked. */
  example: string
}

export const CAPABILITY_GROUPS: Array<CapabilityGroup> = [
  {
    id: "workspace",
    label: "Feeds and folders",
    description: "Counts, unread, what's busiest and what's failing.",
    icon: FolderTree,
    tools: ["get_workspace_info", "list_folders", "list_feeds"],
    minAutonomy: "read-only",
    example:
      "Give me an overview of my workspace: how many feeds and folders, how much is unread, and is anything broken?",
  },
  {
    id: "articles",
    label: "Search and read articles",
    description: "Find items across every feed and read the full text.",
    icon: BookOpenText,
    tools: ["search_articles", "get_article"],
    minAutonomy: "read-only",
    example:
      "Find the most interesting things published in my feeds this week and summarise them.",
  },
  {
    id: "web",
    label: "Search and read the web",
    description: "Search live pages, and read any of them in the side panel.",
    icon: Globe,
    tools: ["web_search", "read_url"],
    /*
      `ask` because of `read_url`, not `web_search`. The group's level has to
      cover its strictest member, or the row would promise at read-only
      something the server then refuses.
    */
    minAutonomy: "ask",
    example:
      "What is being said about small language models this week? Then read the most interesting one.",
  },
  {
    id: "discovery",
    label: "Find and check sources",
    description: "Discover feeds by topic, scan a site, or verify a URL.",
    icon: Radar,
    tools: ["find_feeds", "verify_feed"],
    minAutonomy: "read-only",
    example: "Find me five good RSS feeds about self-hosting.",
  },
  {
    id: "charts",
    label: "Chart and report",
    description: "Plot your reading, and file what matters into a report.",
    icon: BarChart3,
    tools: ["chart_workspace"],
    minAutonomy: "read-only",
    example:
      "Chart my unread by folder, and show me which day of the week is busiest.",
  },
  {
    id: "documents",
    label: "Write a document",
    description: "A digest or a page, opened in a panel beside the chat.",
    icon: FileText,
    // The one tool that is not in the registry — it does nothing to the
    // workspace, so it has no MCP or REST form. See src/server/ai/artifacts.ts.
    tools: ["create_artifact"],
    minAutonomy: "read-only",
    example:
      "Write me a markdown digest of the most interesting things in my feeds this week.",
  },
  {
    id: "sources",
    label: "Add and organise feeds",
    description: "Subscribe, create folders, move feeds between them.",
    icon: Rss,
    tools: ["add_feed", "create_folder", "move_feed"],
    minAutonomy: "ask",
    example:
      "Subscribe to https://simonwillison.net/atom/everything/ and put it in a folder called Research.",
  },
  {
    id: "curation",
    label: "Mark read and favourite",
    description: "Clear the unread pile, or star what matters.",
    icon: Star,
    tools: ["mark_read", "set_favorite"],
    minAutonomy: "ask",
    example: "Mark everything older than a week as read.",
  },
]

/** Every tool name the catalogue claims to cover. */
export const CATALOGUED_TOOLS: Array<string> = CAPABILITY_GROUPS.flatMap(
  (group) => group.tools
)
