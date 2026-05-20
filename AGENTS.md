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
├── .husky/pre-commit         # Husky pre-commit hook (runs `yarn lint`)
├── .nvmrc                    # Pinned Node major version (14)
├── LICENSE                   # MIT
├── README.md                 # Repository-level README
├── package.json              # Root package — orchestrates the mono-repo via `bolt`
└── packages/
    ├── openapi-merge/        # Library package (published as `openapi-merge` on npm)
    │   ├── src/              # Library source
    │   ├── src/__tests__/    # Jest test suites for the library
    │   ├── jest.config.js
    │   ├── tsconfig.json
    │   └── package.json
    └── openapi-merge-cli/    # CLI package (published as `openapi-merge-cli` on npm)
        ├── src/              # CLI source (entrypoint: `cli.ts` → `index.ts`)
        ├── confluence.swagger.yaml   # Example OpenAPI input used for manual testing
        ├── openapi-merge.test.json   # Example merge configuration
        ├── tsconfig.json
        └── package.json
```

### Package manager / workspace tooling

The mono-repo uses **[bolt](https://github.com/boltpkg/bolt)** (a thin wrapper over
Yarn) for workspace orchestration. The root `package.json` declares:

```json
"bolt": { "workspaces": ["packages/*"] }
```

Most root-level scripts are bolt commands that fan out into each package:

| Script             | What it does                                                       |
| ------------------ | ------------------------------------------------------------------ |
| `yarn lint`        | `bolt ws lint` — runs `lint` in every workspace                    |
| `yarn test`        | `bolt ws test` — runs `test` in every workspace                    |
| `yarn cli`         | `bolt w openapi-merge-cli run start` — runs the CLI in dev mode   |
| `yarn prepare`     | `husky install` — installs the git hooks                           |

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
yarn build         # tsc --project .       (also runs on `prepare` and `prepublishOnly`)
yarn test          # jest --collect-coverage --verbose
yarn lint          # eslint src --ext .js,.jsx,.ts,.tsx --fix
yarn start         # ts-node src/index.ts  (rarely useful directly)
```

Jest configuration (`jest.config.js`):

- `testEnvironment: 'node'`.
- `testMatch: ['**/__tests__/**/(*.)+(spec|test).[tj]s?(x)']`.
- Coverage output: `coverage/`.

The library is compiled with `tsc` to `dist/`, and the published `main`/`typings`
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

| Code | Meaning                              |
| ---- | ------------------------------------ |
| `0`  | Success                              |
| `1`  | `ERROR_LOADING_CONFIG`               |
| `2`  | `ERROR_LOADING_INPUTS`               |
| `3`  | `ERROR_MERGING`                      |

### Build / Test / Lint / Generate

From `packages/openapi-merge-cli`:

```bash
yarn build         # tsc --project .
yarn gen-schema    # typescript-json-schema src/data.ts Configuration ...
                   #   then ts-node src/fix-schema.ts
yarn prepare       # npm run gen-schema && tsc --project .
yarn prepublishOnly# same as prepare
yarn start         # ts-node src/cli.ts        (dev mode)
yarn lint          # eslint src --ext .ts,.tsx --fix
yarn gen-docs      # jsonschema2md --input=src (regenerate Markdown docs)
```

The CLI package has **no Jest tests** of its own; functional coverage lives in
the library package. Manual end-to-end testing uses the example configuration:

```bash
# From the repo root, after `bolt install` and a library build:
yarn cli -- --config packages/openapi-merge-cli/openapi-merge.test.json
```

---

## 5. Common Developer Workflow

1. **Install Node 14** (matches `.nvmrc`).
2. Install `bolt`:
   ```bash
   yarn global add bolt
   ```
3. Install workspace dependencies:
   ```bash
   bolt install
   ```
4. (Optional) Run the library compiler in watch mode so the CLI picks up
   changes immediately:
   ```bash
   bolt w openapi-merge build -w
   ```
5. Run the CLI:
   ```bash
   yarn cli
   ```
6. Run the test suite:
   ```bash
   yarn test
   ```
7. Run lint (also runs automatically on `git commit` via Husky):
   ```bash
   yarn lint
   ```

### Pre-commit hook

`.husky/pre-commit` runs `yarn lint` before every commit. If you add new files,
ensure they pass ESLint with `--fix` cleanly.

---

## 6. Continuous Integration & Deployment

All CI runs on **Node 14** on `ubuntu-latest`, and installs bolt globally before
`bolt install`.

### `.github/workflows/branch-test.yml`

Runs on every push to a non-`main` branch. Two parallel jobs:

- **lint**: `bolt install` → `yarn lint`.
- **test**: `bolt install` → `yarn test`.

### `.github/workflows/npm-publish.yml`

Runs on every push to `main`:

1. `bolt install`
2. `yarn lint`
3. `yarn test`
4. Writes an `.npmrc` containing `${NPM_AUTH_TOKEN}`, copies it into both
   package folders, and runs `bolt publish` to publish any package whose
   `version` was bumped.

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

- **Language**: TypeScript 3.8, compiling to ES2015 / CommonJS.
- **Strict mode**: `"strict": true` is enabled in both `tsconfig.json`s.
- **Declarations**: `declaration` and `declarationMap` are on; published packages
  ship `.d.ts` and source maps for them.
- **Linting**: ESLint (`@typescript-eslint/eslint-plugin`, `parser`). Lint with
  `--fix` is the canonical way to apply style.
- **Testing**: Jest 27 + Babel (`babel-jest`) for the library only.
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
3. **Add Jest tests** under `packages/openapi-merge/src/__tests__/` for any
   change in merge behaviour. Existing suites cover `components`,
   `external-docs`, `info`, `paths`, `security`, `x-tensions`, and the
   end-to-end `index` flow.
4. **Regenerate the configuration schema** whenever you change
   `packages/openapi-merge-cli/src/data.ts`:
   ```bash
   bolt w openapi-merge-cli run gen-schema
   ```
   The schema is committed; CI does not regenerate it.
5. **Keep `openapi: '3.0.3'`** as the emitted version in
   `paths-and-components.ts`/`index.ts` unless explicitly asked to change it.
6. **Match the existing style** (2-space indent, single quotes, trailing semicolons,
   `interface` for object shapes with extension semantics, `type` aliases
   otherwise). Run `yarn lint` before committing.
7. **Do not commit `node_modules` or `dist/`** — both are git-ignored per package.
8. **`yarn cli` requires a built library** (or a parallel `tsc -w` from
   `packages/openapi-merge`) because the CLI imports compiled artifacts from
   `openapi-merge/dist/data`.

---

## 10. Quick Reference — Commands Cheat Sheet

| Goal                                       | Command                                                       |
| ------------------------------------------ | ------------------------------------------------------------- |
| Install all workspace deps                 | `bolt install`                                                |
| Lint everything                            | `yarn lint`                                                   |
| Run the full test suite                    | `yarn test`                                                   |
| Run only the library tests                 | `bolt w openapi-merge test`                                   |
| Build the library                          | `bolt w openapi-merge build`                                  |
| Watch-build the library                    | `bolt w openapi-merge build -w`                               |
| Build the CLI                              | `bolt w openapi-merge-cli build`                              |
| Regenerate the CLI JSON Schema             | `bolt w openapi-merge-cli run gen-schema`                     |
| Regenerate the CLI Markdown docs           | `bolt w openapi-merge-cli run gen-docs`                       |
| Run the CLI in dev mode                    | `yarn cli` (or `bolt w openapi-merge-cli run start`)          |
| Run the CLI against the example config     | `yarn cli -- --config packages/openapi-merge-cli/openapi-merge.test.json` |
| Publish (CI only, on `main`)               | Handled automatically by `npm-publish.yml` after version bump |

---

## 11. License

MIT — see `LICENSE` at the repository root.
