# AI Planning

Design documents and implementation proposals, written before the work rather
than after it. Each records what was measured, what was decided, and — where it
matters — where the proposal turned out to be wrong.

## Layout

```
ai-planning/
├── issues/          proposals that address a specific GitHub issue
└── *.md             everything else
```

### The `NN-` prefix

Every proposal — in `issues/` and at the top level alike — is prefixed with a
two-digit number giving the **order in which it was written**. The sequence is
global: `01` is the oldest proposal in the repository and `29` the newest,
regardless of which directory it lives in.

The numbers were derived from git history, from each file's *first* commit
(`git log --follow --diff-filter=A`, so the move into `issues/` did not reset
anything). Two consequences worth knowing:

- Several proposals were committed together with the implementation they
  describe, so the number reflects when the file first landed in git, not the
  hour it was drafted.
- `01`–`05` all share a single commit ("Add implementation proposals for top 5
  prioritised issues") and cannot be separated by timestamp. They are ordered by
  the ranking in
  [`issue-triage-value-vs-effort.md`](issue-triage-value-vs-effort.md), which is
  the order they were worked through.

Documents that are records rather than proposals — the triage, the findings, the
build timings — are not numbered.

### `issues/`

One proposal per GitHub issue, named `NN-proposal-<issue-number>-<slug>.md`.
Every file in here links to its issue at the top and carries a status
(`Proposal` / `✅ Fixed` / `⛔ Superseded`).

Start from [`issue-triage-value-vs-effort.md`](issue-triage-value-vs-effort.md),
which scores every open issue by value and effort and links to the proposal for
each one that has been written up.

### Top level

Cross-cutting work that no single issue asked for — tooling, test coverage,
dependency health, build migrations. Named by topic rather than by issue number.

| Document | What it covers |
| --- | --- |
| [`20-proposal-cli-test-coverage.md`](20-proposal-cli-test-coverage.md) | ⛔ Superseded by the two below; kept for history |
| [`21-proposal-code-coverage.md`](21-proposal-code-coverage.md) | Making the coverage numbers trustworthy and enforced |
| [`22-proposal-closing-coverage-gaps.md`](22-proposal-closing-coverage-gaps.md) | Closing the gaps that measurement then exposed |
| [`23-proposal-dependency-updates.md`](23-proposal-dependency-updates.md) | Dependency audit and the phased upgrade path |
| [`24-proposal-openapi-3.2-support.md`](24-proposal-openapi-3.2-support.md) | What it would take to support OpenAPI 3.1 / 3.2 |
| [`25-proposal-mixed-version-inputs.md`](25-proposal-mixed-version-inputs.md) | Policy for inputs of differing versions, and automatic upgrading |
| [`26-proposal-oas-phase1-version-checking.md`](26-proposal-oas-phase1-version-checking.md) | ✅ Phase 1: detect the input versions and refuse mixed majors |
| [`27-proposal-oas-phase2-31-support.md`](27-proposal-oas-phase2-31-support.md) | ✅ Phase 2: merging OpenAPI 3.1, including webhooks |
| [`28-proposal-oas-phase3-32-support.md`](28-proposal-oas-phase3-32-support.md) | ✅ Phase 3: merging OpenAPI 3.2 |
| [`29-proposal-node-runtime-verification.md`](29-proposal-node-runtime-verification.md) | ✅ Building with Bun while proving the artifacts run on Node |
| [`30-proposal-bundle-the-cli.md`](30-proposal-bundle-the-cli.md) | ✅ Bundling the CLI so it runs under both Node and Bun; reduces 29 |
| [`33-proposal-cli-init-command.md`](33-proposal-cli-init-command.md) | ✅ An `init` command that writes a starter configuration, scanning for inputs |
| [`34-proposal-init-yaml-commented-options.md`](34-proposal-init-yaml-commented-options.md) | ✅ `init` writes YAML with every optional field present, commented out |
| [`35-proposal-commented-yaml-section-type.md`](35-proposal-commented-yaml-section-type.md) | Evaluates a typed `Section`/`CommentedYaml` refactor of how 34's generator builds that file |
| [`38-proposal-input-root-containment.md`](38-proposal-input-root-containment.md) | ✅ `inputRoot` — a read-side containment boundary mirroring `outputRoot`, closing the gap proposal 37 left open |
| [`39-proposal-init-convenience-defaults.md`](39-proposal-init-convenience-defaults.md) | ✅ `resolveExternalReferences` + `inputRoot` turned on by default in `init`'s output |
| [`40-proposal-null-safe-document-walking.md`](40-proposal-null-safe-document-walking.md) | ✅ Systemic fix for `typeof null === 'object'` crashes across the reference walker; review of PR #97 |
| [`41-proposal-release-gated-npm-publish.md`](41-proposal-release-gated-npm-publish.md) | `npm-publish.yml` triggers on a published GitHub Release instead of every push to `main` |
| [`42-proposal-create-output-directories.md`](42-proposal-create-output-directories.md) | Auto-create missing output directories, improving on PR #88's non-recursive, uncaught-exception approach |
| [`44-proposal-path-based-operation-selection.md`](44-proposal-path-based-operation-selection.md) | ✅ `includePaths`/`excludePaths`, wildcard-matched like `TagMatcher` (review of PR #67) |
| [`45-proposal-external-ref-equality-in-dedup.md`](45-proposal-external-ref-equality-in-dedup.md) | ✅ `CrossDocumentLookup`: component dedup resolves a cross-document `$ref` instead of crashing on it (PR #87) |
| [`46-proposal-local-reference-cycle-guard.md`](46-proposal-local-reference-cycle-guard.md) | ✅ Reimplements `CrossDocumentLookup`'s resolution directly so a single cycle guard covers local and cross-document refs alike |
| [`48-proposal-configurable-extension-merge-strategies.md`](48-proposal-configurable-extension-merge-strategies.md) | ✅ A recursive merge-strategy tree for `x-*` extensions, mirroring the extension's own JSON shape (generalises issue #60 / PR #127) |
| [`49-proposal-retire-gen-docs.md`](49-proposal-retire-gen-docs.md) | Retire `gen-docs`/`@adobe/jsonschema2md` (redundant with the docs site, and the last `bun audit` finding); publish the raw JSON Schema instead |
| [`release-notes-2.0.1.md`](release-notes-2.0.1.md) | Everything merged since the last published release (1.3.3/1.3.2), for the upcoming 2.0.1 |
| [`issue-triage-value-vs-effort.md`](issue-triage-value-vs-effort.md) | Value/effort scoring of every open issue; the index into `issues/` |
| [`spec-edge-case-findings.md`](spec-edge-case-findings.md) | Divergences between the merge and the spec, found by edge-case testing |
| [`bun-tsgo-migration-build-timings.md`](bun-tsgo-migration-build-timings.md) | Measured build timings for the Bun + tsgo migration |

## Conventions

- **A proposal is written before the implementation** and updated with results
  afterwards, including any prediction that turned out to be wrong. The
  corrections are the most useful part; do not quietly edit them away.
- **Claims are measured, not assumed.** If a proposal states a number, it was
  produced by running something.
- **Superseded documents are marked, not deleted.** They record why an approach
  was abandoned.
