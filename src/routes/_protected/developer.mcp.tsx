import { createFileRoute } from "@tanstack/react-router"
import { loadWorkspaceData } from "@/lib/workspace-query"
import { RSSShell } from "@/components/RSSShell"
import { McpPanel } from "@/components/developer/McpPanel"

/**
 * Uses the same loader as every other page even though this one only renders a
 * connection string: RSSShell draws the sidebar, which needs folders, feeds and
 * per-folder article counts. A leaner loader would render a visibly empty
 * sidebar, and the router already has this data cached from wherever the user
 * navigated in from.
 */
export const Route = createFileRoute("/_protected/developer/mcp")({
  loader: ({ context }) => loadWorkspaceData(context),
  component: McpRoute,
})

function McpRoute() {
  const data = Route.useLoaderData()

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles }}
      title="MCP"
      crumbs={[{ label: "Developer" }]}
    >
      <McpPanel />
    </RSSShell>
  )
}
