import { createFileRoute } from "@tanstack/react-router"
import { RSSShell } from "@/components/RSSShell"
import { ApiKeysPanel } from "@/components/developer/ApiKeysPanel"
import { getAllData } from "@/server/rss"

export const Route = createFileRoute("/_protected/developer/keys")({
  loader: () => getAllData(),
  component: KeysRoute,
})

function KeysRoute() {
  const data = Route.useLoaderData()

  return (
    <RSSShell
      initialData={{ folders: data.folders, feeds: data.feeds, articles: data.articles as any }}
      title="API keys"
      crumbs={[{ label: "Developer" }]}
    >
      <ApiKeysPanel />
    </RSSShell>
  )
}
