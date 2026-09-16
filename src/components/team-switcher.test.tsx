// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

const org = vi.hoisted(() => ({
  id: "org-1",
  slug: "team-a-very-long-internal-workspace-id",
  name: "ACME Inc",
  logo: null,
}))
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useListOrganizations: () => ({ data: [org] }),
    useActiveOrganization: () => ({ data: org }),
    useSession: () => ({
      data: { user: { id: "owner", name: "Tech Support" } },
    }),
    organization: { setActive: vi.fn() },
  },
}))
vi.mock("@/lib/demo", () => ({ DEMO_MODE: false }))
vi.mock("@/hooks/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("@/hooks/use-workspace-creation-permission", () => ({
  useWorkspaceCreationPermission: () => ({ allowed: false }),
}))
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }))
vi.mock("./CreateWorkspaceModal", () => ({ CreateWorkspaceModal: () => null }))
vi.mock("@/server/workspace-management", () => ({
  getWorkspaceOverview: vi.fn().mockResolvedValue({
    workspaces: [
      { id: "owner", type: "personal", plan: "personal_plus" },
      { id: org.id, type: "organization", plan: "pro" },
    ],
  }),
}))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({
    size: _size,
    ...props
  }: React.ComponentProps<"button"> & { size?: string }) => (
    <button {...props} />
  ),
}))
const { TeamSwitcher } = await import("./team-switcher")
afterEach(cleanup)
it("shows plan labels, keeps controls from shrinking, and never renders the internal slug", async () => {
  render(<TeamSwitcher />)
  await screen.findByText("Pro")
  fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }))
  const menu = within(await screen.findByRole("menu"))
  expect(menu.getByText("Pro")).toBeTruthy()
  expect(menu.getByText("Personal+")).toBeTruthy()
  expect(menu.queryByText(org.slug)).toBeNull()
  expect(
    menu.getByRole("button", { name: "Manage" }).parentElement?.className
  ).toContain("shrink-0")
  expect(menu.getByText("A").parentElement?.className).toContain("shrink-0")
})
