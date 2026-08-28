# Release Sparkfeed

## Prepare the commit

1. Confirm that the source, history, branches, dependencies, and assets passed their release audits.
2. Update `../CHANGELOG.md` and the package version.
3. Run the application checks and the documentation and proxy builds.
4. Build and cold-start `compose.yml` against an empty PostgreSQL volume.
5. Test backup and restore with the release candidate.

## Build the artifacts

Build the application image from the reviewed commit:

```bash
docker build -t ghcr.io/sparkable-dev/sparkfeed:0.1.0-beta.1 .
```

Record the image digest and source commit in the release notes.

## Publish the first beta

For `v0.1.0-beta.1`, make the reviewed repository public before creating the tag. Tag the same commit without another code change. Publish the source release and versioned container together.

Do not publish while a release gate in `../ROADMAP.md`, `SECURITY.md`, or `ASSETS.md` remains unresolved.
