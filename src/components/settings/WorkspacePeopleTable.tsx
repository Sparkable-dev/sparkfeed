import { useMemo, useState } from "react"
import {
  Crown,
  Loader2,
  MailPlus,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
  UserRoundCog,
  X,
} from "lucide-react"
import { toast } from "sonner"
import type {
  WorkspaceDetail,
  WorkspacePerson,
} from "@/server/workspace-management"
import { DEMO_MODE } from "@/lib/demo"
import {
  cancelWorkspaceInvitation,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  transferWorkspaceOwnership,
  updateWorkspaceMemberRole,
} from "@/server/workspace-management"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function initials(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function activityLabel(person: WorkspacePerson) {
  if (!person.activityAt)
    return person.kind === "invitation" ? "Invited" : "Never"
  const date = new Date(person.activityAt)
  if (Number.isNaN(date.getTime())) return "Recently"
  const label = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date)
  return person.kind === "invitation" ? `Invited ${label}` : label
}

function statusVariant(status: WorkspacePerson["status"]) {
  if (status === "active") return "secondary" as const
  if (status === "expired") return "destructive" as const
  return "outline" as const
}

export function WorkspacePeopleTable({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDetail
  onChanged: () => Promise<void> | void
}) {
  const [query, setQuery] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"admin" | "editor">("editor")
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{
    kind: "transfer" | "remove"
    person: WorkspacePerson
  } | null>(null)

  const people = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return workspace.people
    return workspace.people.filter((person) =>
      [person.name, person.email, person.role, person.status].some((value) =>
        value.toLowerCase().includes(term)
      )
    )
  }, [query, workspace.people])

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    success: string
  ) => {
    setBusy(key)
    try {
      await action()
      toast.success(success)
      await onChanged()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update people."
      )
    } finally {
      setBusy(null)
    }
  }

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    await run(
      "invite",
      () =>
        inviteWorkspaceMember({
          data: { organizationId: workspace.id, email, role: inviteRole },
        }),
      "Invitation sent."
    )
    setInviteEmail("")
  }

  const canActOn = (person: WorkspacePerson) => {
    if (person.isCurrentUser || person.role === "owner") return false
    if (workspace.role === "owner") return true
    return workspace.role === "admin" && person.role === "editor"
  }

  const actions = (person: WorkspacePerson) => {
    if (DEMO_MODE) return null
    if (person.kind === "invitation") {
      if (!canActOn(person)) return null
      return (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${person.email}`}
              >
                {busy === person.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="size-4" />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                void run(
                  person.id,
                  () =>
                    resendWorkspaceInvitation({
                      data: { invitationId: person.id },
                    }),
                  "Invitation resent."
                )
              }
            >
              <RefreshCw className="size-4" />
              Resend
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                void run(
                  person.id,
                  () =>
                    cancelWorkspaceInvitation({
                      data: { invitationId: person.id },
                    }),
                  "Invitation canceled."
                )
              }
            >
              <X className="size-4" />
              Cancel invitation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }

    if (!canActOn(person)) return null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${person.name}`}
            >
              {busy === person.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MoreHorizontal className="size-4" />
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-52">
          {workspace.role === "owner" ? (
            <>
              <DropdownMenuLabel>Role</DropdownMenuLabel>
              {person.role !== "admin" ? (
                <DropdownMenuItem
                  onClick={() =>
                    void run(
                      person.id,
                      () =>
                        updateWorkspaceMemberRole({
                          data: {
                            organizationId: workspace.id,
                            memberId: person.id,
                            role: "admin",
                          },
                        }),
                      `${person.name} is now an Admin.`
                    )
                  }
                >
                  <UserRoundCog className="size-4" />
                  Make Admin
                </DropdownMenuItem>
              ) : null}
              {person.role !== "editor" ? (
                <DropdownMenuItem
                  onClick={() =>
                    void run(
                      person.id,
                      () =>
                        updateWorkspaceMemberRole({
                          data: {
                            organizationId: workspace.id,
                            memberId: person.id,
                            role: "editor",
                          },
                        }),
                      `${person.name} is now an Editor.`
                    )
                  }
                >
                  <UserRoundCog className="size-4" />
                  Make Editor
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={() => setConfirmation({ kind: "transfer", person })}
              >
                <Crown className="size-4" />
                Transfer ownership
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmation({ kind: "remove", person })}
          >
            <Trash2 className="size-4" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="invite-email">Invite by email</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              disabled={DEMO_MODE}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="name@company.com"
            />
          </div>
          {workspace.role === "owner" ? (
            <div className="space-y-2 md:w-36">
              <Label>Role</Label>
              <Select
                value={inviteRole}
                disabled={DEMO_MODE}
                onValueChange={(value) =>
                  setInviteRole(value === "admin" ? "admin" : "editor")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <Button
            onClick={() => void invite()}
            disabled={DEMO_MODE || busy !== null || !inviteEmail.includes("@")}
            className="w-full md:w-auto"
          >
            {busy === "invite" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MailPlus className="size-4" />
            )}
            Send invite
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {workspace.usedSeats} of {workspace.seatCapacity ?? "unlimited"} seats
          used. Pending invitations reserve a seat.
        </p>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="font-semibold">People</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Active members and pending invitations.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              className="pl-9"
              aria-label="Search people"
            />
          </div>
        </div>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((person) => (
                <TableRow key={`${person.kind}:${person.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9 rounded-xl border">
                        <AvatarImage src={person.image || undefined} alt="" />
                        <AvatarFallback className="rounded-xl text-[10px] font-semibold">
                          {initials(person.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {person.name}
                          {person.isCurrentUser ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (You)
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {person.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">{person.role}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {activityLabel(person)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={statusVariant(person.status)}
                      className="capitalize"
                    >
                      {person.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {actions(person)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="divide-y md:hidden">
          {people.map((person) => (
            <article
              key={`${person.kind}:${person.id}`}
              className="flex items-start gap-3 px-4 py-4"
            >
              <Avatar className="size-10 shrink-0 rounded-xl border">
                <AvatarImage src={person.image || undefined} alt="" />
                <AvatarFallback className="rounded-xl text-[10px] font-semibold">
                  {initials(person.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{person.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {person.email}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{person.role}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activityLabel(person)}</span>
                  <Badge
                    variant={statusVariant(person.status)}
                    className="capitalize"
                  >
                    {person.status}
                  </Badge>
                </div>
              </div>
              {actions(person)}
            </article>
          ))}
        </div>

        {people.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No people match that search.
          </div>
        ) : null}
      </section>

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation?.kind === "transfer"
                ? `Transfer ownership to ${confirmation.person.name}?`
                : `Remove ${confirmation?.person.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.kind === "transfer"
                ? "They will control billing and deletion. You will become an Admin."
                : "They will immediately lose access to this workspace."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmation?.kind === "remove"
                  ? "bg-destructive text-white hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => {
                const current = confirmation
                if (!current) return
                setConfirmation(null)
                if (current.kind === "transfer") {
                  void run(
                    current.person.id,
                    () =>
                      transferWorkspaceOwnership({
                        data: {
                          organizationId: workspace.id,
                          memberId: current.person.id,
                        },
                      }),
                    `Ownership transferred to ${current.person.name}.`
                  )
                } else {
                  void run(
                    current.person.id,
                    () =>
                      removeWorkspaceMember({
                        data: {
                          organizationId: workspace.id,
                          memberId: current.person.id,
                        },
                      }),
                    `${current.person.name} was removed.`
                  )
                }
              }}
            >
              {confirmation?.kind === "transfer"
                ? "Transfer ownership"
                : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
