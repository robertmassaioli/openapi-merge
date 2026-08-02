# Implementation Proposal: Gate npm Publish on a GitHub Release

**Status:** Proposal
**Type:** CI / release process
**Scope:** `.github/workflows/npm-publish.yml`
**Date:** 2026-08-02
**Branch:** `worktree-release-gated-npm-publish`

---

## 0. TL;DR

`npm-publish.yml` currently runs on **every push to `main`**, including plain
merges that don't bump a version. It is harmless today only because
`scripts/publish-changed.sh` separately checks each package's local version
against the registry and skips anything unchanged — the workflow runs, but
usually does nothing.

The request: publishing should only ever be *attempted* when a maintainer
explicitly cuts a **GitHub Release**, not on every merge to `main`. This is a
one-line trigger change — swap `on: push: branches: [main]` for
`on: release: types: [published]` — because the actual publish *decision*
already lives in `publish-changed.sh` and doesn't need to change at all.

## 1. Current Behaviour

```yaml
on:
  push:
    branches:
      - main
```

Every merge to `main` runs the full job: lint, test, build, the Node-runtime
verification gate ([`29-proposal-node-runtime-verification.md`](29-proposal-node-runtime-verification.md)),
then `publish-changed.sh`, which publishes a package only if its
`package.json` version is strictly newer than what's on the registry
(`is_newer_version`, string-compared field by field).

Confirmed against the live repo:

- No branch protection rule on `main` requires this workflow to pass (`gh api
  repos/.../branches/main/protection` → 404 `Branch not protected`), so
  nothing else depends on it running on every push.
- `package.json` on `main` already carries `1.4.0` for both packages, while
  the registry has `1.3.3` (`openapi-merge`) and `1.3.2`
  (`openapi-merge-cli`) — i.e. there is already a version bump on `main`
  waiting for the next push to trigger a publish, which is exactly the
  "runs by accident" shape this proposal removes.
- No GitHub Releases exist yet in this repo (`gh release list` is empty);
  only lightweight tags (`v1.0.22` … `v1.1.33`) from an older process. This
  is a genuinely new mechanism, not a reconnection to one already in use.

## 2. Problem

Publish-worthy pushes to `main` and version-bump pushes to `main` are the
same trigger today. That means:

- Every ordinary merge pays the cost of the full publish job (lint, test,
  build, the Node-compat matrix step) for a publish that 99% of the time
  doesn't happen — `publish-changed.sh` prints "already published" and exits
  cleanly, but the job still ran end to end.
- There's no explicit, visible moment that corresponds to "this is a
  release." A version bump landing in a routine PR silently becomes a
  release the next time anyone merges to `main` — potentially before the
  maintainer meant to ship it.
- GitHub Releases are the natural place to attach release notes, and nothing
  currently produces one.

## 3. Design

### 3.1 Trigger on `release: types: [published]`

```yaml
on:
  release:
    types: [published]
```

`published` fires when a maintainer publishes a release (including
publishing straight from a tag), and — importantly — **not** when a draft
release is merely saved. That matches "when I trigger a GitHub Release"
literally: drafting doesn't publish, hitting "Publish release" does.

`actions/checkout@v7`'s default ref for a `release` event is
`github.sha`, which GitHub sets to the commit the release's tag points at —
so no change is needed to the checkout step to get the right commit.

### 3.2 Leave `publish-changed.sh` untouched

The version-comparison gate is still exactly what's wanted: a release event
says "a release is happening," not "publish version X." Keeping the decision
in `publish-changed.sh` means:

- If a maintainer cuts a release without having bumped a package's version
  first, that package is silently skipped ("already published") instead of
  erroring — the same safe no-op behaviour as today.
- Two workspace packages with independent versions ([per the publish-order
  comment in the script itself](../scripts/publish-changed.sh)) both stay
  reachable from a single release event; the release doesn't need to name
  which package it's for.

### 3.3 Everything else in the job is unchanged

Lint, test, build, and the Node/Bun runtime verification step
([§10 of proposal 29](29-proposal-node-runtime-verification.md)) all still run
before publishing — a release is not an excuse to skip the gate that would
have caught the broken-CLI incident that proposal exists for.

## 4. Full Diff Sketch

```yaml
name: npm-publish
on:
  release:
    types: [published]
jobs:
  npm-publish:
    # ...unchanged below this line...
```

Nothing else in the job body changes.

## 5. What a release/publish now looks like

1. Land the version bump(s) in `package.json` on `main` via a normal PR (as
   today — this proposal doesn't change how versions get bumped).
2. On GitHub: **Releases → Draft a new release**, choose or create a tag
   (conventionally `vX.Y.Z`, matching whichever package version is being
   cut), fill in notes, click **Publish release**.
3. `npm-publish.yml` runs against that tag's commit and publishes whichever
   package(s) have a version ahead of the registry.

Pushing to `main` — including a version-bump commit by itself — no longer
publishes anything by itself.

## 6. Effort

| Task | Effort |
| --- | --- |
| Change the `on:` block in `npm-publish.yml` | 5 minutes |
| Update README/AGENTS docs mentioning the old push-to-publish behaviour, if any | 15 minutes |
| Verify via a dry run (see §7) | 15 minutes |

**Total: under an hour.**

## 7. How this would be verified

- `act`/local YAML lint isn't reliable for `release` events (no local
  trigger simulation without a real release), so verification is:
  1. Confirm the workflow no longer has a `push` trigger and the job body
     is byte-for-byte identical otherwise (a diff review, not a test run).
  2. On the implementation branch, temporarily point a **test** repository
     fork's `npm-publish.yml` at `DRY_RUN=1` and publish a real GitHub
     Release against it to confirm the event fires and the job reaches
     `publish-changed.sh` in dry-run mode — this is a manual, one-off check
     rather than something CI can assert, since it requires an actual
     Release event.
  3. Real confirmation is the first live release cut after this merges.

## 8. Non-goals

- Changing how versions are bumped, or adding automated version bumping
  (e.g. changesets). Out of scope; this proposal only changes *when*
  publish runs, not how versions get decided.
- Rejecting prereleases (`release.prerelease === true`) or drafts
  explicitly. `types: [published]` already excludes drafts; prereleases are
  included deliberately, since `is_newer_version` in `publish-changed.sh`
  would need a real semver-prerelease comparison to handle that
  distinction correctly today, and it doesn't have one (existing
  limitation, not introduced here).
- Enforcing that a release's tag matches the `package.json` version(s)
  being published. `publish-changed.sh` doesn't look at the tag at all
  today, and adding that check is a separate, larger piece of validation
  than what was asked for.
- Removing or renaming the workflow file. `npm-publish.yml` keeps its name;
  only the trigger changes.
