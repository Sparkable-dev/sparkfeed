# Team billing release checks

## Phase 0: Confirm provider behavior

Use Dodo's [seat-based billing guide](https://docs.dodopayments.com/features/seat-based-billing), [plan-change guide](https://docs.dodopayments.com/developer-resources/subscription-upgrade-downgrade), and [payment retry guide](https://docs.dodopayments.com/features/recovery/payment-retries).

Allowed SDK methods: `subscriptions.previewChangePlan`, `changePlan`, `cancelChangePlan`, `retrieve`, `list`, `customers.customerPortal.create`, and `checkoutSessions.create`.

Verify these rules in Test Mode before release:

- Approved: `prorated_immediately` charges for remaining time and resets the renewal date. Show the exact provider preview, including dates. Require a fresh confirmation if the quoted amount or displayed renewal date changes.
- `effective_at: next_billing_date` with `do_not_bill` schedules reductions without an immediate credit or charge.
- `on_payment_failure: prevent_change` keeps additional seats unavailable until payment succeeds.
- Automatic payment retries cover renewals, not initial payments or plan-change charges.

Do not assume `idempotencyKey` sends an HTTP header. In the installed SDK, `idempotencyHeader` is unassigned. Do not invent response fields: plan-change responses expose nullable payment handles, not a reliable paid status.

## Phase 1: Prevent duplicate creating requests

Use the committed-request pattern in `src/server/billing/team-subscriptions.ts` and `personal-checkout.ts`. Commit a database guard before creating a checkout or charging a seat change. Disable SDK retries on these requests. Reuse saved checkout links. Keep uncertain requests blocked until reconciliation proves their outcome.

Verify concurrent clicks, lost responses, delayed webhooks, and repeated confirmations. A failed first mandate may get a fresh attempt. An active, on-hold, or expired subscription must not be replaced while outstanding invoices may still recover.

Do not reset a pending checkout merely because time passed. Do not build an application renewal-charge loop alongside Dodo's retries.

Replace an expired hosted checkout only after 25 hours and after Dodo confirms that it created no payment. The extra hour is clock margin beyond Dodo's documented 24-hour expiry. Keep sessions with payments blocked until their subscription state is resolved.

Allow corrected requests after explicit provider rejections, such as invalid parameters or missing permission. Preserve the guard for timeouts, conflicts, connection failures, and server errors. Never clear an unresolved guard to make a retry button work. Support must verify the exact customer, session, subscription, and payment outcome first.

## Phase 2: Enforce seat changes

Follow the provider preview/change pattern in `teamChangeParams` and `changeTeamPlan`.

| Case | Required outcome |
| --- | --- |
| 3 to 4 monthly seats | Preview remaining-time charge and new renewal date; unlock after payment |
| 3 to 4 annual seats | Preview remaining annual-period charge, not a monthly approximation |
| 3 occupied seats to 2 paid seats | Sonner error; no provider mutation |
| 2 occupied seats to 2 paid seats | Schedule reduction from 3 at renewal; retain paid capacity until then |
| Pending invitation | Reserve a seat; include it in the server-side capacity check |
| Invitation races with a plan change | Reject the insert in PostgreSQL while the billing request is pending |
| Invite into a seat scheduled for removal | Cancel the scheduled reduction before accepting the reservation |
| Seat count plus interval change | Require separate changes; do not silently defer added seats |
| Failed or uncertain seat charge | Retain confirmed seat capacity; block another charge |
| Enterprise | Keep operator-managed negotiated billing separate from self-service Pro |

Verify database concurrency, Owner authorization, source-capacity changes, and confirmation dialogs. Never calculate authoritative charges in the browser or unlock access from a redirect URL.

## Phase 3: Convert Personal+ safely

Use `createPendingTeam` with explicit upgrade consent and `completePersonalUpgrade`. Keep personal content unchanged before confirmed Pro payment. Confirm Personal+ renewal cancellation before moving folders, sources, articles, and private chat context. Preserve IDs and user ownership. Do not transfer personal API keys or credit history.

Verify failed payment, cancellation outage, repeated delivery, simultaneous upgrade requests, and content ownership. The current checkout starts Pro immediately without an automatic refund for unused Personal+ time; disclose this before payment.

Complete conversion from the signed webhook as well as billing refresh and maintenance. A failed cancellation leaves content personal and the webhook retryable.

## Phase 4: Release and deployed verification

Run application tests, PostgreSQL billing tests, type checks, builds, and UI checks. Verify the separate dashboard's Enterprise wording. Preserve unrelated Discover edits.

Ask before committing, pushing, or deploying either repository. Railway runs the additive migrations at startup. These changes require no new Railway variables.

In Dodo Test Mode, enable Payment Retries with a 13-day window. Enable on-hold dunning reminders. Leave cancelled-subscription repurchase reminders off until their checkout metadata and upgrade interactions are tested.

After deployment, verify initial checkout recovery, monthly and annual seat increases, occupied-seat rejection, next-renewal decreases, invitation races, and Personal+ conversion. Check Dodo records for one intended charge and subscription per operation. Local tests do not prove the deployed payment flow.
