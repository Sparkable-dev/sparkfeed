import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { WorkspaceDetail } from "@/server/workspace-management"
import {
  cancelScheduledTeamChange,
  cancelTeamPlan,
  checkoutTeam,
  confirmTeamChange,
  getTeamBillingSummary,
  openTeamPortal,
  previewTeamChange,
} from "@/server/team-billing-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Summary = Awaited<ReturnType<typeof getTeamBillingSummary>>
type Preview = Awaited<ReturnType<typeof previewTeamChange>>
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" })
    : "Not started"
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount / 100
  )

export function OnlineTeamBillingPanel({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDetail
  onChanged: () => Promise<void> | void
}) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seats, setSeats] = useState(String(workspace.seatCapacity ?? 1))
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [poll, setPoll] = useState(0)
  const previous = useRef<Summary | null>(null)
  const load = useCallback(async () => {
    const value = await getTeamBillingSummary({
      data: { workspaceId: workspace.id },
    })
    if (
      previous.current?.status === "checkout_pending" &&
      value.status === "active"
    )
      toast.success(
        "Your Pro workspace is active. You can now invite your team."
      )
    previous.current = value
    setSummary(value)
    setError(null)
    return value
  }, [workspace.id])
  useEffect(() => {
    let cancelled = false
    void load()
      .then((value) => {
        if (cancelled) return
        setSeats(
          String(value.canCheckout ? value.checkoutSeats : value.paidSeats)
        )
        setInterval(value.interval)
        if (value.status === "checkout_pending") setPoll(12)
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load billing.")
      })
    return () => {
      cancelled = true
    }
  }, [load])
  useEffect(() => {
    if (poll <= 0) return
    const timer = window.setTimeout(() => {
      void load()
        .catch(() => {})
        .finally(() => setPoll((left) => left - 1))
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [poll, load])
  const run = async (action: () => Promise<unknown>, success?: string) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      if (success) toast.success(success)
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Could not complete this billing action."
      toast.error(message)
      setError(message)
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }
  const refresh = async () => {
    await load()
    await onChanged()
  }
  const purchase = { workspaceId: workspace.id, interval, seats: Number(seats) }
  const valid =
    Number.isInteger(Number(seats)) &&
    Number(seats) >= Math.max(1, workspace.usedSeats) &&
    Number(seats) <= 10
  return (
    <div className="space-y-5" aria-busy={busy}>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Pro team billing</h2>
            <p className="text-sm text-muted-foreground">
              {workspace.name} · Only the Owner can manage payments.
            </p>
          </div>
          <Badge variant="secondary">
            {(summary?.status ?? "loading").replaceAll("_", " ")}
          </Badge>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {summary?.syncWarning && (
          <p
            role="status"
            className="text-sm text-amber-600 dark:text-amber-400"
          >
            {summary.syncWarning}
          </p>
        )}
        {summary?.pendingSeatReduction && (
          <p role="status" className="text-sm">
            A reduction to {summary.pendingSeatReduction} seats is waiting to be
            scheduled for renewal. Refresh billing to retry.
          </p>
        )}
        {!summary && !error && (
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading billing…
          </p>
        )}
        {summary && (
          <>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Seats in use</dt>
                <dd className="font-medium">
                  {workspace.usedSeats} / {summary.paidSeats}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Billing</dt>
                <dd className="capitalize">{summary.interval}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Period ends</dt>
                <dd>{date(summary.periodEnd)}</dd>
              </div>
            </dl>
            {summary.canCheckout && (
              <p className="text-sm">
                {summary.billingSource === "manual"
                  ? "Your manually managed plan stays active until payment succeeds. Completing checkout starts a new paid subscription."
                  : "Complete payment to activate this workspace. Existing data stays available to read."}
              </p>
            )}
            {summary.status === "past_due" && (
              <p
                role="alert"
                className="text-sm text-amber-600 dark:text-amber-400"
              >
                Payment needs attention.{" "}
                {summary.accessState === "active"
                  ? `Your grace period ends ${date(summary.graceDeadline)}.`
                  : "Your workspace is read-only."}{" "}
                Open Manage billing to update your payment method.
              </p>
            )}
            {summary.status === "canceled" && !summary.canCheckout && (
              <p className="text-sm">
                Cancellation is scheduled for {date(summary.periodEnd)}. Your
                team keeps access until then.
              </p>
            )}
            {summary.scheduledSeats !== null && (
              <div className="rounded-lg border p-3 text-sm">
                <p>
                  {summary.scheduledSeats} seats, billed{" "}
                  {summary.scheduledInterval}, take effect{" "}
                  {date(summary.scheduledAt)}.
                </p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await cancelScheduledTeamChange({
                        data: { workspaceId: workspace.id },
                      })
                      await refresh()
                    }, "Scheduled change canceled.")
                  }
                >
                  Keep current plan
                </Button>
              </div>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            <RefreshCw className="size-4" />
            Refresh billing
          </Button>
          {summary?.portalAvailable && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const portal = await openTeamPortal({
                    data: { workspaceId: workspace.id },
                  })
                  window.location.assign(portal.link)
                })
              }
            >
              Manage billing & invoices
            </Button>
          )}
        </div>
      </section>
      {summary && (
        <section className="space-y-4 rounded-xl border bg-card p-5">
          {workspace.accessState === "suspended" && (
            <p
              role="alert"
              className="text-sm text-amber-600 dark:text-amber-400"
            >
              Sparkable has suspended access to this workspace. Billing changes
              will not remove that restriction. Contact support to restore
              access.
            </p>
          )}
          <h3 className="font-semibold">
            {summary.canCheckout
              ? "Activate Pro"
              : "Seats and billing interval"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="team-paid-seats">
                Paid seats, including the Owner
              </Label>
              <Input
                id="team-paid-seats"
                type="number"
                min={Math.max(1, workspace.usedSeats)}
                max={10}
                value={seats}
                disabled={busy || summary.checkoutLocked}
                onChange={(e) => {
                  setSeats(e.target.value)
                  setPreview(null)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-billing-interval">Billing interval</Label>
              <select
                id="team-billing-interval"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={interval}
                disabled={busy || summary.checkoutLocked}
                onChange={(e) => {
                  setInterval(e.target.value as typeof interval)
                  setPreview(null)
                }}
              >
                <option value="monthly">Monthly · $12 per seat</option>
                <option value="annual">Annual · $96 per seat</option>
              </select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            ${(Number(seats) || 0) * (interval === "monthly" ? 12 : 96)} per{" "}
            {interval === "monthly" ? "month" : "year"}, tax included. Seat
            increases require payment. Reductions and interval changes start at
            renewal. Each paid seat includes 50 website sources without RSS.
            Reducing seats pauses excess website sources; their saved articles
            remain readable.
          </p>
          {summary.canCheckout ? (
            <Button
              disabled={!valid || busy}
              onClick={() =>
                void run(async () => {
                  const result = await checkoutTeam({ data: purchase })
                  window.location.assign(result.checkoutUrl)
                })
              }
            >
              {busy && <Loader2 className="size-4 animate-spin" />}Continue to
              payment
            </Button>
          ) : (
            <Button
              disabled={!valid || busy || summary.status !== "active"}
              onClick={() =>
                void run(async () =>
                  setPreview(await previewTeamChange({ data: purchase }))
                )
              }
            >
              Review plan change
            </Button>
          )}
          {!summary.canCheckout && (
            <Button
              className="ml-2"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                summary.status === "canceled"
                  ? void run(async () => {
                      await cancelTeamPlan({
                        data: { workspaceId: workspace.id, cancel: false },
                      })
                      await refresh()
                    }, "Subscription restored.")
                  : setCancelOpen(true)
              }
            >
              {summary.status === "canceled"
                ? "Keep subscription"
                : "Cancel subscription"}
            </Button>
          )}
        </section>
      )}
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm your plan change</DialogTitle>
            <DialogDescription>
              Review the charge and billing dates before confirming.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-2 text-sm">
              <p>
                {seats} seats · {interval}
              </p>
              <p className="font-semibold">
                Due now:{" "}
                {preview.scheduled
                  ? "$0.00"
                  : money(preview.quote.amount, preview.quote.currency)}
              </p>
              <p>Change starts: {date(preview.quote.effectiveAt)}</p>
              <p>Next billing date: {date(preview.quote.nextBillingDate)}</p>
              {!preview.scheduled && (
                <p className="text-muted-foreground">
                  This prorated change resets your billing cycle. Added seats
                  become available after payment succeeds.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Back
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                preview &&
                void run(async () => {
                  const result = await confirmTeamChange({
                    data: { ...purchase, previewToken: preview.token },
                  })
                  setPreview(null)
                  setPoll(12)
                  await refresh()
                  toast.success(
                    result.scheduled
                      ? "Plan change scheduled for renewal."
                      : "Plan change submitted. Waiting for payment confirmation."
                  )
                })
              }
            >
              {busy && <Loader2 className="size-4 animate-spin" />}Confirm
              change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!busy) setCancelOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel at the end of this period?</DialogTitle>
            <DialogDescription>
              Your team keeps paid access until{" "}
              {date(summary?.periodEnd ?? null)}. After that the workspace
              becomes read-only. Your data will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setCancelOpen(false)}
            >
              Keep subscription
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await cancelTeamPlan({
                    data: { workspaceId: workspace.id, cancel: true },
                  })
                  setCancelOpen(false)
                  await refresh()
                }, "Cancellation scheduled for the end of this billing period.")
              }
            >
              Confirm cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
