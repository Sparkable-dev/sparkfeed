# Discover — a catalogue that makes an empty Sparkfeed worth using

## Context

A new user signs up, lands on Explore, and sees `No articles in All Articles.` — one grey
sentence in the middle of an empty grid (`ArticleGrid.tsx:40-45`). There is nothing to do and
nothing to look at. Every RSS product solves this with a curated starting point; we have none.

This adds **Discover**: eight categories of hand-picked sources, where the lead cards are
*collections* — an org or theme that owns several feeds, imported as a folder in one click — and
the rest are single feeds. Some categories lead with three collections, some with one, some with
none, because some segments genuinely have no dominant publisher.

The same catalogue appears in two places: at `/discover`, always reachable, and inline on `/`
when the user has no articles yet.

**Hero section is explicitly out of scope.** This spec covers everything below it.

---

## Decisions already made

| | |
|---|---|
| **Placement** | New `/discover` route in the sidebar, *and* rendered inline on `/` when empty |
| **Import** | One click, rows created instantly, articles fetched in the background |
| **Source of truth** | Curated JSON in the repo, synced into `catalogue_*` tables that cache the volatile half |
| **Imagery** | Icons fetched once by a script and committed to `public/catalogue/`; anything without one falls back to a gradient block with initials, which must look deliberate |
| **Categories** | AI · Technology · Startups & Venture · Business & Finance · Engineering · Security · Healthcare · Marketing & Growth |

---

## The finding that shapes everything

**There is no background job mechanism in the deployed server, and there never has been.**

`src/server/plugins/cron.ts` defines two `setInterval`s that refresh every feed. It is not
registered. `vite.config.ts:25` lists exactly one Nitro plugin — `demo-boot.ts` — and the comment
directly above it records that `src/server/plugins/*` "was dead code that never ran" and that
"anything added there needs a line here or it silently does nothing."

Two consequences:

1. **Feeds are only ever refreshed when a user presses the refresh button.** There is no periodic
   ingest in production today.
2. **An existing message is untrue.** After copying a shared folder, `sprk.$folderSlug.tsx:383`
   toasts *"Articles will load shortly."* Nothing fetches them. They arrive when the user
   manually refreshes, or never. This feature's import machinery fixes that for free — see
   Phase 3.

Registering `cron.ts` as written would be a mistake: it `Promise.all`s over **every feed in the
database** with no concurrency limit, ignores workspaces, would double up on a second replica, and
still uses the Nitro 2 `defineNitroPlugin` idiom that never worked. Rewriting it is its own
project. The right long-term answer is a **Railway cron service** running a script against
`DATABASE_URL` — infra config, no replica coordination, fails visibly. Recommended, not required.

---

## Data model

Two tables in `src/db/schema.pg.ts`. That is the only schema file to edit — `schema.ts` is a
one-line re-export and `schema.sqlite.ts` is dead reference code.

**`catalogue_collections`** — `slug` (pk), `category`, `name`, `description`, `siteUrl`,
`coverFile`, `accent`, `sortOrder`, `importCount`, `retiredAt`, `createdAt`.

**`catalogue_feeds`** — `slug` (pk), `category`, `collectionSlug` (nullable — membership is a
column, not a join table), `name`, `description`, `feedUrl`, `siteUrl`, `iconFile`, `accent`,
`sortOrder`, then the cached half: `status`, `lastCheckedAt`, `lastError`, `articleCount`,
`latestTitle`, `latestPublishedAt`, `importCount`, `retiredAt`, `createdAt`.

Everything stays in the dialect-portable subset — `text` ids, ISO-string timestamps via
`$defaultFn`, plain `integer`, no dialect-specific SQL — because demo mode runs these same
Postgres definitions against SQLite through the cast at `src/db/client.ts:31`.

**Curated vs cached is a hard line.** The JSON sync writes only the curated columns. If its `set`
clause ever touches `articleCount` or `status`, every deploy silently wipes the numbers and the
page looks dead for a day. Worth a comment on the line itself.

`retiredAt` instead of deleting: pulling a source from the JSON shouldn't destroy its counters,
and rows already in users' workspaces are unaffected regardless.

**Both tables also need a hand-written `CREATE TABLE IF NOT EXISTS` in the `tables` array in
`ensureDemoSchema` (`demo-seeder.ts:18-116`)**, or demo mode 500s on `/discover`. While there:
`api_keys` is missing from that array today — same class of bug, four lines to fix.

### The catalogue file

`src/config/catalogue.json`, imported the way `demo-seeder.ts:6` imports `demo-feeds.json`.
One flat `items` array per category in display order; `kind: "collection" | "feed"` discriminates,
so a category with three collections or none needs no schema change. `sortOrder` is the array
index, materialised at sync — no sorting rules in code, and the reviewable artefact in a PR is the
file itself.

### Sync

Lazily, on the first catalogue read after boot, guarded by a module-level promise — exactly
`ensureDemoSchema`'s `schemaReady` latch. Not a Nitro plugin (see above), and not a migration step
(`scripts/migrate.ts` deliberately imports no app modules and skips demo entirely). Idempotent via
`onConflictDoUpdate` on `slug`, then two sweeps to set and clear `retiredAt`.

> Verify on the first demo boot that `onConflictDoUpdate` passes through the SQLite cast.
> `onConflictDoNothing` already does in `seedDemoData`. If it doesn't, the portable fallback is
> select-then-insert-then-update — fifteen extra lines, zero risk.

---

## Import: the crux

`addRssFeed` (`rss.ts:371-416`) cannot be used and should not be modified. It fetches articles
inline **and deletes the feed row again if that fetch fails** (`:402-415`), with the rollback
inside the same `try`. That policy is correct for `createFeed`, where a user typed a URL and a
silent dead feed is a bug. It is exactly wrong for a catalogue whose URLs were validated in CI,
where a transient failure should leave the row and retry later. Two policies, two call sites.

### `importCatalogueItem({ kind, slug })`

1. `DEMO_MODE` guard, `resolveWorkspaceId()`
2. Read the entry **from the database by slug** — never trust URLs sent by the client
3. One query for feed URLs already in this workspace, filtered to this item's URLs
4. **If nothing is new, return `already_added` before creating anything.** Get this order wrong
   and a double-click leaves an empty `"OpenAI (2)"` folder
5. Collection: insert one folder row, name auto-suffixed on collision
6. One batched feed insert, mirroring `add-to-workspace.ts:177-186`
7. `enqueueIngest(rows)` — **not awaited**
8. Return `{ folderId, feedIds, added, skipped }`

Four round trips, no network I/O. Sub-100ms.

### The queue

`src/server/services/ingest-queue.ts`, ~60 lines: a `Set` of in-flight feed ids (so two imports of
the same feed, or an import racing a manual refresh, run once) and a concurrency cap of 4.

The cap is not optional. `fetchAndInsertArticles` scrapes up to 40 og:image URLs per feed at
concurrency 5 (`fetch-articles.ts:35-37`). An 8-feed collection unbounded is 40 concurrent sockets;
three users at once is 120.

> **The highest-risk line in this plan is the detached promise.** An unhandled rejection kills the
> Node process. Every task terminates in `.catch()`, and the drain loop sits in `try/finally` so a
> throw can't wedge the counter above zero for the life of the process. Test it with a task that
> throws synchronously.

Railway runs a long-lived Node process, not serverless functions, so a promise the handler doesn't
await runs to completion. This is the same trick `demo-boot.ts:29-42` already uses at boot.

### What the user sees

The app's established three-state button (`sprk.$folderSlug.tsx:183-205`): `Add` → `Adding…` →
`Added`. On return, `reload()` puts the folder in the sidebar immediately, a toast reads
*"OpenAI added · 8 feeds. Articles are loading."* with an **Open folder** action, and the card
grows a quiet `Fetching articles… 3/8`.

**Progress comes from the database, not the queue's memory** — `feeds.lastFetchedAt` /
`lastError`, which `recordFeedHealth` already stamps. Polled every 2.5s, capped at 90s. That makes
it replica-agnostic and workspace-scoped for free; an in-memory job map would be neither.

### Failure modes, stated plainly

- **Navigate away, close the tab, quit the browser** — nothing is lost. Only the progress UI stops.
- **Deploy or restart mid-ingest** — in-flight ingests die. Result is a folder with all its feed
  rows and some or no articles. Never broken, because nothing rolls back.
- **Recovery already exists**: `refreshFolder` (`rss.ts:576`) is workspace-scoped, not demo-locked,
  and never deletes rows. Add a nudge on the folder page — if a feed has `lastFetchedAt IS NULL`
  and was created over ten minutes ago, show a one-line *"Some feeds haven't loaded yet — Retry"*.
  Cheap, and it also covers a source that was simply down at import time.

### Conflicts

**Feed already present** → skip silently, report it: *"6 feeds added, 2 you already had."*

**Folder name collision** → auto-suffix `(2)`, `(3)`, server-side. Deliberately **not** the
409-plus-rename-dialog that `add-to-workspace` uses. That dance is right for a share, where the
user chose that specific folder; interrupting a browse-and-click catalogue with a naming dialog is
the difference between a feature people use and one they abandon.

**"Already added" on the card** → computed client-side with zero extra queries. The loader already
calls `getAllData()`, whose feeds projection includes `url`. Build a `Set` of normalised URLs once
with `useMemo`. The same set drives the partial state: 5 of 8 present renders `Add 3 more`.

> A `uniqueIndex` on `(workspaceId, url)` would be the real fix for the double-click race, but it
> will likely **fail on the production table** — nothing has ever prevented duplicate feeds, so
> some almost certainly exist, and the migration would abort the deploy. File it separately behind
> a dedupe migration. The client `disabled` plus the server-side dedupe make the race require
> deliberate effort, and the worst outcome is one duplicate row the user can delete.

---

## The page

```
DiscoverCatalogue                    props: catalogue, ownedUrls, onImported,
├─ DiscoverIntro                            variant: 'page' | 'empty', limitPerCategory?
└─ CategorySection × 8
   └─ grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4
      ├─ CollectionCard × 0-3   (sm:col-span-2)
      └─ FeedCard × n
         ├─ SourceIcon
         └─ AddCatalogueButton    ← the only stateful component in the tree
```

**A responsive grid, not horizontal scrollers.** There is no carousel anywhere in `src/`; the
landing site's embla is a separate package. `ui/scroll-area.tsx` can't be used as-is — its
`ScrollArea` hardcodes a vertical `<ScrollBar />`. And a horizontal row isn't one component: it's
arrow buttons with disabled state, scroll-snap, keyboard access, and iOS momentum debugging. It
would be the most expensive item here, to solve a problem we don't have — 5-10 curated cards fit
in two grid rows. A scroller's job is hiding surplus; there is no surplus.

Cards reuse `ArticleCard`'s vocabulary (`bg-[#161616]`, `rounded-xl`, `border-white/5`,
`hover:-translate-y-1`) so they don't look imported from another app. Feeds with `status: 'dead'`
are **filtered out entirely** — a greyed row admits the catalogue is stale; an absent row is a
catalogue that curates.

### `SourceIcon` and the fallback

An `<img>` from `/catalogue/…` with an `onError`, falling back to a gradient block with initials.
What makes this look designed rather than broken:

- **Colour from a hash of `slug`, never from list index.** `ArticleCard` uses
  `PASTEL_COLORS[index % 6]`, so a card changes colour when the list reorders. Repeating that
  would make a stable catalogue feel like it's flickering.
- Eight **two-stop gradients**, hand-checked against `#161616`. The six flat pastels lifted from
  `ArticleCard` read as washed out on a dark card.
- `rounded-lg ring-1 ring-white/10` — the ring is what stops it reading as a placeholder.
- Initials skip common words: "The Verge" is `TV`, not `TT`.
- `accent` in the JSON overrides the hash so a curator can pin a brand colour.

Because it's deterministic and pleasant, the icon pipeline is genuinely optional per source. A
missing icon becomes a non-event rather than a gap.

### Two shell fixes it needs

1. **A scroll container.** `RSSShell`'s content slot is `overflow-hidden` (`:612`); `ArticleGrid`
   brings its own `flex-1 overflow-y-auto`, `DeveloperPage` does not. Discover needs
   `<div className="flex-1 overflow-y-auto">` wrapping `mx-auto w-full max-w-6xl px-6 py-8`.
   Do not reuse `DeveloperPage` — its `max-w-3xl` is far too narrow.
2. **The header bar.** `RSSShell` renders the breadcrumb only when `children && section` (`:508`)
   and the toolbar only when `!children` (`:517`). Discover has no parent section, so the bar
   would render empty. One-line fix: fall back to the bare title when `children` is set without
   `section`.

### Inline on `/`

Add an `emptyState?: ReactNode` slot to `ArticleGrid` (replacing the `<p>` at `:40-45`) and thread
it through `RSSShell`. Do not fork the component and do not use the `children` path — the toolbar
and Add Feed button should stay.

> **The subtlest bug in this plan**: the gate must be `rawArticles.length === 0`, not
> `displayedArticles.length === 0`. `RSSShell` defaults to a 15-day filter and has a search box, so
> gating on the filtered list would ambush an existing user whose search missed. The filtered-empty
> case keeps the existing message, which is the correct one for it.

Inline variant passes `limitPerCategory={4}` and a `Browse all →` link per category.

### Sidebar

One entry under Explore: `{ title: "Discover", href: "/discover", icon: <Telescope />, exact: true }`.
Explore already owns `CompassIcon`. Guests are already handled by `{!guest && <NavMain …>}`.

### Demo mode

`/discover` should be **browsable** in demo — it's the best thing in the app to show a visitor.
Add is locked with the established `toast.warning("Feature locked in demo mode")` plus the
server-side guard. Render the button live and explain on click rather than showing it disabled; a
page of dead buttons is a worse demo than a page of honest ones.

---

## The catalogue

**Authored with site URLs, not feed URLs.** `resolveFeed` already does discovery, so
`catalogue-validate --fix` fills in the exact feed URL. That removes the risk of shipping a
hand-typed path that never existed, and re-running catches feeds that move.

Every source below is a *candidate*. The validator decides what ships; anything paywalled,
feedless or dead gets cut, and the counts will shift.

| Category | Collections | Feeds |
|---|---|---|
| **AI & Machine Learning** | OpenAI · Google AI (DeepMind, Research) · Anthropic | Hugging Face · Import AI · The Batch · Simon Willison · Ahead of AI · MIT Tech Review AI |
| **Technology** | The Verge · Ars Technica | Hacker News · TechCrunch · Wired · 404 Media · Platformer · Rest of World |
| **Startups & Venture** | Y Combinator · a16z | Stratechery · Paul Graham · First Round Review · Lenny's Newsletter · Sifted · Both Sides of the Table |
| **Business & Finance** | — | Money Stuff (Matt Levine) · Marginal Revolution · Calculated Risk · The Economist · Axios Markets · Reuters Business |
| **Engineering** | GitHub · Cloudflare | The Go Blog · Rust Blog · Netflix Tech · Stripe Engineering · Julia Evans · Dan Luu |
| **Security** | — | Krebs on Security · Schneier · Project Zero · Troy Hunt · The Record · CISA Advisories · Bleeping Computer |
| **Healthcare** | STAT News | Ground Truths (Eric Topol) · KFF Health News · Endpoints News · Nature Medicine · NIH Director's Blog · The Lancet |
| **Marketing & Growth** | HubSpot | Marketing Brew · Seth Godin · Ahrefs · Search Engine Land · Demand Curve · Growth.Design |

≈ 70 sources. Business & Finance and Security lead with feeds only — the first because the good
sources are independent writers rather than institutions, the second because it is genuinely
scattered. That is the "sometimes no collections" case working as intended, not a gap.

---

## Curation tooling

**`scripts/catalogue-validate.ts`** — runs every entry through `resolveFeed` at concurrency 5.
Prints `ok` / `MOVED` / `DEAD` per line, exits non-zero on any `DEAD`, so it works as a CI gate.
`--fix` rewrites moved URLs in place, one line per change. `--stats` writes
`catalogue.stats.json`, used as the **initial** value for cached columns on first insert only —
without it the very first page view shows blank stats. Also checks slug and URL uniqueness, that
every icon file exists, and that descriptions fit the card's clamp.

> `resolveFeed` has a 20s budget and up to 8 fetches per entry. Seventy entries sequentially is
> ten minutes; at concurrency 5 it's about two. Say so in the header or someone will think it hung.

**`scripts/catalogue-icons.ts`** — fetches `apple-touch-icon` → `link[rel=icon]` →
`/apple-touch-icon.png` → `/favicon.ico`, first hit ≥64px, writes `public/catalogue/<slug>.png`.
Uses plain `fetch`, not `safeFetch` — the SSRF guard is for user input, and `safeFetchText` decodes
to a string, which corrupts binary. Preferring `apple-touch-icon` (square PNG by definition) covers
most sources with **no new dependency**; `sharp` only if we want the rest resized, and then as a
devDependency verified unreachable from app code. Exits 0 even with misses — a missing icon is a
design state, not a failure.

> Icons go in **`public/catalogue/`**. `src/public/` is committed but not served — putting them
> there will look right in the file tree and render nothing.

---

## Sequencing

Six commits, each independently deployable.

1. **Data model and sync** — schema, migration, the two demo `CREATE TABLE`s (plus the missing
   `api_keys` one), one hand-written category, `services/catalogue.ts`, `getCatalogue`. Ships dark.
2. **Tooling and content** — both scripts, then use them to expand to all eight categories and
   commit the icons. Nothing user-visible, so the content can be argued over without blocking code.
3. **Ingest queue and import** — the queue with its throwing-task test, `importCatalogueItem`,
   `getImportStatus`. No UI. **This is the commit worth the most review.** Point
   `add-to-workspace` at the same queue here, which makes its existing toast true.
4. **`/discover`** — the component tree, route, shell fixes, sidebar entry. First user-visible commit.
5. **Inline empty state** — the `emptyState` prop and the `index.tsx` conditional. Last among the
   UI work because it touches the app's busiest component.
6. **Volatile refresh** — stale-while-revalidate on page view, two consecutive failures before a
   feed is marked `dead` (one probe is not proof). Optionally, separately: fix and register `cron.ts`.

---

## Verification

1. `bun run typecheck`, `bun run test`, and `bun run build` at each commit.
2. **Demo boot from cold** — delete `rss-demo.db`, start the server, load `/discover`. Confirms the
   `ensureDemoSchema` tables exist and the sync runs against SQLite. This is where the
   `onConflictDoUpdate` dialect question gets answered.
3. **Import a collection** against a real workspace: folder and feeds appear immediately, the
   progress line counts up, articles arrive, the card flips to `Added` and stays that way after a
   page refresh (the derived state must win over the local flag).
4. **Import the same collection twice** — second click returns `already_added` and creates no
   `(2)` folder. Then import one where 5 of 8 feeds already exist and confirm `Add 3 more`.
5. **Navigate away mid-import**, come back, confirm articles still landed.
6. **Kill the server mid-import**, restart, confirm the folder is intact and the retry nudge appears.
7. Run `catalogue-validate` and confirm it exits non-zero when a URL is deliberately broken.
8. `/discover` at 390px and 1280px, and `/` with an empty workspace at both.
9. Demo mode: `/discover` browsable, Add explains itself rather than sitting dead.

---

## Open questions

- **Naming.** `src/server/utils/discover.ts` is RSS auto-discovery, so "Discover" means two things
  in the codebase. Alternatives: `/browse`, `/catalog`. Worth deciding before the route is named,
  though the collision is conceptual rather than technical.
- **"Explore" currently means all-articles**, which is a strange name for it, and your own
  description of the problem used "Explore" to mean the catalogue. Renaming the existing item to
  "Home" or "All Articles" would free the better word — but it changes established navigation.
- **Category order.** Fixed as written, or ordered by something? Fixed is simpler and I'd keep it.
- **Should `import_count` be visible** ("added by 240 people")? It is honest social proof but reads
  badly at low numbers, and there is nothing to show on day one.
