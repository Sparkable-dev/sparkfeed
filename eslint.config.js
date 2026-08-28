//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  {
    /*
      Generated output, none of it hand-written and none of it shipped from
      source. `.output` alone accounted for 418 of the 448 problems a bare
      `bun run lint` reported — it is the built Nitro server and the client
      bundle, so linting it measured the bundler rather than the codebase, and
      made a full lint run take minutes.
    */
    ignores: [
      ".output/**",
      "dist/**",
      "**/.astro/**",
      "src/routeTree.gen.ts",
      /*
        The same boundary tsconfig draws. `landing` and `docs` are separate
        deployables with their own package.json and their own lint script;
        `scripts` and `workers` are excluded from the tsconfig project, so the
        type-aware rules cannot parse them at all and every file in them
        reported a parser error rather than anything about the code.

        This is a scope decision, not a clean bill of health: `landing` has 24
        outstanding problems of its own, mostly `any` and setState-in-effect in
        its animation components.
      */
      "landing/**",
      "docs/**",
      "scripts/**",
      "workers/**",
    ],
  },
  ...tanstackConfig,
  {
    rules: {
      /*
        Off, because in this codebase it is wrong far more often than it is
        right, and acting on it introduces crashes.

        It flagged 95 sites. Every one sampled was a guard protecting against
        real runtime nullability that the types understate, in two recurring
        shapes:

          session?.user?.name?.[0]?.toUpperCase()
          message.parts?.filter(...)

        The first is the clearest. `noUncheckedIndexedAccess` is off, so TS
        types `name[0]` as `string` and calls the `?.` after it redundant — but
        `""[0]` is `undefined` at runtime and `.toUpperCase()` on it throws.
        The guard is load-bearing and the type system simply cannot see it. The
        second is the same story via an SDK: streamed message parts are typed
        as always present and are not, mid-stream.

        The real fix is `noUncheckedIndexedAccess: true` in tsconfig, which
        would make the types agree with runtime and turn most of these back
        into legitimately-required checks. Measured: it produces 129 new
        typecheck errors today, each one a potentially unguarded access worth
        reading individually. That is its own piece of work, not a line in a
        formatting pass.
      */
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
]
