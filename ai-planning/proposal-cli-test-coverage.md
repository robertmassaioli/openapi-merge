# Implementation Proposal: Comprehensive Test Coverage for `openapi-merge-cli`

**Status:** 📝 Proposal — awaiting implementation
**Type:** Cross-cutting infrastructure / quality improvement
**Scope:** `packages/openapi-merge-cli`

---

## 0. TL;DR

The `openapi-merge` **library** has a thorough Jest suite (16 suites, 98
tests) that has caught real regressions throughout this session. The
**CLI**, by contrast, was untested at all until very recently — Jest
infrastructure was first added during the #93 fix, and today the suite
contains only 27 tests covering two helper modules (`path-resolution`
and `formatting`). The CLI is the user-facing entry point for the vast
majority of openapi-merge consumers, and the remaining 7 source files
(`cli.ts`, `index.ts`, `data.ts`, `examples-for-schema.ts`, `exit-codes.ts`,
`file-loading.ts`, `fix-schema.ts`, `load-configuration.ts`) have **zero**
test coverage.

This proposal lays out a phased plan to bring CLI test coverage up to
the same standard as the library, with concrete test files, fixture
strategy, and tooling additions. Total effort: roughly 2–3 days of
focused work.

---

## 1. Motivation

### Why test the CLI specifically?

1. **It's the public interface.** The library's 98-test suite proves
   that `merge()` is correct, but most users never call `merge()`
   directly — they install `openapi-merge-cli` from npm and run
   `openapi-merge-cli` against an `openapi-merge.json`. Every bug
   between "config file parsed" and "output file written" is invisible
   to the library suite.
2. **The CLI has accumulated non-trivial logic.** During this session
   alone the CLI grew: a configurable `outputRoot` safety knob (#93),
   a `formatting.indent` discriminated union (#114), a YAML+tabs
   semantic check, and a `--restrict-output-to` flag. Each of these
   should be covered by tests that survive future refactors.
3. **Regression hot-spots are already visible.** Looking at the issues
   we triaged: #92 (uncaught exception did not set non-zero exit code),
   #93 (leading `/` stripped), #45 (no-config-file mode), and #61
   (auth headers for `inputURL`) are all CLI-only bugs that an
   end-to-end test would have caught.
4. **Future proposals depend on this.** Every "implement #X" branch in
   the second half of the triage doc will benefit from being able to
   add a regression test in a known location with known scaffolding.

### Why now?

- The CLI Jest infrastructure (`jest.config.js`, `babel.config.js`,
  the `__tests__/` directory, a `test` script in `package.json`) is
  already in place — added during the #93 implementation. The
  marginal cost of adding the next test file is now zero.
- Two example test files already exist (`path-resolution.test.ts`,
  `formatting.test.ts`) that establish the in-house conventions
  (Jest, Babel TypeScript transform, no separate `tsconfig` for tests,
  AAA layout). New tests have a clear template to copy.
- The repository CI currently runs `yarn test` via bolt
  (`bolt ws test`) which fans out to every workspace; adding tests
  here will automatically be picked up by the existing pipeline.

---

## 2. Current Coverage Snapshot

### Library (`packages/openapi-merge`)

| Source file | Has test? | Notes |
| --- | --- | --- |
| `index.ts` | ✅ `index.test.ts` | End-to-end merge orchestration |
| `paths-and-components.ts` | ✅ `paths.test.ts`, `components.test.ts` | Two suites by concern |
| `component-equivalence.ts` | ✅ `component-equivalence.test.ts` | Added during #92 |
| `dispute.ts` | partial via `components.test.ts` | No dedicated suite |
| `info.ts` | ✅ `info.test.ts` | |
| `tags.ts` | partial via integration tests | No dedicated suite |
| `extensions.ts` | ✅ `x-tensions.test.ts` | |
| `operation-selection.ts` | partial via integration tests | |
| `reference-walker.ts` | partial via `components.test.ts` | |
| Security | ✅ `security.test.ts` | |
| External docs | ✅ `external-docs.test.ts` | |

**Total: 16 suites, 98 tests, ~95% effective coverage.**

### CLI (`packages/openapi-merge-cli`)

| Source file | LOC | Has test? | Coverage gap |
| --- | --- | --- | --- |
| `cli.ts` | ~25 | ❌ | Uncaught-exception handling, global handlers, exit codes (the #92 fix is uncovered at the CLI level) |
| `index.ts` (orchestrator) | ~200 | ❌ | The whole `main()` flow: config loading, input loading, merge invocation, output writing, exit codes |
| `data.ts` (types only) | ~220 | n/a | Pure types — no runtime to test |
| `examples-for-schema.ts` | ~10 | ❌ | The example-emission helper used by `fix-schema.ts` |
| `exit-codes.ts` | ~25 | ❌ | The `ExitCode` enum values are essentially constants but their *meaning* is contractual |
| `file-loading.ts` | ~30 | ❌ | `readFileAsString`, `readYamlOrJSON`, `JsonOrYamlParseError` — the file/YAML/JSON loader path |
| `fix-schema.ts` | ~40 | ❌ | The post-processing step over the generated JSON Schema |
| `formatting.ts` | ~55 | ✅ `formatting.test.ts` | Covered (added during #114) |
| `load-configuration.ts` | ~70 | partial via `formatting.test.ts` | Only `validateConfigurationSemantics` is tested; `loadConfiguration` itself (Ajv validation, error paths) is not |
| `path-resolution.ts` | ~80 | ✅ `path-resolution.test.ts` | Covered (added during #93) |

**Total: 2 suites, 27 tests, ~15% effective coverage.**

### The gap

| Layer | Library | CLI |
| --- | --- | --- |
| Unit tests | comprehensive | only `path-resolution` + `formatting` |
| Integration tests | yes (`index.test.ts`) | none |
| E2E / "real CLI invocation" tests | n/a | none |
| Error-path tests | systematic | only formatting + path-safety |

---

## 3. Goals

1. **Every CLI source file with runtime behaviour has at least one
   test file** dedicated to it (i.e. no zero-coverage files).
2. **Every `ExitCode` value is reachable by at least one test** that
   asserts the CLI exits with that code under the expected condition.
3. **`main()` is exercised by integration tests** that drive a real
   config file through to a real output file using temp directories,
   without any hand-mocked filesystem.
4. **A small smoke-test layer** invokes the built CLI binary (`node
   dist/cli.js`) against a known-good fixture and asserts the output
   bytes match a snapshot. This is the closest thing to "what the
   user actually sees".
5. **Coverage threshold enforced in CI.** Set the CLI Jest config
   to fail under 80% statements / 80% branches once the suite lands.
   Set the threshold deliberately lower than the library's effective
   coverage so the test target is achievable without inviting
   tautological tests.
6. **Conventions documented in AGENTS.md** so future contributors
   add new tests in the right place using the right idioms.

---

## 4. Non-Goals

- **Mocking the filesystem.** We use real temp directories
  (`fs.mkdtempSync(os.tmpdir() + '/openapi-merge-cli-')`) so the
  tests exercise the same code paths as production. Mocking `fs`
  has historically been a source of false confidence.
- **Mocking the network.** `inputURL` paths are exercised by a tiny
  in-process HTTP server (Node's `http.createServer`) bound to
  `127.0.0.1:0` for ephemeral port assignment, **not** by stubbing
  `fetch`. This catches real `isomorphic-fetch` bugs.
- **Replacing the library's existing tests.** Cross-package
  duplication is wasteful; the CLI tests assume the library is
  correct and focus on CLI-only concerns.
- **A full BDD/Cucumber layer.** Plain Jest is sufficient.
- **Migrating to `vitest`, `tsx`, or any other runner.** Stay
  on Jest + Babel for consistency with the library.

---

## 5. Phased Plan

The proposal breaks into five phases. Each phase is independently
shippable and leaves the CLI in a strictly-better state.

### Phase 1 — Plug the smallest holes (≈ half a day)

Three trivial files first to build momentum and validate the test
infrastructure end-to-end:

#### 5.1 `exit-codes.test.ts`

```typescript
import { ExitCode } from '../exit-codes';

describe('ExitCode enum', () => {
  it('preserves the documented numeric values (contract)', () => {
    // These numbers are part of the CLI's public contract; do not
    // change them without bumping the major version of the CLI.
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.ErrorLoadingConfig).toBe(1);
    expect(ExitCode.ErrorLoadingInputs).toBe(2);
    expect(ExitCode.ErrorMerging).toBe(3);
    expect(ExitCode.ErrorUncaught).toBe(4);
    expect(ExitCode.ErrorUnsafePath).toBe(5);
  });

  it('does not have duplicate values', () => {
    const values = Object.values(ExitCode).filter(v => typeof v === 'number');
    expect(new Set(values).size).toBe(values.length);
  });

  it('has a Success member equal to zero (POSIX convention)', () => {
    expect(ExitCode.Success).toBe(0);
  });
});
```

**Why this is valuable despite being trivial:** the enum is part of
the CLI's machine-readable contract. Scripts piping output through
`openapi-merge-cli && cp ...` rely on exit codes being stable. A
test that fails the moment someone renumbers an enum member is the
right cost/benefit trade-off.

#### 5.2 `file-loading.test.ts`

Cover `readFileAsString`, `readYamlOrJSON`, `JsonOrYamlParseError`,
and the dispatch between JSON and YAML.

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readFileAsString, readYamlOrJSON, JsonOrYamlParseError } from '../file-loading';

describe('readFileAsString', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opm-cli-')); });
  afterEach(()  => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('reads UTF-8 contents', async () => {
    const p = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(p, 'hello world');
    expect(await readFileAsString(p)).toBe('hello world');
  });

  it('rejects when the file does not exist', async () => {
    await expect(readFileAsString(path.join(tmpDir, 'missing.txt')))
      .rejects.toThrow(/ENOENT/);
  });

  it('reads binary UTF-8 with non-ASCII characters', async () => {
    const p = path.join(tmpDir, 'u.txt');
    fs.writeFileSync(p, 'résumé — 日本語');
    expect(await readFileAsString(p)).toBe('résumé — 日本語');
  });
});

describe('readYamlOrJSON', () => {
  it('parses obvious JSON without falling through to YAML', async () => {
    const json = '{"openapi":"3.0.3","info":{"title":"t","version":"1"}}';
    const parsed = await readYamlOrJSON(json);
    expect(parsed).toEqual({ openapi: '3.0.3', info: { title: 't', version: '1' } });
  });

  it('parses YAML when JSON.parse fails', async () => {
    const yaml = 'openapi: 3.0.3\ninfo:\n  title: t\n  version: "1"\n';
    const parsed = await readYamlOrJSON(yaml) as { openapi: string };
    expect(parsed.openapi).toBe('3.0.3');
  });

  it('throws a JsonOrYamlParseError reporting BOTH parse errors when neither succeeds', async () => {
    // Garbage that is neither valid JSON nor valid YAML
    const bad = '{ "openapi": "3.0.3"\n\t- not valid';
    await expect(readYamlOrJSON(bad)).rejects.toBeInstanceOf(JsonOrYamlParseError);
    try { await readYamlOrJSON(bad); } catch (e) {
      const err = e as JsonOrYamlParseError;
      expect(err.jsonError).toBeDefined();
      expect(err.yamlError).toBeDefined();
      expect(err.message).toMatch(/json/i);
      expect(err.message).toMatch(/yaml/i);
    }
  });
});
```

#### 5.3 `fix-schema.test.ts`

Cover the schema-postprocessing step that runs as part of
`gen-schema`. Goal: prove that `$id`, `title`, and `description`
get applied correctly to a hand-rolled tiny input schema, and that
the function is a pure transformation (input not mutated unless we
explicitly do so).

```typescript
// Test against a tiny inline schema rather than the real generated one
// to keep the test deterministic across `typescript-json-schema` upgrades.
```

### Phase 2 — `load-configuration.ts` end-to-end (≈ half a day)

`validateConfigurationSemantics` already has tests via
`formatting.test.ts`, but the rest of `loadConfiguration` is
uncovered. New file `load-configuration.test.ts`:

- **Happy path:** valid JSON config loads to a `Configuration` object.
- **Happy path:** valid YAML config loads identically.
- **Schema rejection:** missing required `inputs`. Missing required
  `output`. Invalid type (`inputs: "string-not-array"`).
- **Schema rejection:** unknown top-level field (`noExtraProps` is
  enabled in the generated schema).
- **Schema rejection:** invalid `dispute` shape (both `prefix` and
  `suffix` present).
- **Backwards-compat:** v1 `disputePrefix` string field still parses
  (we promised this in proposal-115's success criteria and across
  the deprecation cycle).
- **File errors:** config file does not exist → readable error.
- **File errors:** config file is unreadable JSON/YAML → message
  contains both parse errors (proves the `JsonOrYamlParseError`
  is bubbled through).
- **Semantic check:** the YAML+tabs rejection from §114 still fires
  through `loadConfiguration` (currently covered only via the
  helper).

### Phase 3 — Integration tests of `main()` (≈ 1 day)

The big one. New file `main-integration.test.ts` drives `main()`
end-to-end without spawning a subprocess. Each test:

1. Creates a temp directory.
2. Writes a tiny `gateway.swagger.json` (and any extra input files
   the test needs) into the temp dir.
3. Writes an `openapi-merge.json` referencing those inputs.
4. Calls `main()` with `process.argv` rewritten to point at the
   temp config.
5. Asserts on:
   - Exit code (captured via spying on `process.exit`).
   - Stdout/stderr (captured via spying on `console.log` / `console.error`).
   - The output file contents (`fs.readFileSync` against the merged
     spec; compare with `toEqual` against the expected object).

#### Test matrix

| Scenario | Asserts |
| --- | --- |
| Single input, no transformations | exit 0, output contains expected paths |
| Two inputs with disjoint paths | both paths present in output |
| Two inputs with `pathModification.prepend` | rewritten paths present |
| Input via `inputURL` (in-process HTTP server) | network path works |
| Input that fails to load (404) | exit `ExitCode.ErrorLoadingInputs` (2) |
| Conflicting `operationId` without `dispute` | exit `ExitCode.ErrorMerging` (3) |
| Conflicting `operationId` resolved by `dispute.prefix` | exit 0, prefixed id present |
| Schema-invalid config | exit `ExitCode.ErrorLoadingConfig` (1) |
| Missing config file | exit `ExitCode.ErrorLoadingConfig` (1) |
| Absolute `output` path | written at the absolute location (regression test for #93) |
| `outputRoot` set and output is inside it | exit 0 |
| `outputRoot` set and output escapes it | exit `ExitCode.ErrorUnsafePath` (5) |
| `--restrict-output-to` CLI flag overrides `outputRoot` from config | flag wins |
| `formatting.indent` = `{ style: 'spaces', width: 4 }` | output indented with 4 spaces |
| `formatting.indent` = `{ style: 'tabs' }` + `.json` output | output indented with tabs |
| `formatting.indent` = `{ style: 'tabs' }` + `.yaml` output | exit `ExitCode.ErrorLoadingConfig` (1) |
| Description merging across inputs | merged description appears |
| Synthetic uncaught throw inside `main()` | exit `ExitCode.ErrorUncaught` (4) — regression test for #92 |

#### Shared helpers (`__tests__/_helpers/`)

```typescript
// fixture-builder.ts
export async function withTempConfig(
  config: Configuration,
  inputs: Record<string, Swagger.SwaggerV3>,
  body: (cwd: string) => Promise<void>,
): Promise<void> { /* ... */ }

// process-mock.ts
export function captureProcessExit(): { codes: number[]; restore: () => void };
export function captureConsole(): { stdout: string[]; stderr: string[]; restore: () => void };
```

These helpers exist once, are reused across every integration test,
and keep individual test bodies under 15 lines.

### Phase 4 — Smoke / E2E tests (≈ 2–3 hours)

A handful of tests in `main-smoke.test.ts` spawn the real CLI binary
(`node packages/openapi-merge-cli/dist/cli.js`) as a subprocess.
These are slow (~200ms each) but they're the only thing that catches
bugs in the shebang line, `commander` registration, the
`process.argv` wiring, and the `npm bin` install path. Keep it to
five tests:

1. `--version` prints the `package.json` version.
2. `--help` prints usage and exits 0.
3. Real merge against the existing `openapi-merge.test.json`
   fixture produces a non-empty output file. (We already ship that
   fixture; reusing it is free.)
4. Bad config exits with `ErrorLoadingConfig` (1).
5. `--restrict-output-to` rejects an out-of-jail output with
   `ErrorUnsafePath` (5).

These tests **require the CLI to have been built first** (`dist/cli.js`
must exist). Add a `pretest` hook to the CLI's `package.json`:

```jsonc
"scripts": {
  "pretest": "tsc --project .",
  "test": "jest --collect-coverage --verbose"
}
```

### Phase 5 — Coverage gating and AGENTS.md update (≈ 1 hour)

#### 5.1 Coverage thresholds

Update `packages/openapi-merge-cli/jest.config.js`:

```javascript
module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': 'babel-jest' },
  testMatch: ['**/__tests__/**/(*.)+(spec|test).[tj]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/data.ts',                  // pure types
    '!src/__tests__/**',
    '!src/examples-for-schema.ts',   // covered by Phase 1
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
};
```

CI already runs `yarn test`, which runs `jest --collect-coverage`,
so the threshold is enforced automatically.

#### 5.2 AGENTS.md additions

Append a short section to the root `AGENTS.md`:

```markdown
## CLI Test Conventions

- Tests live in `packages/openapi-merge-cli/src/__tests__/`.
- One test file per source file, named `<source>.test.ts`.
- Integration tests use temp directories (`fs.mkdtempSync`), never
  filesystem mocks.
- Network tests use an in-process Node HTTP server on a random port,
  never a `fetch` mock.
- Use the shared helpers in `__tests__/_helpers/` for temp configs,
  process-exit capture, and console capture.
- Smoke tests spawn the real built CLI; add `pretest` `tsc` if you
  introduce them in a new package.
- New `ExitCode` enum members require:
  - a value in `exit-codes.ts`
  - a row in `exit-codes.test.ts`
  - a row in the README's exit-code table
  - a row in the proposal-92 exit-code table
```

---

## 6. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Slow tests as the suite grows | Integration tests deliberately stay under 50ms each by avoiding subprocess spawning. Smoke tests are capped at 5, total budget < 1.5s. |
| Flaky tests from the in-process HTTP server | Bind to `127.0.0.1:0` so the OS picks an unused port; always shut the server down in `afterEach`. |
| Test fixtures going stale | All fixtures are inline `Swagger.SwaggerV3` objects, type-checked at compile time. No separate JSON files to drift. |
| Coverage threshold blocking unrelated PRs | Set the threshold to 80% rather than 95% so genuinely uncovered minor code paths don't block work. Allow per-file exemptions via `collectCoverageFrom`. |
| `process.exit` mock leaking between tests | Centralise in `captureProcessExit()` and always call `.restore()` in `afterEach`. |
| Behaviour difference between Babel transform (Jest) and `tsc` (production) | Cross-validate by also running `tsc --noEmit` as part of CI (already happens). The coverage tool reports against the TypeScript source, not the transpiled output. |

---

## 7. Effort Estimate

| Phase | Effort | Notes |
| --- | --- | --- |
| Phase 1 — small file coverage | ½ day | exit-codes, file-loading, fix-schema |
| Phase 2 — load-configuration | ½ day | Reuses the temp-dir helper from Phase 1 |
| Phase 3 — `main()` integration | 1 day | The bulk of the work; ~18 test cases |
| Phase 4 — smoke / E2E | 2–3 hours | Five subprocess tests + `pretest` hook |
| Phase 5 — coverage + AGENTS | 1 hour | Config + docs |
| **Total** | **≈ 2.5 days** | Single contributor, no concurrent work |

**Value:** 4 / **Effort:** 3 / **ROI:** 5 (Quick Win — comparable to
#33 and #71 in the value-vs-effort triage). High strategic value
because it unblocks confident implementation of every remaining issue
in the backlog.

---

## 8. Acceptance Criteria

- [ ] Every CLI source file with runtime behaviour has a dedicated
  `<source>.test.ts` in `__tests__/`. The current list:
  `cli.ts`, `index.ts`, `examples-for-schema.ts`, `exit-codes.ts`,
  `file-loading.ts`, `fix-schema.ts`, `formatting.ts` (✅ already),
  `load-configuration.ts` (extend), `path-resolution.ts` (✅ already).
- [ ] Every value in the `ExitCode` enum has at least one
  integration test that asserts the CLI exits with that code.
- [ ] `main-integration.test.ts` covers the 18 scenarios in the
  Phase 3 matrix.
- [ ] `main-smoke.test.ts` covers the 5 subprocess scenarios in Phase 4.
- [ ] Shared helpers live in `__tests__/_helpers/`.
- [ ] `jest.config.js` enforces 80% / 80% / 80% / 80% coverage
  thresholds; `yarn test` fails locally and in CI if any drop below.
- [ ] AGENTS.md "CLI Test Conventions" section is added.
- [ ] No new ESLint warnings.
- [ ] CI's `branch-test.yml` job passes on the implementation branch.
- [ ] No regression: library suite remains at 98/98.
- [ ] Total CLI test wall-clock time is under 5 seconds on a developer
  laptop.

---

## 9. Sequencing

Phases are designed to be implementable in order on one branch
(`test/cli-coverage`) with one commit per phase, so review is
straightforward. Alternatively each phase can ship as its own PR if
preferred — they are deliberately independent.

A reasonable rollout:

1. **Phase 1** in its own commit — proves the infrastructure works
   and gives reviewers a small change to react to.
2. **Phase 2** — moderate-sized commit covering all the
   `loadConfiguration` paths.
3. **Phase 3** — split into two commits if it gets too large
   (helpers + first 9 scenarios, then remaining 9 scenarios).
4. **Phase 4** + **Phase 5** together in one commit — small, mostly
   config + docs.

Total: 4–5 commits on a single branch, easily reviewed.

---

## 10. Open Questions

1. **Coverage tool choice.** Babel-Jest reports against the TypeScript
   source by default via Istanbul — confirmed correct after Phase 1.
   If it doesn't behave, fall back to `@vitest/coverage-istanbul` or
   add `@babel/plugin-syntax-typescript`. (No expected blocker.)
2. **Should `data.ts` count toward coverage?** It's pure types but
   exports `DEFAULT_INDENT`. Exclude it via `collectCoverageFrom` to
   avoid 0% on a file that's mostly type declarations; the
   `DEFAULT_INDENT` constant is exercised transitively by
   `formatting.test.ts` already.
3. **Should we test `cli.ts` directly?** The `process.on(...)` global
   handlers there are hard to test without subprocess-spawning. My
   recommendation is to cover them via the Phase 4 smoke tests rather
   than `cli.test.ts`, and document that decision.
4. **Should the library's `jest.config.js` also get a coverage
   threshold?** Out of scope here, but worth a tiny follow-up: the
   library already collects coverage; setting `coverageThreshold`
   there would lock in its 95% effective coverage. Track as a small
   follow-up if desired.

---

## 11. Related Issues & Proposals

- **Proposal #92** (uncaught-exit-code, ✅ Fixed) — the regression test
  for #92 belongs in `main-integration.test.ts` (synthetic uncaught
  throw → exit 4).
- **Proposal #93** (absolute paths, ✅ Fixed) — `path-resolution.ts`
  is already covered; absolute-output regression test belongs in
  `main-integration.test.ts`.
- **Proposal #114** (formatting, ✅ Fixed) — `formatting.ts` and
  `validateConfigurationSemantics` are already covered; YAML+tabs
  rejection belongs as an integration scenario.
- **Proposal #45** (no-config mode) — once implemented, it should
  ship with at least three integration scenarios (success path,
  ambiguous flags, missing required arg).
- **Proposal #61** (`inputURL` auth) — will need an in-process
  HTTP server that verifies the `Authorization` header was forwarded
  correctly; the helper proposed in Phase 3 is the foundation.
- **Proposal #76** (configurable openapi version) — each strategy
  variant (`fixed`, `first-input`, `highest-input`) needs an
  integration test, especially the cross-minor conflict case.

---

## 12. Summary

The CLI is the user-visible artifact, has accumulated real logic
across half a dozen recently-implemented features, and is the
common testbed for every remaining issue in the backlog. It
deserves the same test rigour as the library. The infrastructure
is already in place (Jest + Babel + 27 tests added during #93 and
#114), so the marginal cost of comprehensive coverage is roughly
two-and-a-half days of focused work and yields a permanent quality
floor: any future regression will be caught by an existing test
rather than by a downstream user filing an issue.
