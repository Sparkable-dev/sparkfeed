import { defineToolkit } from "@assistant-ui/react"
import { WorkspaceOverview } from "./WorkspaceOverview"
import { FolderTree } from "./FolderTree"
import { FeedTable } from "./FeedTable"
import { ArticleResults } from "./ArticleResults"
import { ArticleCard } from "./ArticleCard"
import { FeedDiscovery } from "./FeedDiscovery"
import { FeedVerification } from "./FeedVerification"
import { FeedAdded } from "./FeedAdded"
import { ReadUrlCard } from "./ReadUrlCard"
import { WebSearchResults } from "./WebSearchResults"
import { ChartCard } from "./ChartCard"
import { ArtifactCard } from "@/components/ai/artifacts/ArtifactCard"

/**
 * Client-side renderers for tool calls.
 *
 * These entries are **render-only**. The server owns every schema and every
 * executor (`src/server/tools/registry.ts`); nothing here describes what a tool
 * does or how to run it, only how its result looks. That split is why no
 * `"use generative"` compiler is needed — `type: "backend"` states outright
 * that execution happens server-side, which is exactly true.
 *
 * The five write tools are deliberately absent. Their results are a sentence
 * ("Added The Verge with 40 articles"), which the model says better in prose
 * than a component would; they fall through to `ToolFallback`, and the model's
 * own reply carries the confirmation.
 */
export const sparkToolkit = defineToolkit({
  get_workspace_info: { type: "backend", render: WorkspaceOverview },
  list_folders: { type: "backend", render: FolderTree },
  list_feeds: { type: "backend", render: FeedTable },
  search_articles: { type: "backend", render: ArticleResults },
  get_article: { type: "backend", render: ArticleCard },
  find_feeds: { type: "backend", render: FeedDiscovery },
  verify_feed: { type: "backend", render: FeedVerification },
  read_url: { type: "backend", render: ReadUrlCard },
  web_search: { type: "backend", render: WebSearchResults },
  chart_workspace: { type: "backend", render: ChartCard },

  // The only write tool with a renderer. Asking Spark to subscribe and clicking
  // Add on a card are the same action, so they should not look like different
  // features. The other four writes still fall through to prose.
  add_feed: { type: "backend", render: FeedAdded },

  // The odd one out, and the only renderer that reads `args` rather than
  // `result`: the document streams in as the call's arguments, and the tool
  // returns nothing but an acknowledgement. See `src/server/ai/artifacts.ts`.
  create_artifact: { type: "backend", render: ArtifactCard },
})
