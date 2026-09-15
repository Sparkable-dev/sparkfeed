import { createFileRoute, redirect } from "@tanstack/react-router"
import SignUpForm from "@/components/shadcn-space/blocks/register-02/register"
import { authSearch } from "@/lib/auth-redirect"

export const Route = createFileRoute("/sign-up")({
  validateSearch: authSearch,
  beforeLoad: async ({ search }) => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
    const { checkCanRegister } = await import("@/server/auth-setup")
    const { allowed, reason } = await checkCanRegister({
      data: { email: search.email },
    })
    if (!allowed)
      throw redirect({
        to: "/sign-in",
        search: {
          info: reason,
          redirect: search.redirect,
          email: search.email,
        },
      })
  },
  component: SignUpPage,
})
function SignUpPage() {
  return <SignUpForm search={Route.useSearch()} />
}
