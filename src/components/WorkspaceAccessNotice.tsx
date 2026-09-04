import { useEffect, useState } from "react"
import { AlertTriangle, BadgeCheck } from "lucide-react"
import type {
  WorkspaceAccessNotice as Notice,
  WorkspaceAccessSnapshot,
} from "@/lib/workspace-access-notice"
import { workspaceAccessNotice } from "@/lib/workspace-access-notice"
import { DEMO_MODE } from "@/lib/demo"
import { getActiveWorkspaceAccessState } from "@/server/workspace-access-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const STORAGE_PREFIX = "sparkfeed:workspace-access:"

function stableKey(snapshot: WorkspaceAccessSnapshot): string {
  return snapshot.workspaceKey.split(":").slice(0, 2).join(":")
}

function readSnapshot(key: string): WorkspaceAccessSnapshot | null {
  try {
    const value = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    return value ? (JSON.parse(value) as WorkspaceAccessSnapshot) : null
  } catch {
    return null
  }
}

function rememberSnapshot(snapshot: WorkspaceAccessSnapshot): void {
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${stableKey(snapshot)}`,
      JSON.stringify(snapshot)
    )
  } catch {
    // A blocked storage API must not block access-state checks.
  }
}

function copyFor(notice: Notice) {
  const { current, previous } = notice
  if (notice.kind === "plan_changed") {
    return {
      title: "Workspace plan changed",
      description: `The plan for ${current.workspaceName} changed from ${previous?.planLabel ?? "its previous plan"} to ${current.planLabel}. Limits and feature access now follow ${current.planLabel}.`,
    }
  }
  if (notice.kind === "access_restored") {
    return {
      title: "Workspace access restored",
      description: `${current.workspaceName} is active again. You can continue using the features included with ${current.planLabel}.`,
    }
  }
  if (notice.kind === "billing_changed") {
    return {
      title: "Workspace billing status changed",
      description: `The billing status for ${current.workspaceName} is now ${current.billingStatus.replaceAll("_", " ")}. Review the workspace plan if this is unexpected.`,
    }
  }
  if (current.accessState === "read_only") {
    return {
      title: "Workspace is read-only",
      description: `${current.workspaceName} is read-only while its billing status is ${current.billingStatus.replaceAll("_", " ")}. Review the workspace plan or contact support if this is unexpected.`,
    }
  }
  return {
    title: "Workspace access suspended",
    description: `${current.workspaceName} was suspended by Sparkfeed Cloud. Plan-gated features and workspace administration are unavailable until access is restored.`,
  }
}

export function WorkspaceAccessNotice() {
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    if (DEMO_MODE) return
    let stopped = false

    const check = async () => {
      try {
        const current = await getActiveWorkspaceAccessState()
        if (!current || stopped) return
        const previous = readSnapshot(stableKey(current))
        const next = workspaceAccessNotice(previous, current)
        rememberSnapshot(current)
        if (next) setNotice(next)
      } catch {
        // The app's normal request/error handling remains authoritative.
      }
    }

    const onFocus = () => void check()
    void check()
    const interval = window.setInterval(check, 30_000)
    window.addEventListener("focus", onFocus)
    return () => {
      stopped = true
      window.clearInterval(interval)
      window.removeEventListener("focus", onFocus)
    }
  }, [])

  if (!notice) return null
  const copy = copyFor(notice)
  const Icon = notice.kind === "access_restored" ? BadgeCheck : AlertTriangle

  return (
    <Dialog open onOpenChange={(open) => !open && setNotice(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Icon className="size-5" />
          </div>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
          <Button
            onClick={() => {
              window.location.href = "/settings?tab=workspaces"
            }}
          >
            Review workspaces
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
