import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { ChevronDownIcon, PlusIcon, User } from "lucide-react"
import { CreateWorkspaceModal } from "./CreateWorkspaceModal"
import type { EntitlementPlan } from "@/server/entitlements/types"
import { authClient } from "@/lib/auth-client"
import { DEMO_MODE } from "@/lib/demo"
import { useWorkspaceCreationPermission } from "@/hooks/use-workspace-creation-permission"
import { getPersonalBillingSummary } from "@/server/personal-billing-actions"
import { personalWorkspaceName, workspacePlanLabel } from "@/lib/workspaces"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/useHydrated"

export function TeamSwitcher() {
  return DEMO_MODE ? <DemoTeamSwitcher /> : <AuthenticatedTeamSwitcher />
}

function DemoTeamSwitcher() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="rounded-full">
          <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-violet-600 text-white">
            <User className="size-4" />
          </div>
          <div className="min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold">Personal workspace</p>
            <p className="truncate text-[10px] text-muted-foreground">
              Demo workspace
            </p>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function AuthenticatedTeamSwitcher() {
  const [showCreateModal, setShowCreateModal] = React.useState(false)
  const navigate = useNavigate()
  const { data: orgs } = authClient.useListOrganizations()
  const { data: clientActiveOrg } = authClient.useActiveOrganization()
  const session = authClient.useSession()
  const hydrated = useHydrated()
  const activeOrg = hydrated ? clientActiveOrg : null
  const user = hydrated ? session.data?.user : undefined
  const workspaceCreation = useWorkspaceCreationPermission()
  const [personalPlan, setPersonalPlan] =
    React.useState<EntitlementPlan | null>(null)

  React.useEffect(() => {
    if (DEMO_MODE || !user?.id) return

    let active = true
    void getPersonalBillingSummary()
      .then((summary) => {
        if (active) setPersonalPlan(summary.plan)
      })
      .catch(() => {
        if (active) setPersonalPlan(null)
      })

    return () => {
      active = false
    }
  }, [user?.id])

  const handleSwitch = async (id: string | null) => {
    if (DEMO_MODE) {
      toast.warning("Feature locked in demo mode")
      return
    }
    try {
      await authClient.organization.setActive({
        organizationId: id,
      })
      toast.success(id ? "Switched workspace" : "Switched to Personal")
      window.location.href = "/"
    } catch (e) {
      toast.error("Failed to switch workspace")
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="rounded-full hover:bg-zinc-800/50"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-md transition-all duration-200 group-hover:scale-105">
              {activeOrg?.logo ? (
                <img
                  src={activeOrg.logo}
                  alt=""
                  className="size-full object-cover"
                />
              ) : activeOrg ? (
                activeOrg.name[0].toUpperCase()
              ) : user?.image ? (
                <img
                  src={user.image}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <User className="size-4.5" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden leading-none group-data-[collapsible=icon]:hidden">
              <span className="w-full truncate text-sm font-bold text-zinc-200">
                {activeOrg?.name || personalWorkspaceName(user?.name)}
              </span>
              <span className="w-full truncate text-[10px] font-medium text-zinc-500">
                {workspacePlanLabel(personalPlan, Boolean(activeOrg))}
              </span>
            </div>
            <ChevronDownIcon className="ml-auto size-3.5 text-zinc-500 group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-64 rounded-xl border-zinc-800 bg-zinc-950 p-2 shadow-2xl"
            align="start"
            side="bottom"
            sideOffset={8}
          >
            <div className="mb-1 px-2 py-1.5">
              <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                Select Workspace
              </p>
            </div>

            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => handleSwitch(null)}
                className={`cursor-pointer gap-3 rounded-lg p-2 transition-colors ${!activeOrg ? "bg-blue-600/10 text-blue-400" : "text-zinc-400 hover:bg-white/5"}`}
              >
                <div className="flex size-7 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-900 shadow-sm">
                  {user?.image ? (
                    <img
                      src={user.image}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <User className="size-4" />
                  )}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold">
                    {personalWorkspaceName(user?.name)}
                  </p>
                  <p className="text-[10px] opacity-60">Personal account</p>
                </div>
                {!activeOrg ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 rounded-md border-zinc-800 bg-white/5 px-2 text-[10px] font-bold transition-all hover:bg-white/10 hover:text-white"
                      onClick={(e) => {
                        e.stopPropagation()
                        window.location.href = "/settings?tab=profile"
                      }}
                    >
                      Manage
                    </Button>
                  </div>
                ) : null}
              </DropdownMenuItem>

              {orgs?.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => handleSwitch(org.id)}
                  className={`mt-1 cursor-pointer gap-3 rounded-lg p-2 transition-colors ${activeOrg?.id === org.id ? "bg-blue-600/10 text-blue-400" : "text-zinc-400 hover:bg-white/5"}`}
                >
                  <div className="flex size-7 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-900 shadow-sm">
                    {org.logo ? (
                      <img
                        src={org.logo}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="text-[10px] font-bold">
                        {org.name[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold">{org.name}</p>
                    <p className="text-[10px] opacity-60">{org.slug}</p>
                  </div>
                  {activeOrg?.id === org.id && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 rounded-md border-zinc-800 bg-white/5 px-2 text-[10px] font-bold transition-all hover:bg-white/10 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate({
                            to: "/settings/workspaces/$slug",
                            params: { slug: org.slug },
                            search: { section: "general" },
                          } as never)
                        }}
                      >
                        Manage
                      </Button>
                    </div>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>

            {workspaceCreation.allowed ? (
              <>
                <DropdownMenuSeparator className="my-2 bg-zinc-800/50" />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => setShowCreateModal(true)}
                    className="cursor-pointer gap-3 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-blue-600/5 hover:text-blue-400"
                  >
                    <div className="flex size-7 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-transparent">
                      <PlusIcon className="size-4" />
                    </div>
                    <p className="text-sm font-semibold">Create Workspace</p>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      {workspaceCreation.allowed ? (
        <CreateWorkspaceModal
          open={showCreateModal}
          onOpenChange={setShowCreateModal}
        />
      ) : null}
    </SidebarMenu>
  )
}
