import { useState, useSyncExternalStore } from "react"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, Check, Copy, ExternalLink, Loader2 } from "lucide-react"
import { DeveloperPage, Section } from "./DeveloperPage"
import type { ConnectionTest } from "@/lib/mcp-config"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { copyText } from "@/lib/clipboard"
import { DEMO_MODE } from "@/lib/demo"
import {
  KEY_PLACEHOLDER,
  claudeCodeCommand,
  connectorHeaderValue,
  httpClientConfig,
  looksLikeKey,
  mcpRemoteConfig,
  normalizeKey,
  testConnection,
} from "@/lib/mcp-config"

const TOOLS = [
  ["get_workspace_info", "Counts, plan and what a key is allowed to do"],
  ["list_folders", "The workspace tree with feed counts"],
  ["list_feeds", "Sources, optionally filtered to one folder"],
  ["search_articles", "Search, or omit the query for the newest first"],
  ["get_article", "The full text of one article, as markdown"],
  ["set_favorite", "Favorite or unfavorite up to 100 articles"],
  ["mark_read", "Mark articles read or unread"],
] as const

const subscribeToOrigin = () => () => {}
const getBrowserOrigin = () => window.location.origin
const getServerOrigin = () => ""

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    const ok = await copyText(code, { successMessage: `${label} copied` })
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border dark:border-zinc-800 bg-card dark:bg-black/40 p-3 pr-12 text-[11px] leading-relaxed text-foreground dark:text-zinc-300">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${label}`}
        className="absolute top-2 right-2 rounded-md border border-border dark:border-zinc-800 bg-card dark:bg-zinc-900 p-1.5 text-muted-foreground dark:text-zinc-400 transition-colors hover:text-foreground dark:hover:text-zinc-100"
      >
        {copied ? <Check className="size-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

export function McpPanel() {
  // Hydrate with the same relative URL the server rendered, then expose the
  // deployment's real origin once the browser snapshot is available.
  const origin = useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin)
  const endpoint = `${origin}/api/mcp`

  /*
    Held in component state and nowhere else. The key never leaves the browser
    except as the Authorization header of the test request, which goes to this
    same origin — there is no server function behind this field, and nothing
    persists it.
  */
  const [key, setKey] = useState("")
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ConnectionTest | null>(null)

  const normalized = normalizeKey(key)
  const suspicious = normalized.length > 0 && !looksLikeKey(normalized)

  const onTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await testConnection(endpoint, key))
    } finally {
      setTesting(false)
    }
  }

  return (
    <DeveloperPage
      title="MCP"
      lead="Connect an AI agent to this workspace. It can browse your folders, search your feeds and read full articles, without you opening the app."
    >
      <Section
        title="Endpoint"
        description="Streamable HTTP. Authenticate with a bearer token from the API keys page."
      >
        <CodeBlock code={endpoint} label="Endpoint" />
        {DEMO_MODE && (
          <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300/90">
            This is the demo workspace. The endpoint is read-only, serves cached article text
            only, and is shared by everyone, so it is rate limited. Sign up for a free workspace
            to mint your own key and enable the write tools.
          </p>
        )}
      </Section>

      <Section
        title="Your key"
        description="Paste a key to fill in every snippet below with it, ready to copy whole. It stays in this browser tab."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={KEY_PLACEHOLDER}
            spellCheck={false}
            autoComplete="off"
            aria-label="API key"
            className="font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-2 sm:w-40"
            disabled={testing || normalized.length === 0}
            onClick={onTest}
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Test connection
          </Button>
        </div>

        {suspicious && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300/90">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            That does not look like a Sparkfeed key — they begin with{" "}
            <code>sfk_live_</code>.
          </p>
        )}

        {result?.ok === true && (
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300/90">
            <p className="font-medium">Connected.</p>
            <p className="mt-1 text-emerald-700 dark:text-emerald-300/70">
              This key can call {result.tools.length}{" "}
              {result.tools.length === 1 ? "tool" : "tools"}: {result.tools.join(", ")}
            </p>
          </div>
        )}

        {result?.ok === false && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300/90">
            <p className="font-medium">
              Not connected{result.status ? ` (${result.status})` : ""}.
            </p>
            <p className="mt-1 text-red-700 dark:text-red-300/70">{result.message}</p>
          </div>
        )}
      </Section>

      <Section
        title="Claude Code, Cursor, VS Code"
        description="These take a bearer token directly. One command:"
      >
        <CodeBlock code={claudeCodeCommand(endpoint, key)} label="Command" />
        <p className="mt-3 mb-2 text-xs text-muted-foreground">Or by config file:</p>
        <CodeBlock code={httpClientConfig(endpoint, key)} label="Config" />
      </Section>

      <Section
        title="Claude Desktop"
        description="Add a custom connector, point it at the endpoint above, and set one request header. No bridge process, no OAuth."
      >
        <div className="rounded-lg border border-border dark:border-zinc-800 bg-card dark:bg-black/20 p-3 text-xs text-muted-foreground">
          <p>
            Settings → Connectors → Add custom connector. Under request headers, set
            <code className="mx-1 text-foreground dark:text-zinc-300">Authorization</code>
            to:
          </p>
        </div>
        <div className="mt-2">
          <CodeBlock code={connectorHeaderValue(key)} label="Header value" />
        </div>
        <p className="mt-4 mb-2 text-xs text-muted-foreground">
          On an older build without request-header support, bridge it with{" "}
          <code>mcp-remote</code> instead. Keep the value in <code>env</code> as shown — Claude
          Desktop mangles arguments containing spaces:
        </p>
        <CodeBlock code={mcpRemoteConfig(endpoint, key)} label="Config" />
      </Section>

      <Section title="Available tools" description="Write tools appear only if the key carries the articles:write scope.">
        <ul className="flex flex-col divide-y divide-border dark:divide-zinc-800/60">
          {TOOLS.map(([name, desc]) => (
            <li key={name} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
              <code className="text-xs font-medium text-foreground dark:text-zinc-200">{name}</code>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </li>
          ))}
        </ul>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        {/* Base UI composes with `render`, not Radix's `asChild`. */}
        {!DEMO_MODE && (
          <Button size="sm" className="gap-2" render={<Link to={"/developer/keys"} />}>
            Create an API key
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          render={
            <a
              href="https://sparkfeed.dev/docs/developer/mcp/"
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          Documentation
          <ExternalLink className="size-3.5" />
        </Button>
      </div>
    </DeveloperPage>
  )
}
