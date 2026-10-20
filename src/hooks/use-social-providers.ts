import { queryOptions, useQuery } from "@tanstack/react-query"
import { getEnabledSocialProviders } from "@/server/social-auth"
import { DEMO_MODE } from "@/lib/demo"

// Auth route loaders await this query so SSR and hydration use the same list.
export const socialProvidersQueryOptions = queryOptions({
  queryKey: ["social-auth-providers"],
  queryFn: () => getEnabledSocialProviders(),
  staleTime: 60_000,
  enabled: !DEMO_MODE,
})

export function useSocialProviders() {
  return useQuery(socialProvidersQueryOptions)
}
