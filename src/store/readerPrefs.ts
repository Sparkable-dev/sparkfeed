import { create } from "zustand"
import { persist } from "zustand/middleware"

export type ReaderTheme = "dark" | "sepia" | "light"
export type ReaderWidth = "narrow" | "wide"

export const FONT_MIN = 0.85
export const FONT_MAX = 1.4
const FONT_STEP = 0.075

function clampFont(v: number) {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(v * 1000) / 1000))
}

interface ReaderPrefsStore {
  fontScale: number
  width: ReaderWidth
  theme: ReaderTheme
  increaseFont: () => void
  decreaseFont: () => void
  setWidth: (w: ReaderWidth) => void
  setTheme: (t: ReaderTheme) => void
}

// Persisted reader-view preferences — shared across every article the user opens.
export const useReaderPrefs = create<ReaderPrefsStore>()(
  persist(
    (set, get) => ({
      fontScale: 1,
      width: "narrow",
      theme: "dark",
      increaseFont: () => set({ fontScale: clampFont(get().fontScale + FONT_STEP) }),
      decreaseFont: () => set({ fontScale: clampFont(get().fontScale - FONT_STEP) }),
      setWidth: (width) => set({ width }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: "rss-reader-prefs" }
  )
)
