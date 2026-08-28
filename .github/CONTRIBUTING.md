# Contributing to Sparkfeed

Sparkfeed accepts bug fixes, documentation corrections, tests, and focused product improvements. Open an issue before starting a broad refactor or a change to product behavior.

## Prepare the repository

Install Bun and Node.js 22. The application uses PostgreSQL outside demo mode.

```bash
bun install --frozen-lockfile
cp .env.example .env.local
bun run db:migrate
```

The `docs/` directory is an independent Astro project. Install its dependencies only when your change touches the documentation site.

## Make a change

- Keep data access scoped to the active workspace.
- Enforce permissions on the server. UI visibility is not an authorization check.
- Preserve demo mode. Demo requests must not mutate data or call external providers.
- Add a migration for deployed schema changes. Do not use `db:push` as a migration.
- Update documentation when you change configuration, commands, routes, or public behavior.
- Format only the files you changed.

## Validate a change

Run checks that match the change:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

Run the production build before asking for merge. If you changed Docker packaging, also build the image and cold-start `compose.yml` against an empty PostgreSQL volume.

## Sign off the contribution

Sparkfeed uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Add a sign-off to every commit:

```bash
git commit -s
```

The sign-off states that you have the right to submit the contribution under the repository license. Sparkfeed does not require a contributor license agreement.

## Open a pull request

Describe the user-visible result, the checks you ran, and any known limitation. Keep unrelated formatting and dependency changes out of the pull request.

Do not include credentials, production data, customer information, or third-party assets without verified redistribution rights.
