# Sparkfeed Cloud billing and administration specification

> Internal implementation specification. Do not publish this file as customer documentation without a separate review.

| Field | Value |
| --- | --- |
| Status | Approved for phased implementation |
| Decision owner | Sudharsan Ananth |
| Recorded | 2026-08-30 |
| Applies to | Sparkfeed Cloud billing, hosted entitlements, Better Auth administration, and Dodo Payments |

This specification replaces the hosted plan, billing, and control-plane decisions in `SPARKFEED-EDITION-DECISIONS.md`. The Community Edition, licensing, and public-release decisions in that document remain in force.

Current source is authoritative for implementation facts. This document is authoritative for the product and architecture decisions below.

## Goals

The implementation must provide:

- Four Sparkfeed Cloud tiers: Free, Personal+, Pro, and Enterprise.
- One personal workspace for every Cloud account.
- Organization workspaces for Pro and Enterprise teams.
- Server-side entitlement enforcement for browser sessions, API keys, REST, MCP, Spark AI, sources, invitations, and workspace creation.
- Personal+ customer fields and the authenticated customer portal through the Better Auth Dodo adapter.
- Personal+ checkout and signed webhook ingestion through the official Dodo TypeScript SDK.
- Pro workspace billing through the official Dodo TypeScript SDK.
- A Clerk-like Cloud administration portal for Sparkfeed's platform operator.
- Full Community Edition capabilities without Dodo or the Cloud administration portal.
- One public application repository. Production-specific secrets and infrastructure stay outside Git.

The implementation must not create a private production fork of the Sparkfeed application.

## Deployment editions and services

Use two server-only settings:

```text
SPARKFEED_EDITION=community|cloud
SPARKFEED_SURFACE=app|admin
```

`SPARKFEED_EDITION` defaults to `community`. Community Edition must not initialize Dodo clients or call Dodo APIs.

Sparkfeed Cloud deploys the same reviewed commit as two Railway services:

| Service | Host | Configuration |
| --- | --- | --- |
| Customer application | `app.sparkfeed.dev` | `SPARKFEED_EDITION=cloud`, `SPARKFEED_SURFACE=app` |
| Platform administration | `admin.sparkfeed.dev` | `SPARKFEED_EDITION=cloud`, `SPARKFEED_SURFACE=admin` |

The services use the same Cloud database. They use separate host-only session cookies and trusted-origin lists. The admin service requires a separate sign-in.

If the active surface is not `admin`, platform-admin routes and APIs return 404. Community Edition never exposes those routes.

Cloud billing must fail closed when required Dodo configuration is absent. Do not expose Dodo API keys, webhook secrets, database credentials, or provider credentials through `VITE_` variables.

## Workspace identity

Workspace is the universal tenancy concept. A workspace has one of these identities:

```ts
type WorkspaceRef =
	| { type: "personal"; id: string }
	| { type: "organization"; id: string }
```

Use the existing tenancy keys:

- A personal workspace uses the user's ID.
- An organization workspace uses the Better Auth organization ID.
- The active workspace remains `activeOrganizationId || user.id` until a later migration explicitly replaces it.

Do not create a one-member Better Auth organization for a personal workspace. Do not add a duplicate workspace registry in this implementation.

Every first-time signup receives one personal workspace. Display its default name as `<name>'s workspace`. Use `Personal workspace` when the account has no suitable name.

An invited person also receives a personal workspace. After the person accepts an organization invitation, set that organization as the active workspace. If the organization removes the person, fall back to the personal workspace. Removing organization access must not remove the account or personal data.

A Pro subscription creates a separate organization workspace. It does not convert or upgrade the owner's personal workspace. A person can have Personal+ for a personal workspace and belong to one or more Pro organizations at the same time.

## Product contract

### Plan table

| Edition or plan | Audience | Workspace | Included usage | Price |
| --- | --- | --- | --- | --- |
| Community | Self-hosted individuals and teams | Personal and organization | Full application features, API, MCP, operator-configured AI providers, and up to 10 registered accounts per deployment | No Dodo |
| Free | Individual reader | One personal workspace | Unlimited standard RSS, 5 active no-RSS sources, and 50 one-time Spark AI credits | Free |
| Personal+ | Founders, researchers, analysts, and agent users | One personal workspace | Unlimited standard RSS, 50 active cost-bearing source units, API, MCP, 100 monthly Spark AI credits, and a 300-credit balance cap | $5 monthly or $48 annually, tax included |
| Pro | Small teams | One organization workspace | 1 to 10 seats, shared content, invitations, roles, API, MCP, 50 pooled cost-bearing source units per paid seat, 200 monthly Spark AI credits per active member, and a 600-credit per-member balance cap | $12 monthly or $96 annually per seat, tax included |
| Enterprise | Larger or contract-driven teams | Organization or dedicated deployment | 11 or more seats, contract-defined capacity, controls, support, invoicing, and deployment requirements | Custom |

Free is the trial. Paid plans do not have a separate timed trial at launch.

Standard RSS remains unlimited. Normal RSS refresh and article retention do not vary by hosted plan at launch.

One website without RSS consumes one cost-bearing source unit. Future connectors can use weighted units after Sparkable implements and costs them. Do not present YouTube, Instagram, X, or other future connectors as available before their implementation ships.

Free and Personal+ do not expose organization creation, invitations, members, or team roles.

### Spark AI credits

Spark AI credits apply only to AI actions inside the authenticated application. REST, API keys, and MCP do not consume Spark AI credits.

One hundred credits represent one US dollar of reported upstream model cost. The service reserves credits before an AI request and reconciles the reservation against the final reported cost. More expensive requests consume more credits.

Cloud uses Sparkable-managed model providers. Cloud customers cannot supply provider keys. Community Edition uses provider keys configured by the instance operator.

Credit rules are:

- Free grants 50 credits once to each verified Cloud account. Creating or joining another workspace does not create another Free grant.
- Personal+ grants 100 credits each month. The balance cannot exceed 300 credits.
- Pro grants 200 credits each month to each active accepted member. Credits belong to that member within that workspace and are not pooled. The balance cannot exceed 600 credits.
- Annual subscriptions still receive credits monthly.
- A new Pro member receives a prorated grant for the remaining days in the current subscription period.
- A grant uses `workspace:user:period` as its idempotency scope. Removing and reinviting a member cannot create another grant for the same period.
- A removed member immediately loses access to workspace credits. Rejoining in the same period restores only the unexpired balance.
- Paid credits become unspendable after a downgrade. Keep them for 30 days, then expire them.
- Credits are an included service allowance. They are not money, are not transferable, and have no cash value.

## Entitlement authority

Define plan constants in typed server code. Add one server authority with the equivalent contract:

```ts
resolveEntitlements(workspace: WorkspaceRef, principal: Principal): Promise<ResolvedEntitlements>
```

`ResolvedEntitlements` must provide the active plan, workspace access state, billing status, seat capacity, source-unit capacity, Spark AI allowance, and boolean access for organization creation, invitations, API, MCP, and managed AI.

Use the resolver in every server path that creates or changes a gated resource. UI hiding is secondary. Replace the current hard-coded `plan: "pro"` values for browser sessions and API-key principals.

Community Edition bypasses hosted plan rows and resolves the Community contract. It must not call Dodo while resolving entitlements.

Keep subscription status separate from workspace access state. Payment state must not double as authorization state.

Suggested types are:

```ts
type PlanKey = "free" | "personal_plus" | "pro" | "enterprise"
type BillingSource = "free" | "manual" | "dodo"
type SubscriptionStatus =
	| "free"
	| "checkout_pending"
	| "active"
	| "past_due"
	| "canceled"
type WorkspaceAccessState = "active" | "read_only" | "suspended"
```

Use typed entitlement overrides. Do not accept unrestricted JSON. Initial override fields are seat limit, monthly AI credits, source-unit limit, API access, and MCP access.

## Persistent records

Add the following records through reviewed Drizzle migrations.

### Workspace subscriptions

Store:

- The typed workspace reference.
- The plan key, billing source, subscription status, and workspace access state.
- The billing interval and paid seat quantity.
- A scheduled seat reduction, if one exists.
- The current period start, current period end, and failed-payment grace deadline.
- Dodo customer and subscription IDs.
- The configured product key. Keep environment-specific Dodo product IDs in server configuration.
- Typed entitlement overrides.
- Created and updated timestamps.

Personal and organization subscriptions need separate stable Dodo customer identities even when they share an email address.

### Credit ledger

Use an append-only ledger. Each entry stores:

- The workspace reference and the beneficiary user when the credit is member-specific.
- The amount and entry type.
- The grant period or AI request ID.
- Reservation, settlement, adjustment, expiry, or refund reason.
- The actor for a manual change.
- An idempotency key.
- The expiry time when applicable.

Do not use one mutable credit number as the audit trail.

### Usage counters

Store period counters by workspace, member when applicable, and metric. Source usage and Spark AI usage must use separate metrics.

### Webhook inbox

Store the Dodo webhook ID as a unique key. Also store the event type, event time, payload hash, processing status, attempt count, last error, and processing timestamps.

### Admin audit log

Store the platform-admin actor, action, target type, target ID, required reason, redacted before state, redacted after state, and timestamp.

## Better Auth organization rules

Use Better Auth Organization as the only invitation system. Remove the custom invitation flow after all callers use Better Auth.

Require a verified email before invitation acceptance. Use owner, admin, and editor organization roles. The owner controls billing, transfer, and deletion. Admins manage workspace identity, invitations, and editors. Editors collaborate on workspace content without administration access.

As of 2026-09-01, Cloud team workspaces use a tracked request and audited manual provisioning flow. Self-service Pro checkout remains deferred to Phase 5. The customer application must not expose Pro pricing or a team checkout action before that payment lifecycle is implemented and tested.

The organization owner is a paid seat. Every accepted member is a paid seat. Every pending invitation reserves a seat.

Only the owner can start checkout, change the billing interval, increase paid seat quantity, reduce paid seat quantity, cancel, or open the billing portal.

An organization admin can invite an editor only when unused paid capacity exists. Only the owner can appoint or demote admins. If an invitation requires another seat, direct the owner to request a seat change.

When a member leaves or an invitation is revoked, schedule the seat reduction for the next renewal. If the workspace reuses that capacity before renewal, cancel the scheduled reduction.

## Dodo integration

Sparkfeed's database is the access authority. Dodo is the payment, invoice, tax, refund, and dispute system.

Never accept a client redirect as proof of payment. Never trust a client-supplied product ID, customer ID, workspace ID, quantity, metadata value, or return URL.

### Personal+ Dodo flow

Use `@dodopayments/better-auth` for its Better Auth user field and authenticated customer portal. Use the official Dodo TypeScript SDK for checkout and signed webhook ingestion.

The adapter compatibility spike found two limits in version `1.6.6`:

- The checkout-session endpoint replaces an existing customer ID with the session user's email and name. Sparkfeed cannot use that endpoint because personal and organization customers can share an email address.
- The webhook callback does not expose the signed `webhook-id` header. Sparkfeed cannot key its durable webhook inbox from that callback.

Do not enable the adapter's checkout or webhook endpoints. Keep `createCustomerOnSignUp: false`.

Configure `createCustomerOnSignUp: false`. Free signup must not depend on Dodo availability and must not create unused Dodo customers.

When a verified personal-workspace owner starts checkout:

1. Resolve the active personal workspace on the server.
2. Create or find a dedicated Dodo customer with idempotency key `personal:<userId>`.
3. Store the customer ID on the Better Auth user.
4. Accept only the server-defined `personal-monthly` or `personal-annual` product slug.
5. Strip or reject client product carts, customer overrides, metadata, and return URLs.
6. Start an SDK checkout session with `customer_id`, a server-selected product ID, and server-generated metadata.
7. Activate Personal+ only after a verified webhook or server reconciliation confirms payment.

Use the SDK's standard-webhook verification against the raw request body and the three signed webhook headers. Write the verified `webhook-id` to the inbox before changing subscription state.

### Pro SDK flow

Use the official Dodo TypeScript SDK for organization billing.

When a user starts a Pro workspace:

1. Create a separate Better Auth organization in `checkout_pending` access.
2. Keep the organization owner-only and block content creation and invitations until payment succeeds.
3. Create or find a Dodo customer with idempotency key `organization:<organizationId>`.
4. Store the Dodo customer ID on the workspace subscription.
5. Resolve the product and seat quantity from server configuration.
6. Add the workspace type, workspace ID, and environment to server-generated Dodo metadata.
7. Start hosted checkout.
8. Activate the organization only after a verified webhook or reconciliation confirms payment.

The user can resume or delete an abandoned pending organization. Do not create customer content in that workspace before activation.

Use short-lived Dodo portal sessions for the organization owner. Do not use the user-centric adapter portal for an organization subscription.

### Product mapping

Use server-defined product keys:

```text
personal-monthly
personal-annual
pro-seat-monthly
pro-seat-annual
```

Map these keys to Dodo test or live product IDs through server configuration. Product IDs are identifiers, but they must not be client-controlled.

### Webhooks and reconciliation

Verify Dodo's signature against the raw request body before parsing or processing an event.

Write each verified event to the webhook inbox before changing subscription state. Duplicate delivery must return success without applying the event twice.

If an event is older than local state or arrives out of order, fetch the current subscription from Dodo before changing local state.

Add:

- A retry path for failed inbox events.
- An audited manual replay operation.
- A scheduled reconciliation job that compares active local subscriptions with Dodo.
- An emergency manual override that has an actor, reason, expiry, and audit entry.

Keep Dodo test and live databases, keys, product IDs, customers, webhook endpoints, and events separate.

## Billing lifecycle

Free is the default Cloud billing record for a personal workspace.

An upgrade takes effect after payment confirmation. A downgrade or cancellation takes effect at the current period end. Do not offer subscription pause at launch.

Added Pro seats take effect immediately with proration. Seat reductions take effect at renewal.

After a failed payment, retain paid access for 13 days. At the end of the grace period, set the workspace to read-only.

When Personal+ becomes Free:

- Keep all data readable.
- Disable API and MCP access.
- Pause no-RSS sources beyond the Free limit.
- Ask the owner to choose up to five active no-RSS sources.
- Keep standard RSS available.
- Apply the 30-day paid-credit retention rule.

When Pro ends:

- Keep the organization and its membership records.
- Set the whole organization to read-only.
- Disable writes, invitations, API, MCP, and managed AI.
- Keep API keys stored but unusable.
- Let the owner export data, remove members, delete data, reactivate, or explicitly delete the workspace.
- Do not schedule automatic data deletion.

Enterprise uses manual, typed entitlements until a contract requires another billing flow.

## Cloud platform administration

Use Better Auth Admin and Better Auth Two-Factor Authentication on the Cloud admin service.

Sudharsan is the only platform administrator at launch. Create that account through Better Auth's official `create-admin` CLI. Every other account has the normal user role. Do not add support or billing administrator roles in the first release.

Require TOTP for the platform administrator. Enable backup codes and Better Auth's failed-verification lockout. Allow a trusted device for 30 days.

Do not implement impersonation, routine hard deletion, or customer-content browsing at launch.

The portal must provide:

- User search and user details.
- Email verification state, last activity, sessions, bans, and workspace memberships.
- Workspace search and workspace details.
- Owners, members, invitations, plan, seat capacity, usage, and subscription status.
- User ban and unban.
- Session revocation.
- Password-reset delivery instead of direct password viewing or storage.
- Workspace suspension and reactivation.
- Invitation revocation.
- Manual Enterprise entitlement changes.
- Credit adjustments.
- Webhook failure inspection, replay, and subscription reconciliation.
- Audit-log inspection.

Do not store or display raw card or bank details. Show only Dodo identifiers and billing state needed for support.

Every mutation requires server-side platform-admin authorization and an audit reason. Banning a user revokes current sessions but keeps the account, personal workspace, memberships, and customer data. Permanent deletion belongs to a separate privacy workflow.

## Security rules

- Keep all entitlement checks on the server.
- Use host-only secure cookies for the app and admin hosts.
- Restrict trusted origins for each service.
- Protect state-changing routes against CSRF.
- Rate-limit login, checkout, portal, invitation, API-key, webhook-replay, and admin mutation routes.
- Redact secrets, raw webhook signatures, tokens, and sensitive payload fields from logs and audit records.
- Do not use email lookup as the final identity for a Dodo customer.
- Do not manipulate PostgreSQL directly for routine administration.
- Keep Railway, Dodo, customer, and incident runbooks private.

Public admin source code is not an authorization boundary. Server checks, MFA, deployment settings, and audit records are the authorization boundary.

## Implementation phases

### Phase 1: entitlement foundation

1. Add the edition, deployment-surface, plan, workspace-reference, billing-status, access-state, and entitlement types.
2. Add reviewed Drizzle schemas and migrations for subscriptions, credits, usage, webhook inbox, and admin audit records.
3. Implement `resolveEntitlements` with Community and Cloud Free behavior.
4. Replace hard-coded `plan: "pro"` principals.
5. Add server configuration validation. Community must run without Dodo settings. Cloud billing must fail closed when required settings are absent.
6. Add unit tests for type mapping, default records, edition behavior, and entitlement resolution.

Stop after Phase 1 if the schema or resolver reveals a tenancy conflict. Do not start Dodo or admin work until the conflict is reviewed.

### Phase 2: personal workspace and Free enforcement

1. Make the user-keyed personal workspace explicit in UI and server contracts without adding an organization row.
2. Ensure both direct and invited signups receive personal-workspace access.
3. Set the invited organization active after acceptance. Fall back to personal access after membership removal.
4. Replace custom invitations with Better Auth Organization invitations where Phase 2 touches invitation behavior.
5. Enforce Free organization, invitation, source, API, MCP, and Spark AI rules on the server.
6. Add the one-time Free credit grant and idempotency rule.
7. Add focused integration tests for signup, invitation acceptance, workspace switching, removal, and Free limits.

Stop after Phase 2. Run the full application verification before starting Personal+.

### Phase 3: Personal+

1. Run a compatibility and endpoint-security spike for the current Better Auth version and the Dodo adapter.
2. Add guarded Personal+ customer creation, SDK checkout, SDK webhook ingestion, subscription reconciliation, and the adapter customer portal.
3. Add monthly grants, reservations, settlement, rollover, downgrade, and source-selection behavior.
4. Add the personal billing page and server-tested entitlement gates.
5. Exercise the full Personal+ lifecycle in Dodo test mode.

### Phase 4: Cloud administration

1. Add Better Auth Admin and Two-Factor Authentication schemas and plugins.
2. Add the isolated admin service routes and sole-administrator bootstrap procedure.
3. Build the user, workspace, billing, webhook, and audit views.
4. Add suspension, session revocation, credit adjustment, and reconciliation actions.
5. Verify all authorization, TOTP, audit, and app-service 404 boundaries.

### Phase 5: Pro workspace billing

1. Add pending organization checkout through the Dodo SDK.
2. Add seat capacity, reserved invitations, immediate increases, scheduled reductions, and owner-only billing controls.
3. Add per-member credit grants and membership lifecycle handling.
4. Add Pro cancellation, failed-payment, read-only, portal, and reactivation behavior.
5. Exercise multi-workspace and same-email Dodo customer isolation in test mode.

### Phase 6: Enterprise and launch operations

1. Add typed manual Enterprise entitlements and audited overrides.
2. Add backup, restore, reconciliation, webhook replay, and emergency override runbooks.
3. Update the landing repository only after the corresponding server enforcement works.
4. Configure and verify the isolated `beta.sparkfeed.dev` database, Dodo test products, test keys, and test webhook.
5. Complete a guided Dodo live-mode and Railway production setup after beta acceptance.
6. Promote the tested build to production without moving beta customers or test subscriptions into the live database.

## Thread and review sequence

Implement only one or two phases per task.

The first implementation task owns Phases 1 and 2. It must not add the Dodo adapter, Dodo SDK, Better Auth Admin, the admin portal, Railway changes, or dashboard configuration.

After each task finishes:

1. Review its diff against this specification.
2. Run the focused tests that the task added.
3. Run the repository's full typecheck, test, lint, build, and migration checks that apply to the changed code.
4. Exercise affected authenticated flows in a browser when the environment permits it.
5. Resolve failures before creating the next implementation task.

The last setup task must guide Sudharsan through Dodo test and live configuration, product creation, webhook setup, environment variables, Railway services, domains, database isolation, deployment, and production verification. Browser automation can perform dashboard steps after Sudharsan signs in and approves the production changes.

## Acceptance criteria

- Community starts without Dodo configuration, calls no Dodo endpoint, and retains the full self-hosted feature contract.
- Cloud Free, Personal+, Pro, and Enterprise resolve different entitlements from local authoritative records.
- Browser sessions and API keys no longer receive a hard-coded Pro plan.
- Every account keeps a personal workspace, including an account invited to or removed from an organization.
- Free and Personal+ cannot create or manage teams.
- Client input cannot select an unauthorized Dodo product, customer, workspace, quantity, or return URL.
- A personal Dodo customer and an organization Dodo customer cannot collide when they share an email address.
- Duplicate and out-of-order webhooks do not duplicate credits or regress subscription state.
- Seat additions, reductions, invitations, membership changes, cancellation, grace, and reactivation match this specification.
- Admin routes return 404 on Community and customer-app services.
- A normal user cannot read platform-admin data or run platform-admin operations.
- TOTP, trusted devices, bans, session revocation, workspace suspension, audit reasons, and webhook replay work in the isolated beta environment.
- `beta.sparkfeed.dev` uses a separate database and Dodo test mode.
- Production uses Dodo live mode, separate live products and webhooks, and reviewed Railway secrets.

## Launch positioning

Use this product statement when hosted pricing goes live:

> Sparkfeed is the open-source intelligence reader for people and teams who want trusted web sources in one place, ready for human reading and AI workflows.

The tier progression is personal reading, AI-ready research, shared team intelligence, and contract-defined organizational capacity.

Review Personal+ economics after 90 days of real payment, AI, scraping, and support-cost data. The review does not change customer pricing automatically.
