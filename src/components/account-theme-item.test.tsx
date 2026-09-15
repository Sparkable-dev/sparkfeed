// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider, useTheme } from "next-themes"
import { AccountThemeItem } from "./account-theme-item"
import { AuthLayout } from "./auth/auth-ui"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu"

let mediaDark = false
const mediaListeners = new Set<(event: { matches: boolean }) => void>()
function Harness() {
  const { theme } = useTheme()
  return <><output data-testid="theme">{theme}</output>
    <input aria-label="Chat draft" defaultValue="Keep this draft" />
    <DropdownMenu><DropdownMenuTrigger>Account menu</DropdownMenuTrigger>
      <DropdownMenuContent><DropdownMenuItem>Settings</DropdownMenuItem><AccountThemeItem /><DropdownMenuItem>Log out</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
    <AuthLayout title="Sign in"><p>Authentication preview</p></AuthLayout>
  </>
}
function App() { return <ThemeProvider attribute="class" defaultTheme="dark" enableSystem storageKey="sparkfeed-theme"><Harness /></ThemeProvider> }
beforeEach(() => {
  localStorage.clear()
  mediaDark = false
  mediaListeners.clear()
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: mediaDark, media: "(prefers-color-scheme: dark)", addListener: (fn: (event: { matches: boolean }) => void) => mediaListeners.add(fn), removeListener: (fn: (event: { matches: boolean }) => void) => mediaListeners.delete(fn), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }))
})
afterEach(cleanup)

describe("shared theme controls", () => {
  it("cycles in place, stays open, preserves drafts, and updates login", async () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }))
    const dark = await screen.findByRole("menuitem", { name: "Theme: Dark. Switch to system." })
    const items = screen.getAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual(["Settings", "Theme: Dark", "Log out"])
    fireEvent.click(dark)
    fireEvent.click(await screen.findByRole("menuitem", { name: "Theme: System. Switch to light." }))
    expect(await screen.findByRole("menuitem", { name: "Theme: Light. Switch to dark." })).toBeTruthy()
    await waitFor(() => expect(localStorage.getItem("sparkfeed-theme")).toBe("light"))
    expect(document.documentElement.classList.contains("light")).toBe(true)
    expect((screen.getByRole<HTMLInputElement>("textbox", { name: "Chat draft" })).value).toBe("Keep this draft")
    expect(screen.getByRole("button", { name: "Theme: light. Switch to dark." })).toBeTruthy()
    fireEvent.click(screen.getByRole("menuitem", { name: "Theme: Light. Switch to dark." }))
    expect(await screen.findByRole("menuitem", { name: "Theme: Dark. Switch to system." })).toBeTruthy()
  })
  it("restores the preference and responds to system appearance", async () => {
    localStorage.setItem("sparkfeed-theme", "system")
    render(<App />)
    await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true))
    mediaDark = true
    act(() => { for (const listener of mediaListeners) listener({ matches: true }) })
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true))
    expect(screen.getByTestId("theme").textContent).toBe("system")
  })
})
