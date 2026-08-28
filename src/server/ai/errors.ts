/**
 * Errors that are safe to show the user.
 *
 * The route this replaced swallowed everything into a generic 500 that the UI
 * never rendered, so a missing API key looked like a spinner that quietly
 * stopped. Anything thrown as an `AIError` carries a status and a message
 * intended for a human; anything else is logged and reported generically, so
 * provider internals and stack traces never reach the client.
 */
export class AIError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "AIError"
    this.status = status
  }
}

export const AI_DISABLED = (demo = false) =>
  new AIError(
    demo
      ? "Spark AI is a preview in demo mode. Sign up for a free account to chat."
      : "Spark AI is not available on this deployment.",
    403
  )

export const AI_UNAUTHENTICATED = () =>
  new AIError("Sign in to use Spark AI.", 401)

export const AI_BAD_REQUEST = () =>
  new AIError("That request was malformed.", 400)

export const AI_NO_PROVIDER = (modelLabel: string) =>
  new AIError(
    `No AI provider is configured for ${modelLabel}. Set AI_GATEWAY_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY.`,
    503
  )

/** Maps any thrown value to a (status, message) pair fit for a response body. */
export function toUserFacingError(error: unknown): {
  status: number
  message: string
} {
  if (error instanceof AIError) {
    return { status: error.status, message: error.message }
  }
  console.error("[ai] unhandled error:", error)
  return {
    status: 500,
    message: "Spark AI hit an unexpected error. Try again.",
  }
}
