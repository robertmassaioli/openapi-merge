# Implementation Proposal: Trustworthy Code Coverage Across All Packages

**Status:** ✅ Implemented on `feature/code-coverage-config` (option A + the three
addendum corrections). §3.3 turned out to need no change — see the correction
recorded there. Options B and C remain unimplemented by design; §A6.3 lists the
triggers for revisiting C.
**Type:** Cross-cutting infrastructure / tooling
**Scope:** `packages/openapi-merge`, `packages/openapi-merge-cli`, `AGENTS.md`
**Date:** 2026-07-25
**Toolchain verified against:** `bun 1.3.14`

---

## 0. TL;DR

**A coverage tool is already running.** Both packages have
`"test": "bun test --coverage"` in `package.json`, and both print a coverage
table on every test run — locally and in CI.

The problem is not that coverage is missing. It is that **the numbers being
printed do not measure what they appear to measure**, and nothing enforces them:

1. **The CLI's denominator is wrong.** Bun only instruments modules actually
   *loaded* during the test run. Five of the CLI's ten source files — including
   `index.ts`, the 189-line orchestrator holding essentially all of the CLI's
   logic — never appear in the report at all. The headline "61.30% lines" is
   computed over five files, not ten.
2. **Test helpers are counted as production code** in the library's report.
3. **Nothing is gated.** Coverage can drop to zero and CI stays green.
4. **Bun's "All files" row is an unweighted mean of the per-file percentages**,
   not covered ÷ total — so a one-line file at 100% cancels out a 189-line file
   at 22%. See **Defect D (A4.3)**, discovered while writing the addendum. Both
   packages' headline figures are overstated by this: the library's true line
   coverage is **~65%, not ~89%**, and the CLI's is **~21%, not ~61%**. Every
   "All files" number quoted in §1–§10 is subject to this correction; the
   per-file numbers are unaffected, and so are the per-file thresholds in §3.1.

Consequence worth stating plainly: because unloaded files are simply absent,
**the CLI's reported coverage can be improved by deleting a test.** Any threshold
set on the current denominator is gameable by subtraction.

There is also a sting in the tail: Bun's `coverageThreshold` is enforced
**per-file, not globally** (§4), which makes the obvious "gate at 85%" plan
impossible to express. Everything in §4 was determined by bisection because Bun
documents none of it and prints no error when a threshold trips.

Effort: **≈ 3 hours.** No new dependencies, no new tooling, and **no changes to
`branch-test.yml`**.

Every number and behaviour below was measured in this repo, not assumed.

---

## 1. Current State (measured)

### 1.1 What is configured today

| Location | Content |
| --- | --- |
| `packages/openapi-merge/package.json` | `"test": "bun test --coverage"` |
| `packages/openapi-merge-cli/package.json` | `"test": "bun test --coverage"` |
| `packages/openapi-merge/bunfig.toml` | `[test]` / `root = "src"` — nothing else |
| `packages/openapi-merge-cli/bunfig.toml` | `[test]` / `root = "src"` — nothing else |
| Root `package.json` | `"test": "bun run --filter '*' test"` |
| `.github/workflows/branch-test.yml` | runs `bun run test` |

The coverage *profiler* is on. No reporter beyond `text`, no ignore patterns, no
thresholds, no artifact, no upload.

### 1.2 What it currently prints

**Library (`packages/openapi-merge`)** — 49 tests, 8 test files:

```
File                             | % Funcs | % Lines
All files                        |   90.33 |   89.52
 src/__tests__/oas-generation.ts |  100.00 |  100.00   <- test helper
 src/__tests__/test-utils.ts     |  100.00 |   84.62   <- test helper
 src/component-equivalence.ts    |   80.00 |   95.71
 src/data.ts                     |  100.00 |  100.00
 src/dispute.ts                  |  100.00 |   90.91
 src/extensions.ts               |  100.00 |   93.55
 src/index.ts                    |  100.00 |  100.00
 src/info.ts                     |  100.00 |  100.00
 src/operation-selection.ts      |  100.00 |  100.00
 src/paths-and-components.ts     |   61.11 |   80.48
 src/reference-walker.ts         |   42.86 |   32.81
 src/tags.ts                     |  100.00 |   96.15
```

All ten library source files are present — the library does not suffer the
denominator problem described in §2.1. It is still affected by two test helpers
inflating the total (§2.2) and by the unweighted-mean defect (§2.4).

**CLI (`packages/openapi-merge-cli`)** — 27 tests, 2 test files:

```
File                       | % Funcs | % Lines
All files                  |   40.00 |   61.30
 src/data.ts               |    0.00 |   66.67
 src/file-loading.ts       |    0.00 |   18.18
 src/formatting.ts         |   66.67 |   83.33
 src/load-configuration.ts |   33.33 |   38.30
 src/path-resolution.ts    |  100.00 |  100.00
```

Five files. `packages/openapi-merge-cli/src/` contains **ten** non-test
TypeScript files. Missing entirely: `cli.ts`, `index.ts`,
`examples-for-schema.ts`, `exit-codes.ts`, `fix-schema.ts`.

Note on both tables above: the `All files` row is an **unweighted mean of the
per-file percentages**, not covered ÷ total — see §2.4. Neither headline figure
means what it appears to.

---

## 2. The Defects

### 2.1 Defect A — unloaded files are invisible (CLI only)

Bun's coverage is runtime-instrumented: a module never `import`ed during the test
run contributes **nothing** — not even a 0% row. The report silently shrinks to
whatever the tests happened to touch.

Verified by force-loading every loadable CLI module via `--preload`:

| File | Baseline | With all loadable modules loaded |
| --- | --- | --- |
| `src/index.ts` | *absent* | **0.00% funcs / 22.22% lines** |
| `src/exit-codes.ts` | *absent* | 100.00 / 100.00 |
| `src/examples-for-schema.ts` | *absent* | 100.00 / 100.00 |
| `src/cli.ts` | *absent* | *still absent — §3.2* |
| `src/fix-schema.ts` | *absent* | *still absent — §3.2* |
| **All files** | **40.00 / 61.30** | **50.00 / 66.09** |

Note the direction: the honest number is *higher* here, because `exit-codes.ts`
and `examples-for-schema.ts` are declaration-shaped modules that reach 100% on
import alone. That is exactly the point — **the current number is not
conservative, it is arbitrary.** It moves in whichever direction the accident of
module loading pushes it.

The signal that was hidden: `index.ts` — 189 lines, the whole `main()`
orchestration flow — sits at **0% function coverage**. That is the single most
important fact about this repository's test suite, and today's report does not
show it.

### 2.2 Defect B — test helpers counted as source (library)

`src/__tests__/*.test.ts` files are excluded automatically (Bun recognises the
`.test.` name pattern), but non-`.test.` helper modules inside `__tests__/` are
treated as ordinary source.

Setting `coveragePathIgnorePatterns = ["**/__tests__/**"]` on the library:

| | % Funcs | % Lines |
| --- | --- | --- |
| Before | 90.33 | 89.52 |
| After | **88.40** | **88.96** |

Small, but it is ~0.6 points of coverage the library does not actually have.

Note: `coverageSkipTestFiles = true` does **not** remove these helpers — it was
tried and changed nothing. `coveragePathIgnorePatterns` is the mechanism that
works.

### 2.3 Defect C — sibling `dist/` pollution (CLI; appears once A is fixed)

`openapi-merge-cli` depends on the workspace-linked `openapi-merge`, which
resolves to `../openapi-merge/dist/*.js` (compiled output). The moment
`src/index.ts` is loaded, ten compiled library files enter the CLI's report:

```
 ../openapi-merge/dist/paths-and-components.js  |   20.00 |    7.66
 ../openapi-merge/dist/reference-walker.js      |    6.67 |    9.72
 ...
```

This double-counts the library at its *compiled* granularity and drags the CLI's
total to a meaningless 42.40 / 47.26. It is coupled to the fix for Defect A — it
only appears once you start loading everything, so both must be fixed together.

### 2.4 Defect D — the "All files" total is an unweighted mean

Found while evaluating alternative tools; documented in full at **A4.3**. Bun's
`All files` row averages the per-file percentages rather than dividing total
covered lines by total lines, so file size is ignored entirely. Corrected
figures: library **~65% lines** (not 88.96), CLI **~21% lines** (not 61.30).
Every "All files" number in §1–§10 carries this caveat; per-file numbers, and
therefore §3.1's per-file thresholds, are unaffected.

---

## 3. Proposed Changes

### 3.1 Library: ignore patterns, lcov reporter, per-file floor

`packages/openapi-merge/bunfig.toml`:

```toml
[test]
root = "src"
coveragePathIgnorePatterns = ["**/__tests__/**"]
coverageReporter = ["text", "lcov"]
# Per-file floors, NOT a global average — see §4. Bound by the weakest file
# (reference-walker.ts: 42.86% funcs / 32.81% lines). Raise both as that file
# gains tests. Both keys are mandatory; omitting one fails unconditionally.
coverageThreshold = { lines = 0.30, functions = 0.40 }
```

Verified: this exact block exits 0, and `{ lines = 0.35, functions = 0.40 }` or
`{ lines = 0.30, functions = 0.45 }` both exit 1 — i.e. the floor is live and
sits directly against `reference-walker.ts`.

The library needs **no preload** — all ten of its source files are already
reachable from the existing test suite.

### 3.2 CLI: a curated coverage preload

Bun has no equivalent of Jest's `collectCoverageFrom` include-list. No option
says "instrument these files whether or not they are imported." The only
mechanism is to ensure they *are* imported.

Add `packages/openapi-merge-cli/src/__tests__/_coverage-preload.ts`:

```typescript
// Loaded via `preload` in bunfig.toml so that every CLI source module appears in
// the coverage report, including modules no test imports yet. Without this, Bun
// silently omits unloaded files from the denominator and the reported percentage
// becomes meaningless. Add a line here whenever a new source file is added.
//
// Deliberately NOT imported (both execute on import):
//   - cli.ts        — calls main() at module scope; importing it runs the CLI.
//   - fix-schema.ts — a build script whose module body rewrites
//                     src/configuration.schema.json on disk.
import '../index';
import '../exit-codes';
import '../examples-for-schema';
import '../file-loading';
import '../data';
```

This must be a **curated list, not a glob.** Two files can never be preloaded:

- **`cli.ts`** invokes `main()` at module scope and registers
  `process.on('uncaughtException')` handlers. Importing it would run the CLI
  inside the test process.
- **`fix-schema.ts`** has no exports and no function wrapper — all eleven lines
  are module-scope statements that read, mutate and **write**
  `src/configuration.schema.json`. Importing it during tests would modify a
  checked-in source file. Worth knowing when diagnosing this: that JSON file is
  *also* generated by the `gen-schema` script, so someone who notices it dirty in
  `git status` will naturally assume the generator ran. If the preload ever grows
  a `fix-schema` import, the symptom will look like a build-script problem rather
  than a test-config one — hence the acceptance criterion in §9.

Both are structurally unreachable by in-process coverage. `cli.ts` is reachable
only by subprocess smoke tests, and Bun collects no coverage from subprocesses,
so **`cli.ts` and `fix-schema.ts` will remain permanently absent from the
report.** Document that rather than pretending otherwise.

`index.ts` was verified safe to import: it constructs a `commander` program at
module scope but does not call `main()` or `program.parse()`.

`packages/openapi-merge-cli/bunfig.toml`:

```toml
[test]
root = "src"
preload = ["./src/__tests__/_coverage-preload.ts"]
coveragePathIgnorePatterns = ["**/__tests__/**", "**/dist/**"]
coverageReporter = ["text", "lcov"]
# No threshold yet — see §5. data.ts and file-loading.ts are at 0.00% funcs, so
# any functions floor above zero fails today.
```

`**/__tests__/**` also excludes the preload file itself, which otherwise appears
at 100% and inflates the total.

`**/dist/**` excludes the sibling library's compiled output. Verified: all three
of `../openapi-merge/dist/*`, `**/openapi-merge/dist/**` and `**/dist/**` match
correctly — including paths resolving *outside* the package root — and all give
identical results. `**/dist/**` is recommended as the least brittle.

**Result after both changes:**

```
File                        | % Funcs | % Lines
All files                   |   50.00 |   66.09
 src/data.ts                |    0.00 |   66.67
 src/examples-for-schema.ts |  100.00 |  100.00
 src/exit-codes.ts          |  100.00 |  100.00
 src/file-loading.ts        |    0.00 |   18.18
 src/formatting.ts          |   66.67 |   83.33
 src/index.ts               |    0.00 |   22.22   <- now visible
 src/load-configuration.ts  |   33.33 |   38.30
 src/path-resolution.ts     |  100.00 |  100.00
```

Eight of ten files — the honest baseline *as far as Bun can measure it*. Two
caveats, both established in the addendum: the `50.00 / 66.09` total is an
unweighted mean of the eight per-file figures (Defect D, A4.3), and the two
missing files are not intrinsically unmeasurable. Weighted, and with all ten
files included, the CLI's true figure is **21.02% lines / 17.14% funcs**
(A4.4).

### 3.3 `.gitignore` — no change needed

**Correction (2026-07-25).** An earlier draft of this section claimed the lcov
output at `packages/<pkg>/coverage/` was not gitignored, because the root
`.gitignore`'s `/coverage` is anchored to the repository root. That was wrong,
and the error was in the measurement, not the reasoning: `git check-ignore -v
packages/openapi-merge/coverage` had been run from *inside*
`packages/openapi-merge`, so the relative path resolved to the nonexistent
`packages/openapi-merge/packages/openapi-merge/coverage` and naturally matched
nothing.

Re-run from the repository root, both directories are already ignored — by each
package's **own** `.gitignore`, which the root file never needed to cover:

```
packages/openapi-merge/.gitignore:13:/coverage      packages/openapi-merge/coverage
packages/openapi-merge-cli/.gitignore:14:/coverage  packages/openapi-merge-cli/coverage
```

No `.gitignore` change is required. The corresponding acceptance criterion in §9
is retained as a *verification* step rather than a change to make.

The general lesson is worth keeping: `git check-ignore` takes paths relative to
the current directory, so always run it from the repository root, or pass
absolute paths.

### 3.4 CI: nothing to change

Verified: a `coverageThreshold` breach makes `bun test` exit 1, and the root
`bun run --filter '*' test` propagates that failure. Since `branch-test.yml`
already runs `bun run test`, **thresholds are enforced in CI the moment they land
in `bunfig.toml`.** Cost: zero workflow changes.

Optionally publish the lcov artifact for inspection on red builds:

```yaml
    - run: bun run test
    - name: Upload coverage
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: coverage
        path: packages/*/coverage/lcov.info
```

---

## 4. `coverageThreshold` Semantics (undocumented; determined by bisection)

This section is the most important one to read before setting any threshold.
Bun's docs are silent on all of it, and **Bun prints no message when a threshold
trips** — the run emits its normal coverage table and exits 1, with nothing
naming the offending file or metric. Every rule below was established
empirically.

### Rule 1 — thresholds are **per-file**, not global

The library totals 88.40% funcs / 88.96% lines, but its weakest file
(`reference-walker.ts`) is at 42.86 / 32.81. Bisecting the scalar form:

| `coverageThreshold` | Exit |
| --- | --- |
| `0.30` | 0 |
| `0.32` | 0 |
| `0.328` | 0 |
| **`0.33`** | **1** |
| `0.50` | 1 |
| `0.80` | 1 |

The boundary lands exactly on `reference-walker.ts`'s **32.81%**, not anywhere
near the 88.96% total. Confirmed on the CLI, where `data.ts` and `file-loading.ts`
sit at 0.00% funcs and *every* non-zero threshold fails — including `0.15`, well
below the 61.30% total and below `file-loading.ts`'s own 18.18% lines.

**Implication: "gate the package at 85%" is not expressible.** A threshold is
capped by the worst file in the package. It is a per-file floor, and its natural
use is as a ratchet against the weakest module — which is arguably more useful
than an average, but it is not what the config name suggests.

### Rule 2 — the object form requires **both** `lines` and `functions`

Omitting either makes the run fail unconditionally, at any value:

| `coverageThreshold` | Exit | Note |
| --- | --- | --- |
| `{ lines = 0.001 }` | 1 | fails despite an absurdly low bar |
| `{ lines = 1.0 }` | 1 | |
| `{ statements = 0.85 }` | 1 | |
| `{ statements = 0.0 }` | 1 | |
| `{ lines = 0.30, functions = 0.40 }` | **0** | both keys present ✅ |
| `{ lines = 0.30, functions = 0.40, statements = 0.30 }` | **0** | `statements` is accepted |
| `{ lines = 0.35, functions = 0.40 }` | 1 | correctly rejects — above 32.81 |
| `{ lines = 0.30, functions = 0.45 }` | 1 | correctly rejects — above 42.86 |

An unspecified metric evidently defaults to 100%. `{ statements = 0.85 }` alone
is not "statements coverage is broken" — it is `lines` and `functions` both
defaulting to 1.0.

### Rule 3 — an object of *only* unrecognised keys silently disables the threshold

Measured on the library, under the same config as Rules 1–2:

| `coverageThreshold` | Exit | Enforced? |
| --- | --- | --- |
| `{ line = 0.95 }` (singular) | 0 | ❌ **silently ignored** |
| `{ line = 0.95, function = 0.95 }` | 0 | ❌ **silently ignored** |
| `{ nonsense = 0.95 }` | 0 | ❌ **silently ignored** |
| `{ lines = 0.95 }` (plural) | 1 | ✅ |

Note the trap, and note that it points the *opposite way* to Rule 2: an object
with one recognised key over-fires (Rule 2 — the other metric defaults to 100%),
while an object with no recognised key at all under-fires. A `line`/`lines` typo
therefore produces a repository that believes it is gated and is not — and
because nothing is printed either way, neither mistake announces itself.

### Rule 4 — the scalar and section forms both work

`coverageThreshold = 0.30` (scalar) applies one number to all metrics.
`[test.coverageThreshold]` as a TOML section with `lines = 0.99` also enforces
correctly. The inline object form in §3.1 is recommended for explicitness.

### Verification ritual

Because every failure mode here is silent, any threshold change must be verified
in both directions: set it deliberately high, confirm a red build; set it to the
proposed value, confirm green. Ten seconds, and it is the only way to know the
gate exists.

---

## 5. Sequencing (thresholds depend on denominators)

The CLI **cannot** be gated until §3.2 lands, and even then `data.ts` and
`file-loading.ts` are at 0.00% functions, so any per-file functions floor above
zero is red on arrival.

| Step | Action | Gate |
| --- | --- | --- |
| 1 | Library ignore patterns + `{ lines = 0.30, functions = 0.40 }` | ✅ gate now (see caveat) |
| 2 | CLI preload + ignore patterns; publish the honest 50/66 baseline | ❌ no gate yet |
| 3 | Land CLI tests (see `proposal-cli-test-coverage.md`) | — |
| 4 | Add a CLI per-file floor just under its new weakest file | ✅ gate then |
| 5 | Ratchet both upward as tests land; never lower a floor to make a build pass | — |

**Caveat on step 1:** the proposed floor sits just *below* the current worst file
(0.30/0.40 against `reference-walker.ts`'s 0.3281/0.4286), so on day one it
forbids nothing that is not already true. That is the deliberately conservative
choice — it makes the gate exist and prevents backsliding, but it is emphatically
not an "the library is 85% covered" guarantee. The guarantee arrives only as
step 5 ratchets it upward.

The value of step 2 is **visibility, not coverage**. The preload makes the gap
measurable; it does not close it. Closing it is test-writing work, and that work
already has a proposal.

Because the floor is per-file, the ratchet has a pleasant property: it tracks the
worst module in the package. Raising it from 0.30 to 0.60 is a concrete
instruction to go and test `reference-walker.ts`, not a diffuse request for
"more coverage".

---

## 6. Limitations of `bun test --coverage`

Worth knowing before anyone writes an acceptance criterion against it.

1. **No branch coverage.** The lcov output contains `FN`/`FNF`/`FNH`, `DA`,
   `LF`/`LH` records and **zero `BR*` records** — verified by grep. Only function
   and line coverage exist. Any "80% branch coverage" target is unsatisfiable
   with this toolchain.
2. **Silent threshold failures.** No message, no file name, no metric — just
   exit 1 (§4). Budget debugging time accordingly.
3. **No global/average gate.** Per-file only (§4, Rule 1).
4. **No monorepo-aggregate number.** Two packages, two runs, two `lcov.info`
   files, no merged total. A single repo-wide percentage needs an external merge
   step (Codecov, `lcov -a`).
5. **`SF:` paths are package-relative** (`SF:src/index.ts`), not repo-relative.
   Any external upload needs per-package path prefixing to render correctly.
6. **No subprocess coverage** — hence the permanent absence of `cli.ts`.
7. **`-c=<path>` is unreliable for coverage settings.** Coverage keys supplied
   via an out-of-tree config with `bun -c=...` were ignored, while the same keys
   in the package's own `bunfig.toml` took effect. Configure coverage in the real
   `bunfig.toml`; do not rely on `-c`.

### How to read the report

`0.00% Funcs` alongside a non-zero `% Lines` means **"the module was loaded but
none of its functions were ever called."** The line percentage is counting
top-level declarations executing at import time. `src/index.ts` at
`0.00 / 22.22` is exactly this: imports and module-scope `commander` setup run,
`main()` and every helper never do.

---

## 7. Relationship to `proposal-cli-test-coverage.md`

That proposal is about **writing CLI tests**; this one is about **measuring what
they cover**. They are complements: §3.2 here makes the gap that proposal
describes visible as a number, and step 4 of §5 here is what locks in its gains.

That document predates the Bun/tsgo migration and several statements are now
incorrect. Rather than edit it, the corrections are recorded here:

| Location | Stale claim | Correction |
| --- | --- | --- |
| §2 "Why now" (~line 63) | "CI currently runs `yarn test` via bolt (`bolt ws test`)" | CI runs `bun run test`, fanning out via `bun run --filter '*'` |
| Phase 5.1 | Prescribes `jest.config.js` with `collectCoverageFrom` and a `coverageThreshold.global` block | No Jest in this repo. Bun's `coveragePathIgnorePatterns` replaces `collectCoverageFrom`'s *exclusions*; Bun has **no include-list equivalent** (hence §3.2's preload) and **no global threshold at all** (§4, Rule 1) |
| Phase 5.1 / §8 | 80% **branches** threshold | Unachievable — Bun emits no branch data (§6.1). Drop the criterion |
| Phase 5.1 / §8 | "80% statements / branches / functions / lines" globally | Only per-file `lines` and `functions` exist, and they are capped by the weakest file |
| Phase 4 | `"pretest": "tsc --project ."` | Would be `tsgo --project .`; also the CLI's `prepare` already builds the sibling library first |
| Open Question 1 | "Coverage tool choice… Babel-Jest/Istanbul" | Resolved: Bun's built-in profiler, already enabled |
| Open Question 4 | "Should the library also get a coverage threshold?" | Yes — §3.1, and it can gate immediately |
| §8 acceptance | "`yarn test` fails locally and in CI if any drop below" | `bun run test` — and this is confirmed to work (§3.4) |

Its Open Question 2 ("should `data.ts` count?") is worth re-answering with the
measurement in hand: the CLI's `data.ts` reports 0.00% funcs / 66.67% lines. It
is mostly type declarations plus `DEFAULT_INDENT`. Recommendation: **leave it
in.** It is 1 of 8 reported files, excluding it is a thumb on the scale, and
66.67% lines is not so low that it distorts the total. It does, however, mean a
CLI `functions` floor must stay at 0 until `data.ts` is either exercised or
excluded — a decision to revisit at step 4.

---

## 8. Effort Estimate

| Task | Effort |
| --- | --- |
| Library `bunfig.toml` — ignore patterns, lcov reporter, per-file floor | 20 min |
| CLI `bunfig.toml` + `_coverage-preload.ts` | 45 min |
| `.gitignore` fix (`coverage/` unanchored); optional CI artifact upload | 15 min |
| Verify both thresholds fire and clear (the §4 ritual, both packages) | 20 min |
| AGENTS.md — preload maintenance rule, per-file semantics, silent-failure traps | 45 min |
| **Total** | **≈ 2.5–3 hours** |

Followed later by the separately proposed (~2.5 day) work of writing CLI tests,
after which step 4 of §5 adds the CLI floor.

**Value:** 4 / **Effort:** 1 / **ROI:** high. The cost is a config change plus a
five-line file; the return is that the number in CI stops being decorative.

---

## 9. Acceptance Criteria

- [ ] `packages/openapi-merge/bunfig.toml` sets `coveragePathIgnorePatterns`,
      `coverageReporter = ["text", "lcov"]`, and
      `coverageThreshold = { lines = 0.30, functions = 0.40 }` (both keys — §4
      Rule 2).
- [ ] `packages/openapi-merge-cli/src/__tests__/_coverage-preload.ts` exists, is
      referenced from `bunfig.toml`'s `preload`, and carries the comment
      explaining why `cli.ts` and `fix-schema.ts` are excluded.
- [ ] The CLI coverage report lists **8 of 10** source files — all but `cli.ts`
      and `fix-schema.ts` — and no `../openapi-merge/dist/*.js` entries.
- [ ] The library report lists 10 source files and no `__tests__/` entries.
- [ ] `src/configuration.schema.json` is byte-identical after a test run
      (proves `fix-schema.ts` is not being executed by the preload).
- [ ] For each package, the §4 ritual is performed: a deliberately high threshold
      makes `bun run test` exit non-zero **from the repository root**, and the
      proposed value exits zero. Confirms CI gating without touching
      `branch-test.yml`.
- [ ] Coverage output is gitignored — `git check-ignore -v
      packages/openapi-merge/coverage packages/openapi-merge-cli/coverage`,
      **run from the repository root**, reports a match for both. (Already
      satisfied by the per-package `.gitignore` files; §3.3.)
- [ ] AGENTS.md documents: (a) add a line to `_coverage-preload.ts` for every new
      CLI source file, (b) thresholds are per-file and capped by the weakest
      file, (c) both `lines` and `functions` are mandatory and typos fail
      silently in both directions, (d) `cli.ts` and `fix-schema.ts` are
      intentionally uncovered, (e) Bun provides no branch coverage.
- [ ] Both suites still pass: library 49/49, CLI 27/27.
- [ ] No new ESLint warnings (the preload file lives under `src/`, so it is
      linted).

---

## 10. Summary

Coverage is already collected on every test run in both packages; it is simply
not trustworthy and not enforced. The library's number needs its test helpers
excluded — and is separately overstated by ~24 points because Bun's total is an
unweighted mean (Defect D, A4.3); its true line coverage is ~65%, not ~89%. The
CLI's number measures an accidental subset of
its own source and hides the fact that its 189-line orchestrator has **zero**
function coverage — a curated preload makes that visible, and a `**/dist/**`
ignore pattern keeps the sibling library's compiled output out of the total.

The one genuine surprise is that Bun's `coverageThreshold` is a per-file floor
rather than a package average, fails silently in two opposite directions
depending on how you misconfigure it, and prints nothing when it trips. §4
documents the semantics so nobody has to bisect them again.

The whole change is configuration plus one five-line file, needs no CI edits, and
costs about three hours. What it buys is a coverage number that goes down when
the tests get worse.

---

# Addendum — Evaluating Alternative Coverage Tools

**Added:** 2026-07-25
**Question asked:** are there other code coverage libraries that would be a
better fit and solve most of the problems in §2, §4 and §6?

## A1. The short answer, and why the question has an unusual shape

**At the library layer, there are no alternatives — the choice of coverage tool
is welded to the choice of *test runner*.**

Every mainstream Node coverage library (`c8`, `nyc`, `monocart-coverage-reports`)
is a *consumer* of V8 coverage JSON, which Node emits when `NODE_V8_COVERAGE` is
set. Bun does not emit it. Measured:

```
$ NODE_V8_COVERAGE=./v8cov bun test
$ ls ./v8cov
(empty)
```

Nothing is written, so there is nothing for those tools to read. `c8`, `nyc` and
`monocart` cannot wrap `bun test` — this is structural, not a matter of
configuration or a missing flag. The upstream tracking issue
([oven-sh/bun#3158](https://github.com/oven-sh/bun/issues/3158)) and the wider
2026 write-ups agree: if coverage reporting matters, the practical answer is a
Node-based runner.

So "which coverage library?" collapses into "which test runner?", and that turns
a tooling question into a migration question.

## A2. The finding that makes a migration cheap

The test suites are **runner-agnostic to an unusual degree**. Measured across
every file in `packages/*/src/__tests__/`:

| Property | Finding |
| --- | --- |
| Framework imports (`bun:test`, `@jest/globals`, `vitest`) | **none** — the tests rely purely on globals |
| Mocks / spies (`mock()`, `spyOn`, `jest.*`, `vi.*`) | **none** |
| Lifecycle hooks (`beforeEach`, `afterAll`, …) | **none** at the time of writing — `beforeEach`/`afterEach` were introduced later by `proposal-closing-coverage-gaps.md`. Portability is unaffected: they are globals in every Jest-compatible runner. |
| Snapshot assertions | **none** |
| Distinct matchers used | **6**: `toBe`, `toBeInstanceOf`, `toBeUndefined`, `toContain`, `toEqual`, `toThrow` |

This is a legacy of the Jest era — `@types/jest` is still in both packages'
`devDependencies` and `"types": ["jest"]` is still in both `tsconfig.json`s. The
tests were never rewritten for `bun:test`; they simply kept working because Bun
implements the Jest globals.

Consequence: **the 76 tests would run unmodified under any Jest-compatible
runner.** That is not speculation — see A4, where all 49 library tests pass under
Vitest with zero source edits.

## A3. Does a runner switch undo the Bun/tsgo migration?

No — and this is worth stating precisely, because it is the obvious objection.

Per `bun-tsgo-migration-build-timings.md`, the ~5–6x win came from **`tsgo`
(the compiler) and `bun install` (the package manager)**:

| Step | Speedup | Depends on the test runner? |
| --- | --- | --- |
| Combined build (`tsgo` vs `tsc`) | ~5–6x | ❌ no |
| Dependency install (`bun install` vs `yarn`) | ~5–8x | ❌ no |
| Cold bootstrap | ~5–7x | ❌ no |

None of it is attributable to `bun:test`. Test wall time is not in that document
at all, because at 132ms (library) and 52ms (CLI) it was never the bottleneck.
Vitest runs the same 49 tests in ~245ms. **Changing the test runner leaves every
measured benefit of the migration intact** — `tsgo` still compiles, `bun install`
still installs, `bun` remains the package manager and script runner.

The real cost of a switch is not speed. It is two new devDependencies, a config
file per package, and the loss of "one tool does everything."

## A4. Vitest + `@vitest/coverage-v8` — measured, not assumed

Tested two ways: a synthetic probe isolating the exact behaviours §2 and §3.2
depend on, and a scratch copy of the real `openapi-merge` library package. The
repo itself was never modified (verified: `git status --porcelain` clean, `bun.lock`
untouched).

### A4.1 The load-bearing question: never-imported files

§3.2 of this proposal builds an entire preload apparatus around Bun's inability
to see unloaded modules, and declares `cli.ts` and `fix-schema.ts` *permanently*
unmeasurable because importing them executes them.

Vitest's `coverage.all: true` was tested against a probe containing (a) a module
imported by a test, (b) a module no test imports, and (c) a module that writes a
file at module scope — a deliberate stand-in for `fix-schema.ts`:

```
File               | % Stmts | % Branch | % Funcs | % Lines
 loaded.ts         |      50 |      100 |      50 |      50
 never-imported.ts |       0 |      100 |       0 |       0   <- reported, no preload
 side-effect.ts    |       0 |      100 |     100 |       0   <- reported, NOT executed
```

The marker file that `side-effect.ts` writes on import **was not created**.
Vitest statically includes never-imported files in the report *without executing
them*.

**This collapses §3.2 entirely.** No `_coverage-preload.ts`, no hand-curated
import list to maintain, no risk of rewriting `configuration.schema.json`, and
**no permanent exclusions** — `cli.ts` and `fix-schema.ts` both become
measurable, at an honest 0%.

### A4.2 Both real suites, unmodified

Scratch copies of each package's `src`, one `vitest.config.ts` each, no source
edits, real dependencies symlinked from the repo:

```
openapi-merge      Test Files  8 passed (8)    Tests  49 passed (49)   245ms
openapi-merge-cli  Test Files  2 passed (2)    Tests  27 passed (27)   154ms
```

All 76 tests pass. The only config line the source shape demands is
`test: { globals: true }` — Vitest does not expose `describe`/`it`/`expect` as
globals by default, and these tests rely on them. That is a config setting, not a
source change.

The CLI run specifically exercises two constructs the library does not have, both
of which are load-bearing for the claim in A4.4 and both of which worked without
special handling:

- `src/index.ts:5` — a bare CommonJS `const pjson = require('../package.json')`
  inside an ES module;
- `src/index.ts:9` — a deep import into the sibling's compiled output,
  `from "openapi-merge/dist/data"`.

### A4.3 A fourth defect this uncovered: Bun's total is an unweighted mean

Vitest reports the library at **64.74% lines**. Bun reports **88.96%**. Same
tests, same source. The discrepancy is not a rounding difference or a metric
definition quibble — it is arithmetic:

```
Bun per-file line %: 95.71 100 90.91 93.55 100 100 100 80.48 32.81 96.15
  unweighted mean  = 88.96   <-- exactly what Bun prints as "All files"
Vitest  = 292 covered / 451 total lines = 64.74
```

**Bun's "All files" row is the unweighted arithmetic mean of the per-file
percentages, not covered-lines ÷ total-lines.** Every file counts equally
regardless of size, so `data.ts` (1 line, 100%) carries the same weight as
`reference-walker.ts` (160 lines, 28%) — the single largest file in the package
and by far the least covered.

This is not a one-metric coincidence. The same unweighted mean reproduces every
"All files" figure quoted anywhere in this proposal:

| Reported by Bun | Per-file values | Unweighted mean |
| --- | --- | --- |
| Library lines, 88.96 | 95.71 100 90.91 93.55 100 100 100 80.48 32.81 96.15 | **88.96** ✅ |
| Library funcs, 88.40 | 80 100 100 100 100 100 100 61.11 42.86 100 | **88.40** ✅ |
| CLI lines, 66.09 (§3.2) | 66.67 100 100 18.18 83.33 22.22 38.30 100 | **66.09** ✅ |
| CLI funcs, 50.00 (§3.2) | 0 100 100 0 66.67 0 33.33 100 | **50.00** ✅ |

**Defect D therefore affects both packages, on both metrics.** It biases the
number upward exactly as a codebase accumulates small fully-covered modules
alongside large poorly-covered ones — which is precisely this repo's shape.
`reference-walker.ts` (160 lines, 28%) and `index.ts` (189 lines, 22%) are the
two largest source files in their respective packages and the two least covered,
yet each carries one-tenth of the weight.

Corrected figures: the library is **~65% lines, not ~89%**; the CLI is
**~21% lines, not ~61%** (A4.4).

**What Defect D does *not* invalidate:** §3.1's threshold recommendation. Bun's
`coverageThreshold` is a per-file floor (§4, Rule 1) and never consults the
"All files" row, so `{ lines = 0.30, functions = 0.40 }` remains correct and
correctly calibrated. Defect D corrupts the *headline*, not the *gate*.

### A4.4 The real CLI package under Vitest — §3.2 collapses in practice

A4.1 proved the safety property on a synthetic probe. Run against the **real**
`openapi-merge-cli` source, with no preload module and `coverage.all: true`:

```
File               | % Stmts | % Branch | % Funcs | % Lines
All files          |   20.78 |    38.46 |   17.14 |   21.02
 cli.ts            |       0 |      100 |       0 |       0   <- "permanently absent" under Bun
 data.ts           |      50 |      100 |       0 |      50
 ...-for-schema.ts |       0 |      100 |       0 |       0
 exit-codes.ts     |       0 |      100 |       0 |       0
 file-loading.ts   |       0 |        0 |       0 |       0
 fix-schema.ts     |       0 |      100 |     100 |       0   <- "permanently absent" under Bun
 formatting.ts     |      70 |    77.77 |   66.66 |      70
 index.ts          |       0 |        0 |       0 |       0
 ...nfiguration.ts |   30.76 |       50 |   33.33 |   30.76
 ...-resolution.ts |     100 |    85.71 |     100 |     100
```

Four results, all verified:

1. **All ten files appear**, including `cli.ts` and `fix-schema.ts`. §3.2's two
   permanent exclusions are permanent *under Bun only*.
2. **`src/configuration.schema.json` is byte-identical after the run**
   (`diff -q` against the repo's copy). `fix-schema.ts` was measured without
   being executed — the exact safety property §3.2 says is impossible, confirmed
   on the real file rather than a stand-in.
3. **No `../openapi-merge/dist/*.js` rows.** `coverage.include: ['src/**/*.ts']`
   scopes the sibling's compiled output out *structurally*, so **Defect C
   disappears by construction** — no ignore pattern needed.
4. **The CLI's true coverage is 21.02% lines / 17.14% funcs**, against the
   61.30% Bun reports today and the 66.09% §3.2 arrives at. The gap is Defect D
   plus the two missing files: Bun's unweighted mean over the same ten files
   would read 25.08%.

`index.ts` at 0% across all four metrics is the honest statement of where this
repo's CLI testing actually stands.

### A4.5 Bun's §4 and §6 limitations, re-tested under Vitest

| Limitation (this proposal) | Bun | Vitest | Verified by |
| --- | --- | --- | --- |
| Branch coverage (§6.1) | ❌ none | ✅ `% Branch` column; `thresholds.branches: 60` passes, `65` fails | measured |
| Global threshold (§4 Rule 1) | ❌ per-file only | ✅ global by default — `lines: 60` passes, `70` fails against a 64.74% global | measured |
| Per-file threshold | ✅ only mode | ✅ opt-in via `perFile: true` — `lines: 60` then fails | measured |
| Silent threshold failure (§4, §6.2) | ❌ nothing printed | ✅ `ERROR: Coverage for lines (64.74%) does not meet global threshold (70%)` | measured |
| Partial/typo'd threshold keys (§4 Rules 2–3) | ❌ two silent failure modes | ✅ typed config, no such traps | — |
| Unloaded files (§2.1) | ❌ invisible | ✅ `all: true`, no execution | measured |
| Reporters (§6) | `text`, `lcov` only | `text`, `text-summary`, `json`, `json-summary`, `lcov`, `html`, `cobertura` | measured |
| Weighted total (A4.3) | ❌ unweighted mean | ✅ covered ÷ total | measured |
| Monorepo aggregate (§6.4) | ❌ none | ⚠️ still per-project; needs a workspace config or lcov merge | — |

Every §4 footgun and five of the seven §6 limitations are resolved.

## A5. The options, ranked

| # | Option | Verdict |
| --- | --- | --- |
| **A** | **Bun as-is** (§1–§10) | Baseline. Cheapest. Keeps every defect in §2/§4/§6 plus Defect D. |
| **B** | **Bun + lcov post-processing** | Keeps Bun entirely; `genhtml` renders each package's `lcov.info` as HTML, closing the reporter gap. A repo-wide merge via `lcov -a` needs a path-rewrite first — see B1 below. Additive to §3, no runner change. Does **not** fix the denominator, branch data, thresholds, or Defect D. |
| **C** | **Vitest + `@vitest/coverage-v8`** | The only option that fixes §2.1, §4, §6.1–6.3 and Defect D. Costs 2 devDeps + a config file per package. Tests need no edits. |
| **D** | `node:test` + `--experimental-test-coverage` | **Disqualified.** `node:test` provides no `expect` at all (verified: `typeof globalThis.expect === 'undefined'` under `node --test`). All 55 assertions would have to be rewritten as `node:assert` calls — a large, purely mechanical diff with real regression risk. |
| **E** | Jest + `nyc` | **Rejected by history.** The repo deliberately migrated off Jest three commits ago (`fe83568`). |
| **F** | `c8` / `nyc` / `monocart` wrapping `bun test` | **Impossible.** Bun emits no `NODE_V8_COVERAGE` output (A1). |

### B1. Option B's aggregate needs a path rewrite first

Naively running `lcov -a packages/openapi-merge/coverage/lcov.info -a
packages/openapi-merge-cli/coverage/lcov.info` **does not work**, for a reason
already documented in §6.5: Bun writes package-relative `SF:` paths
(`SF:src/index.ts`). Both packages contain `src/index.ts` *and* `src/data.ts` —
verified — so the merge would silently combine records for four unrelated files
into two.

The `SF:` lines must be prefixed before merging:

```bash
sed 's|^SF:|SF:packages/openapi-merge/|'     packages/openapi-merge/coverage/lcov.info     > /tmp/lib.info
sed 's|^SF:|SF:packages/openapi-merge-cli/|' packages/openapi-merge-cli/coverage/lcov.info > /tmp/cli.info
lcov -a /tmp/lib.info -a /tmp/cli.info -o /tmp/all.info
genhtml /tmp/all.info -o coverage-html
```

Two further caveats: `lcov`/`genhtml` are **not installed on this machine**
(`which lcov` → not found; they ship via `brew install lcov`), so option B adds a
system-level dependency that CI would also need. And the merged total, being
derived from Bun's own `DA` records, is at least *weighted* correctly — unlike
Bun's own "All files" row (Defect D). That makes B a partial fix for Defect D as
a side effect, which is worth knowing but is a roundabout way to get a number
Vitest prints directly.

## A6. Recommendation

**Ship §1–§10 as written (A), with option B (plus the B1 path rewrite) if a
single repo-wide number is ever wanted.** The preference for staying on Bun is
well-founded: `bun:test` is fast, zero-config, already wired into CI, and the
proposal's changes cost ~3 hours against Vitest's larger surface area.

This recommendation trades capability for simplicity, and it is worth being
explicit about what is being given up: C would delete the `_coverage-preload.ts`
maintenance burden, remove both permanent exclusions, fix Defects C and D, and
add branch coverage — for two devDependencies, one config file per package, and
zero test-file edits. A is still the right call *because* the preference for a
single toolchain is a legitimate engineering value and the current gaps are
tolerable, not because C is weak. If that calculus changes, §A6.3 lists the
triggers.

But adopt three corrections from this addendum regardless of runner:

1. **Add Defect D (A4.3) to §2.** It affects **both packages on both metrics** —
   library ~65% lines (not ~89%), CLI ~21% lines (not ~61%). Every "All files"
   figure in §1–§10 is an unweighted mean. This is independent of tooling; it is
   simply what Bun's number means. Note it does *not* affect §3.1's per-file
   thresholds, which never consult the total.
2. **Soften §3.2's "permanently absent" language** to *"permanently absent under
   Bun."* `cli.ts` and `fix-schema.ts` are not intrinsically unmeasurable; they
   are unmeasurable by a runtime-instrumented profiler. A4.4 measures both under
   Vitest, with `configuration.schema.json` left byte-identical.
3. **Record the migration trigger (§A6.3).** Adopt Vitest if any of these becomes a
   requirement, because Bun cannot provide them at any price:
   - branch coverage is needed (e.g. to satisfy `proposal-cli-test-coverage.md`'s
     80%-branches criterion, currently unsatisfiable — see §7);
   - a **global** coverage gate is needed rather than a per-file floor;
   - an HTML or Cobertura report is needed for CI surfacing;
   - maintaining `_coverage-preload.ts` by hand starts causing drift, i.e.
     someone adds a CLI source file and forgets the import line.

The migration path is genuinely short and should be recorded as such: add
`vitest` + `@vitest/coverage-v8`, add a `vitest.config.ts` per package with
`globals: true` and `coverage.all: true`, change two `test` scripts, delete
`_coverage-preload.ts`. **The test files themselves do not change** (A2, A4.2).
That is the whole reason this stays a cheap option rather than a rewrite — and it
is worth re-verifying that property before relying on it, since it erodes the
moment anyone uses a Bun-specific API such as `mock()` or `bun:test`'s
`spyOn`.

## A7. Sources

- [oven-sh/bun#3158 — Support test coverage reporters in `bun test`](https://github.com/oven-sh/bun/issues/3158)
- [oven-sh/bun#17867 — Coverage instrumentation for child processes](https://github.com/oven-sh/bun/issues/17867)
- [oven-sh/bun#28620 — No coverage info when using `node:test`](https://github.com/oven-sh/bun/issues/28620)
- [c8 — coverage via Node's built-in V8 output](https://github.com/bcoe/c8)
- [monocart-coverage-reports](https://www.npmjs.com/package/monocart-coverage-reports)
- [Bun Compatibility in 2026](https://dev.to/alexcloudstar/bun-compatibility-in-2026-what-actually-works-what-does-not-and-when-to-switch-23eb)

All behavioural claims above were verified locally against `bun 1.3.14`,
`node v25.5.0` and Vitest in a scratch directory; the search results are cited
only for upstream status, not for behaviour.
