import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToString } from "react-dom/server"
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
} from "@tanstack/react-query"
import { SocialButtons } from "./auth-ui"
import type { SocialProvider } from "@/lib/social-auth"
import { socialProvidersQueryOptions } from "@/hooks/use-social-providers"

const { getProviders } = vi.hoisted(() => ({ getProviders: vi.fn() }))
vi.mock("@/server/social-auth", () => ({
  getEnabledSocialProviders: getProviders,
}))
vi.mock("@/lib/auth-client", () => ({ authClient: {} }))
afterEach(() => vi.resetAllMocks())

describe("social provider server rendering", () => {
  it.each(
    (
      [[], ["google"], ["github"], ["google", "github"]] as Array<
        Array<SocialProvider>
      >
    ).map((providers) => ({ providers }))
  )(
    "renders configured providers on the first frame and preserves them through hydration: %j",
    async ({ providers }) => {
      getProviders.mockResolvedValue(providers)
      const server = new QueryClient()
      const client = new QueryClient()
      try {
        await server.ensureQueryData(socialProvidersQueryOptions)
        const render = (cache: QueryClient, action: "sign-in" | "sign-up") =>
          renderToString(
            <QueryClientProvider client={cache}>
              <SocialButtons action={action} />
            </QueryClientProvider>
          )
        hydrate(client, dehydrate(server))
        for (const action of ["sign-in", "sign-up"] as const) {
          const html = render(server, action)
          expect(html.includes(">Google<")).toBe(providers.includes("google"))
          expect(html.includes(">GitHub<")).toBe(providers.includes("github"))
          expect(html.includes("with email")).toBe(providers.length > 0)
          expect(render(client, action)).toBe(html)
        }
        await client.ensureQueryData(socialProvidersQueryOptions)
        expect(getProviders).toHaveBeenCalledTimes(1)
      } finally {
        server.clear()
        client.clear()
      }
    }
  )
})
