import { useNavigate } from "@tanstack/react-router"

export type SettingsSection = "profile" | "security" | "workspaces"

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: "profile", label: "Account" },
  { id: "security", label: "Security" },
  { id: "workspaces", label: "Workspace" },
]

export function SettingsNavigation({ active }: { active: SettingsSection }) {
  const navigate = useNavigate()

  return (
    <div className="border-b">
      <nav
        aria-label="Settings sections"
        className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-4 py-3 sm:px-6 lg:px-10"
      >
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={active === section.id ? "page" : undefined}
            onClick={() =>
              navigate({
                to: "/settings",
                search: { tab: section.id },
              } as never)
            }
            className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors active:translate-y-px ${
              active === section.id
                ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {section.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
