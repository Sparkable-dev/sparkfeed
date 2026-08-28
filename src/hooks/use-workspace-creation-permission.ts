import { useEffect, useState } from "react"
import { DEMO_MODE } from "@/lib/demo"
import { checkCanCreateWorkspace } from "@/server/auth-setup"

export function useWorkspaceCreationPermission() {
  const [allowed, setAllowed] = useState(false)
  const [pending, setPending] = useState(!DEMO_MODE)

  useEffect(() => {
    if (DEMO_MODE) return

    let active = true
    void checkCanCreateWorkspace()
      .then((result) => {
        if (active) setAllowed(result.allowed)
      })
      .finally(() => {
        if (active) setPending(false)
      })

    return () => {
      active = false
    }
  }, [])

  return { allowed, pending }
}
