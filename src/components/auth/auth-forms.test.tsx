// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import SignInForm from "@/components/shadcn-space/blocks/login-02/login"
import SignUpForm from "@/components/shadcn-space/blocks/register-02/register"
import VerifyEmail from "@/components/shadcn-space/blocks/verify-email-02/verify-email"

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  getSession: vi.fn(),
  verify: vi.fn(),
  toast: vi.fn(),
  theme: vi.fn(),
}))
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: mocks.signIn },
    signUp: { email: mocks.signUp },
    sendVerificationEmail: mocks.resend,
    getSession: mocks.getSession,
    verifyEmail: mocks.verify,
  },
}))
vi.mock("sonner", () => ({ toast: { info: mocks.toast } }))
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme: mocks.theme }),
}))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ data: null, error: null })
})
describe("auth form interactions", () => {
  it("waits for blur before showing email errors and clears them after correction", () => {
    render(<SignUpForm search={{}} />)
    const email = screen.getByLabelText("Email address")
    expect(document.querySelector("form")?.noValidate).toBe(true)
    expect(screen.queryByText("Use at least 8 characters.")).toBeNull()
    fireEvent.change(email, { target: { value: "invalid" } })
    expect(screen.queryByText("Enter a valid email address.")).toBeNull()
    fireEvent.blur(email)
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy()
    fireEvent.change(email, { target: { value: "reader@example.com" } })
    expect(screen.queryByText("Enter a valid email address.")).toBeNull()
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "short" },
    })
    fireEvent.blur(screen.getByLabelText("Password"))
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy()
    fireEvent.submit(document.querySelector("form")!)
    expect(mocks.signUp).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByLabelText("Full name"))
  })
  it("preserves social buttons as toast-only controls and cycles the theme", () => {
    render(<SignInForm search={{}} />)
    fireEvent.click(screen.getByRole("button", { name: "Google" }))
    fireEvent.click(screen.getByRole("button", { name: "GitHub" }))
    expect(mocks.toast).toHaveBeenNthCalledWith(
      1,
      "Google sign-in is coming soon."
    )
    expect(mocks.toast).toHaveBeenNthCalledWith(
      2,
      "GitHub sign-in is coming soon."
    )
    expect(mocks.signIn).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: "Theme: dark. Switch to system." })
    )
    expect(mocks.theme).toHaveBeenCalledWith("system")
  })
  it("submits normalized email and full name and preserves verification destination", async () => {
    mocks.signUp.mockResolvedValue({ error: { message: "Controlled failure" } })
    render(<SignUpForm search={{ redirect: "/sprk/my-folder" }} />)
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "  李  " },
    })
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "reader@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a long test passphrase" },
    })
    fireEvent.submit(document.querySelector("form")!)
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalled())
    const body = mocks.signUp.mock.calls[0][0]
    expect(body.name).toBe("李")
    expect(
      new URL(body.callbackURL, "https://app.test").searchParams.get("redirect")
    ).toBe("/sprk/my-folder")
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Controlled failure"
    )
  })
  it("shows resend errors without reporting success or starting a cooldown", async () => {
    mocks.resend.mockResolvedValue({ error: { message: "Mail unavailable" } })
    render(
      <VerifyEmail
        search={{ email: "reader@example.com", redirect: "/discover" }}
      />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Resend verification email" })
    )
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Mail unavailable"
    )
    expect(screen.queryByText(/a new link has been sent/)).toBeNull()
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it("does not trust a success query parameter without a verified session", async () => {
    render(<VerifyEmail search={{ verified: "1" }} />)
    await screen.findByText(/If you verified your email in another browser/)
    expect(screen.queryByRole("heading", { name: "Email verified" })).toBeNull()
    expect(mocks.verify).not.toHaveBeenCalled()
  })
})
