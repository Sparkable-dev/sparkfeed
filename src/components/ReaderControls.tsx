import { ALargeSmall, Minus, Plus } from "lucide-react"
import type { ReaderTheme, ReaderWidth } from "@/store/readerPrefs"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FONT_MAX, FONT_MIN, useReaderPrefs } from "@/store/readerPrefs"

const THEMES: Array<{ key: ReaderTheme; label: string; swatch: string }> = [
  { key: "dark", label: "Dark", swatch: "bg-[#111111] text-white" },
  { key: "sepia", label: "Sepia", swatch: "bg-[#f4ecd8] text-[#433422]" },
  { key: "light", label: "Light", swatch: "bg-white text-black" },
]

const WIDTHS: Array<{ key: ReaderWidth; label: string }> = [
  { key: "narrow", label: "Narrow" },
  { key: "wide", label: "Wide" },
]

// "Aa" popover with reader-view preferences (text size, width, theme).
// Preferences persist across articles via the readerPrefs store.
export function ReaderControls() {
  const fontScale = useReaderPrefs((s) => s.fontScale)
  const width = useReaderPrefs((s) => s.width)
  const theme = useReaderPrefs((s) => s.theme)
  const increaseFont = useReaderPrefs((s) => s.increaseFont)
  const decreaseFont = useReaderPrefs((s) => s.decreaseFont)
  const setWidth = useReaderPrefs((s) => s.setWidth)
  const setTheme = useReaderPrefs((s) => s.setTheme)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-500 hover:text-white"
            title="Reading options"
          />
        }
      >
        <ALargeSmall className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-64 gap-3 border-white/10 bg-[#1a1a1a] text-zinc-200"
      >
        {/* Text size */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Text size</span>
          <div className="flex items-center gap-1">
            <button
              onClick={decreaseFont}
              disabled={fontScale <= FONT_MIN}
              aria-label="Decrease text size"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-30"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center text-xs tabular-nums text-zinc-300">
              {Math.round(fontScale * 100)}%
            </span>
            <button
              onClick={increaseFont}
              disabled={fontScale >= FONT_MAX}
              aria-label="Increase text size"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-30"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="h-px bg-white/10" />

        {/* Width */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Width</span>
          <div className="flex gap-0.5 rounded-md border border-white/10 bg-white/5 p-0.5">
            {WIDTHS.map((w) => (
              <button
                key={w.key}
                onClick={() => setWidth(w.key)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  width === w.key ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-white/10" />

        {/* Theme */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Theme</span>
          <div className="flex gap-1.5">
            {THEMES.map((t) => (
              <button
                key={t.key}
                onClick={() => setTheme(t.key)}
                title={t.label}
                aria-label={`${t.label} theme`}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold transition-transform",
                  t.swatch,
                  theme === t.key
                    ? "ring-2 ring-white ring-offset-1 ring-offset-[#1a1a1a]"
                    : "border-white/20 hover:scale-105"
                )}
              >
                Aa
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
