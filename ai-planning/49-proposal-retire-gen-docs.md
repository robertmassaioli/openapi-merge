# Implementation Proposal: Retire `gen-docs`, Publish the JSON Schema to the Docs Site Instead

**Status:** ✅ Implemented as designed — see §9 for what shipped and the one thing measured differently from what §5.3 first sketched.
**Value:** 4/5 — closes `bun audit`'s last remaining, previously-undismissable finding outright, deletes a whole dependency subtree, and replaces a stale generated-docs workflow with something the new docs site already does better.
**Effort:** 1/5 — a `package.json` edit, one small new script, a few lines linking to it from an existing page.

---

## 1. Where this comes from

While fixing `bun audit` findings (PR #157), one finding was left as a documented, deliberate accepted risk rather than fixed: `js-yaml` (moderate [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68) + high [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m)), pulled in transitively by `@adobe/jsonschema2md@8.0.11` — the current latest release, which pins `js-yaml` to exactly `4.1.1`, inside the vulnerable range. That package backs exactly one script, `packages/openapi-merge-cli`'s `gen-docs`, which runs in no build, test, or CI path — a fact re-verified for that PR (`grep` across workflows and scripts found nothing).

Robert then asked, separately: now that the docs site (`packages/docs-site`, shipped via issue #149 / proposal 47) exists, is `gen-docs` still pulling its weight? This proposal is that question, answered properly, plus a concrete replacement for the one part of `gen-docs`'s output that's worth keeping.

## 2. What `gen-docs` actually produces, measured

Ran it directly (`bun run gen-docs` in `packages/openapi-merge-cli`, output un-committed — its `out/` directory is gitignored) to see the real output rather than reason about it from the script name:

```
loading 1 schemas
preparing schemas...
writing schemas to .../packages/openapi-merge-cli/out
README.md created
generating markdown
```

**108 Markdown files, 628K**, one page per node in `configuration.schema.json`'s tree — including every `anyOf` branch and nested `definitions` entry, so a single logical field like `excludePaths` produces seven separate files (`...excludepaths.md`, `...excludepaths-items.md`, `...excludepaths-items-properties-method.md`, `...excludepaths-items-properties-method-anyof-0.md`, ...). Content quality per-page is genuinely good — it pulls the JSDoc comment straight from `data.ts` — but the *shape* of the output (flat files named after JSON Pointer paths, one navigational README) is a mechanical schema walk, not a designed reference.

## 3. Why it's now redundant

`packages/docs-site/cli/configuration.md` — hand-written, shipped as part of the docs site — already covers every field `gen-docs`'s 108 files describe, organized as two flat tables (top-level fields, per-input fields) with prose sections for the fields that need more than one line (`operationSelection` precedence, `duplicatePathHandling`'s four values, `extensionMergeStrategies`'s recursive shape), cross-linked to `/cli/security`, `/cli/formatting`, `/cli/examples`. It is strictly better documentation of the same information: organized by how a config author thinks about the file, not by the schema compiler's own tree structure, and it's already live, already linted, already part of a build that runs in CI.

Nothing links to `gen-docs`'s output. It was never wired into `docs-deploy.yml`, `npm-publish.yml`, or the docs site's own `build:api` step (checked all three). It exists purely as a manual, uncommitted local workflow — `git status` after running it shows nothing changed, confirmed empirically, because `/out` is gitignored — that nobody has referenced from anywhere else in the repo.

## 4. What's worth keeping: the raw JSON Schema itself

`gen-docs` and `gen-schema` are two different things sharing a naming pattern:

- **`gen-schema`** (`typescript-json-schema` against `data.ts`, no advisory findings) writes `src/configuration.schema.json` — the machine-readable schema `ajv` validates every config file against at runtime, imported directly in `load-configuration.ts`. This is load-bearing and stays untouched.
- **`gen-docs`** (`@adobe/jsonschema2md`, the vulnerable one) *consumes* that schema to produce human-readable Markdown. This is the part with no consumer.

`configuration.schema.json` already ships to npm today, as a side effect nobody deliberately arranged: `tsgo`'s `resolveJsonModule` copies any JSON module a `.ts` file imports into `outDir` alongside the compiled output, so it lands in `dist/configuration.schema.json` for free (confirmed: `scripts/verify-node-runtime.sh` already asserts `"configuration.schema.json" is in the tarball"`, and it's there — this is not new work). What doesn't exist anywhere yet is a **public URL** for it. That has a real, standard use: an editor's YAML language server (e.g. VS Code's `redhat.vscode-yaml`) can validate a config file live if the file names a `$schema` URL, either via a `# yaml-language-server: $schema=<url>` comment or an editor-level schema-association setting — but only if the schema is reachable over HTTP, which it currently is not.

## 5. Proposed change

### 5.1 Remove `gen-docs` and its dependency

- Delete the `gen-docs` script from `packages/openapi-merge-cli/package.json`.
- Remove the `@adobe/jsonschema2md` devDependency.
- Verified empirically (tested directly, reverted before writing this proposal — not part of it yet): removing both and running `bun install` drops **133 lines from `bun.lock`** — a whole dependency subtree, not just the one package — and takes `bun audit` from 2 vulnerabilities (1 high, 1 moderate) to **`No vulnerabilities found`**. `bun run lint` and `bun run typecheck` stay clean with nothing else touched.

### 5.2 Publish the raw schema alongside the API reference

`packages/docs-site` already has exactly this pattern for the library's TypeDoc output — `build:api` generates it straight into `public/api`, which VitePress serves as static files, and `build` runs it as a prerequisite:

```json
"build:api": "bun run --cwd ../openapi-merge docs -- --out ../docs-site/public/api",
"build": "bun run build:api && vitepress build",
```

Add a matching step for the schema — a copy, not a fresh generation (`gen-schema` already ran as part of the CLI's own build; this just makes the result reachable):

```json
"build:schema": "cp ../openapi-merge-cli/src/configuration.schema.json public/configuration.schema.json",
"build": "bun run build:api && bun run build:schema && vitepress build",
```

This assumes the CLI has already been built (`gen-schema` has run) by the time the docs site builds — true for the normal workflow (`bun install` → `bun run build` from the repo root builds every workspace, docs-site included, and `packages/openapi-merge-cli`'s own `prepare`/`prepublishOnly` already run `gen-schema` first) but worth stating as an explicit ordering dependency, since docs-site's `build:schema` would otherwise silently copy a stale or missing file. The safer version runs `gen-schema` itself rather than trusting it already ran:

```json
"build:schema": "bun run --cwd ../openapi-merge-cli gen-schema && cp ../openapi-merge-cli/src/configuration.schema.json public/configuration.schema.json",
```

Recommend the safer version — it costs one extra `typescript-json-schema` invocation (already fast; it's not a size concern for `docs-deploy.yml`) and removes a build-order footgun.

### 5.3 Link to it from the existing configuration reference

`packages/docs-site/cli/configuration.md` (§3, above) is the natural home. Add one line near the top, alongside a short note on the `$schema`-comment usage:

```markdown
The raw [JSON Schema](/configuration.schema.json) is also published, for editor validation --
add `# yaml-language-server: $schema=https://robertmassaioli.github.io/openapi-merge/configuration.schema.json`
as the first line of your config file to get live validation and autocomplete in an editor that
supports it (e.g. VS Code with the YAML extension).
```

(Base URL taken from the existing GitHub Pages deploy target; confirm the exact published path against `docs-deploy.yml`/`.vitepress/config.mts`'s configured `base` before landing — not re-derived here since it's a copy-paste detail, not a design decision.)

### 5.4 Documentation updates

Both call sites that mention `gen-docs` as a workflow need to lose it, not just have the script silently disappear underneath them:

- `AGENTS.md` — two references: the command table (§"Build / Test / Lint / Generate") and the top-level goals table (§the "Regenerate the CLI Markdown docs" row). Replace the latter with a "Publish the JSON Schema to the docs site" row pointing at the new `build:schema` step, or fold it into the existing "Build the documentation site" row's description.
- No CI workflow references it (checked: `.github/workflows/*.yml` has zero matches for `gen-docs`), so nothing there needs to change.

## 6. What this does *not* do

- **Does not touch `gen-schema`.** `typescript-json-schema` has no open advisories and is load-bearing (`ajv` validates every config against its output, at runtime, for every CLI invocation). Out of scope entirely.
- **Does not change what the schema validates or how.** This is a docs-publishing change, not a schema-authoring one. `configuration.schema.json`'s content is identical before and after; only its reachability changes.
- **Does not attempt an interactive schema explorer or playground.** That's issue #149's option 4, explicitly out of scope there too (proposal 47 §1) and not reopened here. A static, linkable JSON file is a smaller, immediately-useful step; a playground is a separate, much larger proposal if ever wanted.

## 7. Verification plan

- `bun audit` → `No vulnerabilities found` (measured already, §5.1; re-confirm after the real commit).
- `bun run lint` / `bun run typecheck` clean across all three workspaces (measured already, §5.1).
- `packages/docs-site`'s `build` produces `public/configuration.schema.json`, and it's valid JSON matching the CLI's own `src/configuration.schema.json` byte-for-byte (a copy, not a re-generation with different flags, so this should be a trivial diff check).
- The docs site's dev server serves the file at the expected path (`bun run --cwd packages/docs-site dev`, then fetch it directly) before relying on the production GitHub Pages URL.
- `scripts/verify-node-runtime.sh`'s existing `configuration.schema.json is in the tarball` check is unaffected (unrelated path: that's `dist/`, not the docs site) — re-run anyway as part of the normal full verification pass, not because this change should affect it.
- Full test suite, both workspaces, as a regression guard that removing a devDependency didn't disturb anything unexpected.

## 8. Why this is worth doing now rather than leaving `js-yaml` documented indefinitely

Proposal 45 §3.3 named three theoretical exits for the `js-yaml` finding: wait for upstream, drop `gen-docs`/`@adobe/jsonschema2md`, or maintain a `bun patch`. The PR #157 investigation ruled out `bun patch` empirically (the fix between `4.1.1` and `4.3.0` is a wholesale file rewrite, not an isolable diff) and "wait for upstream" has no timeline — `@adobe/jsonschema2md@8.0.11` is already the current latest, still pinned. That leaves exactly one exit that was always fully within this repo's control, and the trigger for finally taking it — a second, better-designed source of the same documentation already existing — has now arrived.

## 9. Implementation

Built exactly as designed in §5, on a fresh branch off `main` (not stacked on PR #157, so the two ship independently — `bun audit` on this branch alone still shows the `fast-uri`/`brace-expansion`/`vite`/`esbuild` findings PR #157 fixes separately; only `js-yaml` is gone here, as expected).

- **§5.1**: removed the `gen-docs` script and the `@adobe/jsonschema2md` devDependency from `packages/openapi-merge-cli/package.json`. Measured, not estimated: `bun.lock` dropped exactly the predicted **133 lines**, and `bun audit` on this branch shows zero `js-yaml` findings (confirmed with a targeted `grep`, not just eyeballing the summary count).
- **§5.2**: added `build:schema` to `packages/docs-site/package.json`, using the safer (`gen-schema` first, not trusted-already-ran) form the proposal recommended. Verified the copy is byte-identical to `packages/openapi-merge-cli/src/configuration.schema.json` (`diff`, zero output) and that VitePress's own build carries it through to `.vitepress/dist/configuration.schema.json` unchanged. Added `/public/configuration.schema.json` to `packages/docs-site/.gitignore`, matching the existing `/public/api` entry for the same reason (a build artifact, not a source file).
- **§5.3, corrected**: the proposal's own sketch (`[JSON Schema](/configuration.schema.json)`, a plain root-relative Markdown link) would have **404'd on the real deployed site**. Checked `packages/docs-site/.vitepress/config.mts` directly rather than assuming: the site is served at `base: '/openapi-merge/'` (a GitHub Pages project site, no custom domain), so every static asset needs that prefix — plain Markdown links don't get it automatically, only VitePress's own router-aware internal links do. `packages/docs-site/library/api-reference.md` had already solved exactly this problem for the `public/api/` link, using `<script setup>import { withBase } from 'vitepress';</script>` and `<a :href="withBase('/path')">` — followed that existing convention instead of introducing a second way to do the same thing. Verified for real, not just by reading the code: built the site, ran `vitepress preview` (the one mode that actually honors `base`, unlike `vitepress dev`), and fetched both the rendered page and the schema file at their production-shaped URLs — `http://localhost:.../openapi-merge/cli/configuration.html` and `http://localhost:.../openapi-merge/configuration.schema.json` — both `200`.
- **§5.4**: `AGENTS.md`'s two references updated — the command block gained a short paragraph explaining the removal and pointing at `docs-site`'s `build:schema`, and the goals table's "Regenerate the CLI Markdown docs" row became "Publish the JSON Schema to the docs site". `ai-planning/23-proposal-dependency-updates.md`'s own mention of `gen-docs` (a historical record of a past dependency audit) was deliberately left untouched, per this repo's convention that a past proposal's record isn't edited after the fact.

Full verification: 863 tests (596 library + 267 CLI, 0 failures), lint/typecheck clean across all three workspaces, all three builds succeed, and `scripts/verify-node-runtime.sh`'s 48 bundled-artifact checks pass on both Node and Bun — including reconfirming `configuration.schema.json is in the tarball`, which this change doesn't touch (that's `tsgo`'s `resolveJsonModule` side effect into `dist/`, unrelated to the docs site's own copy).
