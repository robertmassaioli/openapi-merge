# Release Notes — v2.0.2

**Covers:** every change merged to `main` since the last published release,
`openapi-merge@1.3.3` / `openapi-merge-cli@1.3.2` (commit `bc232e4`,
2024-06-06), through `e9eb16c` (2026-08-06).

**Why 2.0.2, not 1.5.0:** several changes below are behavior-breaking —
most significantly, inputs that previously merged silently (while quietly
losing data) now fail fast with a distinct exit code. `package.json` had
already been bumped to `1.4.0` for the first of these (commit `1327cbf`)
but never published; enough has landed since to warrant a major version
instead of continuing to stack minors on an unpublished bump.

**Why `.2`, not `.0`:** two prior tags never actually reached npm.
`v2.0.0`'s publish run failed before anything was uploaded (`bun publish`
couldn't authenticate — see `scripts/publish-changed.sh`'s fix). `v2.0.1`'s
publish run got past that, but then failed with a misleading `E404` on the
`PUT` for a package that demonstrably already exists: npm's dead
`NPM_AUTH_TOKEN` secret (last touched 2021) fell back to a stale token,
because the workflow had neither requested an OIDC token nor run an npm new
enough to use one, so setting up a Trusted Publisher on npmjs.com alone had
no effect (fixed in the `npm-publish.yml` update wiring up
`permissions: id-token: write` plus a Node 22 / npm 11.5.1+ step for the
publish job specifically). The registry has never seen a `2.0.0` or a
`2.0.1`, so this release goes out as `2.0.2`.

Both packages are version-locked and release together: `openapi-merge` and
`openapi-merge-cli` both go to `2.0.2`.

---

## Breaking changes

- **Inputs' OpenAPI versions are now read and validated before any merging
  happens** (issue [#113](https://github.com/robertmassaioli/openapi-merge/issues/113),
  proposal [26](26-proposal-oas-phase1-version-checking.md)). Previously the
  `openapi` field was never read: every input was merged under 3.0
  assumptions, unrecognised constructs were silently dropped, and the output
  was stamped `3.0.3` regardless — with exit code `0`. Now:
  - a missing, malformed, or unsupported `openapi` version fails with error
    type `unsupported-openapi-version`;
  - inputs disagreeing on major.minor fails with `mixed-openapi-versions`;
  - both surface as CLI exit code `9` (`ExitCode.ErrorOpenApiVersion`),
    distinct from the general `ErrorMerging` (`3`), because the remedy
    differs — the merge config isn't wrong, the inputs were never eligible
    to be merged together.

  **If your CI never noticed a previously-silent, data-losing merge, it will
  now fail there instead.** That's the point of the change, but it is a
  behavior break worth testing before upgrading. There is no automatic
  upgrading of a mismatched input to a common version — that was
  investigated (proposal [25](25-proposal-mixed-version-inputs.md)) and
  explicitly deferred; today's answer to a version mismatch is refuse, not
  auto-convert.

- **The CLI now propagates a non-zero exit code on every failure path**,
  including previously-uncaught exceptions (issue [#92](https://github.com/robertmassaioli/openapi-merge/issues/92)).
  A broken merge that used to exit `0` and pass CI silently will now
  correctly fail it. Every exit code is now a documented, stable enum
  (`ExitCode`) re-exported from the package for scripted consumers.

- **`formatting` configuration's shape changed** (issue [#114](https://github.com/robertmassaioli/openapi-merge/issues/114)).
  The old shape allowed self-contradictory configuration
  (`{ indent: number | 'tab', useTabs: boolean }` — nothing stopped
  `{ indent: 4, useTabs: true }`). It's now a discriminated union:

  ```json
  { "formatting": { "style": "spaces", "width": 2 } }
  { "formatting": { "style": "tabs" } }
  ```

  A config file using the old `indent`/`useTabs` fields needs updating to
  the `style`-keyed shape.

- **Minimum Node version is now declared explicitly: `engines.node >= 18`.**
  Previously undeclared. This is the version CI actually pins and verifies
  the bundled CLI artifact against (proposal
  [29](29-proposal-node-runtime-verification.md)), and lines up with
  removing the `isomorphic-fetch`/`es6-promise` polyfills in favor of
  Node's native `fetch` — this makes an already-true floor explicit and
  enforced by npm/yarn instead of implicit.

- **`atlassian-openapi` → `@atlassian/atlassian-openapi`** (issue [#115](https://github.com/robertmassaioli/openapi-merge/issues/115)).
  The unscoped package is deprecated and frozen upstream. The scoped
  replacement is a direct republish of the same source, so there's no type
  or runtime surface change in anything `openapi-merge` exports — but if you
  depended on the unscoped package transitively through this library,
  that transitive dependency is gone.

- **`commander` upgraded 5 → 15** (ten major versions), and the CLI's
  internal option-reading switched from the old `program.config`-style
  direct-property access to `program.opts<CliOptions>()`. Verified: no
  existing flag was removed or renamed (`-c`/`--config` is unchanged); two
  flags were added (`--restrict-output-to`, `--restrict-input-to`, see
  below). Existing invocations should be unaffected.

## New features — library (`openapi-merge`)

- **OpenAPI 3.1 and 3.2 support**, including 3.1 `webhooks` (issues
  [#113](https://github.com/robertmassaioli/openapi-merge/issues/113),
  [#96](https://github.com/robertmassaioli/openapi-merge/issues/96)),
  shipped in three phases: version detection/refusal (breaking change,
  above), 3.1 merging, then 3.2 merging (proposals
  [26](26-proposal-oas-phase1-version-checking.md)/[27](27-proposal-oas-phase2-31-support.md)/[28](28-proposal-oas-phase3-32-support.md)).
- **Cross-document `$ref` resolution**, opt-in via
  `resolveExternalReferences` (issues [#104](https://github.com/robertmassaioli/openapi-merge/issues/104),
  [#10](https://github.com/robertmassaioli/openapi-merge/issues/10)) — follows
  `$ref`s into files/URLs that aren't declared inputs, pulling in only the
  components actually referenced, with correct path rewriting and a cycle
  guard covering both local and cross-document reference cycles (proposals
  [36](issues/36-proposal-104-external-ref-rewriting.md)/[45](45-proposal-external-ref-equality-in-dedup.md)/[46](46-proposal-local-reference-cycle-guard.md)).
- **Configurable `duplicatePathHandling`** (issue [#71](https://github.com/robertmassaioli/openapi-merge/issues/71)):
  `error` (default, unchanged) / `skip-later` / `prefer-later` /
  `merge-operations` (new — combine two inputs' path items when their
  method sets don't overlap and their path-level fields agree).
- **Configurable `serversStrategy`** (issue [#4](https://github.com/robertmassaioli/openapi-merge/issues/4)):
  `first` (default) or `concat` (deduplicated by URL).
- **Configurable `securitySchemesStrategy`** (issue [#33](https://github.com/robertmassaioli/openapi-merge/issues/33)):
  `merge` (default), `first`, or `error`.
- **`pruneUnusedComponents`** (issue [#94](https://github.com/robertmassaioli/openapi-merge/issues/94)):
  drop components nothing in the merged output references — pairs well with
  operation selection, which can otherwise leave orphaned schemas behind.
- **`extensionMergeStrategies`** (issue [#60](https://github.com/robertmassaioli/openapi-merge/issues/60),
  proposal [48](48-proposal-configurable-extension-merge-strategies.md)):
  a recursive, configurable merge-strategy tree for document-root `x-*`
  extensions. Default behavior (first-wins) is unchanged; any extension can
  now be configured to concatenate, deduplicate, union array elements by a
  key field, deep-merge object fields, or fail the merge on disagreement —
  down to the exact path inside the extension's value. This generalizes
  (and replaces) the earlier `x-tagGroups`-only proposal
  ([#127](https://github.com/robertmassaioli/openapi-merge/pull/127),
  closed in favor of this — see
  [issue #60](https://github.com/robertmassaioli/openapi-merge/issues/60)
  for the worked example reproducing its exact behavior as configuration).
- **Path-based operation selection**: `includePaths` / `excludePaths`,
  wildcard-matched the same way `includeTags`/`excludeTags` are (proposal
  [44](44-proposal-path-based-operation-selection.md)).
- **Wildcard support in `includeTags` / `excludeTags`** (issue [#111](https://github.com/robertmassaioli/openapi-merge/issues/111)).
- **Per-input tag injection**: tag every operation carried in from a given
  input (issue [#112](https://github.com/robertmassaioli/openapi-merge/issues/112)).
- **Global `info` override**: override `title`/`version`/`description` of
  the merged output, field by field (issue [#102](https://github.com/robertmassaioli/openapi-merge/issues/102)).
- **`dispute.alwaysApply` now renames `operationId`s too**, not just
  component names (issue [#40](https://github.com/robertmassaioli/openapi-merge/issues/40)).
- **`operationId` deduplication inside callbacks** (issue [#105](https://github.com/robertmassaioli/openapi-merge/issues/105)).
- **Discriminator `mapping` rewritten on component rename** (issue [#99](https://github.com/robertmassaioli/openapi-merge/issues/99)),
  and **`defaultMapping` / `Link.operationRef` rewritten correctly** (issue
  [#106](https://github.com/robertmassaioli/openapi-merge/issues/106)).
- **Null-safe document walking**: a `null` in a structural slot now fails
  clearly (`malformed-document`) instead of crashing the process (issue
  [#92](https://github.com/robertmassaioli/openapi-merge/issues/92),
  proposal [40](40-proposal-null-safe-document-walking.md)).

## New features — CLI (`openapi-merge-cli`)

- **`init` command**: scans the current directory for OpenAPI files and
  writes a starter `openapi-merge.yaml`, with every optional setting
  present as a commented-out, documented, working example (proposals
  [33](33-proposal-cli-init-command.md)/[34](34-proposal-init-yaml-commented-options.md)).
  `resolveExternalReferences` and `inputRoot` are turned on by default in
  the generated config (proposal [39](39-proposal-init-convenience-defaults.md)).
- **`inputRoot`**: a read-side containment boundary mirroring the existing
  `outputRoot` — refuses to read any local file, declared or discovered,
  from outside a configured directory (proposal [38](38-proposal-input-root-containment.md)).
- **Missing output directories are created automatically** (previously a
  non-recursive, uncaught-exception failure) (proposal [42](42-proposal-create-output-directories.md)).
- **`inputURL` failures distinguish 4xx / 5xx / other non-2xx statuses**
  with distinct exit codes, instead of one generic failure.
- **Absolute `output` paths resolve correctly**, plus a new `outputRoot`
  safety knob to bound where output can be written (issue [#93](https://github.com/robertmassaioli/openapi-merge/issues/93)).
- **Configurable tab/space output `formatting`** (issue [#114](https://github.com/robertmassaioli/openapi-merge/issues/114)) —
  see the breaking-change note above on its new shape.
- **The CLI is now bundled to a single file** and verified to run correctly
  under both Node and Bun (proposals [29](29-proposal-node-runtime-verification.md)/[30](30-proposal-bundle-the-cli.md)).
- **`--restrict-output-to <dir>` / `--restrict-input-to <dir>`** command-line
  flags, overriding `outputRoot`/`inputRoot` from the config file without
  editing it.

## Documentation

- **New documentation microsite**, built with VitePress and deployed to
  GitHub Pages, covering the library and CLI in full — including a worked,
  typechecked example reproducing `x-tagGroups`'s merge as configuration
  (issue [#149](https://github.com/robertmassaioli/openapi-merge/issues/149)).
  Linked front-and-center from all three READMEs.
- **Generated TypeDoc API reference**, published as part of the docs site.
- **Interactive library playground** on the docs site.
- **Generated JSON Schema for the CLI configuration published to the docs
  site**; the old `gen-docs`/`jsonschema2md` script retired — it ran in no
  build or CI path and pulled in a vulnerable transitive dependency with no
  other consumer (proposal [49](49-proposal-retire-gen-docs.md)).
- All three READMEs enriched and corrected for accuracy drift (proposal
  [43](issues/43-proposal-149-readme-and-api-docs.md)).

## Tooling, infrastructure, and dependencies

- **Build and test tooling migrated to Bun and `tsgo`** (the Go-based
  TypeScript compiler) — a significant build-time improvement; see
  [`bun-tsgo-migration-build-timings.md`](bun-tsgo-migration-build-timings.md)
  for measured numbers.
- **Code coverage measurement made honest and enforced** (`bun test
  --coverage`), with the gaps that measurement then exposed subsequently
  closed.
- Whole-repo `typecheck` script folded into `lint`; CI gained a dedicated
  build job alongside coverage reporting.
- **npm publish now gated on a published GitHub Release**, rather than
  firing on every push to `main` (proposal [41](41-proposal-release-gated-npm-publish.md)).
- **`npm-publish.yml` publishes via `npm publish` over npm Trusted Publishing
  (OIDC)**, instead of a long-lived `NPM_AUTH_TOKEN` secret and `bun publish`
  (which doesn't reliably read `.npmrc` auth — see the `.2` note above). The
  publish job requests a GitHub OIDC token (`permissions: id-token: write`)
  and runs it under Node 22 / npm ≥ 11.5.1, npm's stated floor for trusted
  publishing, separate from the Node 18 pin the artifact-verification step
  still deliberately tests against.
- **Dependabot** configured for both the `bun` and `github-actions`
  ecosystems, monthly.
- Dependency upgrades: `ajv` 6→8 (+ `ajv-formats`), `js-yaml` 3→5,
  `commander` 5→15, `eslint` 7→10 + `typescript-eslint` 2→8, `husky` 7→9,
  `@adobe/jsonschema2md` 6→8 (later retired entirely), plus routine GitHub
  Actions version bumps.
- **`bun audit` findings triaged**: 3 of 4 fixed directly; the 4th's only
  consumer (the now-retired `gen-docs` script) was removed rather than kept
  as an accepted risk.

## New error types

`ErrorType` (the library's `MergeResult` discriminant) held four values at
1.3.3: `no-inputs`, `duplicate-paths`, `component-definition-conflict`,
`operation-id-conflict`. Six more are new since then:

| Error type | Meaning |
| --- | --- |
| `unsupported-openapi-version` | An input's `openapi` field is missing, malformed, or names an unsupported version. |
| `mixed-openapi-versions` | Inputs disagree on major.minor OpenAPI version. |
| `duplicate-webhooks` | Two inputs declare the same 3.1 webhook event name and can't be reconciled. |
| `cyclic-external-reference` | A `$ref` cycle was detected while resolving external references. |
| `malformed-document` | A structurally-required value was `null` where a value was required. |
| `extension-merge-conflict` | An `x-*` extension configured with the `error` strategy disagreed across inputs. |
