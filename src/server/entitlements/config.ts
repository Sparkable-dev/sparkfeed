import { EDITIONS } from "./types"
import type { SparkfeedEdition } from "./types"

export interface SparkfeedDeploymentConfig {
  edition: SparkfeedEdition
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
  return { edition }
}

export function sparkfeedEdition(
  env: Record<string, string | undefined> = process.env
): SparkfeedEdition {
  return readSparkfeedDeploymentConfig(env).edition
}
