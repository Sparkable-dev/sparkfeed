import { createFileRoute } from "@tanstack/react-router"
import { loadWorkspaceData } from "@/lib/workspace-query"
import { RSSShell } from "@/components/RSSShell"
import { ApiKeysPanel } from "@/components/developer/ApiKeysPanel"

export const Route = createFileRoute("/_protected/developer/keys")({
  loader: ({ context }) => loadWorkspaceData(context),
  component: KeysRoute,
})

function KeysRoute() {
  const data = Route.useLoaderData()

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles }}
      title="API keys"
      crumbs={[{ label: "Developer" }]}
    >
      <ApiKeysPanel />
    </RSSShell>
  )
}
