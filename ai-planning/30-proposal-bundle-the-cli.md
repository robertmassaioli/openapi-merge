# Implementation Proposal: Bundle the CLI Into One File

**Status:** ✅ Implemented — see §10 for what the implementation changed about
this document. The §6 decision was taken as recommended: bundle.
**Type:** Build / release
**Scope:** `packages/openapi-merge-cli` build and `package.json`
**Date:** 2026-07-28
**Branch:** `docs/bun-native-cli-proposal`

---

## 0. TL;DR

The question that started this was: *can we just make everything work with Bun,
so we don't need [`29-proposal-node-runtime-verification.md`](29-proposal-node-runtime-verification.md)?*

Taken literally, the two ways to do that are both worse than the status quo
(§1). But asking it surfaced a third option that is better than either, and
better than what we do today:

**Bundle the CLI with `bun build --target=node --format=cjs`.** One 0.82 MB
CommonJS file, no runtime dependencies, built by Bun in ~25 ms. Measured, in a
directory containing nothing but the bundle itself:

| Runtime | `--version` | YAML in → YAML out | invalid config | unsupported version |
| --- | --- | --- | --- | --- |
| Node 18.20.8 | 1.4.0 | ✅ | exit 1 | exit 9 |
| Node 22.22.2 | 1.4.0 | ✅ | — | — |
| Node 25.5.0 | 1.4.0 | ✅ | — | — |
| Bun 1.3.14 | 1.4.0 | ✅ | — | — |

The current build fails the first column outright:

```
$ node cli.js --version           # Node 18.20.8, current dist/
Error [ERR_REQUIRE_ESM]: require() of ES Module .../commander/index.js
```

So bundling **fixes the shipped bug** — with no dependency downgrade and no
change to the support range. It does *not* replace proposal 29; it shrinks it
from a matrix to a single smoke job (§7). And it has one serious cost that
deserves the decision, not a default (§4.1).

## 1. The question, taken literally

Two readings of "make it work with Bun". Both measured, both rejected.

### 1.1 `#!/usr/bin/env bun`

Strictly worse, and for a reason that is not obvious: **`bunx` does not run
things under Bun.** It honours the `node` shebang and hands the script to
whatever `node` is on `PATH`. A probe package whose only job is to report its
own runtime:

```
npx runtime-probe         -> NODE v25.5.0
bunx runtime-probe        -> NODE v25.5.0     <- not Bun
bunx --bun runtime-probe  -> BUN 1.3.14
```

Confirmed against the real packed tarball: `bunx openapi-merge-cli` on a Node 18
host reproduces `ERR_REQUIRE_ESM` exactly as `npx` does. Only `bunx --bun`
works — and it does work end to end, including a YAML round trip, so it is a
valid *workaround* for someone stuck today.

Changing the shebang to `bun` would make Bun a hard install requirement for
every user, including every existing CI pipeline that reaches this tool through
`npx` or `actions/setup-node`. It converts a bug affecting two EOL Node versions
into a break for everyone without Bun.

### 1.2 `bun build --compile`

Genuinely appealing — a standalone binary has no runtime question at all — but
the numbers do not support it:

| | |
| --- | --- |
| Binary size | **61 MB**, per platform |
| Compile time | 64 ms |
| Startup, `--version` | 51 ms (vs 65 ms for the bundle under Node) |

61 MB per platform, distributed via the per-platform `optionalDependencies`
pattern that `esbuild` and `swc` use, to buy **14 ms** of startup on a tool
people run a handful of times per build. It also abandons `npx`, which is how
most people invoke this. Not worth it.

## 2. What actually works: bundle for Node

`bun build` is Bun's bundler, and nothing says its output has to run under Bun.
Targeting Node produces a file that runs under both.

### 2.1 The `--format=cjs` trap

`--target=node` **alone is not enough** — Bun's default output format is ESM,
and the result fails in a way that is easy to miss:

```
bun build src/cli.ts --target=node --outfile=cli.js
  Node 18.20.8  FAIL  Warning: To load an ES module, set "type": "module" ...
  Node 22.22.2  ok
  Node 25.5.0   ok
```

It passes on a modern machine because Node ≥22.7 auto-detects module syntax in
`.js`, and fails on exactly the old versions we are trying to support. That is
the *same failure shape as the bug we are fixing* — verified only where it
happens to work. Adding `--format=cjs` fixes it:

```
bun build src/cli.ts --target=node --format=cjs --outfile=cli.js
  Node 18.20.8  ok    Node 22.22.2  ok    Node 25.5.0  ok    Bun 1.3.14  ok
```

### 2.2 What the bundle contains

113 modules, 0.82 MB, from a `dist/` that is currently 192 KB plus a
`node_modules` tree. Everything is inlined: `commander`, `js-yaml`, `ajv`,
`ajv-formats`, `openapi-merge`, and `openapi-merge`'s own `lodash`. The only
`require()` calls left are Node built-ins — plus one exception in §4.3.

`configuration.schema.json` is inlined too, which removes a runtime asset that
had to be copied into `dist/` and could go missing.

## 3. What bundling fixes beyond the immediate bug

Proposal 29 catalogued a family of "what we test is not what we ship" problems.
Bundling deletes most of the family rather than testing for it:

- **Runtime resolution divergence** (29 §2.2 — Bun takes the `import` condition
  of `js-yaml`'s `exports`, Node CJS takes `require`, and they are different
  files). After bundling there is no runtime resolution left to diverge.
- **The `js-yaml` override** (29 §2.1 — the root `overrides` pins `js-yaml` to
  4.3.0 while the CLI declares `^5.2.2`, so we test one major and ship another)
  becomes moot: what is bundled is what was tested.
- **A dependency that resolves differently outside the workspace** — same
  reason.
- **`engines: { node: ">=18" }` becomes true again.** This is the interesting
  one: proposal 29 §5 concluded the floor had to rise to 22.12 because
  `commander@15` requires it. Bundled, commander's own `engines` no longer
  applies — its code is inlined and transpiled. Node 18 passes every check
  above. **Bundling reverses that recommendation** instead of implementing it.
  (Node 20 is untested — no local install — but sits between two passing
  versions and is a safe inference.)

## 4. What bundling costs

### 4.1 Dependency visibility — the serious one

A bundled dependency is invisible to `npm audit`, to Dependabot, and to every
SCA scanner a consumer runs. A CVE in `js-yaml` or `ajv` would no longer reach
users through a semver range on `npm update`; it would need a rebuild and a
republish of `openapi-merge-cli`, and until then consumers have no way to even
*see* that they are exposed.

This is not hypothetical for this project. The root `package.json` carries
`overrides: { "js-yaml": "^4.3.0" }`, added specifically to clear a transitive
advisory — direct evidence that dependency-level patching has mattered here.

The honest counterweight: that same override is the §2.1 bug. Bundling makes
overrides unnecessary *and* impossible. The question is whether this project
would rather patch fast or ship reproducibly, and that is a maintainer's call.

**Mitigation, if we bundle:** keep the dependencies declared in
`devDependencies` so Dependabot still opens PRs against them, and treat a
dependency bump as a release rather than something users pick up on their own.

### 4.2 The library gets inlined into the CLI

`openapi-merge` is bundled into the CLI, verified: an unsupported-version
document exits 9 from a bundle sitting in an empty directory, so the merge logic
is genuinely in there. Two consequences:

- A library bugfix no longer reaches CLI users via `npm update`. Both packages
  must be republished. Today a CLI user picks up `openapi-merge@^1.4.0`
  improvements for free.
- The dependency ordering in `scripts/publish-changed.sh` stops being
  load-bearing for correctness — the CLI tarball no longer needs the library on
  the registry. Worth a comment there, not a change; the ordering is still
  right for the `main: dist/index` path in §5.

### 4.3 `ajv` leaves dynamic `require()`s the bundler cannot resolve

Four survive, from ajv's standalone code-generation path:

```
require("ajv/dist/runtime/equal")       require("ajv/dist/runtime/uri")
require("ajv/dist/runtime/ucs2length")  require("ajv/dist/runtime/validation_error")
```

Both ajv paths were then exercised in a directory with **no `node_modules` at
all** — a valid config validated and merged, an invalid one was rejected with
the correct message and exit 1 — so these sit on code that never runs for our
usage. But "never runs for the configs we tried" is weaker than "cannot run",
and this is precisely the class of thing that would surface as a
`MODULE_NOT_FOUND` in a user's directory rather than in CI. It is the strongest
argument for keeping the reduced smoke job in §7.

### 4.4 Debuggability and licences

Stack traces point into an 0.82 MB bundle. `--sourcemap=linked` costs a file and
restores useful traces; worth doing.

Bundling inlines MIT-licensed code, and MIT requires the copyright notice to
travel with it. Today that happens automatically because each dependency ships
its own `LICENSE` in `node_modules`. Bundled, it does not. This needs a
generated third-party notice file in the tarball — small, but it is a real
obligation and it is easy to forget.

## 5. Scope: bundle `index.ts`, keep tsgo for the declarations

**This section originally proposed bundling `dist/cli.js` and leaving
`dist/index.js` to tsgo. That was wrong, and the implementation does the
opposite.**

`src/cli.ts` is a twenty-line wrapper: it imports `main` from `.` and installs
two process-level error handlers. So `dist/cli.js` was never the file with the
problem — the `require("commander")` lives in whatever `cli.js` points at.
Bundling `cli.ts` would have fixed the `bin` and left `require('openapi-merge-cli')`
— which `main: dist/index` publicly offers — still throwing `ERR_REQUIRE_ESM` on
Node 18. Bundling both would duplicate ~800 KB for nothing.

Bundling the module *underneath* both entry points fixes both with one bundle:

| Output | Built by | Why |
| --- | --- | --- |
| `dist/index.js` (+ `.js.map`) | `bun build --target=node --format=cjs --outdir=dist` | the module both entry points reach |
| `dist/cli.js` (the `bin`) | tsgo, unchanged | a wrapper that `require('.')`s the bundle |
| `dist/*.d.ts` | tsgo, unchanged | declarations, still generated from source |

Verified: `require('openapi-merge-cli')` exposes all three declared exports
(`main`, `ExitCode`, `InputUrlStatusError`) from the CJS bundle, so the tsgo
`.d.ts` and the runtime shape still agree.

The declared `dependencies` stay declared — that is what `npm audit` and
Dependabot read (§4.1) — they are simply no longer resolved at runtime.

## 6. The decision this needs

**Recommendation: bundle the bin.** It fixes a shipped bug that currently breaks
every invocation on Node 18 and 20, it does so without dropping a support range
we have publicly promised, and it removes an entire class of divergence rather
than adding a test for it.

The thing to weigh is §4.1, and it is a genuine trade: faster, more reproducible
releases against slower propagation of dependency security fixes. For a
build-time developer tool that reads local files and is typically pinned in CI,
the exposure is low and the reproducibility is worth more. For a library it
would be the wrong call — which is why §5 leaves the library alone.

If §4.1 is judged unacceptable, the fallback is proposal 29 §5 option A: raise
`engines` to `>=22.12.0` and keep resolving dependencies at runtime. That is a
breaking change to the support range; bundling is not.

## 7. Effect on proposal 29

**Reduced, not superseded.** Proposal 29's diagnosis stands: nothing in CI runs
the shipped artifact under the runtime consumers use. Bundling does not create
that job, it makes it much cheaper — one runtime, no dependency tree, so the
matrix collapses:

| Proposal 29 asked for | After bundling |
| --- | --- |
| Matrix over every Node in `engines` | Floor version only; the bundle is version-agnostic CJS |
| `npm pack` + install with npm | Still needed — §4.3, and `files`/tarball correctness is unaffected by bundling |
| Six assertions (§3.3) | Same six; they are cheap and §4.3 is exactly what they catch |
| `engines` floor check vs dependency floors | Drops out — bundled dependencies impose no floor |
| §5 support-floor decision | Reversed: keep `>=18` |

Estimated remaining work there: **1–2 hours**, against the ~1 day it originally
described.

## 8. Effort

| Task | Effort |
| --- | --- |
| `build:bin` script + wire into `build` / `prepublishOnly` | 1 hour |
| Third-party licence notice generation (§4.4) | 1 hour |
| Verify the packed tarball on the floor Node (the reduced §7 job) | 1–2 hours |
| README / changelog note on how the CLI is now built | 30 min |
| **Total** | **~half a day** |

## 9. How the claims here were verified

- Runtime of `bunx` established with a purpose-built probe package printing
  `typeof Bun`, installed via `npm install` and run three ways.
- `ERR_REQUIRE_ESM` reproduced from `npm pack` tarballs of both packages
  installed with **npm** into a clean directory, with `commander` confirmed at
  15.0.0 — not from the working tree.
- Every bundle result above was produced by running the bundle in a directory
  containing no `node_modules`, under `~/.nvm` installs of Node 18.20.8,
  22.22.2 and 25.5.0.
- Exit codes read from `$?`, not inferred from output text.
- Inlining confirmed by grepping the bundle for library-only identifiers
  (`SUPPORTED_MINOR_VERSIONS`, `negotiateOutputVersion`) and for `lodash`, and
  by enumerating every surviving `require()` call.
- Startup timings are the best of three runs each; the gap is small enough that
  the conclusion rests on the 61 MB, not on the 14 ms.
- The library was checked separately under Node 18 via `require('openapi-merge')`
  from the installed tarball: it works today. **The breakage is CLI-only**, which
  is what confines this proposal to one package.

## 10. What implementation changed about this proposal

Recorded because the corrections are the useful part.

### 10.1 §5 had the wrong entry point

Proposed bundling the `bin`; the implementation bundles `index.ts`, which is what
the `bin` reaches. §5 is rewritten above with the reasoning. Bundling as
originally written would have left the `main: dist/index` path broken on Node 18
— the same bug, in the entry point nobody was looking at.

### 10.2 `--outfile` and `--sourcemap` cannot be combined (Bun 1.3.14)

Not a documented limitation, and it fails silently in the worst way. With both
flags, `bun build` **reports writing the files it was asked for, exits 0, and
ignores `--outfile` entirely** — the output lands beside the *entrypoint*:

```
$ bun build src/entry.ts --format=cjs --target=node \
    --outfile=dist/entry.js --sourcemap=linked
  entry.js      1.41 KB    (entry point)      <- reported
  entry.js.map  289 bytes  (source map)       <- reported
$ ls dist/   ->  (empty)
$ ls src/    ->  entry.js  entry.js.map  entry.ts
```

Live consequences, both hit during implementation: `dist/index.js` silently kept
the *unbundled* tsgo output while the build reported success, and an 819 KB
bundle was quietly written into `src/`, where the next lint run tripped over it.

`--outdir=dist` works correctly and is what the build script uses. Do not
reintroduce `--outfile`.

### 10.3 §4.1 understated the position, and §2.1 is now resolved

The proposal argued bundling makes the `js-yaml` override moot. It is stronger
than that: bundling **freezes** whatever the override resolved. The first build
inlined `js-yaml@4.3.0` into an artifact whose package declares `^5.2.2` — proposal
29 §2.1's mismatch, no longer merely installed but compiled in and published.

So it was fixed rather than noted. Findings:

- Bun **does not support nested `overrides`**. It prints
  `warn: Bun currently does not support nested "overrides"` and ignores them, so
  scoping the override to the dev-tool chain that needed it is not available.
- The override is **obsolete**. It was added to lift a transitive `js-yaml@3`
  advisory out of the dev tooling; those tools have since moved to 4.x on their
  own, so removing it reintroduces nothing.

Dropped `js-yaml` from `overrides`. The CLI now resolves and bundles the
`js-yaml@5.2.2` it declares. All 373 unit tests pass, and the full artifact
verification passes on Node 18, 22, 25 and Bun. `fast-uri` keeps its override.

### 10.4 What was measured after implementation

| | |
| --- | --- |
| Bundle | 0.83 MB, 112 modules, ~25 ms |
| Source map | 1.88 MB (`--sourcemap=linked`), published |
| Attributed packages | 12, generated from the source map (§4.4) |
| Verification | 23 checks × 4 runtimes = **92 passed, 0 failed** |
| Runtimes proven | Node 18.20.8, 22.22.2, 25.5.0, Bun 1.3.14 |

### 10.5 Tarball size

The source map is inside `dist/`, so `files: ["dist"]` publishes it. Measured
with `npm pack --dry-run`:

```
543 KB packed, 2761 KB unpacked, 35 files
  1837 KB  dist/index.js.map
   810 KB  dist/index.js
    33 KB  dist/configuration.schema.json
    15 KB  dist/THIRD-PARTY-NOTICES.txt
```

The map is the single largest entry — larger than the bundle it describes — and
publishing it is a deliberate choice, not an oversight. Without it a stack trace
from a user reports a line number inside an 810 KB generated file, which is
close to useless for a bug report. 543 KB packed is unremarkable for a
development CLI, and it is downloaded once per install rather than per run.

Dropping `--sourcemap=linked` is a one-word change if the size ever matters more
than the diagnostics.
