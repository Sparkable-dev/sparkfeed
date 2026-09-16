import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { checkoutTeam, createPaidTeam } from "@/server/team-billing-actions"
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
  DialogTrigger,
} from "@/components/ui/dialog"

export function TeamCheckoutDialog() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [seats, setSeats] = useState("2")
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly")
  const [busy, setBusy] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const valid =
    name.trim().length >= 2 &&
    Number.isInteger(Number(seats)) &&
    Number(seats) >= 1 &&
    Number(seats) <= 10
  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    const key = requestId ?? crypto.randomUUID()
    setRequestId(key)
    let team: { id: string; slug: string } | null = null
    try {
      team = await createPaidTeam({
        data: { name, seats: Number(seats), interval, requestId: key },
      })
      const result = await checkoutTeam({
        data: { workspaceId: team.id, seats: Number(seats), interval },
      })
      window.location.assign(result.checkoutUrl)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start checkout."
      )
      if (team) {
        setOpen(false)
        toast.info(
          "Your workspace was saved. Resume payment from its Billing tab."
        )
        await navigate({
          to: "/settings/workspaces/$slug",
          params: { slug: team.slug },
          search: { section: "billing" },
        } as never)
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next)
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            Create Pro workspace
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a Pro workspace</DialogTitle>
          <DialogDescription>
            Choose your seats, then pay securely with Dodo Payments. Your team
            activates after payment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="pro-name">Workspace name</Label>
            <Input
              id="pro-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pro-seats">Seats, including you</Label>
            <Input
              id="pro-seats"
              type="number"
              min={1}
              max={10}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              1–10 seats. Pending invitations reserve a seat. Need more? Request
              Enterprise.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pro-interval">Billing interval</Label>
            <select
              id="pro-interval"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={interval}
              onChange={(e) => setInterval(e.target.value as typeof interval)}
              disabled={busy}
            >
              <option value="monthly">Monthly · $12 per seat</option>
              <option value="annual">Annual · $96 per seat</option>
            </select>
          </div>
          <p className="rounded-lg bg-muted p-3 text-sm font-medium">
            ${(Number(seats) || 0) * (interval === "monthly" ? 12 : 96)} /{" "}
            {interval === "monthly" ? "month" : "year"}, tax included
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!valid || busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}Continue to
            payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
