import { definePlugin } from "nitro"
import { readSparkfeedDeploymentConfig } from "../entitlements/config"
import { readDodoBillingConfig } from "../billing/dodo-config"

/** Fail startup on an unknown edition or deployment surface. */
export default definePlugin(() => {
  readSparkfeedDeploymentConfig()
  readDodoBillingConfig()
})
