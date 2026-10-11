# Releasing jlv

`jlv` is published to npm from `master` by [`publish.yml`](../.github/workflows/publish.yml). A release is a commit that
raises the version in `packages/jlv/package.json` and dates its section in [CHANGELOG.md](../CHANGELOG.md); pushing
it to `master` runs every gate again and publishes the tarball that the gates tested. There are no tags to push, no
release bot and no npm token: npm trusts the workflow through OpenID Connect. Only maintainers release.

## How the workflow protects a release

Every push to `master` and every manual run starts three jobs:

1. **Quality** (Ubuntu 24.04, Node 24, npm 12.2.0) installs from the lockfile, runs `typecheck`, `lint`, `build` and
   the test build, packs `packages/jlv` with npm and runs [`scripts/check-package.ts`](../scripts/check-package.ts) on
   the tarball: exactly the expected files, the release manifest, the public declarations, and the tarball installed
   into an empty project with production dependencies only and lifecycle scripts off, where it runs the `jlv` command,
   a strict TypeScript consumer and plugins, and `npm audit`. A dry run of
   [`scripts/publish-package.ts`](../scripts/publish-package.ts) then makes the publish decision without publishing.
   The job uploads the tarball and passes its file name and SHA-256 on.
2. **Runtime** runs on Node 22.9.0 (the `engines` floor), the latest 22, 24 and 26: it compiles the tests with Node 24,
   verifies the downloaded tarball against the SHA-256 of the quality job, and runs the whole test suite and the
   package check of that tarball with the Node and npm under test.
3. **Publish** runs only on `master`, after both, with `id-token: write` as its only extra permission and one
   publication at a time. It downloads the tarball and runs `scripts/publish-package.ts`, which:
   - verifies the SHA-256 against the quality job's output, so that the tested file is published, never a new pack;
   - requires the manifest to name `jlv` with a stable version and `CHANGELOG.md` to have `## [X.Y.Z] - YYYY-MM-DD`;
   - requires npm 11.5.1 or later, the first release with trusted publishing (the job installs 12.2.0);
   - reads the published versions with `npm view jlv versions --json`. A failed or malformed answer stops the job:
     it never counts as a missing version. A version that is on npm already is skipped with a notice, so every later
     push without a version change, and every rerun, ends green without publishing;
   - otherwise runs `npm publish <tarball> --access public --provenance --tag latest` and waits until the registry
     lists the version.

A manual run (`gh workflow run publish.yml --ref <branch>`) checks a branch; the publish job is skipped there, and
the script refuses to publish outside the publish job on `refs/heads/master` as well. A manual run on `master` is the
way to repeat a publication that failed.

## Setting up trusted publishing

This is done once, by a maintainer with publish rights on npm and two-factor authentication:

```sh
npm trust github jlv --file publish.yml --repo Defkil/jlv --allow-publish
npm trust list jlv
```

The trusted publisher names the repository `Defkil/jlv` and the workflow file `publish.yml`, without an environment.
Renaming the workflow file or adding a GitHub environment requires changing the trusted publisher first. npm checks
that the package's `repository.url`, `git+https://github.com/Defkil/jlv.git`, matches the repository of the run that
publishes, so that it can attach the provenance statement.

## Checklist

1. **Prepare** on a branch or on `master`:
   - Set the new version in `packages/jlv/package.json`. Versions follow [Semantic Versioning](https://semver.org/);
     the workflow publishes stable versions only.
   - Move the entries of `## [Unreleased]` in `CHANGELOG.md` into `## [X.Y.Z] - YYYY-MM-DD` with the release date,
     and add the version's link to its npm page at the end of the file. The quality job checks the dated section.
   - Commit both as `chore(release): jlv X.Y.Z`.
   - Run `pnpm run typecheck`, `pnpm run lint`, `pnpm test` and `pnpm run check:package` locally.
2. **Push** `master` (or merge the branch into it and push). The workflow takes a few minutes.
3. **Check the result** from outside the repository:
   - `npm view jlv@X.Y.Z version` prints the version, and `npm view jlv dist-tags.latest` names it.
   - The version's page on npmjs.com shows the provenance statement with a link to the workflow run.
   - `npx --yes jlv@X.Y.Z --version` prints the version, and
     `npx --yes jlv@X.Y.Z --output plain docs/examples/pino.log` in a checkout prints the four pino records.
4. **Optionally** create a GitHub release with the changelog section. It is bookkeeping, not a trigger.

## When something fails

- **A gate fails** (quality or runtime): nothing was published. Fix it with a new commit on `master`; the next push
  runs everything again.
- **The publish job fails before `npm publish`**, for example on the registry lookup or a missing changelog section:
  nothing was published. Fix the cause, then rerun the failed job or start the workflow manually on `master`.
- **`npm publish` fails**: look at `npm view jlv versions` first. If the version is missing, rerun the job; if it is
  there, a rerun skips it. Never unpublish or overwrite a version.
- **A published version is broken**: publish a fixed patch release. Deprecating the broken version with
  `npm deprecate` is a maintainer's decision.

## Maintenance

- **Actions** are pinned to full commit SHAs with the version in a comment. Resolve a new version with
  `gh api repos/<owner>/<repo>/commits/<tag> -q .sha` and read its release notes before updating the pin.
- **Runner image**: all jobs use `ubuntu-24.04` rather than `ubuntu-latest`, which moves to Ubuntu 26.04 from
  2026-10-19. Move all jobs together once a manual run on the new image is green; the trusted publisher does not
  depend on the image.
- **Node.js**: the runtime matrix is the `engines` floor, 22.9.0, and the latest 22, 24 and 26. Raising the floor is a
  breaking change for the changelog.
- **npm**: the quality and publish jobs pin the npm that packs and publishes; `scripts/publish-package.ts` checks the
  minimum for trusted publishing.
- **Dependencies** are exact pins in `pnpm-lock.yaml`, updated deliberately in small commits with their release notes
  read; there is no update bot. A new runtime dependency needs the inventory of `docs/v2-phase-4-results.md`: license,
  install scripts, native code and advisories.
