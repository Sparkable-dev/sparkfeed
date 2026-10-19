// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ConnectedAccounts } from "./ConnectedAccounts"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  providers: vi.fn(),
}))
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    listAccounts: mocks.list,
    linkSocial: mocks.link,
    unlinkAccount: mocks.unlink,
  },
}))
vi.mock("@/hooks/use-social-providers", () => ({
  useSocialProviders: mocks.providers,
}))
vi.mock("@/lib/demo", () => ({ DEMO_MODE: false }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.providers.mockReturnValue({
    data: ["google", "github"],
    isPending: false,
    isError: false,
  })
  mocks.list.mockResolvedValue({
    data: [{ id: "password-row", providerId: "credential" }],
    error: null,
  })
  mocks.link.mockResolvedValue({ error: null })
  mocks.unlink.mockResolvedValue({ error: null })
})
function show(error?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ConnectedAccounts userId="reader" oauthError={error} />
    </QueryClientProvider>
  )
}
describe("connected sign-in methods", () => {
  it("links from the signed-in settings page and returns to Security", async () => {
    show()
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect Google" })
    )
    await waitFor(() =>
      expect(mocks.link).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "/settings?tab=security",
        errorCallbackURL: "/settings?tab=security",
      })
    )
  })
  it("connects GitHub when configured", async () => {
    show()
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect GitHub" })
    )
    await waitFor(() =>
      expect(mocks.link).toHaveBeenCalledWith({
        provider: "github",
        callbackURL: "/settings?tab=security",
        errorCallbackURL: "/settings?tab=security",
      })
    )
  })
  it("hides the section when no social providers or linked identities exist", async () => {
    mocks.providers.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    })
    const { container } = show()
    await waitFor(() => expect(container.querySelector("section")).toBeNull())
  })
  it("keeps existing connected identities manageable after provider configuration is removed", async () => {
    mocks.providers.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    })
    mocks.list.mockResolvedValue({
      data: [
        { id: "password-row", providerId: "credential" },
        { id: "google-row", providerId: "google" },
      ],
      error: null,
    })
    show()
    expect(
      (
        await screen.findByRole("button", { name: "Disconnect Google" })
      ).hasAttribute("disabled")
    ).toBe(false)
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull()
  })
  it("unlinks using the local row ID, then refreshes the displayed accounts", async () => {
    mocks.list.mockResolvedValueOnce({
      data: [
        { id: "password-row", providerId: "credential" },
        { id: "google-row", providerId: "google", accountId: "google-subject" },
      ],
      error: null,
    })
    show()
    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect Google" })
    )
    await waitFor(() =>
      expect(mocks.unlink).toHaveBeenCalledWith({ accountId: "google-row" })
    )
    expect(
      await screen.findByRole("button", { name: "Connect Google" })
    ).toBeTruthy()
    expect(screen.getByRole("status").textContent).toContain("disconnected")
  })
  it("disables disconnecting the final method and hides unavailable connections", async () => {
    mocks.list.mockResolvedValue({
      data: [{ id: "google-row", providerId: "google" }],
      error: null,
    })
    mocks.providers.mockReturnValue({
      data: ["google"],
      isPending: false,
      isError: false,
    })
    show()
    expect(
      (
        await screen.findByRole("button", { name: "Disconnect Google" })
      ).hasAttribute("disabled")
    ).toBe(true)
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull()
    expect(mocks.unlink).not.toHaveBeenCalled()
  })
  it("shows callback errors and clears them when a new connection starts", async () => {
    show("social_account_already_linked")
    expect(screen.getByRole("alert").textContent).toContain(
      "another Sparkfeed account"
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect Google" })
    )
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })
  it("blocks mutations when account loading fails", async () => {
    mocks.list.mockResolvedValue({
      data: null,
      error: { message: "Unavailable" },
    })
    show()
    expect((await screen.findByRole("alert")).textContent).toContain(
      "couldn't load"
    )
    expect(
      screen
        .getByRole("button", { name: "Connect Google" })
        .hasAttribute("disabled")
    ).toBe(true)
  })
})
