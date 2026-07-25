# Implementation Proposal: Dependency Audit and a Progressive Update Path

**Status:** 📝 Proposal — implementation in progress, see §9
**Type:** Maintenance / security
**Scope:** all three `package.json` files
**Date:** 2026-07-25
**Branch:** `chore/dependency-updates`, based on `fix/input-url-http-status`
**Toolchain:** `bun 1.3.14`, `node v25.5.0`

---

## 0. TL;DR

Every dependency in the repository was audited: 3 `package.json` files, 27
declared dependencies, of which **18 are behind** and several are behind by
enough to matter (`commander` 5 → 15, `eslint` 7 → 10,
`@typescript-eslint/*` 2 → 8).

`bun audit` reports **13 vulnerabilities: 1 critical, 6 high, 5 moderate,
1 low.**

Two findings shape the plan more than the version numbers do:

1. **One devDependency causes most of the security exposure.**
   `@adobe/jsonschema2md` pulls in the critical `parse-url` SSRF plus
   `vue-template-compiler`, `ansi-html`, `parse-path`, `braces`, `micromatch`
   and `@babel/core` advisories. It is used by exactly one script, `gen-docs`,
   which runs in no build, no test, no publish path and no CI job. Removing or
   upgrading it is the single highest-value change in this document.
2. **Two production dependencies can simply be deleted.** `es6-promise` is
   declared and **never imported anywhere**. `isomorphic-fetch` exists to
   polyfill `fetch`, which Node has had natively since v18. Dropping both
   removes production dependencies rather than updating them — strictly better.

The plan is ordered by **risk-adjusted value**, not by version distance: free
deletions first, then the security fix, then the breaking upgrades one package
at a time, each independently revertable, with the full suite green after every
phase.

---

## 1. Method

- `bun outdated --filter '*'` for version drift across all workspaces.
- `bun audit` for advisories.
- `grep` over `packages/*/src` to confirm every declared dependency is actually
  imported — this is what found `es6-promise`.
- Breaking API changes were **verified empirically** in a scratch project
  against the real `configuration.schema.json`, not inferred from changelogs
  (§4). Nothing in this document is assumed.

## 2. Full inventory

### Production dependencies

| Package | Workspace | Current | Latest | Verdict |
| --- | --- | --- | --- | --- |
| `@atlassian/atlassian-openapi` | both | 1.0.6 | 1.0.6 | ✅ current |
| `lodash` | library | 4.17.15 | 4.17.x | ✅ current |
| `ts-is-present` | library | 1.1.1 | 1.1.1 | ✅ current |
| `openapi-merge` | cli | workspace | — | n/a |
| `ajv` | cli | 6.15.0 | **8.20.0** | ⚠️ major, `fast-uri` advisory |
| `commander` | cli | 5.1.0 | **15.0.0** | ⚠️ 10 majors behind |
| `js-yaml` | cli | 3.15.0 | **5.2.2** | ⚠️ major, API renamed |
| `isomorphic-fetch` | cli | 3.x | 3.x | 🗑️ **delete** — native `fetch` |
| `es6-promise` | cli | 4.2.8 | 4.2.8 | 🗑️ **delete** — never imported |

### Development dependencies

| Package | Workspace | Current | Latest | Verdict |
| --- | --- | --- | --- | --- |
| `@typescript/native-preview` | both | 7.0.0-dev | pinned | ✅ intentional |
| `@types/lodash` | library | 4.14.150 | 4.14.x | ✅ current |
| `@adobe/jsonschema2md` | cli | 6.1.4 | 8.0.11 | 🔴 **critical CVE**, `gen-docs` only |
| `eslint` | both | 7.32.0 | **10.8.0** | ⚠️ flat config migration |
| `@typescript-eslint/*` | both | 2.34.0 | **8.65.0** | ⚠️ 6 majors behind |
| `@types/jest` | both | 25.2.3 | 30.0.0 | ⚠️ see §5 risk |
| `@types/node` | cli | 22.20.1 | 26.1.1 | ✅ low risk |
| `@types/js-yaml` | cli | 3.12.10 | 4.0.9 | ties to `js-yaml` upgrade |
| `@types/isomorphic-fetch` | cli | 0.0.35 | 0.0.39 | 🗑️ delete with its runtime |
| `typescript-json-schema` | cli | 0.65.1 | 0.68.0 | ✅ low risk, minor |
| `husky` | root | 7.0.4 | 9.1.7 | ⚠️ install command changed |

## 3. Security posture

```
critical  parse-url            SSRF                    <- @adobe/jsonschema2md
high      ansi-html            resource consumption    <- @adobe/jsonschema2md
high      parse-path           authorization bypass    <- @adobe/jsonschema2md
high      braces               resource consumption    <- @adobe/jsonschema2md
high      brace-expansion      DoS                     <- eslint, ts-eslint, tjs, jsonschema2md
high      fast-uri             host confusion          <- ajv
high      js-yaml (4.0-4.1.0)  quadratic CPU           <- transitive
moderate  micromatch           ReDoS                   <- @adobe/jsonschema2md
moderate  vue-template-compiler XSS                    <- @adobe/jsonschema2md
low       @babel/core          arbitrary file read     <- @adobe/jsonschema2md
```

**7 of 10 distinct advisories trace to `@adobe/jsonschema2md` alone.**

Worth keeping in proportion: every one of these is a **devDependency**, reached
only when a maintainer runs `gen-docs` or `lint` locally. None ships to users —
neither published package depends on them, and `files` in both `package.json`s
restricts the tarball to `dist/`. The `fast-uri` advisory under `ajv` is the
only one on a production path, and `ajv` runs against a config file the user
already trusts.

So this is hygiene, not an incident. It does still matter: `bun audit` output
that is permanently red trains people to ignore it.

## 4. Breaking changes, verified

Tested in a scratch project against the real generated schema. These are
measured facts, not changelog claims.

### 4.1 `ajv` 6 → 8 — needs `ajv-formats`

```
ajv8 FAILED: Error: unknown format "uri" ignored in schema
             at path "#/anyOf/1/properties/inputURL"
```

ajv 8 unbundled format validators. Adding `ajv-formats` restores it, verified
against the real schema:

```
valid config   -> true
missing inputs -> false | data must have required property 'inputs'
extra prop     -> false
bad url        -> false
good url       -> true
```

Note the message wording changed: ajv 6 said *"should have required property"*,
ajv 8 says *"must have"*. This is **user-visible** in CLI error output. The
existing tests assert on substrings (`toContain('inputs')`) so they survive, but
it is a behaviour change worth noting in the changelog.

### 4.2 `js-yaml` 3 → 5 — `safeLoad`/`safeDump` removed

```
js-yaml5 has safeLoad? undefined | load? function | dump? function
js-yaml5 dump indent: "a:\n    b: 1\n"
```

`load`/`dump` are safe by default in v4+, so the rename is the whole migration.
Two call sites: `file-loading.ts` (`safeLoad`) and `index.ts` (`safeDump`).

### 4.3 `commander` 5 → 15 — options moved off the instance

```
commander15 program.config: undefined | opts().config: file.json
```

Options are no longer set as properties on the `Command`. Both call sites in
`main()` (`program.config`, `program.restrictOutputTo`) must become
`program.opts().config` / `.restrictOutputTo`.

This interacts with the `buildProgram()` refactor already on this branch: the
`InstanceType<typeof Command>` annotation exists because commander 5's typings
export `Command` as a static interface. Newer commander ships different typings,
so that annotation should be re-checked and probably simplified.

### 4.4 `fetch` — no polyfill needed

Node has had global `fetch` since v18 (unflagged since v21). The `isomorphic-fetch`
import in `index.ts` can be deleted outright. This implicitly raises the minimum
Node version, so an `engines` field should be declared at the same time — the
repo currently declares none.

## 5. Risks

| Risk | Assessment |
| --- | --- |
| `@types/jest` 25 → 30 removes `fail()` | Jest removed the `fail()` global in v27. `test-utils.ts` and several suites use it. If the types drop it, typecheck breaks. **Verify before upgrading**; if it breaks, either keep `@types/jest` pinned or replace `fail()` with `expect(...).fail`-style assertions. |
| eslint 9+ flat config | `.eslintrc.js` is no longer read by default. Requires an `eslint.config.js` rewrite. Mechanical but touches every lint invocation, including the Husky pre-commit hook. |
| `@typescript-eslint` 2 → 8 | Six majors. Rule names and defaults changed; expect new warnings on existing code. The v2 parser already crashes on some modern syntax (a tuple type in `exit-codes.test.ts` had to be rewritten to appease it), so this upgrade *removes* an existing constraint. |
| `husky` 7 → 9 | `husky install` is deprecated in favour of `husky`. The root `prepare` script needs updating or the hook silently stops installing. |
| Removing `gen-docs` | It is a documented workflow in AGENTS.md. Removal must update those docs, or the upgrade path must keep the script working. |
| `commander` 15 min Node | Newer commander majors raise their Node floor; confirm against the `engines` value chosen in Phase 2. |

## 6. Non-goals

- Upgrading `@typescript/native-preview` (tsgo). It is a deliberately pinned
  pre-release; the Bun/tsgo migration note owns that decision.
- Changing the test runner. `proposal-code-coverage.md` §A6.3 owns that.
- Bumping either published package's `version`. `scripts/publish-changed.sh`
  publishes on version change, so that is the maintainer's call.
- Adding new capabilities. This is maintenance only; no behaviour should change
  except where a dependency forces it (§4.1's message wording).

## 7. The progressive path

Each phase is independently shippable and independently revertable, and leaves
`bun run lint`, `bun run build` and `bun run test` green. Ordered by
risk-adjusted value, so the cheapest and safest wins land first and the riskiest
churn last.

| Phase | Change | Risk | Value |
| --- | --- | --- | --- |
| **1** | Delete `es6-promise` | none — never imported | removes a prod dep |
| **2** | Delete `isomorphic-fetch` + `@types/isomorphic-fetch`; use native `fetch`; declare `engines` | low | removes a prod dep, clarifies support |
| **3** | `@adobe/jsonschema2md` 6 → 8 | low — devDep, one script | clears critical + 6 advisories |
| **4** | `js-yaml` 3 → 5 (+ `@types/js-yaml` 4) | low — two call sites, typed | clears advisory |
| **5** | `ajv` 6 → 8 + `ajv-formats` | medium — validation is load-bearing | clears `fast-uri` advisory |
| **6** | `commander` 5 → 15 | medium — two call sites, well tested | 10 majors of drift |
| **7** | `@types/node`, `typescript-json-schema`, `@types/jest` | low | routine |
| **8** | `eslint` 7 → 10 + `@typescript-eslint` 2 → 8 + flat config | high churn | clears `brace-expansion`; unblocks modern syntax |
| **9** | `husky` 7 → 9 | low | routine |

### Why this order

Phases 1–2 are deletions: strictly less code and less supply chain, and they
cannot regress anything that tests do not already cover. Phase 3 buys the
largest security improvement for the least risk because it touches a script no
automated process runs. Phases 4–6 are the real migrations, sequenced smallest
blast radius first, each verified by the integration suite that landed in
`proposal-closing-coverage-gaps.md`. Phase 8 is last because it is pure churn
with no functional payoff and the highest chance of noisy diffs.

## 8. Verification gate for every phase

The dependency work is only safe because the suite is now comprehensive — 201
tests at ~97–99% weighted coverage. Each phase must pass, from the repository
root:

```bash
bun install
bun run lint     # exit 0
bun run build    # exit 0 -- the only thing that typechecks
bun run test     # exit 0, all tests, coverage floors enforced
```

Plus, because `bun test` transpiles rather than typechecks and CI installs from
a clean tree:

- **the built binary is exercised for real**, not just in-process — a merge that
  writes an output file, and a failing `inputURL` that returns the right exit
  code;
- **a clean clone runs CI's exact commands** (`git clone` → `bun install
  --frozen-lockfile` → `bun run lint` → `bun run test`), because generated
  artefacts (`dist/`, `configuration.schema.json`) exist locally but not in CI,
  and a `prepare`-script failure surfaces there as an unrelated-looking
  module-resolution error.

`bun audit` is re-run at the end to confirm the advisory count actually fell.

## 9. Progress

Updated as phases land. See §10 for results.
