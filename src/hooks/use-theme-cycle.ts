import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun } from "lucide-react"

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/** Shared by authentication and account controls; the provider owns persistence. */
export function useThemeCycle() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
  const current = mounted && (theme === "light" || theme === "dark") ? theme : "system"
  const next = current === "light" ? "dark" : current === "dark" ? "system" : "light"
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor
  const label = current[0].toUpperCase() + current.slice(1)
  return { mounted, current, next, Icon, label, cycle: () => setTheme(next) }
}
