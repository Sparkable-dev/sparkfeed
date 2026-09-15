# Sign-in and sign-up UI proposal

Date: 2026-09-15

Status: Implemented and validated; prepared for release.

## Delivery update

The implementation below is complete for the local auth experience. The original proposal is retained as design context.

- Canonical sign-in and sign-up routes are live, with compatibility redirects from the old URLs.
- Sign-in, sign-up, email verification, resend, forgot-password, and reset-password use the shared layout.
- User-approved follow-up changes replace the vendor wordmark with the existing Sparkfeed symbol and live Nunito Sans text. The selected generated Sparkfeed workspace illustration is installed.
- Typography: 18px/600 brand, 28px/400 heading, 14px/500 labels, and regular input text. Mobile inputs retain the existing 16px size to avoid browser zoom.
- A persistent light/dark/system theme control uses the installed next-themes package. Its icon represents the selected preference.
- Full name remains a single field. Zod validates fields after blur or submit, without native browser validation popups or permanent password hints. Client and server share the existing 8–128-character policy, without a special-character requirement.
- Verification emails retain Better Auth's generated callback, successful verification creates a session, and the UI confirms server-backed verification before entering Discover or the intended internal destination.
- Missing email configuration now fails explicitly for verification and reset delivery rather than silently succeeding.

Validation: the release snapshot test run passed 810 tests with 54 conditional tests skipped with an isolated local PostgreSQL URL. Typecheck and production build passed. Scoped lint has no errors and three async-test warnings. Desktop light/dark visuals, actual computed typography, and the theme cycle were checked in the browser. A fresh account sent verification through local SMTP capture, established its verified browser session, and reached Discover. Returning sign-in, reset delivery, old/new password behavior, rejected reused reset tokens, password minimums, unverified sign-in rejection, and resend passed against the actual app with disposable local PostgreSQL. External email delivery was not tested. The browser viewport override did not take effect, so a narrow mobile visual check remains outstanding.

Landing-site entry links retain their existing URLs until release; application compatibility redirects support them.

## Scope

Install the Base UI versions of Shadcn Space `login-02`, `register-02`, and `verify-email-02`. Preserve their original logo and `login-2.webp` image. Keep the existing application pages running until the flow and naming decisions are agreed.

The official MCP supplied the installation commands. The installer created these files:

- `src/components/shadcn-space/blocks/login-02/login.tsx`
- `src/components/shadcn-space/blocks/register-02/register.tsx`
- `src/components/shadcn-space/blocks/verify-email-02/verify-email.tsx`
- `src/assets/logo/logo.tsx`

The installer added `cn` to `package.json` and `bun.lock`. Existing shared UI components were not overwritten. No registry credentials belong in this document or the repository.

## Phase 0: Findings and documented APIs

Current source was checked through the code graph and direct file reads:

- `src/routes/login.tsx`: calls `authClient.signIn.email({ email, password })`. Defaults to `/` and accepts a validated internal return destination. Unverified users see an inline resend screen.
- `src/routes/signup.tsx`: requires first name, last name, email, password, and password confirmation. Sends one combined `name` to `authClient.signUp.email`. Shows an email-sent screen after success.
- `src/lib/auth.ts`: requires email verification, sends verification on sign-up, and sets `autoSignInAfterVerification: false`. Its custom email URL retains the token but drops the callback destination.
- `src/routes/verify-email.tsx`: calls `authClient.verifyEmail({ query: { token } })`, caches token success in localStorage, and offers a return to `/login`.
- Both existing resend handlers await `sendVerificationEmail` without checking its returned `error`, which can show false success.
- `src/lib/auth-redirect.ts`: `safeLoginRedirect` validates an internal destination. Reuse and strengthen it where auth destinations could cause loops.
- `src/server/auth-setup.ts`: the sign-up page checks registration policy; the server user-create hook remains authoritative.
- `src/routes/_protected/discover/index.tsx`: the requested Explore destination is currently Discover at `/discover`.

Allowed APIs and primary documentation:

- [Better Auth email verification](https://better-auth.com/docs/concepts/email): `sendVerificationEmail({ email, callbackURL })`, `verifyEmail({ query: { token } })`, and `autoSignInAfterVerification`.
- [Better Auth email and password](https://better-auth.com/docs/authentication/email-password): `signIn.email`, `signUp.email`, and verification requirements.
- [Better Auth client error handling](https://better-auth.com/docs/concepts/client): inspect returned `{ data, error }` and catch transport exceptions.
- Installed `node_modules/better-auth/dist/api/routes/email-verification.mjs` confirms that version 1.7.1 supports verification callbacks and creates a session when automatic sign-in is enabled.

The installed blocks contain visual forms and placeholder links, not authentication. Sign-in uses a placeholder Username field. Verification contains a static email address and a `Verify Now` submit button without verification logic. These require wiring before exposure to users.

## Proposed names and URLs

Use **Sign in** and **Sign up** for user-facing actions. Use `SignInPage`, `SignUpPage`, `SignInForm`, and `SignUpForm` in application code. Keep the vendor directory names for provenance and Better Auth's existing API names.

| Purpose | Canonical URL | Behavior |
| --- | --- | --- |
| Sign in | `/sign-in` | Email and password; default success destination `/` |
| Sign up | `/sign-up` | Full name, email address, password |
| Verify email | `/verify-email` | Waiting, verifying, success, expired or invalid link, and resend states |
| Forgot password | `/forgot-password` | Existing reset-email flow in the same visual layout |
| Reset password | `/reset-password` | Existing token-based password reset in the same visual layout |
| Home | `/` | Default destination for returning users |
| Discover | `/discover` | Default destination after new-account verification |

Redirect existing `/login` and `/signup` URLs to their canonical replacements. Preserve validated return destinations, invitation context, and supported informational parameters. Do not add `/register` as another public name. Update internal links, route guards, reset links, invitation links, and landing-site entry links after inventorying them. Do not rename Better Auth's `/api/auth` endpoints.

There is no single mandatory industry naming standard. This is a consistent convention for Sparkfeed. Renaming Discover to Explore is a separate product decision; the proposed auth flow uses `/discover`.

## Proposed sign-up fields

Ask for **Full name**, **Email address**, and **Password**. One name field matches the existing stored `name` and accommodates single names and different naming traditions. Use `autocomplete="name"` and disable spellcheck. Permit Unicode, spaces, apostrophes, and hyphens. Do not try to split the name automatically.

[GOV.UK names guidance](https://design-system.service.gov.uk/patterns/names/) and the [USWDS name form guidance](https://designsystem.digital.gov/templates/form-templates/name-form/) support a single field when separate name components are unnecessary.

Use password reveal and visible requirements instead of a confirmation field. Match client validation to the actual server password policy. Allow password managers and paste. Leave avatar, company, role, interests, and workspace setup for later settings or onboarding. Preserve invited-email handling and registration restrictions.

## Proposed flows

### Returning user

1. Open `/sign-in` and submit email and password.
2. Show inline errors with accessible announcements and prevent duplicate submission.
3. If the account is unverified, open the shared verification screen and preserve the intended destination.
4. After successful authentication, load the validated return destination, or `/` by default.

### New user

1. Open `/sign-up` and submit full name, email address, and password.
2. Create the account through Better Auth under the existing registration policy.
3. Open `/verify-email` in its waiting state. Display the submitted email and offer resend with a cooldown.
4. Open the emailed verification link. Better Auth verifies the token and creates the session.
5. Confirm the session and verified email before navigating to `/discover`, or a validated invitation/share destination.

To provide this flow, enable `autoSignInAfterVerification` and test the resulting session. Prefer emailing Better Auth's generated verification URL unchanged, with a callback to the shared verification result screen. Support existing `/verify-email?token=...` links during transition, using the documented manual verification call.

On the callback screen, read the server-backed session before showing success. On a waiting screen without a token, do not call `verifyEmail` with an empty token. Refresh the session on focus or a deliberate Continue action when verification occurs in another tab. If verification succeeds elsewhere but this browser has no session, offer sign-in with the destination preserved.

Never use the current localStorage token marker as proof of verification. Do not store raw tokens there. Show recoverable expired, invalid, or used-link states based on the server response and current session. Offer resend rather than sending users back through account creation. Treat duplicate sign-up responses generically, consistent with Better Auth's account-enumeration protection.

### Social buttons

Preserve the supplied Google and GitHub button appearance and icons. Use `type="button"`. On click, show `Google sign-in is coming soon.` or `GitHub sign-in is coming soon.` through the existing Sonner toast system. Do not submit the form or start OAuth. Apply equivalent sign-up wording on the sign-up page.

### Password recovery

Keep `/forgot-password` and `/reset-password` functional and visually consistent. Preserve reset tokens, expiry handling, and generic email-sent responses. After a successful reset, return to `/sign-in` with a confirmation message.

## Phase 1: Agree on the product choices

Recommended choices are the route names above, one full-name field, three sign-up inputs, and automatic sign-in after verified sign-up. Keep the supplied image and logo through the initial integration. Use one consistent layout, form width, spacing, typography, focus treatment, and error treatment across auth pages.

Verification: review the proposed names, destination, and fields before replacing existing pages. No OAuth implementation is part of this update.

## Phase 2: Wire forms and navigation

Use the installed blocks as the visual source. Copy the existing `authClient` call patterns into application auth forms and shared state helpers. Replace Username with Email address. Replace placeholder links and static verification content with real state. Preserve the supplied visual assets.

Wire the remembered-session option only if its behavior is explicit and tested against Better Auth 1.7.1; do not leave a decorative checkbox. Share the resend implementation, check returned errors, and enforce the server's resend limits in addition to a visible cooldown.

Add canonical routes and compatibility redirects. Preserve invitation and internal return context through sign-in, sign-up, verification, and resend. Use safe internal destinations with loop prevention. Retain the existing demo-mode and registration-policy behavior.

Verification: exercise navigation and form handlers with mocked success, returned error, and thrown error results. Confirm social buttons show a toast without invoking auth. Check field labels, autocomplete, password reveal, keyboard focus, and loading states.

## Phase 3: Fix verification and session behavior

Follow Better Auth's generated-link flow and the installed 1.7.1 verification implementation. Enable automatic sign-in only after controlled integration coverage demonstrates session creation. Preserve old links without retaining browser token caches. Verify that the callback reaches the intended internal destination and cannot accept an external destination.

Verification: use a disposable database and controlled mail capture for sign-up, verification, resend, and password reset. Cover registration restrictions, duplicate sign-up, expired and invalid tokens, already-verified users, missing tokens, mail failures, cross-tab verification, and a link opened in another browser. Confirm unauthenticated users cannot bypass protected routes.

## Phase 4: Acceptance before further visual changes

Run typecheck, relevant lint, auth tests, and a production build. Compare desktop and mobile views against the supplied block design. Check light and dark modes under the app's theme, image loading, form overflow, and keyboard use.

Acceptance requires a fresh account to receive a real verification email, establish a verified session, and reach Discover. A returning account must reach Home. Invitation and share-link return destinations must survive the full flow. Social buttons must produce only the requested coming-soon toast. Real delivery remains unverified until that end-to-end check is performed.

Commit, push, and deployment require separate authorization. Further image, logo, and visual customization follows functional acceptance.

## Final visual and navigation updates

- One primary color, #7055FF, across both themes.
- Frosted auth panel, centered violet background wash, and selected angled Sparkfeed artwork.
- Spark AI starts a new chat; a separate disclosure opens searchable history. Folder disclosures expand without navigating.
- The account menu cycles Light, Dark, and System while retaining focus. User-facing application components support light backgrounds and readable text.
- Article cards use a real border without hover lift or heavy shadows; the history separator spans the sidebar.
- Desktop and real 390-pixel framed-browser checks covered the account menu and populated Home.
