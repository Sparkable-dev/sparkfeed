import { useCallback, useEffect, useState } from "react"
import { Check, ExternalLink, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { PersonalBillingSummary } from "@/server/personal-billing-actions"
import { authClient } from "@/lib/auth-client"
import { DEMO_MODE } from "@/lib/demo"
import {
  getPersonalBillingSummary,
  startPersonalCheckout,
  updateFreePersonalSources,
} from "@/server/personal-billing-actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function readableDate(value: string | null): string | null {
  if (!value) return null
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value))
}

export function PersonalBillingTab() {
  const [summary, setSummary] = useState<PersonalBillingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedSources, setSelectedSources] = useState<Array<string>>([])

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const next = await getPersonalBillingSummary()
      setSummary(next)
      setSelectedSources(
        next.sources
          .filter((source) => source.active)
          .map((source) => source.id)
      )
    } catch (error) {
      if (!background) {
        toast.error(
          error instanceof Error ? error.message : "Could not load billing."
        )
      }
    } finally {
      if (!background) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (DEMO_MODE) {
      setLoading(false)
      return
    }
    void load(false)
  }, [load])

  useEffect(() => {
    if (summary?.billingStatus !== "checkout_pending") return

    const timer = window.setInterval(() => {
      void load(true)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [load, summary?.billingStatus])

  const checkout = async (interval: "monthly" | "annual") => {
    setBusy(interval)
    try {
      const result = await startPersonalCheckout({ data: { interval } })
      window.location.assign(result.checkoutUrl)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Checkout could not start."
      )
      setBusy(null)
    }
  }

  const openPortal = async () => {
    setBusy("portal")
    try {
      const { data, error } = await authClient.dodopayments.customer.portal()
      if (error) throw error
      if (data?.url) window.location.assign(data.url)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The billing portal could not open."
      )
      setBusy(null)
    }
  }

  const toggleSource = (sourceId: string) => {
    setSelectedSources((current) => {
      if (current.includes(sourceId)) {
        return current.filter((id) => id !== sourceId)
      }
      if (current.length >= 5) {
        toast.error("Free workspaces can keep five no-RSS sources active.")
        return current
      }
      return [...current, sourceId]
    })
  }

  const saveSources = async () => {
    setBusy("sources")
    try {
      await updateFreePersonalSources({ data: { sourceIds: selectedSources } })
      toast.success("Active no-RSS sources updated.")
      await load(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Sources could not be updated."
      )
    } finally {
      setBusy(null)
    }
  }

  if (DEMO_MODE) {
    return (
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Demo mode</CardTitle>
            <CardDescription>
              Checkout and the customer portal are disabled on this deployment.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (loading || !summary) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (summary.plan === "community") {
    return (
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Community Edition</CardTitle>
            <CardDescription>
              Your instance operator manages hosting and provider costs.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const renewal = readableDate(summary.currentPeriodEnd)
  const grace = readableDate(summary.graceDeadline)
  const isPersonalPlus = summary.plan === "personal_plus"
  const checkoutPending = summary.billingStatus === "checkout_pending"

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>{isPersonalPlus ? "Personal+" : "Free"}</CardTitle>
          <CardDescription>
            {isPersonalPlus
              ? "API, MCP, 50 no-RSS sources, and 100 monthly Spark AI credits."
              : "Five no-RSS sources and 50 one-time Spark AI credits."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground">Status</div>
              <div className="mt-1 font-semibold capitalize">
                {summary.billingStatus.replaceAll("_", " ")}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground">Spendable credits</div>
              <div className="mt-1 font-semibold">
                {summary.spendableCredits ?? "Operator managed"}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground">No-RSS sources</div>
              <div className="mt-1 font-semibold">
                {summary.sources.filter((source) => source.active).length} /{" "}
                {summary.sourceLimit ?? "Unlimited"}
              </div>
            </div>
          </div>

          {renewal ? (
            <p className="text-sm text-muted-foreground">
              {summary.billingStatus === "canceled"
                ? "Access ends"
                : "Next billing date"}
              : {renewal}
            </p>
          ) : null}
          {grace ? (
            <p className="text-sm text-amber-600">
              Payment recovery is required by {grace} to avoid read-only access.
            </p>
          ) : null}

          {summary.portalAvailable ? (
            <Button
              variant="outline"
              onClick={openPortal}
              disabled={busy !== null}
            >
              {busy === "portal" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              Open billing portal
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {checkoutPending ? (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Confirming your payment
            </CardTitle>
            <CardDescription>
              Dodo is finishing the subscription. This page checks the payment
              automatically and will switch to Personal+ when it is active.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => load(false)}>
              Check again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!isPersonalPlus && !checkoutPending ? (
        <Card>
          <CardHeader>
            <CardTitle>Upgrade to Personal+</CardTitle>
            <CardDescription>
              Choose monthly billing or save with the annual plan. Prices
              include tax.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border p-5">
              <div className="text-2xl font-bold">$5</div>
              <div className="text-sm text-muted-foreground">per month</div>
              <Button
                className="mt-5 w-full"
                onClick={() => checkout("monthly")}
                disabled={busy !== null}
              >
                {busy === "monthly" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Choose monthly
              </Button>
            </div>
            <div className="rounded-xl border border-primary p-5">
              <div className="text-2xl font-bold">$48</div>
              <div className="text-sm text-muted-foreground">per year</div>
              <Button
                className="mt-5 w-full"
                onClick={() => checkout("annual")}
                disabled={busy !== null}
              >
                {busy === "annual" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Choose annual
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {summary.plan === "free" && summary.sources.length > 5 ? (
        <Card>
          <CardHeader>
            <CardTitle>Choose five active no-RSS sources</CardTitle>
            <CardDescription>
              Paused sources and their saved articles remain available to read.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.sources.map((source) => {
              const selected = selectedSources.includes(source.id)
              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => toggleSource(source.id)}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted"
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                  >
                    {selected ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {source.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {source.url}
                    </span>
                  </span>
                </button>
              )
            })}
            <Button onClick={saveSources} disabled={busy !== null}>
              {busy === "sources" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save active sources
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
