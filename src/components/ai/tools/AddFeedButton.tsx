import { invalidateWorkspace } from "@/lib/workspace-query"
import * as React from "react"
import { useRouter } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  PlusIcon,
} from "lucide-react"
import { createFeed } from "@/server/rss"
import { DEMO_MODE } from "@/lib/demo"
import { cn } from "@/lib/utils"
import { useAddFeed } from "@/components/add-feed/add-feed-context"

/**
 * Subscribe to a feed, from the chat transcript.
 *
 * This reverses a decision that used to be written into `FeedDiscovery.tsx`:
 * that an Add button here would be "a second, ungated write path" around the
 * autonomy pill. The pill governs what the **agent** may do unattended. A
 * button is the **user** acting, and the user has always been able to add a
 * feed from Sources or Discover — gating a click behind the agent's leash would
 * mean the button refuses in read-only mode, which reads as broken rather than
 * as careful.
 *
 * So it calls `createFeed`: the same server function the Add Feed modal and the
 * command palette use, with the same tenancy check and the same demo gate. One
 * write path, reached from one more place.
 *
 * Add → Adding… → Added, matching `AddCatalogueButton` on the Discover page,
 * because a user who has added a feed there should not have to learn a second
 * idiom here.
 */
export function AddFeedButton({
  url,
  name,
  alreadyAdded,
  size = "default",
}: {
  url: string
  name: string
  alreadyAdded: boolean
  /** `sm` for a card in a dense list; `default` for a single verification card. */
  size?: "sm" | "default"
}) {
  const router = useRouter()
  const { openAddFeed } = useAddFeed()
  const [adding, setAdding] = React.useState(false)
  const [added, setAdded] = React.useState(false)

  // `alreadyAdded` comes from the tool result, so it survives a reload where
  // the local flag would not. It has to win, or reopening a saved conversation
  // would offer to add a feed the user already has.
  const isAdded = alreadyAdded || added

  const add = async (folderId: string | null) => {
    if (DEMO_MODE) {
      toast.warning("Feature locked in demo mode", {
        description: "Sign up to add sources to your own workspace.",
      })
      return
    }

    setAdding(true)
    try {
      const result = await createFeed({
        data: {
          name,
          url,
          folderId,
          includeKeywords: [],
          excludeKeywords: [],
        },
      })

      if (result.status === "error") {
        toast.error(result.error.message ?? "Could not add that feed")
        return
      }

      setAdded(true)
      toast.success(`Added ${name}`, {
        description: "Articles are loading.",
      })
      // The sidebar's folder tree and every unread count are loader data, so
      // they are stale the moment this succeeds.
      void invalidateWorkspace(router)
    } catch (error) {
      console.error(error)
      toast.error("Could not add that feed")
    } finally {
      setAdding(false)
    }
  }

  const height = size === "sm" ? "h-7" : "h-8"
  const text = size === "sm" ? "text-[11px]" : "text-xs"

  if (isAdded) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 text-muted-foreground",
          height,
          text
        )}
      >
        <CheckIcon className="size-3" />
        Added
      </span>
    )
  }

  return (
    <div className="inline-flex shrink-0">
      <button
        type="button"
        disabled={adding}
        onClick={() => void add(null)}
        className={cn(
          "inline-flex items-center gap-1 rounded-s-md border border-border/60 border-e-0 bg-card px-2 font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60",
          height,
          text
        )}
      >
        {adding ? (
          <Loader2Icon className="size-3 animate-spin" />
        ) : (
          <PlusIcon className="size-3" />
        )}
        {adding ? "Adding…" : "Add"}
      </button>

      {/*
        The chevron hands off to the app's one Add-sources dialog instead of
        rebuilding a folder picker here. This used to be a lazily-fetched
        DropdownMenu of folders — a fourth place that knew how to choose a
        destination, and the only one that could not create a folder.
      */}
      <button
        type="button"
        disabled={adding}
        aria-label="Choose a folder"
        onClick={() => openAddFeed({ url })}
        className={cn(
          "inline-flex items-center rounded-e-md border border-border/60 bg-card px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60",
          height
        )}
      >
        <ChevronDownIcon className="size-3" />
      </button>
    </div>
  )
}
