# Implementation Proposal: Build with Bun, Verify on Node

**Status:** ✅ Implemented, in the reduced form that
[`30-proposal-bundle-the-cli.md`](30-proposal-bundle-the-cli.md) made possible —
see §10. The diagnosis below stands in full; **§5's recommendation is reversed**
(the floor stays at 18, because bundling made the claim true) and the §4 matrix
no longer needs to test dependency floors.
**Type:** CI / release safety
**Scope:** `.github/workflows/branch-test.yml`, both `package.json` files
**Date:** 2026-07-27
**Branch:** `ci/latest-actions`

---

## 0. TL;DR

We build and test with Bun. Users run the result with **Node**. Nothing anywhere
in CI, or in the 373-test suite, ever executes the built artifacts under Node —
so the two runtimes have been free to diverge silently.

They have. Measured today, against the current build:

```
node v18.20.8   json=FAIL  yaml=FAIL
  Error [ERR_REQUIRE_ESM]: require() of ES Module
  .../commander@15.0.0/index.js from .../dist/index.js not supported.
node v22.22.2   json=ok    yaml=ok
node v25.5.0    json=ok    yaml=ok
```

**The published CLI is broken on Node 18 and Node 20** — every invocation fails
before doing any work. Both packages declare `engines: { node: ">=18" }`, so we
are actively promising a platform on which the tool cannot start.

Cause: `commander@15` is `type: module` and declares `engines: node >=22.12.0`.
Our build emits CommonJS, and `require()` of an ESM module is unsupported before
Node 20.19 / 22.12. The upgrade that introduced it
([`23-proposal-dependency-updates.md`](23-proposal-dependency-updates.md) phase 6) was
verified under Bun and under the local Node, both of which are new enough.

This proposal is the CI job that would have caught it, plus the smaller
divergences it also surfaced (§2).

## 1. Why the existing gates cannot catch this

| Gate | Runs under | Sees the built output? | Sees what consumers install? |
| --- | --- | --- | --- |
| `bun run test` | Bun | no — it imports `src/` | no |
| `bun run build` | tsgo | produces it, never runs it | no |
| `bun run lint` | ESLint | no | no |
| Binary smoke checks (manual, this session) | local Node only | yes | no |

Three independent blind spots, and the bug needed all three to survive:

1. **Runtime.** Bun resolves the `import` condition of a package's `exports`;
   Node CJS resolves `require`. For `js-yaml` those are *different files*. A
   suite that only runs under Bun cannot see a Node-only resolution failure.
2. **Artifact.** The suite imports `src/`. `dist/` is what ships, and only
   `dist/` has the CommonJS `require()` calls that fail.
3. **Version.** Everything was checked on whatever Node happened to be on PATH.
   The floor we *promise* was never exercised.

## 2. What else the investigation surfaced

Both are the same shape — "what we test is not what we ship" — and both argue
for verifying a packed tarball rather than the working tree.

### 2.1 An override downgrades a direct dependency

The root `package.json` carries `overrides: { "js-yaml": "^4.3.0" }`, added to
clear a transitive advisory. It also applies to `openapi-merge-cli`'s **direct**
dependency, which declares `^5.2.2`:

```
declared by the CLI : ^5.2.2
actually installed  : 4.3.0     <- does not satisfy the declared range
what a consumer gets: 5.x       <- never exercised here
```

The code uses `load`/`dump`, which exist in both, so nothing fails today. But we
test one major and ship a dependency on another.

### 2.2 Bun and Node resolve `js-yaml` to different files

Under Bun, `import yaml from 'js-yaml'` throws *"Missing 'default' export"* —
Bun takes the `import` condition and gets the ESM build. Under Node CJS,
`require('js-yaml')` takes the `require` condition and gets
`dist/js-yaml.cjs.js`, which has different export shape. The source works under
both today only because it uses named imports. That is a coincidence worth a
test, not a guarantee.

## 3. Design

### 3.1 Verify the packed tarball, not the repository

The job must install what npm would publish, not what the working tree contains.
That is the only way to catch:

- a `files` field that omits `dist` — exactly what
  [`23-proposal-dependency-updates.md`](23-proposal-dependency-updates.md) found, where
  `bun publish` shipped two files and no build output;
- an override masking a direct dependency (§2.1);
- a missing runtime asset such as `dist/configuration.schema.json`;
- a dependency that resolves differently outside the workspace.

So: `npm pack` both packages, install the tarballs into a clean scratch
directory with **npm** (not Bun — the consumer's resolver is the one under
test), and drive the installed binary.

### 3.2 A matrix over the versions we promise

One job, one axis: every Node version inside our declared `engines` range, plus
the current release. The floor must be the *lowest version we claim to support*,
because that is the only number the matrix is really testing.

### 3.3 What to assert

Enough to prove the runtime boundary is crossed, not to re-test merge logic —
that is what the 373-test suite is for. Specifically, each case must touch a
dependency that resolves differently across runtimes:

| Case | Proves |
| --- | --- |
| `--version` | the binary starts at all: shebang, `require('../package.json')`, commander |
| JSON in → JSON out | the whole `main()` path end to end |
| YAML in → YAML out | `js-yaml` `load` **and** `dump` resolve and run under CJS |
| invalid config → exit 1 | `ajv` + `ajv-formats` resolve under CJS |
| unsupported version → exit 9 | the library is reachable from the CLI as an installed dependency |
| `require('openapi-merge').merge(...)` | the library's own entry point works for a Node consumer |

The library case matters independently: someone may `require('openapi-merge')`
from a plain Node project without ever touching the CLI.

### 3.4 Enforce `engines` rather than declaring it

`bun install` does not enforce `engines`, which is why nothing objected to a
dependency requiring Node 22.12 sitting under a package claiming Node 18. The
matrix makes the claim testable; a check that the declared floor is `>=` the
highest floor among runtime dependencies makes it *self-maintaining*, and would
have failed the commander upgrade at the moment it was made.

## 4. Sketch

```yaml
  node-compat:
    name: Node ${{ matrix.node }} runs the built package
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false          # report every broken version, not just the first
      matrix:
        node: ['22.12', '24', '26']   # floor, LTS, current -- see §5
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3.14 }
      - uses: actions/setup-node@v7
        with: { node-version: ${{ matrix.node }} }
      - run: bun install --frozen-lockfile
      - run: bun run build                 # built by Bun ...
      - run: ./scripts/verify-node-runtime.sh   # ... exercised by Node
```

`verify-node-runtime.sh` packs both packages, installs the tarballs into a temp
directory **with npm**, and runs the §3.3 cases. Keeping it a script rather than
inline YAML means it can be run locally against any Node — which is how the
`ERR_REQUIRE_ESM` above was found, and how a maintainer would reproduce it.

## 5. The decision this needs

The matrix floor and the `engines` field must agree, and today neither matches
reality. Two options:

**A. Raise the floor to Node 22.12.** Declare `engines: { node: ">=22.12.0" }`,
matching `commander@15`'s own requirement. Honest, zero code change, and
consistent with a package that already requires native `fetch`. Drops Node 18
and 20, both of which are already out of long-term support — and neither of
which currently works, so nothing that functions today is lost.

**B. Keep Node 18 and downgrade commander.** Return to a CommonJS-compatible
major. Preserves the promise at the cost of reverting part of the dependency
work and staying on an older commander indefinitely.

**Recommendation: A.** The support claim is already false; B restores a promise
to platforms that are themselves unsupported upstream. A is a **breaking change**
to the declared support range and warrants a major version bump — which is worth
weighing against the fact that the affected users are, today, unable to run the
tool at all.

This is the one part of this proposal that is not purely additive, and it is why
this is a proposal rather than a commit.

## 6. Effort

| Task | Effort |
| --- | --- |
| `scripts/verify-node-runtime.sh` with the §3.3 cases | half a day |
| The `node-compat` matrix job | 1 hour |
| `engines` floor check against runtime dependencies | 1 hour |
| Resolve §2.1 (scope the `js-yaml` override, or drop it now the direct dep is current) | 1 hour |
| Whichever of §5 is chosen, plus README/changelog | 1–2 hours |
| **Total** | **~1 day** |

## 7. Non-goals

- Running the **test suite** under Node. That would mean rewriting ~400
  assertions away from `bun:test` globals, and it tests `src/`, not the artifact
  — the wrong target. The suite stays on Bun; this job covers the boundary the
  suite cannot see.
- Publishing from Node. `bun publish` is fine once
  [`23-proposal-dependency-updates.md`](23-proposal-dependency-updates.md)'s `files`
  fix is in place.
- Testing on Windows or other platforms. Worth considering separately; the
  runtime boundary is the pressing gap.

## 8. How the claims here were verified

- Built CLI run under Node 18.20.8, 22.22.2 and 25.5.0 from a real `dist/`;
  failure text quoted verbatim from Node 18.
- `commander@15`: `type: module`, `engines.node >= 22.12.0`, read from its
  installed `package.json`.
- `js-yaml@5`'s `exports` map read directly, showing distinct `import` and
  `require` targets.
- Installed-versus-declared `js-yaml` resolved through the CLI's own
  `require.resolve` rather than a filesystem search, after a first attempt found
  transitive copies and reported the wrong versions.
- Absence of Bun-specific APIs in shipped source confirmed by grep over
  `packages/*/src` excluding tests.

---

## 10. What was implemented

`scripts/verify-node-runtime.sh`, wired into two workflows.

The script builds, `npm pack`s both packages, installs the tarballs **with npm**
into a directory outside the workspace, and runs 23 assertions against the
installed artifacts for each runtime in `$RUNTIMES` (default: `node bun`).

Measured on the implementation branch:

```
Node 18.20.8   23/23        <- was completely broken before bundling
Node 22.22.2   23/23
Node 25.5.0    23/23
Bun 1.3.14     23/23
               ------
               92 passed, 0 failed
```

### 10.1 Where it runs

| Workflow | When | Runtimes |
| --- | --- | --- |
| `branch-test.yml` → `node-compat` | every branch push | Node 18, 20, 22, 24 (matrix, `fail-fast: false`) × Node + Bun |
| `npm-publish.yml` | before `publish-changed.sh` | Node 18 (the declared floor) + Bun |

The publish gate is the one that matters: it is what would have stopped the
broken release. Node 20 is covered in CI, which retires the "safe inference"
caveat this proposal previously carried.

### 10.2 Assertions, against §3.3

All six original cases are present. Added:

- **`--help`** — commander's other entry point.
- **JSON output with explicit indent** — the `formatting` path (issue #114).
- **A config supplied as YAML** — routes `js-yaml` into ajv in one path.
- **Four more ajv cases** — missing-required, wrong-type, additional-property
  (the schema is `--noExtraProps`), and malformed JSON. Plus the tabs-and-`.yaml`
  semantic check, which lives *after* validation and proves post-ajv code is
  reachable from the bundle.
- **`require('openapi-merge-cli')` exposes `main`, `ExitCode` and
  `InputUrlStatusError`** — the `main: dist/index` path, which tsgo declares and
  nothing previously executed.
- **Two bundling guards** — the tarball's `dist/index.js` must contain inlined
  dependency code and must *not* contain `require("commander")`. The bundle
  overwrites tsgo's output, so a stray `tsgo` run silently restores the
  unbundled file; it works on a modern Node and fails on 18. That is the exact
  bug this proposal exists for, and it is now a one-grep guard.

`inputURL` deserves a note: `format: "uri"` is the only thing that forces
`ajv-formats`' machinery to load, so it is the case that would surface §4.3's
unresolved dynamic `require()`s. It asserts **exit 6**, not 5 — the URL 404s, so
it exercises `ErrorInputUrlClientStatus` as well, proving the 4xx/5xx split
survived bundling.

### 10.3 A bug found in the verification itself

The pass/fail counters were shell variables, and scenarios ran inside
`( cd "$CONSUMER" && run_scenarios ... )`. Subshell increments are discarded, so
a run with **six visible FAIL lines** summarised as `0 failed` — and exited 0.
The counters are now append-only files, and the `cd` happens once outside any
subshell.

Worth recording because a verification script that cannot fail is worse than
none: it converts a real breakage into a green tick. The six failures were all
mistakes in the assertions (stdout vs stderr, and the exit-6 case above), not in
the product — but they were only noticed because the FAIL lines were read rather
than the summary trusted.

### 10.4 §2.1 resolved

The `js-yaml` override is gone. Bundling did not make it moot as predicted — it
*froze* it, compiling `js-yaml@4.3.0` into a package that declares `^5.2.2`.
Details in 30 §10.3, including the discovery that Bun ignores nested
`overrides`.
