import { createFileRoute } from "@tanstack/react-router"
import { RSSShell } from "@/components/RSSShell"
import { McpPanel } from "@/components/developer/McpPanel"
import { getAllData } from "@/server/rss"

/**
 * Uses the same loader as every other page even though this one only renders a
 * connection string: RSSShell draws the sidebar, which needs folders, feeds and
 * per-folder article counts. A leaner loader would render a visibly empty
 * sidebar, and the router already has this data cached from wherever the user
 * navigated in from.
 */
export const Route = createFileRoute("/_protected/developer/mcp")({
  loader: () => getAllData(),
  component: McpRoute,
})

function McpRoute() {
  const data = Route.useLoaderData()

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles as any }}
      title="MCP"
      crumbs={[{ label: "Developer" }]}
    >
      <McpPanel />
    </RSSShell>
  )
}
