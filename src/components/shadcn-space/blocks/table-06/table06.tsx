"use client"

import { useMemo, useState } from "react"
import { Eye, Pen, Trash } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"

// ---------------- DATA ---------------- //

const users = [
  {
    name: "Olivia Rhye",
    email: "olivia@ui.com",
    role: "Maintainer",
    plan: "Enterprise",
    billing: "Auto debit",
    status: "Active",
    avatar: "https://images.shadcnspace.com/assets/profiles/user-11.jpg",
  },
  {
    name: "Barbara Steele",
    email: "steele@ui.com",
    role: "Admin",
    plan: "Enterprise",
    billing: "Auto debit",
    status: "Inactive",
    avatar: "https://images.shadcnspace.com/assets/profiles/user-8.jpg",
  },
  {
    name: "Leonard Gordon",
    email: "leonard@ui.com",
    role: "Editor",
    plan: "Team",
    billing: "Manual - PayPal",
    status: "Active",
    avatar: "https://images.shadcnspace.com/assets/profiles/user-3.jpg",
  },
  {
    name: "Evelyn Pope",
    email: "evelyn@ui.com",
    role: "Author",
    plan: "Basic",
    billing: "Manual - cash",
    status: "Pending",
    avatar: "https://images.shadcnspace.com/assets/profiles/user-4.jpg",
  },
  {
    name: "Tommy Garza",
    email: "tommy@ui.com",
    role: "Subscriber",
    plan: "Company",
    billing: "Auto debit",
    status: "Inactive",
    avatar: "https://images.shadcnspace.com/assets/profiles/user-5.jpg",
  },
  {
    name: "Isabel Vasquez",
    email: "isabel@ui.com",
    role: "Editor",
    plan: "Team",
    billing: "Auto debit",
    status: "Active",
    avatar: "https://images.shadcnspace.com/assets/profiles/user-12.jpg",
  },
]

// Colors for status badges
const statusColors: any = {
  Active: "bg-teal-400/10 text-teal-400",
  Pending: "bg-orange-400/10 text-orange-400",
  Inactive: "bg-red-500/10 text-red-500",
}

// ---------------- COMPONENT ---------------- //

const Table06 = () => {
  const [role, setRole] = useState("All")
  const [plan, setPlan] = useState("All")
  const [status, setStatus] = useState("All")

  // Filter logic
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      return (
        (role === "All" || u.role === role) &&
        (plan === "All" || u.plan === plan) &&
        (status === "All" || u.status === status)
      )
    })
  }, [role, plan, status])

  const roles = ["All", "Maintainer", "Admin", "Editor", "Author", "Subscriber"]
  const plans = ["All", "Enterprise", "Team", "Basic", "Company"]
  const statuses = ["All", "Active", "Pending", "Inactive"]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-16 lg:py-20">
      <Card className="w-full max-w-6xl gap-6 overflow-hidden rounded-md border-0 px-6 py-4">
        {/* --------------- FILTERS --------------- */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div>
            <p className="mb-1 text-sm font-medium">Select Role</p>
            <Select value={role} onValueChange={(val) => val && setRole(val)}>
              <SelectTrigger className="w-full cursor-pointer shadow-xs focus-visible:shadow-none! focus-visible:ring-0! data-[size=default]:h-9">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                {roles.map((item) => (
                  <SelectItem
                    key={item}
                    value={item}
                    className="mb-0.5 hover:bg-accent! data-[state=checked]:bg-accent!"
                  >
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">Select Plan</p>
            <Select value={plan} onValueChange={(val) => val && setPlan(val)}>
              <SelectTrigger className="w-full cursor-pointer shadow-xs focus-visible:shadow-none! focus-visible:ring-0! data-[size=default]:h-9">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                {plans.map((item) => (
                  <SelectItem
                    key={item}
                    value={item}
                    className="mb-0.5 hover:bg-accent! data-[state=checked]:bg-accent!"
                  >
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">Select Status</p>
            <Select
              value={status}
              onValueChange={(val) => val && setStatus(val)}
            >
              <SelectTrigger className="w-full cursor-pointer shadow-xs focus-visible:shadow-none! focus-visible:ring-0! data-[size=default]:h-9">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                {statuses.map((item) => (
                  <SelectItem
                    key={item}
                    value={item}
                    className="mb-0.5 hover:bg-accent! data-[state=checked]:bg-accent!"
                  >
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* --------------- TABLE --------------- */}
        <div className="rounded-md border">
          <Table className="min-w-3xl">
            <TableHeader>
              <TableRow className="hover:bg-transparent!">
                <TableHead></TableHead>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filteredUsers.map((u, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Checkbox className="cursor-pointer" />
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-3">
                      <img
                        src={u.avatar}
                        alt="avatar"
                        width={40}
                        height={40}
                        className="rounded-full"
                      />
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {u.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>{u.role}</TableCell>
                  <TableCell>{u.plan}</TableCell>
                  <TableCell>{u.billing}</TableCell>

                  <TableCell>
                    <Badge className={statusColors[u.status]}>{u.status}</Badge>
                  </TableCell>

                  <TableCell>
                    <div className="flex gap-4">
                      <Trash
                        size={16}
                        className="cursor-pointer text-foreground hover:text-red-500"
                      />
                      <Eye
                        size={16}
                        className="cursor-pointer text-foreground hover:text-foreground/80"
                      />
                      <Pen
                        size={16}
                        className="cursor-pointer text-foreground hover:text-foreground/80"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  )
}

export default Table06
