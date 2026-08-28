import { ComposerMenuContent, ComposerPill } from "./composer-menu"
import type { AIModel, EffortId } from "@/config/ai-models"
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DEFAULT_MODEL_ID,
  formatModelChoice,
  getEffortsFor,
  getModel,
  getModelsGrouped,
} from "@/config/ai-models"
import { useAIComposerPrefs } from "@/store/aiComposerPrefs"

/**
 * Model picker with a per-model effort submenu.
 *
 * Each model is a submenu trigger: hovering opens its effort levels, and
 * clicking the row itself selects the model at its default effort. Base UI
 * supports both on one trigger, so the menu stays quick for people who do not
 * care about effort without hiding it from those who do.
 *
 * The effort list is per-model on purpose — the catalogue records exactly which
 * levels each model accepts (Gemini offers "minimal" and GPT-5.6 does not;
 * DeepSeek V4 Flash only does high and above), and a model with no reasoning
 * control gets no submenu at all rather than a set of options that would be
 * silently dropped.
 */
export function ModelMenu() {
  const modelId = useAIComposerPrefs((s) => s.modelId)
  const effort = useAIComposerPrefs((s) => s.effort)
  // Effort is always set together with its model, so `setModel(id, effort)`
  // covers both paths and the store keeps the pair consistent.
  const setModel = useAIComposerPrefs((s) => s.setModel)

  const active = getModel(modelId) ?? getModel(DEFAULT_MODEL_ID)
  const groups = getModelsGrouped()

  return (
    <DropdownMenu>
      <ComposerPill
        label={active ? formatModelChoice(active, effort) : "Model"}
        aria-label="Choose model and reasoning effort"
        className="max-w-[17rem]"
      />
      <ComposerMenuContent align="end" minWidth={300}>
        {/* DropdownMenuGroup is required, not decorative: Base UI's GroupLabel
            reads MenuGroupContext and throws outside a Group or RadioGroup. */}
        {groups.map((group) => (
          <DropdownMenuGroup key={group.group}>
            <DropdownMenuLabel>{group.group}</DropdownMenuLabel>
            {group.models.map((model) =>
              model.efforts.length > 0 ? (
                <ModelRowWithEfforts
                  key={model.id}
                  model={model}
                  selected={model.id === modelId}
                  selectedEffort={model.id === modelId ? effort : null}
                  onSelectModel={() => setModel(model.id)}
                  onSelectEffort={(next) => setModel(model.id, next)}
                />
              ) : (
                <DropdownMenuItem
                  key={model.id}
                  className="items-start py-1.5"
                  onClick={() => setModel(model.id)}
                >
                  <ModelRowLabel
                    model={model}
                    selected={model.id === modelId}
                  />
                </DropdownMenuItem>
              )
            )}
          </DropdownMenuGroup>
        ))}
      </ComposerMenuContent>
    </DropdownMenu>
  )
}

function ModelRowWithEfforts({
  model,
  selected,
  selectedEffort,
  onSelectModel,
  onSelectEffort,
}: {
  model: AIModel
  selected: boolean
  selectedEffort: EffortId | null
  onSelectModel: () => void
  onSelectEffort: (effort: EffortId) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        openOnHover
        delay={120}
        className="items-start py-1.5"
        onClick={onSelectModel}
      >
        <ModelRowLabel model={model} selected={selected} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-auto min-w-[220px] p-1">
        <DropdownMenuRadioGroup
          value={selectedEffort ?? model.defaultEffort ?? ""}
          onValueChange={(value) => onSelectEffort(value as EffortId)}
        >
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          {getEffortsFor(model).map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              // Picking an effort is the end of the interaction — close the
              // whole menu rather than leaving it hanging open.
              closeOnClick
              className="items-start py-1.5"
            >
              <span className="flex min-w-0 flex-col">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.hint}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function ModelRowLabel({
  model,
  selected,
}: {
  model: AIModel
  selected: boolean
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={selected ? "font-medium text-foreground" : undefined}>
        {model.label}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {model.description}
      </span>
    </span>
  )
}
