# Implementation Proposal: Issue #149 — README Enrichment + Generated API Reference

**Status:** Proposal
**Value:** 3/5 — lowers adoption friction for both npm packages; fixes real accuracy drift.
**Effort:** 2/5 — content + tooling wiring, no behavioural code changes.

---

## 1. Issue Summary

**GitHub Issue:** [#149 — Proposal: dramatically improve repository documentation (microsite + playground)](https://github.com/robertmassaioli/openapi-merge/issues/149)

Issue #149 proposes four incremental options for improving documentation:

1. Enrich each of the three READMEs independently (root, `openapi-merge`, `openapi-merge-cli`) — each package publishes to npm on its own, so each README is that package's npm landing page and must stand alone.
2. A generated API reference for the library (TypeDoc), kept in sync with the code.
3. A documentation microsite covering both the CLI and the library.
4. An in-browser playground for the library.

This proposal covers **options 1 and 2 only**. Options 3 and 4 remain tracked on the issue for a later proposal — they involve infrastructure decisions (site hosting, GitHub Pages enablement) that are out of scope here.

---

## 2. What's actually wrong today

Reading the three READMEs against the current source (not against `AGENTS.md`, which is dated 2026-05-21 and itself has drifted — see §5) surfaced genuine accuracy bugs, not just prose polish:

- **All three READMEs describe "OpenAPI 3.0 files."** The library has supported 3.0, 3.1 and 3.2 since proposals 26–28 (✅, shipped). The CLI's own README already documents this correctly in its "OpenAPI version support" section — the *library* README and the root README do not.
- **The library README's "Merging Behaviour" section lists Security Schemes as first-wins.** `MergeOptions.securitySchemesStrategy` (`packages/openapi-merge/src/security-schemes.ts`) now **defaults to `'merge'`**, specifically because first-wins produced documents whose operations required a scheme the document didn't define. The README describes the old, now-wrong default.
- **The library README's example doesn't mention `MergeOptions` at all** — `pruneUnusedComponents`, `info` override, `serversStrategy`, `securitySchemesStrategy`, and `externalDocuments` (issue #94, #102, #4, #33, #10) are all real, shipped, second-argument options with no mention in the README.
- **The library README's "play around with this example" link is a dead Replit fork** (`https://replit.com/@RobertMassaioli/openapi-merge-Example?v=1` → confirmed 404). It predates this proposal and is simply removed; a real playground is issue #149 option 4, not this proposal.
- **The Imgur screenshot in the root README** (`https://i.imgur.com/GjnSXCS.png`) still resolves (confirmed 200), but is an uncommitted external asset with no fallback if that ever stops being true.
- **The root README has no "which package do I want" guidance** beyond one sentence, and doesn't mention `bun run test`/`bun run lint` or the pre-commit hook already documented in `AGENTS.md`.

The CLI README (443 lines) is, by contrast, already detailed and accurate — exit codes 0–11, `resolveExternalReferences`/`inputRoot`/`outputRoot`, `init`, and OAS version support all match the source. Its gap is purely navigational: no table of contents for a file that long.

---

## 3. npm-landing-page constraint

`openapi-merge` and `openapi-merge-cli` READMEs are rendered standalone on their npm package pages — a relative link or a relative image path that only resolves inside the GitHub repo tree renders broken there. Concretely, in both package READMEs:

- Any image must be an absolute URL (`https://raw.githubusercontent.com/robertmassaioli/openapi-merge/main/...` or similar), not a relative `docs/...` path.
- Any cross-package link (e.g. the CLI README pointing at the library) must be an absolute GitHub URL, not a relative `../openapi-merge/README.md`.

The root README has no such constraint — GitHub is its only renderer — so it may use relative paths freely (e.g. for the committed screenshot asset).

Checked: neither package README currently contains a relative link or image, so this is a constraint to preserve going forward rather than a fix needed today.

---

## 4. Plan

### 4.1 Root README (`README.md`)

- Add a short "Which package do I want?" decision under "About this repository": use the CLI if you have OpenAPI files and want a merged file with no code, use the library if you're merging programmatically or building your own tool on top.
- Move the Imgur screenshot to a committed asset (`docs/assets/openapi-merge-config-example.png`) referenced with a relative path; remove the external Imgur dependency.
- Fix "OpenAPI 3.0 files" → "OpenAPI 3.0, 3.1 and 3.2 files."
- Extend "Developing on openapi-merge" with `bun run test` / `bun run lint` and a one-line mention of the Husky pre-commit hook (already true today, just undocumented at the root).

### 4.2 Library README (`packages/openapi-merge/README.md`)

- Fix the 3.0-only claims.
- Fix the Security Schemes first-wins claim to describe the current `'merge'` default and mention `serversStrategy`'s default remains `'first'` (these two now differ, which is itself worth calling out — it surprised nobody's issue yet, but it's exactly the kind of thing this proposal exists to catch).
- Add a "Merge options" subsection documenting the `MergeOptions` second argument: `pruneUnusedComponents`, `info`, `serversStrategy`, `securitySchemesStrategy`, `externalDocuments`, each in one or two lines with an issue-number cross-reference where one exists, matching the level of detail the CLI README already uses.
- Remove the dead Replit link.
- Add a one-line pointer to the generated API reference (§4.3) for the full type shapes, instead of trying to hand-document every field the way `MergeOptions` fields already are.
- Add absolute-URL cross-link to the CLI package's npm page.

### 4.3 Generated API reference (TypeDoc)

- Add `typedoc` as a devDependency of `packages/openapi-merge` (verified: coexists cleanly with `tsgo` — `bunx typedoc` resolves a `typescript` install via Bun's flattened `node_modules` even though the package itself builds with `tsgo`/`@typescript/native-preview`, and `bun run lint`, which includes the full `tsgo --noEmit` typecheck of both packages, is unaffected).
- Add `typedoc.json` pointed at `src/index.ts` (the package's actual public surface) using `tsconfig.json` (not `tsconfig.build.json`, which excludes tests but is otherwise equivalent — either works; `tsconfig.json` is the one used by `typecheck` so it's the more familiar default).
- Add a `docs` script (`bun run docs`) to `packages/openapi-merge/package.json`.
- Gitignore the output directory — generated, not committed, matching every other build artifact in this repo (`dist/`, `coverage/`).
- Document the command in the library README as "generate a local API reference."

**Explicitly out of scope:** a CI workflow that publishes the generated docs to GitHub Pages. Enabling Pages is a one-time repository-settings change only the maintainer can make, and a workflow built against a Pages source that isn't enabled yet is dead weight. This is deferred to whenever option 3 (the microsite) is scoped, since the two hosting decisions are the same decision.

### 4.4 `AGENTS.md`

Since it's the closest thing this repo has to a script index, and it's what a future agent (or this one, next time) will read first:

- Add `bun run docs` to §3's "Build / Test / Lint" table and §10's Quick Reference cheat sheet.
- Leave the rest of its drift (the `ErrorType` list missing `malformed-document`/version errors, `isomorphic-fetch`/`ajv@6` no longer being accurate, the "always emits `openapi: '3.0.3'`" claim) unfixed here — it's real, but it's `AGENTS.md`-wide drift unrelated to issue #149's docs scope, better handled as its own pass.

---

## 5. Note on `AGENTS.md` as a source

`AGENTS.md` was generated 2026-05-21 and has since drifted from the code in ways this proposal had to work around rather than trust — e.g. its exit-code table stops at `9` (the CLI README's, current, correctly goes to `11`), and it lists dependencies (`isomorphic-fetch`, `ajv@6`) the CLI's `package.json` no longer has. Every accuracy claim in this proposal was checked against source (`src/*.ts`) or existing test suites, not against `AGENTS.md`.

---

## 6. Testing

No behavioural code changes. Verification is:

- `bun run lint` (eslint + full `tsgo` typecheck of both packages) passes with `typedoc` added as a devDependency.
- `bun run test` is unaffected (no source changes under `src/`).
- `bunx typedoc` runs clean (0 errors; a handful of warnings about types referenced-but-not-exported from `index.ts`, e.g. `SingleMergeInput`, `SuccessfulMergeResult` — pre-existing narrowness of the public export surface, not something this proposal changes).
- Manual read-through of all three READMEs for internal consistency (no more claims that contradict the CLI README's already-accurate OAS-version and exit-code sections).
