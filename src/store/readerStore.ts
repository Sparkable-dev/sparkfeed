import { create } from "zustand"
import { persist } from "zustand/middleware"

interface ReaderStore {
  favorites: Array<string>
  toggleFavorite: (id: string) => void
  isFavorite: (id: string) => boolean
}

export const useReaderStore = create<ReaderStore>()(
  persist(
    (set, get) => ({
      favorites: [],
      toggleFavorite: (id) => {
        const current = get().favorites
        if (current.includes(id)) {
          set({ favorites: current.filter((f) => f !== id) })
        } else {
          set({ favorites: [...current, id] })
        }
      },
      isFavorite: (id) => get().favorites.includes(id),
    }),
    {
      // Guest-only storage. Leave the old unscoped key available for explicit recovery.
      name: "rss-guest-favorites",
    }
  )
)
