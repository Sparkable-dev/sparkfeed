import { useQuery } from "@tanstack/react-query"
import { getEnabledSocialProviders } from "@/server/social-auth"
import { DEMO_MODE } from "@/lib/demo"

export function useSocialProviders() {
  return useQuery({
    queryKey: ["social-auth-providers"],
    queryFn: () => getEnabledSocialProviders(),
    staleTime: 60_000,
    enabled: !DEMO_MODE,
  })
}
