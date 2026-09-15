import { createFileRoute, redirect } from "@tanstack/react-router"
import SignInForm from "@/components/shadcn-space/blocks/login-02/login"
import { authSearch } from "@/lib/auth-redirect"

export const Route = createFileRoute("/sign-in")({
  validateSearch: authSearch,
  beforeLoad: () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
  },
  component: SignInPage,
})
function SignInPage() {
  return <SignInForm search={Route.useSearch()} />
}
