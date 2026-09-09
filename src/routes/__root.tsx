import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import appCss from "../styles.css?url"
import type { QueryClient } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SupportSessionBanner } from "@/components/SupportSessionBanner"
import { Toaster } from "@/components/ui/sonner"


export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Sparkfeed",
      },
      {
        name: "description",
        content: "Your feeds, in one calm place.",
      },
      {
        name: "theme-color",
        content: "#4F29F6",
      },
    ],
    links: [
      // Brand mark for the browser tab. Without these the app fell back to the
      // template's leftover React favicon.ico.
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "apple-touch-icon",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>
          {import.meta.env.VITE_DEMO_MODE !== "true" && <SupportSessionBanner />}
          {children}
          <Toaster />
          {/* Dev-only: never ship devtools to a public/production build. */}
          {import.meta.env.DEV && (
            <TanStackDevtools
              config={{
                position: "bottom-right",
              }}
              plugins={[
                {
                  name: "Tanstack Router",
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
          )}
        </TooltipProvider>
        <Scripts />
      </body>
    </html>
  )
}
