import * as React from "react"
import { toast } from "sonner"
import {
  ChevronRight,
  CompassIcon,
  FolderTree,
  Heart,
  Home,
  LogOut,
  Settings,
  Sparkles,
  Sun,
  Telescope,
  Zap,
} from "lucide-react"
import { GuestUpsellCard } from "./GuestUpsellCard"
import type { FeedRow, FolderRow } from "@/components/Sidebar"
import type {NavPageKey} from "@/config/nav-pages";
import { authClient } from "@/lib/auth-client"
import { useDemoAwareSession } from "@/hooks/useDemoAwareSession"
import { DEMO_MODE } from "@/lib/demo"
import { NavMain } from "@/components/nav-main"
import { NavFolders } from "@/components/nav-folders"
import { NavDeveloper } from "@/components/nav-developer"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useGuestShare } from "@/hooks/guest-share-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NAV_PAGES  } from "@/config/nav-pages"
import { ChatHistory } from "@/components/ai/history/ChatHistory"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  folders: Array<FolderRow>
  feeds: Array<FeedRow>
  articleCounts: Record<string, number>
  folderArticleCounts: Record<string, number>
  totalCount: number
  todayCount: number
  favoritesCount: number
  onFolderCreated: () => void
  onEditFeed: (feed: FeedRow) => void
}

export function AppSidebar({
  folders,
  feeds,
  articleCounts,
  folderArticleCounts,
  totalCount,
  todayCount,
  favoritesCount,
  onFolderCreated,
  onEditFeed,
  ...props
}: AppSidebarProps) {
  const { data: session } = useDemoAwareSession()
  const guest = useGuestShare()

  /*
    The destinations themselves come from shared config, so the command
    palette offers exactly the pages this sidebar does. Only the icon and the
    live count are the sidebar's own, and both are keyed rather than positional
    so reordering the config cannot silently mismatch them.
  */
  const icons: Record<NavPageKey, React.ReactNode> = {
    home: <Home />,
    all: <CompassIcon />,
    today: <Sun />,
    favorites: <Heart />,
    discover: <Telescope />,
    ai: <Sparkles />,
    sources: <FolderTree />,
  }
  const badges: Partial<Record<NavPageKey, number>> = {
    // Home carries no badge on purpose. It is a summary of everything below
    // it, so a count there would only ever restate the row underneath.
    all: totalCount,
    today: todayCount,
    favorites: favoritesCount,
  }

  const navMain = NAV_PAGES.map((page) => ({
    title: page.title,
    href: page.href,
    icon: icons[page.key],
    badge: (badges[page.key] ?? 0) > 0 ? badges[page.key] : undefined,
    exact: page.exact,
  }))

  const handleLogout = async () => {
    if (DEMO_MODE) {
      toast.info("No account to sign out from in demo mode")
      return
    }
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/login"
          toast.success("Signed out successfully")
        }
      }
    })
  }

  return (
    <Sidebar collapsible="icon" className="border-r border-zinc-800" {...props}>
      <SidebarHeader className="p-2 pt-3">
        {/*
          TeamSwitcher is every-item-is-a-mutation: switch workspace, create one,
          manage it. None of that survives for a guest, and it fires three auth
          hooks to render, so it is replaced outright rather than disabled.
        */}
        {guest ? (
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-700">
              <Zap className="size-4 text-white" fill="currentColor" />
            </span>
            <span className="flex flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
              <span className="text-sm font-bold text-zinc-100">Sparkfeed</span>
              <span className="text-[10px] font-medium text-zinc-500">
                Shared {guest.kind}
              </span>
            </span>
          </div>
        ) : (
          <TeamSwitcher />
        )}
      </SidebarHeader>
      <SidebarContent>
        {/*
          Every NavMain target sits under _protected, so for a guest all four
          would bounce to /login. Four nav items that look broken read worse
          than no nav items.
        */}
        {!guest && <NavMain items={navMain} />}
        {/*
          Directly under Spark AI, which is the last nav row for exactly this
          reason — see the note in `@/config/nav-pages`.
        */}
        {!guest && <ChatHistory />}
        <NavFolders
          folders={folders}
          feeds={feeds}
          articleCounts={articleCounts}
          folderArticleCounts={folderArticleCounts}
          onFolderCreated={onFolderCreated}
          onEditFeed={onEditFeed}
        />
      </SidebarContent>
      <SidebarFooter className="p-2 border-t border-zinc-800/50">
        {DEMO_MODE && (
          <div className="mx-2 mb-1 flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 group-data-[collapsible=icon]:hidden">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Demo Mode</span>
          </div>
        )}
        {guest ? <GuestUpsellCard /> : <NavDeveloper />}
        <SidebarMenu>
          <SidebarMenuItem>
            {/*
              A guest has no settings to open and nothing to sign out of, so the
              account row is inert text rather than a dropdown with two dead
              items in it.
            */}
            {guest ? (
              <div className="flex w-full items-center gap-3 rounded-full px-2 py-1.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-400 ring-1 ring-white/10">
                  G
                </div>
                <div className="flex flex-col items-start gap-0.5 overflow-hidden leading-none group-data-[collapsible=icon]:hidden">
                  <span className="w-full truncate text-left text-sm font-bold text-zinc-200">
                    Guest
                  </span>
                  <span className="w-full truncate text-left text-[10px] text-zinc-500">
                    Not signed in
                  </span>
                </div>
              </div>
            ) : (
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="rounded-full hover:bg-zinc-800/50" />}>
                <div className="flex items-center gap-3 w-full">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 font-bold text-xs shrink-0 ring-1 ring-white/10 group-hover:ring-white/20 group-hover:scale-105 transition-all duration-200">
                    {session?.user?.name?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex flex-col items-start gap-0.5 leading-none overflow-hidden group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-bold text-sm text-zinc-200 w-full text-left">
                      {session?.user?.name}
                    </span>
                    <span className="truncate text-[10px] text-zinc-500 w-full text-left">
                      {session?.user?.email}
                    </span>
                  </div>
                  <ChevronRight className="ml-auto size-3.5 text-zinc-600 group-data-[collapsible=icon]:hidden" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 rounded-xl bg-zinc-950 border-zinc-800 shadow-2xl p-2" align="start" side="right" sideOffset={12}>
                <div className="px-2 py-1.5 mb-1">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Account</p>
                </div>
                <DropdownMenuItem
                  onClick={() => {
                    window.location.href = "/settings?tab=profile"
                  }}
                  className="gap-2 p-2 rounded-lg text-zinc-300 hover:bg-white/5 cursor-pointer"
                >
                  <Settings className="size-4" />
                  <span className="text-sm font-medium">Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 bg-zinc-800/50" />
                <DropdownMenuItem onClick={handleLogout} className="gap-2 p-2 rounded-lg text-red-400 hover:bg-red-500/10 cursor-pointer">
                  <LogOut className="size-4" />
                  <span className="text-sm font-medium">Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
