import { definePlugin } from "nitro"
import { readSparkfeedDeploymentConfig } from "../entitlements/config"
import { readDodoBillingConfig } from "../billing/dodo-config"

/** Fail startup on an unknown edition or incomplete Cloud billing configuration. */
export default definePlugin(() => {
  readSparkfeedDeploymentConfig()
  readDodoBillingConfig()
})
