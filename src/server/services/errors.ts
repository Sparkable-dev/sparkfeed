/**
 * Errors that cross the API boundary.
 *
 * Messages are written to be read by an agent deciding what to do next, not by
 * a developer reading a log. "Narrow with folder_id or since" is actionable;
 * "invalid argument" is not.
 */

export type ServiceErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_argument'
  | 'rate_limited'
  | 'entitlement_required'
  | 'upstream_failed'
  | 'not_implemented'

export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    /** Extra fields merged into the wire payload, e.g. retry_after_ms. */
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ServiceError'
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...this.detail } }
  }
}

export const notFound = (what = 'Resource') =>
  // Deliberately does not distinguish "deleted" from "belongs to another
  // workspace": telling those apart confirms which ids exist.
  new ServiceError('not_found', `${what} not found.`)

export const invalidArgument = (message: string) =>
  new ServiceError('invalid_argument', message)

export const rateLimited = (retryAfterMs: number) =>
  new ServiceError('rate_limited', 'Too many requests. Slow down and retry.', {
    retry_after_ms: retryAfterMs,
  })

export const notImplemented = (message: string) =>
  new ServiceError('not_implemented', message)

export const upstreamFailed = (message: string) =>
  new ServiceError('upstream_failed', message)
