import { createHash, createPublicKey, verify } from "node:crypto"
import { z } from "zod"

export class PlatformRequestError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

const claimsSchema = z
  .object({
    iss: z.literal("sparkfeed-dashboard"),
    aud: z.literal("sparkfeed-platform"),
    sub: z.string().min(1).max(200),
    email: z.email(),
    environment: z.enum(["beta", "production"]),
    method: z.enum(["GET", "POST"]),
    path: z.string().max(3000),
    bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    iat: z.number().int(),
    exp: z.number().int(),
    jti: z.uuid(),
  })
  .strict()

export function requestHash(body: string) {
  return createHash("sha256").update(body).digest("hex")
}

/** Ed25519, fixed algorithm; assertion is bound to this exact request. */
export function verifyPlatformAssertion(
  request: Request,
  body: string,
  env = process.env,
  now = Date.now()
) {
  if (
    env.SPARKFEED_EDITION !== "cloud" ||
    !env.SPARKFEED_DASHBOARD_PUBLIC_KEY ||
    !env.SPARKFEED_ENVIRONMENT
  ) {
    throw new PlatformRequestError(404, "Not found")
  }
  try {
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1]
    if (!token || token.length > 8000) throw new Error("Missing assertion")
    const [encoded, signature, extra] = token.split(".")
    if (!encoded || !signature || extra) throw new Error("Malformed assertion")
    const key = createPublicKey(
      env.SPARKFEED_DASHBOARD_PUBLIC_KEY.replace(/\\n/g, "\n")
    )
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(encoded),
        key,
        Buffer.from(signature, "base64url")
      )
    )
      throw new Error("Bad signature")
    const claims = claimsSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    )
    const seconds = Math.floor(now / 1000)
    const url = new URL(request.url)
    if (
      claims.environment !== env.SPARKFEED_ENVIRONMENT ||
      claims.method !== request.method ||
      claims.path !== url.pathname + url.search ||
      claims.bodyHash !== requestHash(body) ||
      claims.iat > seconds + 5 ||
      claims.iat < seconds - 65 ||
      claims.exp <= seconds ||
      claims.exp > claims.iat + 60 ||
      claims.exp <= claims.iat
    )
      throw new Error("Invalid request binding")
    return claims
  } catch {
    throw new PlatformRequestError(401, "Invalid operator assertion")
  }
}
