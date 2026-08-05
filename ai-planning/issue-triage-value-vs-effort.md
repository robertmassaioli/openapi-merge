# openapi-merge — Open Issue Triage (Value vs. Effort)

> Generated: Thursday, 2026-05-21 08:52
>
> Source: <https://github.com/robertmassaioli/openapi-merge/issues> (open issues only)
>
> Scope: All **open** GitHub issues at the time of generation. Closed issues are
> intentionally omitted.
>
> Disclaimer: These rankings are AI-generated, opinionated estimates intended as
> a *starting point* for backlog grooming. "Value" and "effort" are scored on a
> 1–5 scale; weighting reflects this repository's API-gateway use case and the
> maintainer's stated design intent in `AGENTS.md` and the README. Real
> prioritization should incorporate user demand, maintainer bandwidth, and
> compatibility constraints not visible here.

---

## 1. Scoring System

### Value (1–5) — "What do users get?"
| Score | Meaning                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------ |
| 5     | Unlocks a major new use case OR removes a blocker affecting many users (data corruption, crash). |
| 4     | Strongly requested feature; fixes a confusing/silent bug; broadens supported inputs.             |
| 3     | Quality-of-life feature, niche correctness fix, useful CI-friendly tweak.                        |
| 2     | Convenience / polish; small ergonomic improvement.                                               |
| 1     | Minor cosmetic change with few known users.                                                      |

### Effort (1–5) — "How much work is it?"
| Score | Meaning                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------- |
| 1     | < 1 hour. Trivial config flag, doc update, version bump, one-line bug fix with obvious test.        |
| 2     | A few hours. Localized change with new Jest cases.                                                  |
| 3     | < 1 day. Cross-cutting code change; needs new reference-walker rules and dedicated tests.            |
| 4     | Multi-day. Affects public API or merging semantics; needs careful design + significant test churn.   |
| 5     | Major project. New spec dialect / loading model / dependency replacement.                            |

### Priority Quadrants

```
         LOW EFFORT       HIGH EFFORT
HIGH    ┌──────────────┬──────────────┐
VALUE   │  Quick Wins  │  Big Bets    │
        ├──────────────┼──────────────┤
LOW     │  Fill-ins    │  Avoid /     │
VALUE   │              │  Defer       │
        └──────────────┴──────────────┘
```

ROI score in the per-issue tables below is `value * 2 - effort` (range −3…+9).
Higher is better; ties broken by lower effort first.

---

## 2. Quick-Reference Ranked Backlog

> The **Proposal** column links to a detailed implementation proposal in this
> directory. Status legend in that column: ✅ Fixed and merged to `main`;
> 📝 Proposal written, awaiting implementation; — no proposal yet.

| Rank | # | Title | Value | Effort | ROI | Quadrant | Proposal |
| ---: | --- | --- | :-: | :-: | :-: | --- | --- |
| 1 | [#92](https://github.com/robertmassaioli/openapi-merge/issues/92) | Uncaught exception does not set failure status code | 5 | 1 | **9** | Quick Win | ✅ [01-proposal-92-exit-code.md](issues/01-proposal-92-exit-code.md) |
| 2 | [#115](https://github.com/robertmassaioli/openapi-merge/issues/115) | Out of date dependency (`atlassian-openapi` deprecation) | 5 | 1 | **9** | Quick Win | ✅ [02-proposal-115-dep-update.md](issues/02-proposal-115-dep-update.md) |
| 3 | [#93](https://github.com/robertmassaioli/openapi-merge/issues/93) | Leading `/` is stripped from output path | 4 | 1 | **7** | Quick Win | ✅ [03-proposal-93-absolute-paths.md](issues/03-proposal-93-absolute-paths.md) |
| 4 | [#76](https://github.com/robertmassaioli/openapi-merge/issues/76) | Fix / configure emitted OpenAPI version | 4 | 1 | **7** | Quick Win | 📝 [04-proposal-76-openapi-version.md](issues/04-proposal-76-openapi-version.md) |
| 5 | [#114](https://github.com/robertmassaioli/openapi-merge/issues/114) | Provide tab/space formatting options | 3 | 1 | **5** | Quick Win | ✅ [05-proposal-114-formatting.md](issues/05-proposal-114-formatting.md) |
| 6 | [#111](https://github.com/robertmassaioli/openapi-merge/issues/111) | Support wildcards in include/excludeTags | 4 | 2 | **6** | Quick Win | 📝 [08-proposal-111-wildcard-tags.md](issues/08-proposal-111-wildcard-tags.md) |
| 7 | [#40](https://github.com/robertmassaioli/openapi-merge/issues/40) | `dispute.alwaysApply` ineffective on `operationId`s | 4 | 2 | **6** | Quick Win | 📝 [06-proposal-40-dispute-operationid.md](issues/06-proposal-40-dispute-operationid.md) |
| 8 | [#105](https://github.com/robertmassaioli/openapi-merge/issues/105) | Callback `operationId` not included in dispute resolving | 4 | 2 | **6** | Quick Win | 📝 [07-proposal-105-callback-operationid.md](issues/07-proposal-105-callback-operationid.md) |
| 9 | [#106](https://github.com/robertmassaioli/openapi-merge/issues/106) | Discriminator mappings not prefixed under disputes | 4 | 2 | **6** | Quick Win | 📝 [09-proposal-106-discriminator-mappings.md](issues/09-proposal-106-discriminator-mappings.md) |
| 10 | [#99](https://github.com/robertmassaioli/openapi-merge/issues/99) | Discriminator mapping not resolved under dispute prefix | 4 | 2 | **6** | Quick Win | 📝 [10-proposal-99-discriminator-mapping-prefix.md](issues/10-proposal-99-discriminator-mapping-prefix.md) |
| 11 | [#102](https://github.com/robertmassaioli/openapi-merge/issues/102) | Global title/description override in config | 3 | 2 | **4** | Quick Win | 📝 [14-proposal-102-global-info-override.md](issues/14-proposal-102-global-info-override.md) |
| 12 | [#45](https://github.com/robertmassaioli/openapi-merge/issues/45) | Allow CLI use without a config file | 3 | 2 | **4** | Quick Win | 📝 [13-proposal-45-no-config.md](issues/13-proposal-45-no-config.md) |
| 13 | [#60](https://github.com/robertmassaioli/openapi-merge/issues/60) | `x-tagGroups` only keeps first file's tags | 3 | 2 | **4** | Quick Win | 📝 [12-proposal-60-x-tag-groups.md](issues/12-proposal-60-x-tag-groups.md) |
| 14 | [#71](https://github.com/robertmassaioli/openapi-merge/issues/71) | Flag to skip duplicate paths | 4 | 3 | **5** | Big Bet (low) | 📝 [11-proposal-71-skip-duplicate-paths.md](issues/11-proposal-71-skip-duplicate-paths.md) |
| 15 | [#112](https://github.com/robertmassaioli/openapi-merge/issues/112) | Option to merge an input into a tag | 4 | 3 | **5** | Big Bet (low) | 📝 [15-proposal-112-merge-into-tag.md](issues/15-proposal-112-merge-into-tag.md) |
| 16 | [#100](https://github.com/robertmassaioli/openapi-merge/issues/100) | Merge paths based on specific tags (refinement of `includeTags`) | 3 | 2 | **4** | Quick Win | 📝 [18-proposal-100-tag-based-path-merge.md](issues/18-proposal-100-tag-based-path-merge.md) |
| 17 | [#33](https://github.com/robertmassaioli/openapi-merge/issues/33) | Merge `securitySchemes` across input files | 4 | 3 | **5** | Big Bet (low) | 📝 [19-proposal-33-security-schemes.md](issues/19-proposal-33-security-schemes.md) |
| 18 | [#4](https://github.com/robertmassaioli/openapi-merge/issues/4) | Servers array is not concatenated/merged | 3 | 2 | **4** | Quick Win | 📝 [16-proposal-4-servers-merge.md](issues/16-proposal-4-servers-merge.md) |
| 19 | [#61](https://github.com/robertmassaioli/openapi-merge/issues/61) | Authorization config for `inputURL` | 3 | 2 | **4** | Quick Win | 📝 [17-proposal-61-input-url-auth.md](issues/17-proposal-61-input-url-auth.md) |
| 20 | [#94](https://github.com/robertmassaioli/openapi-merge/issues/94) | `excludeTags` does not remove unreferenced schemas | 3 | 3 | **3** | Big Bet (low) | — |
| 21 | [#75](https://github.com/robertmassaioli/openapi-merge/issues/75) | `atlassian-openapi` types incompatible with `openapi-types` | 3 | 3 | **3** | Big Bet (low) | — |
| 22 | [#104](https://github.com/robertmassaioli/openapi-merge/issues/104) | Incorrect `$ref` paths in bundled file | 4 | 3 | **4** | Big Bet (low) | ✅ [36-proposal-104-external-ref-rewriting.md](issues/36-proposal-104-external-ref-rewriting.md) |
| 23 | [#8](https://github.com/robertmassaioli/openapi-merge/issues/8) | Merge duplicate OAS paths using `disputePrefix` | 4 | 4 | **4** | Big Bet | — |
| 24 | [#109](https://github.com/robertmassaioli/openapi-merge/issues/109) | Conflict-resolution strategies for duplicate paths | 4 | 4 | **4** | Big Bet | — |
| 25 | [#110](https://github.com/robertmassaioli/openapi-merge/issues/110) | Swagger 2 "definitions" not included | 2 | 3 | **1** | Fill-in / Defer | — |
| 26 | [#10](https://github.com/robertmassaioli/openapi-merge/issues/10) | Resolve / bundle external `$ref`s | 5 | 5 | **5** | Big Bet | ✅ [37-proposal-10-external-ref-bundling.md](issues/37-proposal-10-external-ref-bundling.md) (Option 2-refined) |
| 27 | [#113](https://github.com/robertmassaioli/openapi-merge/issues/113) | Add support for OpenAPI 3.1.x | 5 | 5 | **5** | Big Bet | ✅ [26](issues/26-proposal-oas-phase1-version-checking.md)/[27](issues/27-proposal-oas-phase2-31-support.md)/[28](issues/28-proposal-oas-phase3-32-support.md) |
| 28 | [#96](https://github.com/robertmassaioli/openapi-merge/issues/96) | OpenAPI 3.1 `webhook` support | 3 | 4 | **2** | Big Bet | ✅ Closed 2026-08-01, shipped with #113 |
| 29 | [#149](https://github.com/robertmassaioli/openapi-merge/issues/149) | Improve repository documentation (microsite + playground) | 3 | 2 | **4** | Quick Win | ✅ [43-proposal-149-readme-and-api-docs.md](issues/43-proposal-149-readme-and-api-docs.md) (options 1–2 of 4; shipped as [#151](https://github.com/robertmassaioli/openapi-merge/pull/151)) |
| 30 | [#149](https://github.com/robertmassaioli/openapi-merge/issues/149) | Documentation microsite (option 3 of 4) | 4 | 3 | **5** | Big Bet (low) | ✅ [47-proposal-149-documentation-microsite.md](issues/47-proposal-149-documentation-microsite.md) — implemented (`packages/docs-site`) |
| 31 | [#149](https://github.com/robertmassaioli/openapi-merge/issues/149) | Interactive library playground (option 4 of 4) | 3 | 3 | **3.7** | Quick Win | ✅ [50-proposal-149-playground.md](issues/50-proposal-149-playground.md) — implemented (`/playground` on the docs site) |

---

## 3. Quadrant Summary

### 3.1 Quick Wins (High value, low effort) — do these next sprint
- **#92** — Uncaught CLI exceptions must propagate a non-zero exit code (CI users
  silently green-light bad merges today). Library already returns structured
  errors; this only needs `cli.ts` to `process.exit(1)` in the `.catch`.
- **#115** — Update the `atlassian-openapi` dependency to its new
  `@atlassian/atlassian-openapi` home; this is currently emitting deprecation
  warnings on every install of the CLI.
- **#93** — Trim `path.join` munging so absolute output paths like `/tmp/...`
  work; the bug looks isolated to one `path.join` in `cli/src/index.ts`.
- **#76** — Allow the user to choose the emitted OpenAPI version (today
  hard-coded to `3.0.3` in `paths-and-components.ts`/`index.ts`).
- **#114** — Indentation option (tabs vs. spaces, width). Affects JSON write and
  the `yaml.safeDump({ indent })` call in `writeOutput`.

### 3.2 Dispute-engine cluster (medium value, mostly small effort) — group these
A bunch of issues describe the same root cause: the reference-walker / dispute
machinery doesn't visit *every* place a `$ref` or named identifier can appear.
Bundling them into a single release would amortize the design work:

- **#40** — `dispute.alwaysApply` doesn't apply to `operationId`.
- **#105** — Callback `operationId`s skipped by the dispute pass.
- **#106** — Discriminator `mapping` values not prefixed.
- **#99** — Discriminator mapping `$ref`s not renamed.

Suggested approach: extend `reference-walker.ts` to visit discriminator
mappings + callbacks, then route both through `dispute.applyDispute` with
matching tests in `__tests__/components.test.ts`.

### 3.3 Big Bets (high value, high effort) — quarter-sized investments
- ~~**#113** OpenAPI 3.1 support~~ — ✅ **Done.** Landed as the phase 1/2/3
  work in [26](issues/26-proposal-oas-phase1-version-checking.md)/
  [27](issues/27-proposal-oas-phase2-31-support.md)/
  [28](issues/28-proposal-oas-phase3-32-support.md) (3.1 *and* 3.2, plus
  webhooks — this bucket undersold it). This entry stayed marked as
  unstarted "major 2.0" work well after it shipped; caught while triaging
  #104/#96 and corrected here rather than left to drift further.
- **#10** Resolve / bundle external `$ref`s — explicitly designed-around in the
  current architecture (the README of #10 notes that `merge()` is intentionally
  synchronous). Big change either way; could be delegated to a pre-pass /
  external tool (`@apidevtools/swagger-parser`) as #10's author suggests.
- **#8 / #109 / #71** Duplicate-path handling family — needs a configurable
  policy (`error` | `skip` | `merge` | `prefix`) with care to preserve the
  current strict semantics for users who rely on them.
- **#104** Incorrect `$ref` paths after bundling. Reproduced (still broken on
  `main`) and does **not** need #10: every broken ref in the report points at
  a file that's already a declared merge input, which is a narrower,
  separately fixable problem. See
  [36-proposal-104-external-ref-rewriting.md](issues/36-proposal-104-external-ref-rewriting.md).

### 3.4 Fill-ins (low value, low effort) — only if convenient
- **#102** Global title/description override — small CLI config patch.
- **#45** No-config CLI mode — convenience for one-file merges; small flag work.
- **#60** `x-tagGroups` merging — special-case extension merge; only matters
  for ReDoc users.
- **#100** Per-input tag filtering — duplicates much of the existing
  `includeTags`; mostly docs/clarification.

### 3.5 Defer / Avoid
- **#110** "Definitions not included" — user is on Swagger 2; project is OAS
  3.x only and Swagger 2 support has already been declined (closed issue #6).
  Recommend closing with a pointer to a v2→v3 converter.
- ~~**#96** OpenAPI 3.1 webhooks~~ — ✅ **Done and closed.** Shipped with
  #113's phase 2 work; re-verified end-to-end and closed 2026-08-01.

---

## 4. Per-Issue Detail

Each entry includes the issue title (linked), a short summary, the reasoning
behind the value/effort scores, and a suggested implementation pointer.

### Tier 1 — Quick Wins

#### [#92 — Uncaught exception does not set failure status code](https://github.com/robertmassaioli/openapi-merge/issues/92)
- **Value 5 / Effort 1 / ROI 9** — **Status:** ✅ Fixed (see [01-proposal-92-exit-code.md](issues/01-proposal-92-exit-code.md))
- **Why it matters:** CI pipelines that pipe `npx openapi-merge-cli` into
  artifact upload silently succeed even when the merge crashes (the user even
  showed `echo $?` returning 0). This is the single highest-leverage fix.
- **Pointer:** `packages/openapi-merge-cli/src/cli.ts` — the `main().catch(...)`
  must call `process.exit(1)` after logging. Also worth wrapping the deeper
  `compare()` recursion in `component-equivalence.ts` to handle `null` values
  (the actual crash in this report).

#### [#115 — Out of date dependency](https://github.com/robertmassaioli/openapi-merge/issues/115)
- **Value 5 / Effort 1 / ROI 9** — **Status:** ✅ Fixed (see [02-proposal-115-dep-update.md](issues/02-proposal-115-dep-update.md))
- **Why it matters:** Every install warns that `atlassian-openapi` has moved
  to `@atlassian/atlassian-openapi`. The deprecation will eventually become an
  install failure.
- **Pointer:** Bump dependency in both packages, retest, release a patch
  version. May need a minor API tweak if the new package's types diverge.

#### [#93 — Leading `/` is stripped from output path](https://github.com/robertmassaioli/openapi-merge/issues/93)
- **Value 4 / Effort 1 / ROI 7** — **Status:** ✅ Fixed (see [03-proposal-93-absolute-paths.md](issues/03-proposal-93-absolute-paths.md))
- **Why it matters:** Blocks users writing the merged spec into `/tmp` or
  any absolute path (common in containers/CI).
- **Pointer:** `cli/src/index.ts`'s `path.join(basePath, config.output)` —
  detect absolute outputs and skip the join.

#### [#76 — Fixing the OpenAPI version](https://github.com/robertmassaioli/openapi-merge/issues/76)
- **Value 4 / Effort 1 / ROI 7** — **Status:** 📝 Proposal: [04-proposal-76-openapi-version.md](issues/04-proposal-76-openapi-version.md)
- **Why it matters:** Tools like Postman fail on `3.0.3` when their imports
  expect `3.0.0`. Today the version is hard-coded.
- **Pointer:** Add an optional `output.openapiVersion` to the CLI config and
  thread it through `merge()` (or a new param). Default remains `3.0.3`.

#### [#114 — Provide tab and space formatting options](https://github.com/robertmassaioli/openapi-merge/issues/114)
- **Value 3 / Effort 1 / ROI 5** — **Status:** ✅ Fixed (see [05-proposal-114-formatting.md](issues/05-proposal-114-formatting.md))
- **Why it matters:** Helps repos that enforce consistent JSON/YAML
  formatting via lint.
- **Pointer:** Extend `writeOutput` in `cli/src/index.ts` to accept
  `indent` and `useTabs` (or a `formatting` block in config).

#### [#111 — Support wildcards in includeTags / excludeTags](https://github.com/robertmassaioli/openapi-merge/issues/111)
- **Value 4 / Effort 2 / ROI 6** — **Status:** 📝 Proposal: [08-proposal-111-wildcard-tags.md](issues/08-proposal-111-wildcard-tags.md)
- **Why it matters:** Long tag-prefix lists become unmanageable; wildcards
  (or regex) collapse them dramatically.
- **Pointer:** `operation-selection.ts` — replace `tags.includes(tag)` with a
  matcher that understands `*`/regex. Backwards compatible if literal strings
  remain exact-match.

#### [#40 — `dispute.alwaysApply` not effective on operationIds](https://github.com/robertmassaioli/openapi-merge/issues/40)
- **Value 4 / Effort 2 / ROI 6** — **Status:** 📝 Proposal: [06-proposal-40-dispute-operationid.md](issues/06-proposal-40-dispute-operationid.md)
- **Why it matters:** Users expect `alwaysApply` to be universal; the
  inconsistency creates downstream operation-name collisions.
- **Pointer:** `paths-and-components.ts` — move the `alwaysApply` short-circuit
  before the conflict check in `findUniqueOperationId`.

#### [#105 — callback operationId not included in dispute resolving](https://github.com/robertmassaioli/openapi-merge/issues/105)
- **Value 4 / Effort 2 / ROI 6** — **Status:** 📝 Proposal: [07-proposal-105-callback-operationid.md](issues/07-proposal-105-callback-operationid.md)
- **Pointer:** Extend `reference-walker.walkCallbackReferences` / operation
  walker to also visit `operationId` for dispute renaming.

#### [#106 — discriminator mappings not prefixed under disputes](https://github.com/robertmassaioli/openapi-merge/issues/106)
- **Value 4 / Effort 2 / ROI 6** — **Status:** 📝 Proposal: [09-proposal-106-discriminator-mappings.md](issues/09-proposal-106-discriminator-mappings.md)
- **Pointer:** `reference-walker.walkSchemaReferences` should also rewrite
  `discriminator.mapping` values. Add a dedicated test.

#### [#99 — Issue on discriminator mapping](https://github.com/robertmassaioli/openapi-merge/issues/99)
- **Value 4 / Effort 2 / ROI 6** — **Status:** 📝 Proposal: [10-proposal-99-discriminator-mapping-prefix.md](issues/10-proposal-99-discriminator-mapping-prefix.md)
- Same family as #106; fix together.

#### [#102 — Global title/description config section](https://github.com/robertmassaioli/openapi-merge/issues/102)
- **Value 3 / Effort 2 / ROI 4** — **Status:** 📝 Proposal: [14-proposal-102-global-info-override.md](issues/14-proposal-102-global-info-override.md)
- **Pointer:** Add an optional `info` block in CLI config that, if present,
  overrides `merge()`'s first-input-wins behaviour for `info.title` and
  `info.description`.

#### [#45 — Use without config files](https://github.com/robertmassaioli/openapi-merge/issues/45)
- **Value 3 / Effort 2 / ROI 4** — **Status:** 📝 Proposal: [13-proposal-45-no-config.md](issues/13-proposal-45-no-config.md)
- **Pointer:** Accept positional file arguments in `commander`; default
  output to `<base>-merged.<ext>`.

#### [#60 — x-tagGroups only keeps first file's tags](https://github.com/robertmassaioli/openapi-merge/issues/60)
- **Value 3 / Effort 2 / ROI 4** — **Status:** 📝 Proposal: [12-proposal-60-x-tag-groups.md](issues/12-proposal-60-x-tag-groups.md)
- **Pointer:** Currently `extensions.ts` does a first-wins merge for all `x-*`
  keys. Add a special case (or a configurable "array-merge" list) so
  `x-tagGroups` arrays concatenate and dedupe.

### Tier 2 — Big Bets (low)

#### [#71 — Possible to skip duplicate paths?](https://github.com/robertmassaioli/openapi-merge/issues/71)
- **Value 4 / Effort 3 / ROI 5** — **Status:** 📝 Proposal: [11-proposal-71-skip-duplicate-paths.md](issues/11-proposal-71-skip-duplicate-paths.md)
- **Pointer:** Introduce `onDuplicatePath: 'error' | 'skip-later' | 'prefer-later'`
  on `SingleMergeInput`. Default to `error` to preserve current behaviour.

#### [#112 — Option to merge into a tag](https://github.com/robertmassaioli/openapi-merge/issues/112)
- **Value 4 / Effort 3 / ROI 5** — **Status:** 📝 Proposal: [15-proposal-112-merge-into-tag.md](issues/15-proposal-112-merge-into-tag.md)
- **Pointer:** New per-input option `tag: { name, append?: { description } }`
  that (1) adds the tag to every operation and (2) optionally appends the
  input's `info.description` to that tag's description in the output.

#### [#100 — Merge paths based on specific tags](https://github.com/robertmassaioli/openapi-merge/issues/100)
- **Value 3 / Effort 2 / ROI 4** — **Status:** 📝 Proposal: [18-proposal-100-tag-based-path-merge.md](issues/18-proposal-100-tag-based-path-merge.md) (recommends close-as-docs)
- Largely already possible via `operationSelection.includeTags`; needs
  documentation + a worked example more than code.

#### [#33 — Merge securitySchemes of input files](https://github.com/robertmassaioli/openapi-merge/issues/33)
- **Value 4 / Effort 3 / ROI 5** — **Status:** 📝 Proposal: [19-proposal-33-security-schemes.md](issues/19-proposal-33-security-schemes.md)
- **Pointer:** In `paths-and-components.ts`, when merging `components`,
  treat `securitySchemes` like other component buckets (dedupe by name with
  dispute fallback). Add a per-input `security` override knob if needed.

#### [#4 — Servers array not concatenated/merged](https://github.com/robertmassaioli/openapi-merge/issues/4)
- **Value 3 / Effort 2 / ROI 4** — **Status:** 📝 Proposal: [16-proposal-4-servers-merge.md](issues/16-proposal-4-servers-merge.md)
- **Pointer:** Make the `servers` merge strategy configurable (`first` |
  `concat`). Keep `first` as default to honour the documented API-gateway
  intent.

#### [#61 — Authorization config for InputUrl](https://github.com/robertmassaioli/openapi-merge/issues/61)
- **Value 3 / Effort 2 / ROI 4** — **Status:** 📝 Proposal: [17-proposal-61-input-url-auth.md](issues/17-proposal-61-input-url-auth.md)
- **Pointer:** Extend `ConfigurationInputFromUrl` with optional `headers`
  (preferred; covers bearer + custom headers). Pass through to `fetch()`.

#### [#94 — excludeTags not removing unwanted schemas](https://github.com/robertmassaioli/openapi-merge/issues/94)
- **Value 3 / Effort 3 / ROI 3**
- **Pointer:** After running `operation-selection`, walk remaining operations
  and prune `components.schemas` entries that are not transitively referenced.
  Needs care for shared schemas.

#### [#75 — atlassian-openapi vs openapi-types incompatibility](https://github.com/robertmassaioli/openapi-merge/issues/75)
- **Value 3 / Effort 3 / ROI 3**
- **Pointer:** Either accept `unknown`/`OpenAPIV3.Document` in `merge()`
  (cast internally) or expose a thin adaptor; document the recommended type
  import.

### Tier 3 — Big Bets

#### [#104 — Incorrect `$ref` in bundled file](https://github.com/robertmassaioli/openapi-merge/issues/104)
- **Value 4 / Effort 3 / ROI 4** *(revised from 4/4 after reproducing it —
  see below)*
- **Not** tightly coupled to #10, as this doc originally guessed. Reproduced
  with the user's exact pattern (stripped down): every broken `$ref` in
  their example points at a file that is itself already a declared merge
  input. That's fixable by extending the existing per-input dispute/rename
  rewriting to also recognise refs pre-qualified with a file path matching
  another input, entirely inside this tool -- no general external-bundling
  (#10) required. See
  [36-proposal-104-external-ref-rewriting.md](issues/36-proposal-104-external-ref-rewriting.md).

#### [#8 — Merge duplicate OAS paths using disputePrefix](https://github.com/robertmassaioli/openapi-merge/issues/8)
- **Value 4 / Effort 4 / ROI 4**
- Existing PR proposal from the original author; revisit and address the
  whole-path-replacement edge case noted in the issue.

#### [#109 — Conflict-resolution strategies when merging](https://github.com/robertmassaioli/openapi-merge/issues/109)
- **Value 4 / Effort 4 / ROI 4**
- Same conceptual space as #71 / #8. Designing a single configurable
  `conflictResolution` policy that subsumes them all would consolidate
  three issues.

### Tier 4 — Strategic / Major

#### [#10 — Resolve / bundle external references](https://github.com/robertmassaioli/openapi-merge/issues/10)
- **Value 5 / Effort 5 / ROI 5**
- The issue itself describes three implementation strategies (not two —
  Robert's own note sketches a distinct "synchronous pre-resolved map"
  design alongside the two he explicitly weighs) and a stated preference
  for pre-bundling via another tool, limiting changes to the CLI. Full
  evaluation, including how it relates to #104's narrower fix, in
  [37-proposal-10-external-ref-bundling.md](issues/37-proposal-10-external-ref-bundling.md) —
  kept at options-and-tradeoffs altitude rather than a design spec, since
  the first open question is whether to take this on at all.

#### [#113 — Add support for OpenAPI 3.1.x](https://github.com/robertmassaioli/openapi-merge/issues/113)
- **Value 5 / Effort 5 / ROI 5**
- ✅ **Done.** Shipped as three phases —
  [26](issues/26-proposal-oas-phase1-version-checking.md) (version
  detection, refuse mixed majors),
  [27](issues/27-proposal-oas-phase2-31-support.md) (3.1 merging, including
  webhooks — subsumed #96 as predicted below), and
  [28](issues/28-proposal-oas-phase3-32-support.md) (3.2). This tier's
  "likely a 2.x major release" framing didn't happen; it shipped as normal
  minor-version work instead.

#### [#96 — OAS 3.1 webhook](https://github.com/robertmassaioli/openapi-merge/issues/96)
- **Value 3 / Effort 4 / ROI 2**
- ✅ **Done, as predicted here — subsumed by #113's phase 2.** Re-verified
  against `main` (dedicated `webhooks.test.ts` coverage, plus a fresh
  end-to-end CLI run merging webhooks from two 3.1 inputs) and closed
  2026-08-01.

### Tier 5 — Defer

#### [#110 — Definitions are not included](https://github.com/robertmassaioli/openapi-merge/issues/110)
- **Value 2 / Effort 3 / ROI 1**
- User is on Swagger 2. Project scope is OpenAPI 3.x only (Swagger 2 was
  explicitly declined in closed issue #6). Recommend closing with a pointer
  to `swagger2openapi`.

---

## 5. Suggested Roadmap

### Patch release (next 1–2 weeks)
- #92 (exit code) + #115 (dep update) + #93 (absolute paths) + #76 (version
  config) + #114 (formatting). All Tier 1 quick wins; together they remove
  the top install/CI pain.

### Minor release "Dispute Completeness"
- Bundle #40, #99, #105, #106 plus #111 (wildcard tags). One coordinated
  pass through `reference-walker.ts` and `dispute.ts` with shared tests.

### Minor release "Conflict Policies"
- #8, #71, #109 designed together as a configurable `conflictResolution`
  block. Also a natural home for #33 (securitySchemes merge) and #4
  (servers concat).

### Minor release "CLI Ergonomics"
- #45 (no-config), #61 (auth headers), #60 (x-tagGroups), #102 (global
  info), #100 (docs), #94 (schema pruning).

### ~~Major release 2.0 — "OpenAPI 3.1"~~ — done, and not as a major release
- #113 and #96 both shipped (see above) as normal minor-version work, not
  the parallel `v2` branch this roadmap entry planned for. #10 and #75
  remain open and don't need 3.1 support as a prerequisite anymore — #10
  now has its own evaluation ([37](issues/37-proposal-10-external-ref-bundling.md)),
  kept deliberately unbucketed pending the "should we become a bundler"
  decision it's actually blocked on. #104 was never in this bucket to begin
  with (see 36) and doesn't need to wait on any of this.

---

## 6. Methodology Notes
- Issues were pulled with `gh issue list --repo robertmassaioli/openapi-merge
  --state all --limit 200` and individual bodies with
  `gh issue view N --json title,body,labels,comments`.
- Closed issues were excluded from the writeup because they no longer
  represent work to be done, but they were skimmed when relevant to dedupe
  proposals (e.g., closed #6 informs the recommendation on #110).
- Effort estimates assume the codebase as it stands today — TypeScript 3.8,
  Node 14, `atlassian-openapi@^1.0.8`, Jest 27. Any modernization of those
  baselines would dramatically increase the effort numbers for the Tier 4
  items.
- This document is intended to be regenerated periodically (e.g., quarterly)
  as new issues arrive.
