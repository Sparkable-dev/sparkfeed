import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"
import {
  Activity,
  Ban,
  Building2,
  ClipboardList,
  CreditCard,
  History,
  KeyRound,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  Webhook,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import { getPlatformAdminRouteState } from "@/server/admin/route-state"

type Tab = "users" | "workspaces" | "requests" | "webhooks" | "audit"
type JsonRecord = Record<string, unknown>

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const state = await getPlatformAdminRouteState()
    if (state.state === "not_found" || state.state === "forbidden")
      throw notFound()
    if (state.state === "unauthenticated") {
      throw redirect({ to: "/login", search: { redirect: "/admin" } as never })
    }
    if (state.state === "totp_required") {
      throw redirect({
        to: "/two-factor",
        search: { redirect: "/admin" } as never,
      })
    }
    return { actor: state.actor }
  },
  component: AdminPortal,
})

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/platform-admin/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || "Admin request failed.")
  return body
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function when(value: unknown): string {
  if (!value) return "—"
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function reasonFor(label: string): string | null {
  const value = window.prompt(`${label}\n\nAudit reason (required):`)?.trim()
  if (!value) {
    toast.error("A non-empty audit reason is required.")
    return null
  }
  return value
}

function AdminPortal() {
  const { actor } = Route.useRouteContext()
  const [tab, setTab] = useState<Tab>("users")
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<Array<JsonRecord>>([])
  const [selected, setSelected] = useState<JsonRecord | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setSelected(null)
    try {
      if (tab === "users") {
        const result = await api<{ users: Array<JsonRecord> }>(
          `users?q=${encodeURIComponent(query)}`
        )
        setRows(result.users)
      } else if (tab === "workspaces") {
        const result = await api<{ workspaces: Array<JsonRecord> }>(
          `workspaces?q=${encodeURIComponent(query)}`
        )
        setRows(result.workspaces)
      } else if (tab === "requests") {
        const result = await api<{ requests: Array<JsonRecord> }>(
          `requests?q=${encodeURIComponent(query)}`
        )
        setRows(result.requests)
      } else if (tab === "webhooks") {
        const result = await api<{ webhooks: Array<JsonRecord> }>("webhooks")
        setRows(result.webhooks)
      } else {
        const result = await api<{ audit: Array<JsonRecord> }>("audit")
        setRows(result.audit)
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load admin data."
      )
    } finally {
      setLoading(false)
    }
  }, [query, tab])

  useEffect(() => {
    void load()
  }, [load])

  const mutate = async (payload: JsonRecord) => {
    try {
      await api("mutations", { method: "POST", body: JSON.stringify(payload) })
      toast.success("Admin change recorded.")
      await load()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Admin change failed."
      )
    }
  }

  const openDetail = async (row: JsonRecord) => {
    try {
      if (tab === "users") {
        setSelected(
          await api<JsonRecord>(`users/${encodeURIComponent(String(row.id))}`)
        )
      } else if (tab === "workspaces") {
        setSelected(
          await api<JsonRecord>(
            `workspaces/${encodeURIComponent(String(row.workspaceType))}/${encodeURIComponent(String(row.workspaceId))}`
          )
        )
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load details."
      )
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
    { id: "users", label: "Users", icon: Users },
    { id: "workspaces", label: "Workspaces", icon: Building2 },
    { id: "requests", label: "Team requests", icon: ClipboardList },
    { id: "webhooks", label: "Webhook failures", icon: Webhook },
    { id: "audit", label: "Audit history", icon: History },
  ]

  return (
    <main className="min-h-screen bg-[#08090b] text-zinc-100">
      <header className="border-b border-white/8 bg-[#0d0f12]">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-violet-600 p-2.5">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h1 className="font-semibold">Sparkfeed Cloud</h1>
              <p className="text-xs text-zinc-500">Platform administration</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm text-zinc-300">{actor.email}</p>
              <p className="text-xs text-emerald-400">TOTP verified</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-white/10 bg-white/5"
              onClick={async () => {
                await authClient.signOut()
                window.location.href = "/login"
              }}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-6 px-6 py-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="space-y-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setTab(id)
                setQuery("")
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${tab === id ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"}`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        <section className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">
                {tabs.find((item) => item.id === tab)?.label}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Operational records from Sparkfeed's local authority.
              </p>
            </div>
            <div className="flex gap-2">
              {(tab === "users" ||
                tab === "workspaces" ||
                tab === "requests") && (
                <div className="relative">
                  <Search className="absolute top-2.5 left-3 size-4 text-zinc-500" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search"
                    className="w-72 border-white/10 bg-white/5 pl-9"
                  />
                </div>
              )}
              <Button
                variant="outline"
                onClick={() => void load()}
                className="border-white/10 bg-white/5"
              >
                <RefreshCw className="size-4" />
                Refresh
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/8 bg-[#0d0f12]">
            {loading ? (
              <div className="p-10 text-center text-sm text-zinc-500">
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-500">
                No records found.
              </div>
            ) : (
              <AdminTable
                tab={tab}
                rows={rows}
                onOpen={openDetail}
                onMutate={mutate}
              />
            )}
          </div>
          {selected && (
            <DetailPanel
              tab={tab}
              detail={selected}
              onClose={() => setSelected(null)}
              onMutate={mutate}
            />
          )}
        </section>
      </div>
    </main>
  )
}

function AdminTable({
  tab,
  rows,
  onOpen,
  onMutate,
}: {
  tab: Tab
  rows: Array<JsonRecord>
  onOpen: (row: JsonRecord) => void
  onMutate: (payload: JsonRecord) => void
}) {
  const columns =
    tab === "users"
      ? [
          ["name", "User"],
          ["emailVerified", "Verified"],
          ["lastActivityAt", "Last activity"],
          ["banned", "Banned"],
        ]
      : tab === "workspaces"
        ? [
            ["name", "Workspace"],
            ["planKey", "Plan"],
            ["accessState", "Access"],
            ["subscriptionStatus", "Subscription"],
          ]
        : tab === "webhooks"
          ? [
              ["webhookId", "Webhook"],
              ["eventType", "Event"],
              ["attemptCount", "Attempts"],
              ["lastError", "Last error"],
            ]
          : tab === "requests"
            ? [
                ["workspaceName", "Workspace"],
                ["email", "Requester"],
                ["requestType", "Request"],
                ["expectedSeats", "Seats"],
                ["status", "Status"],
              ]
            : [
                ["action", "Action"],
                ["targetId", "Target"],
                ["reason", "Reason"],
                ["createdAt", "When"],
              ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-white/8 bg-white/[0.02] text-left text-xs tracking-wide text-zinc-500 uppercase">
          <tr>
            {columns.map(([key, label]) => (
              <th key={key} className="px-4 py-3 font-medium">
                {label}
              </th>
            ))}
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/6">
          {rows.map((row, index) => (
            <tr
              key={String(row.id || row.workspaceId || row.webhookId || index)}
              className="hover:bg-white/[0.03]"
            >
              {columns.map(([key]) => (
                <td
                  key={key}
                  className="max-w-sm truncate px-4 py-3 text-zinc-300"
                >
                  {key.endsWith("At") ? when(row[key]) : display(row[key])}
                </td>
              ))}
              <td className="px-4 py-3 text-right">
                {(tab === "users" || tab === "workspaces") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onOpen(row)}
                  >
                    Open
                  </Button>
                )}
                {tab === "webhooks" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const reason = reasonFor(
                        "Replay this failed webhook by reconciling its current subscription state?"
                      )
                      if (reason)
                        void onMutate({
                          action: "replay_webhook",
                          webhookId: row.webhookId,
                          reason,
                        })
                    }}
                  >
                    Replay
                  </Button>
                )}
                {tab === "requests" &&
                  row.status !== "approved" &&
                  row.status !== "declined" && (
                    <div className="flex justify-end gap-1">
                      {row.status === "pending" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const reason = reasonFor(
                              "Mark this request in review?"
                            )
                            if (reason)
                              void onMutate({
                                action: "mark_team_request_in_review",
                                requestId: row.id,
                                reason,
                              })
                          }}
                        >
                          Review
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (row.requestType === "cancel_plan") {
                            const decisionNote =
                              window
                                .prompt(
                                  "Customer-facing note",
                                  "Cancellation approved"
                                )
                                ?.trim() || ""
                            const reason = reasonFor(
                              "Approve this team-plan cancellation?"
                            )
                            if (reason)
                              void onMutate({
                                action: "approve_team_cancellation",
                                requestId: row.id,
                                decisionNote,
                                reason,
                              })
                            return
                          }
                          const suggestedSeats = Number(row.expectedSeats || 2)
                          const planKey = window
                            .prompt(
                              "Plan to activate: pro or enterprise",
                              suggestedSeats > 10 ? "enterprise" : "pro"
                            )
                            ?.trim()
                          if (planKey !== "pro" && planKey !== "enterprise") {
                            if (planKey !== undefined)
                              toast.error("Plan must be pro or enterprise.")
                            return
                          }
                          const rawSeats = window
                            .prompt("Seat capacity", String(suggestedSeats))
                            ?.trim()
                          const seatCapacity = Number(rawSeats)
                          if (
                            !Number.isInteger(seatCapacity) ||
                            seatCapacity < 1
                          ) {
                            toast.error(
                              "Seat capacity must be a positive whole number."
                            )
                            return
                          }
                          const decisionNote =
                            window.prompt("Customer-facing note", "")?.trim() ||
                            ""
                          const reason = reasonFor("Approve this team request?")
                          if (reason)
                            void onMutate({
                              action: "approve_team_request",
                              requestId: row.id,
                              planKey,
                              seatCapacity,
                              decisionNote,
                              reason,
                            })
                        }}
                      >
                        {row.requestType === "cancel_plan"
                          ? "Approve cancellation"
                          : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400"
                        onClick={() => {
                          const decisionNote = window
                            .prompt("Why was this request declined?")
                            ?.trim()
                          if (!decisionNote) return
                          const reason = reasonFor("Decline this team request?")
                          if (reason)
                            void onMutate({
                              action: "decline_team_request",
                              requestId: row.id,
                              decisionNote,
                              reason,
                            })
                        }}
                      >
                        Decline
                      </Button>
                    </div>
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DetailPanel({
  tab,
  detail,
  onClose,
  onMutate,
}: {
  tab: Tab
  detail: JsonRecord
  onClose: () => void
  onMutate: (payload: JsonRecord) => void
}) {
  const account = detail.account as JsonRecord | undefined
  const subscription = detail.subscription as JsonRecord | undefined
  const isUser = tab === "users" && account
  const target = isUser ? account : subscription
  if (!target) return null
  const workspace = subscription ?? {}
  const workspaceType = String(subscription?.workspaceType || "")
  const workspaceId = String(subscription?.workspaceId || "")
  const action = (
    name: string,
    label: string,
    payload: JsonRecord,
    icon: typeof Ban = Activity
  ) => {
    const Icon = icon
    return (
      <Button
        size="sm"
        variant="outline"
        className="border-white/10 bg-white/5"
        onClick={() => {
          const reason = reasonFor(label)
          if (reason) void onMutate({ ...payload, action: name, reason })
        }}
      >
        <Icon className="size-4" />
        {label}
      </Button>
    )
  }
  const adjustCredits = () => {
    const defaultBeneficiary =
      workspaceType === "personal"
        ? workspaceId
        : String(
            (detail.members as Array<JsonRecord> | undefined)?.[0]?.userId || ""
          )
    const beneficiaryUserId = window
      .prompt("Beneficiary user ID:", defaultBeneficiary)
      ?.trim()
    if (!beneficiaryUserId) return
    const rawAmount = window
      .prompt("Credit adjustment. Use a positive or negative whole number:")
      ?.trim()
    const amount = Number(rawAmount)
    if (!Number.isInteger(amount) || amount === 0) {
      toast.error("Credit adjustment must be a non-zero whole number.")
      return
    }
    const rawBucket = window
      .prompt("Credit bucket: free or paid", "paid")
      ?.trim()
    if (rawBucket !== "free" && rawBucket !== "paid") {
      toast.error("Credit bucket must be free or paid.")
      return
    }
    const reason = reasonFor("Record this append-only credit adjustment?")
    if (reason)
      void onMutate({
        action: "adjust_credits",
        workspaceType,
        workspaceId,
        beneficiaryUserId,
        amount,
        creditBucket: rawBucket,
        reason,
      })
  }
  const setEnterpriseOverrides = () => {
    const numberOrNull = (label: string, current: unknown) => {
      const raw = window.prompt(
        `${label}. Leave blank for the plan default:`,
        current == null ? "" : String(current)
      )
      if (raw === null) throw new Error("cancel")
      if (raw.trim() === "") return null
      const value = Number(raw)
      if (!Number.isInteger(value) || value < 0) throw new Error(label)
      return value
    }
    const booleanOrNull = (label: string, current: unknown) => {
      const currentValue =
        current === null || current === undefined
          ? "default"
          : current
            ? "on"
            : "off"
      const raw = window
        .prompt(`${label}: default, on, or off`, currentValue)
        ?.trim()
        .toLowerCase()
      if (raw === undefined) throw new Error("cancel")
      if (raw === "default") return null
      if (raw === "on") return true
      if (raw === "off") return false
      throw new Error(`${label} must be default, on, or off`)
    }
    try {
      const overrides = {
        seatLimit: numberOrNull("Seat limit", workspace.overrideSeatLimit),
        monthlyAiCredits: numberOrNull(
          "Monthly AI credits",
          workspace.overrideMonthlyAiCredits
        ),
        sourceUnitLimit: numberOrNull(
          "Source-unit limit",
          workspace.overrideSourceUnitLimit
        ),
        apiAccess: booleanOrNull("API access", workspace.overrideApiAccess),
        mcpAccess: booleanOrNull("MCP access", workspace.overrideMcpAccess),
      }
      const reason = reasonFor("Apply these typed Enterprise entitlements?")
      if (reason)
        void onMutate({
          action: "set_enterprise_entitlements",
          workspaceType,
          workspaceId,
          overrides,
          reason,
        })
    } catch (error) {
      if (error instanceof Error && error.message !== "cancel") {
        toast.error(
          error.message.includes("must be")
            ? error.message
            : `${error.message} must be a non-negative whole number.`
        )
      }
    }
  }
  const setWorkspacePlan = () => {
    const planKey = window
      .prompt(
        "Team plan: pro or enterprise",
        String(workspace.planKey || "pro")
      )
      ?.trim()
    if (planKey !== "pro" && planKey !== "enterprise") {
      if (planKey !== undefined) toast.error("Plan must be pro or enterprise.")
      return
    }
    const rawSeats = window
      .prompt("Seat capacity", String(workspace.seatCapacity || 2))
      ?.trim()
    const seatCapacity = Number(rawSeats)
    if (!Number.isInteger(seatCapacity) || seatCapacity < 1) {
      toast.error("Seat capacity must be a positive whole number.")
      return
    }
    if (planKey === "pro" && seatCapacity > 10) {
      toast.error("Pro supports up to 10 seats. Use Enterprise above 10.")
      return
    }
    const reason = reasonFor(`Change this workspace to ${planKey}?`)
    if (reason)
      void onMutate({
        action: "set_workspace_plan",
        workspaceType: "organization",
        workspaceId,
        planKey,
        seatCapacity,
        reason,
      })
  }
  return (
    <aside className="mt-5 rounded-xl border border-white/8 bg-[#0d0f12] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isUser ? (
            <UserRound className="size-5 text-violet-400" />
          ) : (
            <Building2 className="size-5 text-violet-400" />
          )}
          <div>
            <h3 className="font-semibold">
              {display(isUser ? account.name : detail.name)}
            </h3>
            <p className="text-xs text-zinc-500">
              {display(
                isUser ? account.email : `${workspaceType}:${workspaceId}`
              )}
            </p>
          </div>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(target)
          .slice(0, 16)
          .map(([key, value]) => (
            <div key={key} className="rounded-lg bg-white/[0.03] p-3">
              <p className="text-[11px] tracking-wide text-zinc-600 uppercase">
                {key}
              </p>
              <p className="mt-1 text-sm break-words text-zinc-300">
                {key.endsWith("At") ? when(value) : display(value)}
              </p>
            </div>
          ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {isUser ? (
          <>
            {account.banned
              ? action(
                  "unban_user",
                  "Unban user",
                  { targetUserId: account.id },
                  ShieldCheck
                )
              : action(
                  "ban_user",
                  "Ban user",
                  { targetUserId: account.id },
                  Ban
                )}
            {action(
              "send_password_reset",
              "Send password reset",
              { targetUserId: account.id },
              KeyRound
            )}
          </>
        ) : (
          <>
            {workspace.accessState === "suspended"
              ? action(
                  "reactivate_workspace",
                  "Reactivate workspace",
                  { workspaceType, workspaceId },
                  ShieldCheck
                )
              : action(
                  "suspend_workspace",
                  "Suspend workspace",
                  { workspaceType, workspaceId },
                  Ban
                )}
            {workspace.dodoSubscriptionId &&
              action(
                "reconcile_subscription",
                "Reconcile subscription",
                { workspaceType, workspaceId },
                RefreshCw
              )}
            {workspaceType === "organization" &&
              workspace.billingSource === "manual" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/10 bg-white/5"
                  onClick={setWorkspacePlan}
                >
                  <Building2 className="size-4" />
                  Change team plan
                </Button>
              )}
            <Button
              size="sm"
              variant="outline"
              className="border-white/10 bg-white/5"
              onClick={adjustCredits}
            >
              <CreditCard className="size-4" />
              Adjust credits
            </Button>
            {workspace.planKey === "enterprise" && (
              <Button
                size="sm"
                variant="outline"
                className="border-white/10 bg-white/5"
                onClick={setEnterpriseOverrides}
              >
                <Activity className="size-4" />
                Edit entitlements
              </Button>
            )}
          </>
        )}
      </div>
      {isUser && (
        <SessionList
          sessions={(detail.sessions as Array<JsonRecord>) || []}
          onMutate={onMutate}
        />
      )}
      {!isUser && <WorkspaceRelations detail={detail} onMutate={onMutate} />}
    </aside>
  )
}

function SessionList({
  sessions,
  onMutate,
}: {
  sessions: Array<JsonRecord>
  onMutate: (payload: JsonRecord) => void
}) {
  return (
    <div className="mt-6">
      <h4 className="mb-2 text-sm font-medium">Sessions</h4>
      <div className="space-y-2">
        {sessions.map((item) => (
          <div
            key={String(item.id)}
            className="flex items-center justify-between rounded-lg bg-white/[0.03] p-3 text-sm"
          >
            <div>
              <p>{display(item.userAgent)}</p>
              <p className="text-xs text-zinc-500">
                {display(item.ipAddress)} · {when(item.updatedAt)}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const reason = reasonFor("Revoke this session?")
                if (reason)
                  void onMutate({
                    action: "revoke_session",
                    sessionId: item.id,
                    reason,
                  })
              }}
            >
              Revoke
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

function WorkspaceRelations({
  detail,
  onMutate,
}: {
  detail: JsonRecord
  onMutate: (payload: JsonRecord) => void
}) {
  const members = (detail.members as Array<JsonRecord>) || []
  const invitations = (detail.invitations as Array<JsonRecord>) || []
  const usage = (detail.usage as Array<JsonRecord>) || []
  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-3">
      <Relation title={`Members (${members.length})`} rows={members} />
      <div>
        <h4 className="mb-2 text-sm font-medium">
          Invitations ({invitations.length})
        </h4>
        <div className="space-y-2">
          {invitations.map((item) => (
            <div
              key={String(item.id)}
              className="flex items-center justify-between rounded-lg bg-white/[0.03] p-3 text-sm"
            >
              <span>
                {display(item.email)} · {display(item.status)}
              </span>
              {item.status === "pending" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const reason = reasonFor("Revoke this invitation?")
                    if (reason)
                      void onMutate({
                        action: "revoke_invitation",
                        invitationId: item.id,
                        reason,
                      })
                  }}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
      <Relation title={`Usage (${usage.length})`} rows={usage} />
    </div>
  )
}

function Relation({ title, rows }: { title: string; rows: Array<JsonRecord> }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={String(row.id || index)}
            className="rounded-lg bg-white/[0.03] p-3 text-xs text-zinc-400"
          >
            {Object.entries(row)
              .slice(0, 5)
              .map(([key, value]) => (
                <p key={key}>
                  <span className="text-zinc-600">{key}:</span> {display(value)}
                </p>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
