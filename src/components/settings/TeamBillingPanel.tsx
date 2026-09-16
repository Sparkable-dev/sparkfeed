import { useState } from "react"
import { CalendarClock, Loader2, Mail, Users } from "lucide-react"
import { toast } from "sonner"
import { OnlineTeamBillingPanel } from "./OnlineTeamBillingPanel"
import type { WorkspaceDetail } from "@/server/workspace-management"
import { DEMO_MODE } from "@/lib/demo"
import { submitWorkspacePlanRequest } from "@/server/workspace-management"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

function dateLabel(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date)
}

export function TeamBillingPanel({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDetail
  onChanged: () => Promise<void> | void
}) {
  const [changeOpen, setChangeOpen] = useState(false)
  const [onlineOpen, setOnlineOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [expectedSeats, setExpectedSeats] = useState(
    String(workspace.seatCapacity ?? Math.max(2, workspace.usedSeats))
  )
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const periodEnd = dateLabel(workspace.currentPeriodEnd)

  if ((workspace.billingSource === "dodo" || onlineOpen) && workspace.role === "owner" && !DEMO_MODE)
    return <OnlineTeamBillingPanel workspace={workspace} onChanged={onChanged} />

  const submit = async (requestType: "change_plan" | "cancel_plan") => {
    setBusy(true)
    try {
      await submitWorkspacePlanRequest({
        data: {
          organizationId: workspace.id,
          requestType,
          expectedSeats:
            requestType === "change_plan" ? Number(expectedSeats) : null,
          message,
        },
      })
      toast.success(
        requestType === "cancel_plan"
          ? "Cancellation request sent."
          : "Plan request sent."
      )
      setChangeOpen(false)
      setCancelOpen(false)
      setMessage("")
      await onChanged()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send the request."
      )
    } finally {
      setBusy(false)
    }
  }

  if (workspace.plan === "community") {
    return (
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="font-semibold">Community Edition</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This instance does not use Sparkfeed Cloud billing.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      {workspace.teamCheckoutAvailable && workspace.plan === "pro" && workspace.billingSource === "manual" && workspace.role === "owner" && !DEMO_MODE && <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Move to online billing</h2><p className="mt-1 text-sm text-muted-foreground">Choose monthly or annual payments with Dodo. Your current team access stays in place until payment succeeds.</p><Button className="mt-3" variant="outline" onClick={() => setOnlineOpen(true)}>Set up online payments</Button></section>}
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{workspace.planLabel}</h2>
              <Badge variant="secondary" className="capitalize">
                {workspace.billingStatus.replaceAll("_", " ")}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {workspace.billingSource === "manual"
                ? "Sparkable manages this team plan."
                : "No team plan has been activated."}
            </p>
          </div>
          {workspace.openBillingRequest ? (
            <Badge variant="outline" className="w-fit capitalize">
              Request {workspace.openBillingRequest.status.replace("_", " ")}
            </Badge>
          ) : null}
        </div>

        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4 sm:px-6">
            <p className="text-xs text-muted-foreground">Seats</p>
            <p className="mt-1 font-semibold tabular-nums">
              {workspace.usedSeats} / {workspace.seatCapacity ?? "Unlimited"}
            </p>
          </div>
          <div className="px-5 py-4 sm:px-6">
            <p className="text-xs text-muted-foreground">Sources</p>
            <p className="mt-1 font-semibold tabular-nums">
              {workspace.feedCount} / {workspace.sourceCapacity ?? "Unlimited"}
            </p>
          </div>
          <div className="px-5 py-4 sm:px-6">
            <p className="text-xs text-muted-foreground">Billing owner</p>
            <p className="mt-1 font-semibold">Workspace Owner</p>
          </div>
        </div>

        {periodEnd ? (
          <div className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground sm:px-6">
            <CalendarClock className="size-4" />
            Current period ends {periodEnd}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Plan changes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Team payments are not self-service yet. Sparkable reviews each
              change.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
              <DialogTrigger
                render={
                  <Button
                    variant="outline"
                    disabled={
                      DEMO_MODE || Boolean(workspace.openBillingRequest)
                    }
                  >
                    <Users className="size-4" />
                    Request a change
                  </Button>
                }
              />
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Request a plan change</DialogTitle>
                  <DialogDescription>
                    Tell us the seat count you need. We will confirm the plan
                    before changing access.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="plan-seats">Expected people</Label>
                    <Input
                      id="plan-seats"
                      type="number"
                      min={1}
                      max={500}
                      value={expectedSeats}
                      onChange={(event) => setExpectedSeats(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plan-note">Notes</Label>
                    <Textarea
                      id="plan-note"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      maxLength={2000}
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => void submit("change_plan")}
                    disabled={busy || Number(expectedSeats) < 1}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    Send request
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={
                      Boolean(workspace.openBillingRequest) ||
                      DEMO_MODE ||
                      workspace.billingStatus === "canceled"
                    }
                  >
                    Request cancellation
                  </Button>
                }
              />
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Cancel the team plan?</DialogTitle>
                  <DialogDescription>
                    Sparkable will review the request. The workspace stays
                    available until the plan is changed.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="cancel-note">Notes</Label>
                  <Textarea
                    id="cancel-note"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={2000}
                    placeholder="Optional"
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="destructive"
                    onClick={() => void submit("cancel_plan")}
                    disabled={busy}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    Send cancellation request
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <Mail className="mt-0.5 size-4 shrink-0" />
        Request status stays visible here while Sparkable reviews it.
      </div>
    </div>
  )
}
