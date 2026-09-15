import { createFileRoute, redirect } from "@tanstack/react-router"
import VerifyEmail from "@/components/shadcn-space/blocks/verify-email-02/verify-email"
import { authSearch } from "@/lib/auth-redirect"

export const Route = createFileRoute("/verify-email")({
  validateSearch: authSearch,
  beforeLoad: () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
  },
  component: VerifyEmailPage,
})
function VerifyEmailPage() {
  return <VerifyEmail search={Route.useSearch()} />
}
