import { useQuery } from "@tanstack/react-query"
import { getCataloguePreview } from "@/server/catalogue"

export type PreviewStatus = "idle" | "loading" | "ready" | "error"

/** Public catalogue data is cached by source, never mixed with private articles. */
export function useCataloguePreview(
  target: { kind: "collection" | "feed"; slug: string } | null,
  enabled = true
) {
  const query = useQuery({
    queryKey: ["catalogue-preview", target?.kind, target?.slug],
    queryFn: ({ signal }) => getCataloguePreview({ data: target!, signal }),
    enabled: !!target && enabled,
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    retry: false,
  })
  const status: PreviewStatus =
    !target || !enabled
      ? "idle"
      : query.isPending
        ? "loading"
        : query.isError
          ? "error"
          : "ready"
  return {
    feeds: query.data?.feeds ?? [],
    status,
    retry: () => {
      void query.refetch()
    },
  }
}
