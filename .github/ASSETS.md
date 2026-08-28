# Asset licensing and provenance

This manifest separates software licensing from visual-asset rights. Do not treat an asset as cleared for public redistribution unless its row says `Cleared`.

## License groups

| Group                         | Paths                                                        | Intended terms                         | Status                                  |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------- | --------------------------------------- |
| SparkFeed and Sparkable brand | `public/favicon.svg`, `public/logo*.png`, `logo-assets/**`   | Reserved trademark and visual identity | Cleared for official Sparkfeed use only |
| Catalogue site icons          | `public/catalogue/**`                                        | Source-site terms apply                | Audit required before release           |
| Documentation media           | `docs/public/**`, `docs/src/assets/**`                       | Original source terms apply            | Audit required before release           |
| Application imagery           | Other image files under `public/**` not listed in rows above | Source terms must be recorded          | Audit required before release           |

The repository currently contains 124 files under its public asset directories. That count is an inventory aid, not proof of ownership.

## Required record

Before the public release, record this information for each file or verified asset group:

- Repository path.
- Creator or source URL.
- Creation or download date when known.
- License or generation terms.
- Redistribution and modification rights.
- Required attribution.
- Reviewer and review date.

Remove or replace any asset whose origin or redistribution right cannot be verified.
