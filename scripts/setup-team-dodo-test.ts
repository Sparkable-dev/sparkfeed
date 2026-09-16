import DodoPayments from "dodopayments"

// Explicitly test-only. Re-runs reuse named objects and never edit Personal+.
if (process.env.DODO_PAYMENTS_ENVIRONMENT !== "test_mode")
  throw new Error("This script only configures Dodo Test Mode.")
const client = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  environment: "test_mode",
})
const products = []
for await (const product of client.products.list()) products.push(product)
const addons = []
for await (const addon of client.addons.list()) addons.push(addon)
const reference = products.find((p) => p.name === "Sparkfeed Personal+ Monthly")
if (!reference)
  throw new Error("Expected Sparkfeed test account was not found.")
const personal = await client.products.retrieve(reference.product_id)
for (const interval of ["monthly", "annual"] as const) {
  const label = interval === "monthly" ? "Monthly" : "Annual"
  const price = interval === "monthly" ? 1200 : 9600
  const name = `Sparkfeed Pro ${label}`
  const addonName = `Sparkfeed Pro Additional Seat ${label}`
  let addon = addons.find((a) => a.name === addonName)
  if (!addon)
    addon = await client.addons.create({
      name: addonName,
      price,
      currency: "USD",
      tax_category: personal.tax_category,
      description: `One additional Pro workspace seat, billed ${interval}.`,
    })
  if (addon.price !== price || addon.currency !== "USD")
    throw new Error(`Review existing ${addonName}: unexpected price.`)
  let product = products.find((p) => p.name === name)
  if (!product)
    product = await client.products.create({
      name,
      tax_category: personal.tax_category,
      brand_id: personal.brand_id,
      description:
        "Includes one workspace seat. Add seats for your team, up to 10 total. Tax included.",
      addons: [addon.id],
      metadata: { sparkfeed_plan: "pro", environment: "test_mode", interval },
      price: {
        type: "recurring_price",
        currency: "USD",
        price,
        discount: 0,
        tax_inclusive: true,
        trial_period_days: 0,
        payment_frequency_count: 1,
        payment_frequency_interval: interval === "monthly" ? "Month" : "Year",
        subscription_period_count: 20,
        subscription_period_interval: "Year",
      },
    })
  const saved = await client.products.retrieve(product.product_id)
  if (
    saved.price.type !== "recurring_price" ||
    saved.price.price !== price ||
    saved.price.currency !== "USD" ||
    saved.price.payment_frequency_count !== 1 ||
    saved.price.payment_frequency_interval !==
      (interval === "monthly" ? "Month" : "Year") ||
    saved.price.subscription_period_count !== 20 ||
    saved.price.subscription_period_interval !== "Year" ||
    !saved.price.tax_inclusive ||
    !saved.addons?.includes(addon.id)
  )
    throw new Error(`Review existing ${name}: unexpected configuration.`)
  console.log(
    `DODO_PRO_${interval.toUpperCase()}_PRODUCT_ID=${saved.product_id}`
  )
  console.log(`DODO_PRO_${interval.toUpperCase()}_SEAT_ADDON_ID=${addon.id}`)
}
