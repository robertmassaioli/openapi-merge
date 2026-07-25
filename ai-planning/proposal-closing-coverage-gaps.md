# Implementation Proposal: Closing the Measured Test-Coverage Gaps

**Status:** ✅ Implemented — see §10 for measured results
**Type:** Test coverage / quality
**Scope:** `packages/openapi-merge`, `packages/openapi-merge-cli`
**Date:** 2026-07-25
**Branch:** `feature/improve-test-coverage`, based on `feature/code-coverage-config` (a6e470c)
**Supersedes:** `ai-planning/proposal-cli-test-coverage.md` (see §8)

---

## 0. TL;DR

`proposal-code-coverage.md` made the coverage numbers honest. This proposal
uses them: it takes the per-file gaps that measurement exposed and closes the
ones worth closing, in descending order of lines-uncovered.

Five targets, ~200 new tests' worth of surface:

| # | Target | Now (funcs / lines) | Why it is first |
| --- | --- | --- | --- |
| 1 | CLI `index.ts` | **0.00% / 22.22%** | 189 lines. The entire `main()` flow — config → load → merge → write. Zero functions ever called. |
| 2 | Library `reference-walker.ts` | 42.86% / 32.81% | 160 lines, the library's largest and least-covered file. Pure functions, no fixtures, no I/O. |
| 3 | Library `paths-and-components.ts` | 61.11% / 80.48% | Uncovered 213–275 is seven component-type branches; only `schemas` is exercised today. |
| 4 | CLI `load-configuration.ts` | 33.33% / 38.30% | Ajv validation and file-error paths entirely untested. |
| 5 | CLI `file-loading.ts` | **0.00% / 18.18%** | Small, and one of three files blocking a CLI threshold. |

**The deliverable is not just tests.** Two things must land with them:

- a **prerequisite refactor** to `cli/src/index.ts` (§3), without which
  integration tests are not independent — verified, not hypothesised;
- **raised thresholds** in both `bunfig.toml`s (§6), because the floors
  committed in a6e470c were calibrated to today's worst files and go stale the
  moment this work lands.

---

## 1. Baseline (weighted, from `coverage/lcov.info`)

Bun's `All files` row is an unweighted mean of per-file percentages
(`proposal-code-coverage.md` §2.4), so it is useless for tracking progress.
All figures here are computed from the `LF`/`LH`/`FNF`/`FNH` records in each
package's `lcov.info` — i.e. covered ÷ total:

| Package | Lines | Functions |
| --- | --- | --- |
| `openapi-merge` | 505/726 — **69.56%** | 52/69 — **75.36%** |
| `openapi-merge-cli` | 229/408 — **56.13%** | 8/28 — **28.57%** |

Targets are stated per-file below rather than as a package average, for the same
reason.

## 2. What is missing, precisely

Taken from Bun's per-file uncovered-line lists, not from guesswork.

### 2.1 CLI `index.ts` — the whole orchestrator

`main()` is exported and reachable. Everything else in the file is private and
only testable *through* `main()`: `loadOasForInput`, `convertInputs`,
`isYamlExtension`, `dumpAsYaml`, `writeOutput`, `LogWithMillisDiff`.

Uncovered paths worth a test each:

- config load failure → `ExitCode.ErrorLoadingConfig` (1)
- input load failure (missing file, HTTP 404) → `ErrorLoadingInputs` (2)
- merge conflict (duplicate `operationId`) → `ErrorMerging` (3)
- output escaping `outputRoot` → `ErrorUnsafePath` (5)
- `--restrict-output-to` overriding config `outputRoot`
- happy path: single input, two disjoint inputs, `pathModification.prepend`
- `inputURL` inputs (in-process HTTP server, not a `fetch` stub)
- JSON vs YAML output selection by extension (`isYamlExtension`, `dumpAsYaml`)
- `formatting.indent` — spaces width N, and tabs into `.json`
- `dispute` and legacy `disputePrefix` passthrough

### 2.2 Library `reference-walker.ts` — seven exported walkers

Every exported function takes a node and a `Modify` callback and rewrites
`$ref` strings in place. Uncovered: `walkSchemaReferences` recursion
(`not`/`allOf`/`oneOf`/`anyOf`/`items`/`properties`/`additionalProperties`),
`walkParameterReferences` (all three arms), `walkRequestBodyReferences`,
`walkHeaderReferences` (all three arms), `walkLinkReferences`,
`walkResponseReferences` (headers/content/links), `walkCallbackReferences`
(including its mutual recursion with `walkPathItemReferences`),
`walkComponentReferences` (all eight component maps), `walkPathReferences`,
`walkAllReferences`.

No fixtures, no I/O, no mocking. This is the cheapest coverage in the repo.

### 2.3 Library `paths-and-components.ts` — component-type branches

Lines 213–275 are seven near-identical blocks: `responses`, `parameters`,
`examples`, `requestBodies`, `headers`, `links`, `callbacks`. Each is reachable
by calling `merge()` with two inputs that both declare that component type with
conflicting names. Also uncovered: the `securitySchemes` first-wins branch (256)
and the "more than one matching key" error at 316.

### 2.4 CLI `load-configuration.ts` and `file-loading.ts`

`validateConfiguration` (36–56): Ajv rejection, `noExtraProps` rejection,
semantic-check rejection, unparseable input. `loadConfiguration` (63–71):
default `openapi-merge.json` path, missing file, unreadable file.

`file-loading.ts` (5, 10–18, 22, 26, 30–44): `readFileAsString` success and
ENOENT; `readYamlOrJSON` JSON path, YAML fallback, and the
`JsonOrYamlParseError` carrying both messages.

## 3. Prerequisite refactor (verified necessary)

`cli/src/index.ts:21` constructs `const program = new Command()` at **module
scope**, and `main()` calls `program.parse(process.argv)`. Commander v5 stores
parsed options on that singleton and **does not clear options absent from a
later parse**.

Measured — two sequential `main()` calls, the second with no `-c`:

```
run1 (with -c cfgA.json): exit=1
run2 (no -c):             exit=1
errors from run2:         "data.inputs should NOT have fewer than 1 items"
```

Run 2 should have failed with *"Could not find or read 'openapi-merge.json'"* —
instead it re-validated run 1's config. `program.config` leaked across calls.

Left as-is, every integration test would be order-coupled, and a test omitting
`--restrict-output-to` would silently inherit it from an earlier test. Since
`program` is not exported, tests cannot reset it either.

**Fix:** move construction and option registration into a `buildProgram()`
factory called inside `main()`. This is a ~10-line change that removes shared
mutable module state, is invisible to the CLI's real single-invocation
behaviour, and fixes a latent bug — `main()` is exported, so any consumer
calling it twice today gets the same corruption.

This is a production-code change made for testability. It is called out here
rather than smuggled into a test commit.

## 4. Approach and constraints

**Tests stay framework-agnostic.** `proposal-code-coverage.md` §A2 records that
no test file imports a test framework, and that property is what makes a future
Vitest migration cheap. So:

- stub `process.exit` / `console.*` by **plain assignment with save-restore**,
  never `bun:test`'s `mock()` or `spyOn`;
- the `process.exit` stub must **throw** a sentinel. The real function never
  returns, and `main()` contains `process.exit(...); return;` pairs that would
  keep executing under a non-throwing stub.

`beforeEach`/`afterEach` will be introduced. They are globals in every
Jest-compatible runner, so portability holds — but §A2's "Lifecycle hooks:
none" row becomes stale and should be updated.

**No filesystem or network mocking.** Real temp dirs via `fs.mkdtempSync`; an
in-process `http.createServer` on `127.0.0.1:0` for `inputURL`. Consistent with
the superseded proposal's non-goals, which were sound.

**Absolute paths, never `process.chdir()`.** `basePath` derives from
`path.dirname(program.config)`, so absolute `-c` paths make resolution
predictable without juggling cwd — another process global.

## 5. Two files that earn no coverage credit

`cli.ts` and `fix-schema.ts` are excluded from `_coverage-preload.ts` by design
and are unmeasurable in-process (`proposal-code-coverage.md` §3.2).

Subprocess smoke tests for `cli.ts` are still worth writing for **correctness** —
the shebang, commander wiring, real exit codes as a shell sees them. But they
will **not move any number**: Bun collects no coverage from subprocesses. The
CLI report will remain at 8 of 10 files no matter how many are added. Stated
here so nobody expects otherwise.

`fix-schema.ts` is 11 lines of module-scope script; the honest options are to
leave it uncovered or extract its body into a testable exported function. This
proposal leaves it uncovered — the extraction is not worth a production change.

## 6. Ratchet the thresholds (part of the deliverable)

The floors committed in a6e470c were calibrated to today's weakest files. They
go stale the moment this work lands, and `proposal-code-coverage.md` §5 steps
4–5 make raising them part of the plan.

| Package | Now | After |
| --- | --- | --- |
| `openapi-merge` | `{ lines = 0.30, functions = 0.40 }` | just under the new weakest file |
| `openapi-merge-cli` | *(none)* | its **first** floor |

The CLI has no threshold today only because `data.ts`, `file-loading.ts` and
`index.ts` all sit at **0.00% functions**, and Bun's floor is per-file. Getting
one function called in each unlocks a CLI gate — a concrete, checkable goal.

Both changes must be verified with the §4 ritual from `proposal-code-coverage.md`:
set deliberately high → confirm red from the repo root; set to the real value →
confirm green. Both failure modes are silent, so this is not optional.

## 7. Non-goals

- Rewriting existing passing tests.
- Chasing 100%. `reference-walker.ts`'s `walkLinkReferences` has a `TODO`
  non-reference branch that is genuinely empty; covering it proves nothing.
- Testing `data.ts`'s type declarations beyond the runtime constants they carry.
- Any Vitest migration (`proposal-code-coverage.md` §A6.3 lists the triggers).
- Extracting `fix-schema.ts` for coverage's sake (§5).

## 8. Relationship to `proposal-cli-test-coverage.md`

**This proposal supersedes it.** That document was written pre-Bun/tsgo and its
corrections are already tabulated in `proposal-code-coverage.md` §7 — Jest
config, `collectCoverageFrom`, bolt/yarn CI, and an 80%-branches criterion that
is unsatisfiable because Bun emits no branch data.

Its *substance* — the scenario matrix, the temp-dir and in-process-HTTP-server
non-goals — is sound and is carried forward here. Three overlapping coverage
documents is worse than two, so that file should be marked superseded rather
than left to rot as a third source of truth.

## 9. Acceptance criteria

- [ ] `cli/src/index.ts` builds its `Command` per invocation; two sequential
      `main()` calls with different argv do not leak options (§3).
- [ ] Every `ExitCode` value is asserted by at least one test that drives
      `main()` to it.
- [ ] `reference-walker.ts` ≥ 90% lines and 100% functions.
- [ ] `paths-and-components.ts`: all seven component-type branches exercised.
- [ ] `load-configuration.ts` and `file-loading.ts` ≥ 85% lines, > 0% functions.
- [ ] CLI `index.ts` > 0% functions (it is 0.00% today).
- [ ] No CLI source file remains at 0.00% functions — unlocking §6's gate.
- [ ] Library threshold raised; CLI threshold added; both verified with the
      red-then-green ritual from the repo root.
- [ ] No test file imports a test framework (`grep` for `bun:test`, `vitest`,
      `@jest/globals` returns nothing).
- [ ] `bun run lint` clean; both suites green; `configuration.schema.json`
      byte-identical after a test run.
- [ ] Weighted before/after figures recorded in this document on completion.

---

## 10. Results (measured)

### 10.1 Weighted totals, from `coverage/lcov.info`

| Package | Lines before | Lines after | Functions before | Functions after |
| --- | --- | --- | --- | --- |
| `openapi-merge` | 69.56% | **97.39%** | 75.36% | **98.57%** |
| `openapi-merge-cli` | 56.13% | **99.46%** | 28.57% | **100.00%** |

Tests: 76 → **187** (library 49 → 108, CLI 27 → 79).

### 10.2 Per-file, the five targets

| File | Funcs before → after | Lines before → after |
| --- | --- | --- |
| CLI `index.ts` | 0.00% → **100.00%** | 22.22% → **100.00%** |
| `reference-walker.ts` | 42.86% → **100.00%** | 32.81% → **100.00%** |
| `paths-and-components.ts` | 61.11% → **100.00%** | 80.48% → **93.55%** |
| CLI `load-configuration.ts` | 33.33% → **100.00%** | 38.30% → **100.00%** |
| CLI `file-loading.ts` | 0.00% → **100.00%** | 18.18% → **100.00%** |

Two files improved beyond the plan: CLI `data.ts` (0.00% → 100.00% funcs, via the
preload plus real use in the integration tests) and `component-equivalence.ts`
(80.00% → 90.91% funcs, 95.71% → 100.00% lines).

### 10.3 Thresholds ratcheted

| Package | Before | After |
| --- | --- | --- |
| `openapi-merge` | `{ lines = 0.30, functions = 0.40 }` | `{ lines = 0.85, functions = 0.85 }` |
| `openapi-merge-cli` | *(none)* | `{ lines = 0.85, functions = 0.95 }` |

Both verified with the red-then-green ritual from the repository root: proposed
values exit 0; either package raised to 0.99 exits 1.

### 10.4 What remains uncovered, and why

Deliberate, per §7:

- `paths-and-components.ts` 67–70 and 129–132 — the `component-definition-conflict`
  and `operation-id-conflict` error returns. Both require **999** prior naming
  collisions to reach (`antiConflict < 1000`). Constructible, but the test would
  assert an anti-conflict loop bound rather than behaviour anyone relies on.
- `paths-and-components.ts` 125–126, 141, 165 — loop-exhaustion and
  error-propagation lines that only execute in the same 999-collision scenario.
- `paths-and-components.ts` 316 — the "more than one matching key" guard.
- `formatting.ts` 52 — statically unreachable. `DEFAULT_INDENT.style` is the
  literal `'spaces'`, so the fallback exists only to satisfy the compiler.
- `dispute.ts` 9, `extensions.ts` 23, `tags.ts` — minor residual branches.
- `cli.ts` and `fix-schema.ts` — unmeasurable in-process by design (§5).

### 10.5 A bug found by the new tests

`loadOasForInput` (`cli/src/index.ts`) does
`fetch(input.inputURL).then(rsp => rsp.text())` and **never checks the HTTP
status**. A 404 body such as `not found` fails `JSON.parse` but is a valid YAML
string scalar, so it parses cleanly and is cast to `SwaggerV3`. The merge then
succeeds against a string and the CLI writes `{"openapi":"3.0.3","paths":{}}` —
a spec with no `info` block — and **exits 0**.

A CI pipeline pointing at a URL that starts 404ing therefore publishes a corrupt
spec and sees success.

This was **not fixed here**: the fix is a production behaviour change, outside
this proposal's scope, and the `ErrorLoadingInputs` path is already covered by
the missing-input-file test. Two tests in `main-integration.test.ts` pin the
current behaviour with a comment marking it a known bug, so whoever adds the
status check will see them fail and can flip them to expect
`ExitCode.ErrorLoadingInputs`.

Recommended fix, for a follow-up branch:

```ts
const rsp = await fetch(input.inputURL);
if (!rsp.ok) {
  throw new Error(`HTTP ${rsp.status} ${rsp.statusText} for ${input.inputURL}`);
}
const inputContents = await rsp.text();
```

`convertInputs` already wraps `loadOasForInput` in a `try`/`catch` that turns a
throw into an `ErrorLoadingInputs` exit, so the throw is all that is needed.

**Update — fixed on `fix/input-url-http-status`.** The fix landed with a
*distinct* exit code rather than reusing `ErrorLoadingInputs`: a status failure
means the server answered and refused, which is a different remedy from an input
that could not be obtained at all. That required reshaping `InputConversionErrors`
to carry an exit code, since it previously flattened every per-input failure into
`string[]` and `main()` hardcoded a single code. The two tests pinned above are
now regression tests for the fixed behaviour.

The status is further split by responsibility, so CI can branch on
retryability: `ErrorInputUrlClientStatus` (6) for 4xx, which will fail
identically on retry; `ErrorInputUrlServerStatus` (7) for 5xx, which may not;
and `ErrorInputUrlUnexpectedStatus` (8) for anything else outside the 2xx range.
That third code is not defensive padding — ordinary redirects are followed by
`fetch` and never surface, but a `304 Not Modified` does, which is measured and
covered by a test.

### 10.6 Prerequisite refactor, as landed

`cli/src/index.ts` now builds its `Command` inside `buildProgram()`, called per
`main()` invocation. Two regression tests in `main-integration.test.ts` cover it
directly: one asserts `--restrict-output-to` does not leak into a later call,
the other that `-c` does not. Both fail against the old module-scope singleton.

One wrinkle worth recording: commander v5 exports `Command` as a *static
interface* whose type differs from `new Command()`'s instance type, so
`buildProgram()` is annotated `InstanceType<typeof Command>`. Annotating it
`Command` does not compile under `tsgo`.

### 10.7 Verify in a clean clone, not just locally

A type error in a *test* file broke CI while every local check passed. The
failure chain is worth knowing because its symptom points nowhere near its
cause:

1. `component-types.test.ts` narrowed `MergeResult` with `'errorType' in result`
   instead of the library's own `isErrorResult` guard, so `result.output` did
   not typecheck.
2. `tsgo --project .` compiles `src/` including `__tests__/`, so the **library
   build** failed.
3. The CLI's `prepare` script is
   `bun run --cwd ../openapi-merge build && bun run gen-schema && tsgo --project .`,
   so the failing library build short-circuited it and **`gen-schema` never ran**.
4. `src/configuration.schema.json` is generated and **gitignored**, so in a clean
   clone it simply did not exist.
5. Every CLI test failed with
   `Cannot find module './configuration.schema.json'` — a module-resolution
   error that looks like a packaging problem and says nothing about the type
   error three steps upstream.

None of this reproduces locally, because the generated schema and `dist/` are
already on disk from earlier runs. The check that catches it is CI's exact two
commands against a fresh clone:

```bash
git clone --branch <branch> . /tmp/probe && cd /tmp/probe
bun install --frozen-lockfile   # runs prepare -> build + gen-schema
bun run lint && bun run test
```

Note also that `bun test` transpiles rather than typechecks, so a type error in
a test file is invisible to `bun run test` and only surfaces via `bun run build`.
Run both.
