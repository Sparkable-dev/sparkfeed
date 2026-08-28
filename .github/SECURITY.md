# Security policy

## Supported versions

Sparkfeed is preparing its first public beta. Security fixes target the latest tagged beta and the current `main` branch. Older prerelease builds do not receive a support promise.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability.

Email `sudu@sparkable.dev` with:

- The affected version or commit.
- The vulnerable route, feature, or configuration.
- Reproduction steps or a proof of concept.
- The impact you observed.
- Any suggested mitigation.

Remove credentials, private data, and unrelated customer information from the report. Sparkable provides security responses on a best-effort basis during beta and does not promise a response time.

## Security-sensitive areas

Review these areas carefully:

- Workspace tenancy and authorization.
- Better Auth signup, invitations, sessions, and password reset.
- REST and MCP API keys.
- Outbound URL fetching, redirects, and SSRF controls.
- Shared folders and password-protected links.
- AI provider requests and stored chat content.
- Database migrations and backup restoration.

## Disclosure

Give the maintainers time to confirm and fix a report before publishing details. Sparkable will coordinate disclosure with the reporter when practical.
