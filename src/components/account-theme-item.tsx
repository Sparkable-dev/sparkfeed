import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { useThemeCycle } from "@/hooks/use-theme-cycle"

export function AccountThemeItem() {
  const { mounted, label, next, Icon, cycle } = useThemeCycle()
  return (
    <DropdownMenuItem disabled={!mounted} closeOnClick={false} onClick={cycle}
      aria-label={`Theme: ${label}. Switch to ${next}.`}
      className="cursor-pointer gap-2 rounded-lg p-2 text-foreground">
      <Icon className="size-4" aria-hidden="true" />
      <span className="text-sm font-medium">Theme: {label}</span>
    </DropdownMenuItem>
  )
}
