import { ImageIcon, PlusIcon, Sparkles, Wrench } from "lucide-react"
import { ComposerPrimitive, useAui } from "@assistant-ui/react"
import { ComposerMenuContent, ComposerPill } from "./composer-menu"
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { useAIComposerPrefs } from "@/store/aiComposerPrefs"
import { SKILLS } from "@/config/skills"
import { CAPABILITY_GROUPS } from "@/config/tool-catalogue"
import { AUTONOMY_RANK } from "@/config/autonomy"

/**
 * The `+` menu: attachments, Skills, and what Spark AI can reach.
 *
 * There is no Connectors section. Spark AI is the MCP *server* — Claude Desktop
 * and Cursor connect to it at `/api/mcp` — and it does not act as a client of
 * anyone else's, so a menu offering to attach external servers was describing a
 * capability that does not exist and is not planned. Web search is not here for
 * the same reason: nothing in the tool registry reaches a search engine.
 */
export function PlusMenu() {
  const aui = useAui()
  const setActiveSkill = useAIComposerPrefs((s) => s.setActiveSkill)
  const autonomy = useAIComposerPrefs((s) => s.autonomy)

  return (
    <DropdownMenu>
      <ComposerPill
        icon={<PlusIcon className="size-4" />}
        aria-label="Add content and tools"
      />
      <ComposerMenuContent>
        {/* Rendering through the primitive keeps the file-picker wiring (and its
            disabled state when no attachment adapter is configured) with
            assistant-ui rather than reimplementing it against the DOM. */}
        <ComposerPrimitive.AddAttachment
          multiple
          render={<DropdownMenuItem className="gap-2.5 py-1.5" />}
        >
          <ImageIcon className="size-4 opacity-70" />
          Add files or photos
        </ComposerPrimitive.AddAttachment>

        <DropdownMenuSeparator />

        {/* Skills are actions, not settings, so they are picked rather than
            toggled — the same list the `/` command menu shows. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2.5 py-1.5">
            <Sparkles className="size-4 opacity-70" />
            Skills
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto min-w-[300px] p-1">
            {SKILLS.map((skill) => (
              <DropdownMenuItem
                key={skill.id}
                className="items-start gap-2.5 py-1.5"
                onClick={() => setActiveSkill(skill.id)}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span>{skill.name}</span>
                    <span className="text-xs text-muted-foreground">
                      /{skill.id}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {skill.description}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2.5 py-1.5">
            <Wrench className="size-4 opacity-70" />
            Tools
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto min-w-[320px] p-1">
            {CAPABILITY_GROUPS.map((group) => {
              const Icon = group.icon
              // The same comparison the server makes before handing the model a
              // tool, so a row can never promise what the request will refuse.
              const permitted =
                AUTONOMY_RANK[autonomy] >= AUTONOMY_RANK[group.minAutonomy]

              return (
                <DropdownMenuItem
                  key={group.id}
                  className="items-start gap-2.5 py-1.5"
                  // Picking a capability writes a worked example into the
                  // composer rather than flipping a setting: these are always
                  // available to the model, so the useful thing a menu can do
                  // is show what asking for one looks like.
                  onClick={() => aui.composer.setText(group.example)}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 opacity-70" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span>{group.label}</span>
                      {permitted ? null : (
                        <span className="rounded-sm bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">
                          needs Ask
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {group.description}
                    </span>
                  </span>
                </DropdownMenuItem>
              )
            })}

            <DropdownMenuSeparator />
            {/* Not a disabled row: a menu item that cannot be chosen reads as a
                broken control. This is a caption. */}
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Spark picks these itself. The pill beside this menu decides
              whether it may write.
            </p>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </ComposerMenuContent>
    </DropdownMenu>
  )
}
