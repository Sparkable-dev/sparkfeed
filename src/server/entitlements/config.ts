import { DEPLOYMENT_SURFACES, EDITIONS } from "./types"
import type { DeploymentSurface, SparkfeedEdition } from "./types"

export interface SparkfeedDeploymentConfig {
  edition: SparkfeedEdition
  surface: DeploymentSurface
}

function oneOf<T extends string>(
  value: string,
  allowed: ReadonlyArray<T>,
  setting: string
): T {
  if (allowed.includes(value as T)) return value as T
  throw new Error(
    `[config] ${setting} must be one of ${allowed.join(", ")}; received ${JSON.stringify(value)}.`
  )
}

export function readSparkfeedDeploymentConfig(
  env: Record<string, string | undefined> = process.env
): SparkfeedDeploymentConfig {
  const edition = oneOf(
    env.SPARKFEED_EDITION ?? "community",
    EDITIONS,
    "SPARKFEED_EDITION"
  )
  const surface = oneOf(
    env.SPARKFEED_SURFACE ?? "app",
    DEPLOYMENT_SURFACES,
    "SPARKFEED_SURFACE"
  )

  if (edition === "community" && surface === "admin") {
    throw new Error(
      "[config] SPARKFEED_SURFACE=admin is only valid when SPARKFEED_EDITION=cloud."
    )
  }

  return { edition, surface }
}

export function sparkfeedEdition(
  env: Record<string, string | undefined> = process.env
): SparkfeedEdition {
  return readSparkfeedDeploymentConfig(env).edition
}

export function sparkfeedSurface(
  env: Record<string, string | undefined> = process.env
): DeploymentSurface {
  return readSparkfeedDeploymentConfig(env).surface
}
