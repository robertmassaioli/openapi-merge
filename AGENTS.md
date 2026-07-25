# AGENTS.md

> Generated: Thursday, 2026-05-21 08:46:03
>
> This file is a guide for AI coding agents (and humans) working in this repository.
> It describes the project structure, functionality, build/test/deployment workflows,
> coding conventions, and helpful commands.

---

## 1. Project Overview

This repository — **`openapi-merge`** — is a TypeScript multi-package mono-repo that
provides tooling for merging multiple OpenAPI 3.0 specification files into a single,
deterministic OpenAPI specification.

The primary motivating use case is:

> "I have multiple microservices, each with their own OpenAPI spec, and I want to
> expose them through one API Gateway with a single combined spec."

While the merging logic is generic enough for many use cases, many design decisions
favor the API-gateway scenario. The merge is deterministic: the first input listed
takes precedence over later inputs for any element-level conflicts (e.g., `info`,
`servers`, `security`, `externalDocs`).

The repository is owned and maintained by **Robert Massaioli** and published under
the **MIT License**. Source is hosted at
<https://github.com/robertmassaioli/openapi-merge>.

---

## 2. Repository Layout

```
.
├── .github/workflows/        # CI workflows: branch-test, npm-publish, codeql-analysis
├── .husky/pre-commit         # Husky pre-commit hook (runs `bun run lint`)
├── scripts/publish-changed.sh # Publishes any workspace package whose version has changed
├── LICENSE                   # MIT
├── README.md                 # Repository-level README
├── package.json              # Root package — orchestrates the mono-repo via Bun workspaces
├── bun.lock                  # Bun lockfile (single lockfile for the whole workspace)
└── packages/
    ├── openapi-merge/        # Library package (published as `openapi-merge` on npm)
    │   ├── src/              # Library source
    │   ├── src/__tests__/    # bun:test suites for the library
    │   ├── bunfig.toml
    │   ├── tsconfig.json
    │   └── package.json
    └── openapi-merge-cli/    # CLI package (published as `openapi-merge-cli` on npm)
        ├── src/              # CLI source (entrypoint: `cli.ts` → `index.ts`)
        ├── confluence.swagger.yaml   # Example OpenAPI input used for manual testing
        ├── openapi-merge.test.json   # Example merge configuration
        ├── bunfig.toml
        ├── tsconfig.json         # Main project config (includes ambient `bun`/`node` types)
        ├── tsconfig.schema.json  # Narrow config used only by `typescript-json-schema`
        └── package.json
```

### Package manager / workspace tooling

The mono-repo uses **[Bun](https://bun.sh/) workspaces** for workspace orchestration
and as the JavaScript/TypeScript runtime. The root `package.json` declares:

```json
"workspaces": ["packages/*"]
```

Root-level scripts fan out into each package using Bun's `--filter`:

| Script             | What it does                                                       |
| ------------------ | ------------------------------------------------------------------ |
| `bun run lint`     | `bun run --filter '*' lint` — runs `lint` in every workspace        |
| `bun run test`     | `bun run --filter '*' test` — runs `test` in every workspace        |
| `bun run build`    | `bun run --filter '*' build` — builds every workspace with `tsgo`   |
| `bun run cli`      | `bun run --cwd packages/openapi-merge-cli start` — runs the CLI in dev mode |
| `bun run prepare`  | `husky install` — installs the git hooks                           |

TypeScript is compiled with **[`tsgo`](https://github.com/microsoft/typescript-go)**
(package `@typescript/native-preview`), the Go-based native port of the TypeScript
compiler, instead of the classic JS `tsc`. Each package's `build`/`prepare`/
`prepublishOnly` scripts invoke `tsgo --project .`. `tsgo` behaves like `tsc` for
this codebase's purposes (same `tsconfig.json`, same CLI flags such as `--watch`),
but it type-checks somewhat more strictly in a few edge cases around nullable
`object`/generic types — see `component-equivalence.ts`'s and `data.ts`'s explicit
`typeof x === 'object' && x !== null` guards, added when migrating off TypeScript 3.8.

---

## 3. The `openapi-merge` Library (`packages/openapi-merge`)

### Purpose

Provides a single `merge(inputs)` function that takes an array of OpenAPI 3.0
documents (plus per-input options) and produces a single combined OpenAPI 3.0.3
document, or an error describing why the merge failed.

### Public API (re-exported from `src/index.ts`)

```ts
import {
  merge,
  isErrorResult,
  MergeInput,
  MergeResult,
  PathModification,
  OperationSelection,
} from 'openapi-merge';
```

- `merge(inputs: MergeInput): MergeResult`
- `isErrorResult(result): result is ErrorMergeResult`

### Key types (`src/data.ts`)

- **`SingleMergeInput`** — a single input. Two backwards-compatible shapes:
  - `SingleMergeInputV1` (deprecated): uses `disputePrefix?: string`.
  - `SingleMergeInputV2`: uses `dispute?: Dispute` (a `DisputePrefix | DisputeSuffix`,
    each with an optional `alwaysApply` flag).
- **`PathModification`** — `{ stripStart?: string; prepend?: string }` applied to
  every path imported from the input. `stripStart` runs before `prepend`.
- **`OperationSelection`** — `{ includeTags?: string[]; excludeTags?: string[] }`.
  Exclusion takes precedence when both apply to the same operation.
- **`DescriptionMergeBehaviour`** — `{ append: boolean; title?: DescriptionTitle }`
  controls how `info.description` from each input contributes to the merged
  `info.description` field (with optional Markdown heading).
- **`MergeResult`** — `SuccessfulMergeResult { output } | ErrorMergeResult { type, message }`.
- **`ErrorType`** — `'no-inputs' | 'duplicate-paths' | 'component-definition-conflict' | 'operation-id-conflict'`.

### Source modules (one responsibility each)

| File                          | Responsibility                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `index.ts`                    | The top-level `merge` orchestrator.                                                             |
| `paths-and-components.ts`     | Merges `paths` and `components`; ensures unique operation IDs; applies path-modification rules. |
| `component-equivalence.ts`    | Shallow and deep equality checks for components (used to deduplicate identical components).     |
| `dispute.ts`                  | Resolves naming conflicts via prefix/suffix; honors `alwaysApply`.                              |
| `reference-walker.ts`         | Walks `$ref`s through schemas, parameters, headers, links, callbacks, requests, responses…     |
| `tags.ts`                     | Merges the top-level `tags` arrays, deduping by name and respecting `excludeTags`.              |
| `info.ts`                     | Uses the first input's `info` as base; optionally appends descriptions with Markdown headings.  |
| `operation-selection.ts`      | Filters operations by `includeTags` / `excludeTags`.                                            |
| `extensions.ts`               | Merges top-level `x-*` extensions (first-wins).                                                 |
| `data.ts`                     | Public types and the `isErrorResult` type guard.                                                |

### Merging rules (summary)

- **First-input-wins** for: `info` (base), `servers`, `security`, `externalDocs`,
  and conflicting top-level `x-*` extensions.
- **Deterministic merge** for: `paths`, `components`, `tags`.
- **Conflicts**:
  - Duplicate paths → error `duplicate-paths`.
  - Conflicting component definitions → error `component-definition-conflict`
    (unless `dispute` resolves them via prefix/suffix).
  - Conflicting operation IDs → error `operation-id-conflict` (dispute applies).
- **Output**: always emits `openapi: '3.0.3'`.

### Build / Test / Lint

From `packages/openapi-merge`:

```bash
bun run build      # tsgo --project .        (also runs on `prepare` and `prepublishOnly`)
bun run test       # bun test --coverage
bun run lint       # eslint src --ext .js,.jsx,.ts,.tsx --fix
bun run start      # bun src/index.ts         (rarely useful directly)
```

Tests run under Bun's built-in test runner (`bun:test`), which is Jest-API-compatible
(`describe`/`it`/`expect` are globals — no import needed). `bunfig.toml` sets
`[test] root = "src"`; the test glob defaults to `**/*.{test,spec}.{ts,tsx,js,jsx}`,
matching the existing `__tests__/*.test.ts` layout. Coverage output goes to `coverage/`
(gitignored); see **§5 → Code coverage** for the coverage conventions and their traps.

The library is compiled with `tsgo` to `dist/`, and the published `main`/`typings`
both point at `dist/index`. Only `dist/!(__tests__)` (and subtree) are published.

---

## 4. The `openapi-merge-cli` Tool (`packages/openapi-merge-cli`)

### Purpose

A thin command-line wrapper around the `openapi-merge` library that:

1. Loads a JSON or YAML configuration file (default: `openapi-merge.json`).
2. Validates it against a generated JSON Schema (`configuration.schema.json`).
3. Loads each input OpenAPI document either from disk (`inputFile`) or HTTP
   (`inputURL`) — JSON or YAML.
4. Invokes `merge(...)` from the library.
5. Writes the merged spec to the configured `output` path (YAML if the output
   ends in `.yaml` / `.yml`, otherwise JSON).

### Entry points

- **bin**: `openapi-merge-cli` → `dist/cli.js` (after build).
- `src/cli.ts` — `#!/usr/bin/env node` shebang; calls `main()` and logs uncaught
  errors.
- `src/index.ts` — exports `async function main()`. Sets up `commander`, parses
  `-c, --config <config_file>`, loads everything, invokes the merge, and writes
  the output.

### Configuration shape (`src/data.ts`)

Top-level shape:

```jsonc
{
  "inputs": [ /* ConfigurationInput[] */ ],
  "output": "./output.swagger.json"
}
```

Each `ConfigurationInput` is either `ConfigurationInputFromFile` or
`ConfigurationInputFromUrl`, optionally extended with either `disputePrefix`
(v1, deprecated) or `dispute` (v2):

```jsonc
{
  "inputFile": "./jira.swagger.json",    // OR
  "inputURL":  "https://example.com/jira.swagger.json",

  "pathModification": { "stripStart": "/rest", "prepend": "/jira" },
  "operationSelection": { "includeTags": ["public"], "excludeTags": ["private"] },
  "description": {
    "append": true,
    "title": { "value": "Jira", "headingLevel": 2 }
  },
  "dispute": { "prefix": "Jira", "alwaysApply": true }
}
```

The example configuration at `packages/openapi-merge-cli/openapi-merge.test.json`
exercises the full CLI when paired with `confluence.swagger.yaml`.

### Validation

`load-configuration.ts` uses **Ajv** (`ajv@6`) to validate the configuration
against `configuration.schema.json`. The schema is itself generated from the
TypeScript types via `typescript-json-schema`, then post-processed by
`fix-schema.ts` to set `$id`, `title`, and `description`.

### File loading

`file-loading.ts` exposes:

- `readFileAsString(path)` — promise wrapper over `fs.readFile`.
- `readYamlOrJSON(contents)` — tries `JSON.parse` first, then `yaml.safeLoad`;
  throws a `JsonOrYamlParseError` reporting both errors if both fail.

URL inputs are fetched with `isomorphic-fetch`.

### Output

`writeOutput` decides between YAML and JSON purely based on the output file
extension. Note: when emitting YAML, the data is JSON-stringified and re-parsed
first to strip `undefined` values (a workaround for
[js-yaml#571](https://github.com/nodeca/js-yaml/issues/571)).

### Exit codes

Defined in `src/exit-codes.ts`, whose header table is the source of truth.
`src/__tests__/exit-codes.test.ts` pins every value, so renumbering a member
fails the build rather than someone's pipeline.

| Code | `ExitCode` member      | Meaning                                        |
| ---- | ---------------------- | ---------------------------------------------- |
| `0`  | `Success`              | Merge succeeded, output written                |
| `1`  | `ErrorLoadingConfig`   | Failed to load/parse the configuration file    |
| `2`  | `ErrorLoadingInputs`   | An input could not be obtained or parsed       |
| `3`  | `ErrorMerging`         | Merge logic failed (conflicts, etc.)           |
| `4`  | `ErrorUncaught`        | Uncaught exception during execution            |
| `5`  | `ErrorUnsafePath`      | Output escaped `outputRoot`                    |
| `6`  | `ErrorInputUrlStatus`  | An `inputURL` returned a non-2xx HTTP status   |

Adding a code means: append the next unused integer (never re-use a retired
one), add a row to the table in `exit-codes.ts`, add it to the `documented`
list in `exit-codes.test.ts`, and update the tables here and in the CLI README.

### Build / Test / Lint / Generate

From `packages/openapi-merge-cli`:

```bash
bun run build      # tsgo --project .
bun run gen-schema # typescript-json-schema against tsconfig.schema.json, then bun ./src/fix-schema.ts
bun run prepare    # bun run gen-schema && tsgo --project .
bun run prepublishOnly # same as prepare
bun run start      # bun ./src/cli.ts           (dev mode)
bun run lint       # eslint src --ext .ts,.tsx --fix
bun run gen-docs   # jsonschema2md --input=src  (regenerate Markdown docs)
```

`gen-schema` runs `typescript-json-schema` against a dedicated `tsconfig.schema.json`
(not the package's main `tsconfig.json`), because `typescript-json-schema` bundles
its own older TypeScript and cannot parse the ambient `bun`/`node` `@types` the main
config pulls in. `tsconfig.schema.json` only includes `src/data.ts` and sets `"types": []`.

The CLI package has a **small `bun:test` suite** of its own (`formatting.test.ts`,
`path-resolution.test.ts`); most functional coverage still lives in the library
package. Manual end-to-end testing uses the example configuration:

```bash
# From the repo root, after `bun install` and a library build:
bun run cli -- --config openapi-merge.test.json
```

---

## 5. Common Developer Workflow

1. **Install Bun** (v1.3.14 or later — see `packageManager` in the root `package.json`):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
2. Install workspace dependencies:
   ```bash
   bun install
   ```
3. (Optional) Run the library compiler in watch mode so the CLI picks up
   changes immediately:
   ```bash
   cd packages/openapi-merge && bun run build -- --watch
   ```
4. Run the CLI:
   ```bash
   bun run cli
   ```
5. Run the test suite:
   ```bash
   bun run test
   ```
6. Run lint (also runs automatically on `git commit` via Husky):
   ```bash
   bun run lint
   ```

### Pre-commit hook

`.husky/pre-commit` runs `bun run lint` before every commit. If you add new files,
ensure they pass ESLint with `--fix` cleanly.

### Code coverage

Both packages run `bun test --coverage` as their `test` script, so coverage is
collected on every local run and in CI. Configuration lives in each package's
`bunfig.toml`. Full background, including the measurements behind every number
here, is in `ai-planning/proposal-code-coverage.md`.

**If you add a source file to `openapi-merge-cli`, add an import line to
`src/__tests__/_coverage-preload.ts`.** Bun's coverage is runtime-instrumented:
a module that no test imports contributes *nothing* to the report — not even a
0% row — so the reported percentage would silently be computed over a subset of
the source. The preload file exists solely to force every module to load. It is
deliberately a hand-curated list rather than a glob, because two files execute
real work at module scope and must never be imported by it:

- `cli.ts` calls `main()` at module scope — importing it runs the CLI inside the
  test process.
- `fix-schema.ts` is a build script whose module body **writes**
  `src/configuration.schema.json`.

Those two are therefore absent from the CLI's coverage report by design. If you
ever see `configuration.schema.json` dirty in `git status` after a test run,
suspect the preload file before suspecting `gen-schema`.

One consequence worth knowing: because the preload imports `src/index.ts`, which
imports the sibling library (`openapi-merge`, resolved via its `dist/`), **the
CLI test suite now requires `packages/openapi-merge/dist/` to exist.** Before the
preload it did not, since no CLI test reached that far. `bun install` builds it
via the CLI's `prepare` script, so CI and fresh clones are fine — but after
`rm -rf packages/*/dist`, `bun test` in the CLI fails with a module-resolution
error that looks nothing like a coverage problem. Run `bun run build` first.

**`coverageThreshold` is enforced per-file, not as a package average.** A
threshold is capped by the *weakest* file in the package, so it functions as a
ratchet against the worst module rather than a coverage guarantee. The library's
current floor sits just under `reference-walker.ts`; raise it as that file gains
tests, and never lower one to make a build pass.

Three traps, all of which fail **silently** — Bun prints nothing when a
threshold trips, and names neither the file nor the metric:

1. Both `lines` and `functions` are mandatory. Specifying only one makes the
   other default to 100%, so the run fails unconditionally.
2. Keys are plural. A `line`/`function` typo is not an error — it silently
   disables the threshold, leaving you gated in name only.
3. Because of (1) and (2), **verify any threshold change in both directions**:
   set it deliberately high and confirm a red build, then set it to the real
   value and confirm green.

**Bun's `All files` row is an unweighted mean of the per-file percentages**, not
covered ÷ total, so file size is ignored — a one-line file at 100% offsets a
189-line file at 22%. Treat per-file numbers as the real signal and the total as
indicative only.

**Bun collects no branch coverage** (its lcov output contains no `BR*` records)
and none from subprocesses. Do not write acceptance criteria that require
either.

---

## 6. Continuous Integration & Deployment

All CI installs **Bun 1.3.14** via `oven-sh/setup-bun` on `ubuntu-latest`, then runs
`bun install --frozen-lockfile`.

### `.github/workflows/branch-test.yml`

Runs on every push to a non-`main` branch. Two parallel jobs:

- **lint**: `bun install --frozen-lockfile` → `bun run lint`.
- **test**: `bun install --frozen-lockfile` → `bun run test`.

### `.github/workflows/npm-publish.yml`

Runs on every push to `main`:

1. `bun install --frozen-lockfile`
2. `bun run lint`
3. `bun run test`
4. `bun run build`
5. Writes an `.npmrc` containing `${NPM_AUTH_TOKEN}`, then runs
   `scripts/publish-changed.sh`, which compares each workspace package's local
   `version` against the version currently on the npm registry (via `npm view`)
   and runs `bun publish` for any package whose version has changed. This
   replaces the automatic version-diffing that `bolt publish` used to provide.

Required GitHub secrets:

- `NPM_AUTH_TOKEN` — npm publish token (must be configured by the maintainer).
- `GITHUB_TOKEN` — provided automatically.

> **Release flow**: bump the relevant `version` in
> `packages/openapi-merge/package.json` and/or
> `packages/openapi-merge-cli/package.json`, merge to `main`, and the workflow
> handles publication to <https://registry.npmjs.org>.

### `.github/workflows/codeql-analysis.yml`

GitHub-provided CodeQL JavaScript scan: runs on push/PR against `main` and on a
weekly cron (`28 21 * * 5`).

---

## 7. Coding Conventions

- **Language**: TypeScript, compiled by `tsgo` (`@typescript/native-preview`) to
  ES2021 / CommonJS.
- **Strict mode**: `"strict": true` is enabled in both `tsconfig.json`s.
- **Declarations**: `declaration` and `declarationMap` are on; published packages
  ship `.d.ts` and source maps for them.
- **Linting**: ESLint (`@typescript-eslint/eslint-plugin`, `parser`). Lint with
  `--fix` is the canonical way to apply style.
- **Testing**: Bun's built-in test runner (`bun test`), Jest-API-compatible, for
  both packages.
- **Imports**: `esModuleInterop` is enabled.
- **Path conventions**: source under `src/`, output under `dist/`.
- **No tests in published artifact**: the `files` field publishes
  `dist/!(__tests__)` and `dist/!(__tests__)/**/*` only.

---

## 8. Key Runtime Dependencies

### Library (`openapi-merge`)
- `atlassian-openapi` — Swagger v3 type definitions and lookup/type-check helpers.
- `lodash` — used by `info.ts`, `component-equivalence.ts`, and `operation-selection.ts`.
- `ts-is-present` — `isPresent` type guard used in several modules.

### CLI (`openapi-merge-cli`)
- `commander` — argument parsing.
- `ajv` — JSON Schema validation of the user's configuration.
- `js-yaml` — YAML parse + dump (with the `JSON.parse(JSON.stringify(...))`
  workaround when dumping).
- `isomorphic-fetch` (+ `es6-promise`) — `inputURL` loading.
- `openapi-merge` — the library, consumed via `^1.2.0`.

---

## 9. Conventions for AI Agents

When editing this repository, please follow these guidelines:

1. **Do not break the library's public API** without bumping the library
   version (`packages/openapi-merge/package.json`) and updating the CLI's
   dependency range if needed. The CLI imports types directly from
   `openapi-merge/dist/data`, so changes to `data.ts` flow through.
2. **Preserve backwards compatibility for `SingleMergeInputV1` / `disputePrefix`**.
   These are explicitly marked `@deprecated` but still exercised by the CLI's
   `convertInputs` function and by the example test config.
3. **Add `bun:test` tests** under `packages/openapi-merge/src/__tests__/` for any
   change in merge behaviour. Existing suites cover `components`,
   `external-docs`, `info`, `paths`, `security`, `x-tensions`, and the
   end-to-end `index` flow.
4. **Regenerate the configuration schema** whenever you change
   `packages/openapi-merge-cli/src/data.ts`:
   ```bash
   cd packages/openapi-merge-cli && bun run gen-schema
   ```
   The schema is committed; CI does not regenerate it.
5. **Keep `openapi: '3.0.3'`** as the emitted version in
   `paths-and-components.ts`/`index.ts` unless explicitly asked to change it.
6. **Match the existing style** (2-space indent, single quotes, trailing semicolons,
   `interface` for object shapes with extension semantics, `type` aliases
   otherwise). Run `bun run lint` before committing.
7. **Do not commit `node_modules` or `dist/`** — both are git-ignored per package.
8. **`bun run cli` requires a built library** (or a parallel `tsgo --watch` from
   `packages/openapi-merge`) because the CLI imports compiled artifacts from
   `openapi-merge/dist/data`.
9. **`typescript-json-schema` cannot see ambient `bun`/`node` types**, so
   `gen-schema` points it at `packages/openapi-merge-cli/tsconfig.schema.json`
   (a minimal config covering only `src/data.ts`) rather than the package's
   main `tsconfig.json`. If `data.ts` gains a new import, verify `gen-schema`
   still runs cleanly.

---

## 10. Quick Reference — Commands Cheat Sheet

| Goal                                       | Command                                                       |
| ------------------------------------------ | ------------------------------------------------------------- |
| Install all workspace deps                 | `bun install`                                                 |
| Lint everything                            | `bun run lint`                                                |
| Run the full test suite                    | `bun run test`                                                |
| Run only the library tests                 | `bun run --cwd packages/openapi-merge test`                   |
| Build the library                          | `bun run --cwd packages/openapi-merge build`                  |
| Watch-build the library                    | `cd packages/openapi-merge && bun run build -- --watch`       |
| Build the CLI                              | `bun run --cwd packages/openapi-merge-cli build`               |
| Regenerate the CLI JSON Schema              | `bun run --cwd packages/openapi-merge-cli gen-schema`          |
| Regenerate the CLI Markdown docs           | `bun run --cwd packages/openapi-merge-cli gen-docs`            |
| Run the CLI in dev mode                    | `bun run cli` (or `bun run --cwd packages/openapi-merge-cli start`) |
| Run the CLI against the example config     | `bun run cli -- --config openapi-merge.test.json` |
| Publish (CI only, on `main`)               | Handled by `npm-publish.yml` → `scripts/publish-changed.sh` after version bump |

---

## 11. License

MIT — see `LICENSE` at the repository root.
