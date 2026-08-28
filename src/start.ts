import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { isUnroutableSsrResponse, notFoundResponse } from './server/http/not-found'
import { wellKnownResponse } from './server/mcp/well-known'

/**
 * The Start instance: request middleware that has to run ahead of the router.
 *
 * ## Read this before adding anything
 *
 * The mere existence of this file changes a security default. In
 * `createStartHandler`:
 *
 *   requestMiddleware: hasStartInstance
 *     ? startOptions.requestMiddleware
 *     : [defaultCsrfMiddleware]
 *
 * Once a start entry exists, Start stops injecting its own CSRF middleware and
 * uses this list verbatim. `csrfMiddleware` below is therefore not optional and
 * not decorative — dropping it silently unprotects every server function in the
 * app. It is a copy of the framework default.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

/**
 * Serves the OAuth discovery documents.
 *
 * Ahead of the router because TanStack's file-based routing cannot express a
 * path segment starting with a dot, and because these documents must answer
 * before any auth or database work happens.
 */
const wellKnownMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => wellKnownResponse(request) ?? next(),
)

/**
 * Rewrites Start's non-HTML SSR refusal to a 404.
 *
 * Outermost of the two so it sees the result of everything downstream. See
 * `server/http/not-found.ts` for why a 500 here was actively harmful.
 */
const notFoundMiddleware = createMiddleware({ type: 'request' }).server(async ({ next }) => {
  const result = await next()
  return (await isUnroutableSsrResponse(result.response)) ? notFoundResponse() : result
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, notFoundMiddleware, wellKnownMiddleware],
}))
