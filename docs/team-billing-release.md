# Pro Team billing release

Implemented locally on 2026-09-16. No push or deployment is authorized without Sudu's confirmation. Deployed acceptance is a separate gate after Railway updates.

## Railway variables

Add these to the **beta customer application service**. Existing Personal+ variables, API key, webhook secret, and test-mode setting remain in use.

```dotenv
DODO_PRO_MONTHLY_PRODUCT_ID=pdt_0NnjegaPYyVX0veYL3j3n
DODO_PRO_MONTHLY_SEAT_ADDON_ID=adn_0NnjeVhuTFqP4is1H62DD
DODO_PRO_ANNUAL_PRODUCT_ID=pdt_0Nnjegd1zz8mpXfNiOZRe
DODO_PRO_ANNUAL_SEAT_ADDON_ID=adn_0NnjegcHuiM70NmYRAWgo
```

These identifiers exist in Dodo Test Mode only. Do not use them with live keys. All four are server variables; do not add a `VITE_` prefix. They enable Pro checkout without changing Community Edition or Enterprise provisioning.

Railway's existing start command runs `bun run db:migrate` before startup. Migrations 0022 and 0023 add durable Team checkout and queued seat-reduction state. No Railway console commands are needed.

The existing 15-minute allowance worker now reconciles Team subscriptions and queued reductions as well. Do not disable `SPARKFEED_ALLOWANCE_WORKER` on the beta application. No additional worker service is required.

## Dodo setup completed

- Pro Monthly: USD 12, one included seat; additional seats USD 12 each.
- Pro Annual: USD 96, one included seat; additional seats USD 96 each.
- Both are tax inclusive, without a trial, recurring for 20 years at the chosen payment frequency.
- Products use the same SaaS category and brand as Personal+.
- Existing webhook: `https://beta.sparkfeed.dev/api/dodo/webhooks`.
- Existing subscription event subscriptions cover activation, renewal, update, plan change, on-hold, failure, cancellation, expiry, pause, and unpause.
- Re-running `bun --env-file=.env.beta.local scripts/setup-team-dodo-test.ts` verifies and reuses these named products and add-ons. It refuses live mode.

Actual Dodo checkout previews verified three monthly seats at USD 36 in both US and India, with tax included. The application created a real test checkout for three annual seats and the browser showed USD 288, including GST. No payment was submitted in that browser check.

## Behavior

New workspaces start owner-only and read-only. A server-created checkout is bound to a dedicated organization customer, environment, workspace ID and durable attempt ID. Reloads and retries reuse that attempt. Payment confirmation comes from signed webhooks and authenticated provider reads, never from a return URL.

Owners can review and confirm seat increases, schedule reductions and interval changes for renewal, cancel at period end, restore a scheduled cancellation, cancel a scheduled plan change, and open their workspace's billing portal. Immediate increases use `prevent_change` on failed payment. The UI displays Dodo's charge and renewal-date preview. A submitted change is not announced as paid access.

Members and pending invitations occupy seats. PostgreSQL membership locks enforce capacity for concurrent writes. Member removal or invitation cancellation queues a reduction, applied at renewal. Invitations that reuse that capacity cancel a conflicting scheduled reduction before reserving the seat.

Each paid seat contributes 50 website-source slots. Confirmed seat reductions pause excess website sources in creation order; confirmed increases restore capacity. Standard RSS and saved articles are preserved. Source additions recheck the current Team limit after acquiring the workspace lock.

Failed initial payment does not grant Pro access. Failed renewal keeps existing access for 13 days, then becomes read-only. Repeated failures do not reset the grace deadline. Cancellation and expiry preserve data. Cleanup operations remain available during billing restrictions, while operator suspensions remain enforced. Open checkout records cannot be deleted while payment may still arrive.

Manual Pro remains active during an optional move to online billing. The confirmed payment switches the base subscription to Dodo and clears legacy manual limits. Separate operator overrides remain authoritative. Enterprise stays manual. Personal+ retains its existing checkout and portal.

## Local validation

Final checks on 2026-09-16: 846 tests passed, 54 optional tests skipped; the targeted Team/platform PostgreSQL and billing UI run passed 52 tests. Typecheck and production build passed. Lint finished with zero errors and 27 warnings in existing test files. No commit, push or Railway deployment was performed.

- Disposable PostgreSQL database `sparkfeed_team_billing_qa`, container `sparkfeed-team-billing-qa-20260916`, port 55442.
- Team billing integration tests exercise checkout idempotency, signed webhook verification and deduplication, stale event recovery, workspace/customer/environment validation, owner authorization, transfer, concurrent invitation capacity, credit grants, grace expiry, cancellation, queued reductions and manual migration.
- Component tests exercise explicit charge confirmation, cancellation confirmation, Sonner error feedback, and activation only after server confirmation.
- Browser checks cover login, Team creation inputs, invalid seat limits, annual totals, application-to-Dodo navigation, billing controls and error notifications.
- `scripts/seed-team-billing-qa.ts` creates synthetic local UI fixtures only; it refuses remote or non-`_qa` databases. These fixtures do not represent real paid subscriptions.

## Railway acceptance, still to run

1. Confirm the approved commit is deployed and migrations succeeded. Check beta health and sign-in.
2. Create separate monthly and annual Pro teams through the application using Dodo test cards. Confirm webhook deliveries return 200 and the correct workspace activates.
3. Invite a second verified account. Verify Owner/Admin/Editor permissions, pending seat reservations, joining, removal, expiry and concurrent capacity limits.
4. Increase seats after reviewing the provider charge; test successful and declined payment. Confirm seats only unlock after payment. Check actual proration and renewal dates in Dodo.
5. Schedule reductions and interval changes; reuse a seat before renewal and verify the scheduled reduction is canceled. Advance a test renewal and compare billed seats to access.
6. Test scheduled cancellation, cancellation reversal, period-end read-only access, failed-renewal grace expiry and reactivation. Confirm data, export and cleanup remain available as intended.
7. Test existing manual Pro migration, ownership transfer, personal-plus/team separation, multiple Teams, operator restriction and reconciliation/replay.
8. Check monthly per-member AI grants on annual subscriptions, late-join proration, credit cap and replay idempotency.

Dodo Test Mode does not send all the transaction emails available in Live Mode. Application invitation/error flows and Dodo payment state must be checked separately. Live-mode catalog creation and a real-payment acceptance run are later release tasks.

## References

- [Dodo seat-based billing](https://docs.dodopayments.com/features/seat-based-billing)
- [Dodo plan changes](https://docs.dodopayments.com/api-reference/subscriptions/change-plan)
- [Dodo test-mode behavior](https://docs.dodopayments.com/miscellaneous/test-mode-vs-live-mode)
- [shadcn Sonner](https://ui.shadcn.com/docs/components/radix/sonner)
