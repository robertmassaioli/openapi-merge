# Implementation Proposal: Issue #149 — Documentation Microsite

**Status:** ✅ Implemented — `packages/docs-site` (VitePress), deployed via
`.github/workflows/docs-deploy.yml`. This status line was stale until
`50-proposal-149-playground.md` (option 4) needed to build on top of it and
verified it was actually live.
**Value:** 4/5 — a single, navigable reference for both packages; closes the gap between "quick npm README" and "actually understanding the merge model."
**Effort:** 3/5 — new tooling (VitePress), a GitHub Pages deploy workflow, and a genuinely large amount of content.

---

## 1. Issue Summary

**GitHub Issue:** [#149 — Proposal: dramatically improve repository documentation (microsite + playground)](https://github.com/robertmassaioli/openapi-merge/issues/149)

Issue #149 proposed four options. [Proposal 43](43-proposal-149-readme-and-api-docs.md) covered options 1–2 (README
enrichment + generated TypeDoc reference) and shipped as [PR #151](https://github.com/robertmassaioli/openapi-merge/pull/151).

This proposal covers **option 3**: a documentation microsite covering both the CLI and the library, deployed to GitHub
Pages. **Option 4 (the interactive playground) remains out of scope** and is not attempted here.

---

## 2. The canonical-source decision

Proposal 43 §4.2 already flagged the risk: "each README should link to the microsite for deeper reference material,
rather than trying to be the single source of truth **once the microsite exists**." That moment is now. Without a
decision here, this proposal would create a *fourth* copy of content already duplicated three times (`exit-codes.ts`'s
header comment, the CLI README, `AGENTS.md`) — the exact class of drift PR #151 spent an entire session fixing.

**Decision: the site is canonical for CLI configuration reference, exit codes, `MergeOptions`, and merging-behaviour
detail.** The two package READMEs remain the quick-start / npm-landing-page layer (per proposal 43's "which package
do I want" framing) and, once this and #151 have both landed, get trimmed to point at the site for depth instead of
repeating it.

**This proposal does not touch the READMEs.** This branch was forked from `main` before #151 merged, so its READMEs are
the pre-#151, less-accurate versions; editing them here would conflict with an already-open PR touching the same files
for an unrelated reason. Trimming the READMEs down to pointers is recorded as an explicit **follow-up**, to be done once
#151 merges, rather than attempted speculatively against a moving target.

For exit codes specifically — now duplicated in `exit-codes.ts`, the CLI README, `AGENTS.md`, *and* the new
`cli/exit-codes.md` — the "renumbering fails the build" test guard doesn't reach documentation, so the only defence is
the existing convention (`exit-codes.ts`'s header comment: "Adding a code means: ... update the tables here and in the
CLI README"). That reminder, and the matching one in `AGENTS.md` §4, are extended to name the site page too, so a future
change has one place telling it about all four mirrors instead of three.

---

## 3. Tooling: VitePress, in `packages/docs-site`

- **Generator:** VitePress — Vite-based, minimal config, built-in local search, fits the existing Vite/Bun/TS toolchain
  rather than introducing a second one (chosen over Starlight/Astro and Docusaurus/React, both heavier for a two-package
  reference site with no blog or multi-version story).
- **Location:** `packages/docs-site`, a new Bun workspace member. `private: true` (never published; also excluded by
  `publish-changed.sh`'s explicit `PUBLISH_ORDER` array, which does not glob `packages/*`).
- **Root script impact:** verified empirically — `bun run --filter '*' <script>` silently skips a workspace package
  that lacks that script (behaves like `--if-present`, not a hard requirement). `docs-site` only needs a real `build`
  script; it does not need no-op `lint`/`typecheck`/`test` entries for `bun run lint`/`test` at the root to keep working.
  A minimal `lint` script is added anyway, for the site's own config file, as a matter of hygiene rather than necessity.

### API reference integration

The library's generated TypeDoc reference (`bun run docs` in `packages/openapi-merge`, from proposal 43) is built a
second time with a different `--out`, directly into `packages/docs-site/public/api/` (gitignored, generated at site-build
time, not committed — same policy as `packages/openapi-merge/docs-api/`). VitePress copies everything under `public/`
into the site output verbatim, so the API reference is served at `/api/` alongside the hand-written guide pages, without
a second templating system. Verified: `vitepress preview` resolves `/api/` correctly and TypeDoc's own `assets/`
directory does not collide with VitePress's `assets/` (different subpaths).

### GitHub Pages deploy

- `.github/workflows/docs-deploy.yml`: on push to `main`, builds the site (`bun run --cwd packages/docs-site build`,
  which itself runs the TypeDoc step first) and deploys via `actions/configure-pages` /
  `actions/upload-pages-artifact` / `actions/deploy-pages`, with `concurrency` scoped to the Pages deployment group (so
  two pushes to `main` in quick succession queue rather than race) and `permissions: pages: write, id-token: write`.
- **GitHub Pages is not currently enabled for this repository** (`gh api repos/robertmassaioli/openapi-merge/pages` →
  404, checked directly rather than assumed). The workflow runs and produces a deployable artifact regardless, but the
  site does not actually go live until the maintainer flips **Settings → Pages → Source → GitHub Actions** once — a
  repository-settings change no workflow can make on its own.
- Because a project-repo Pages site with no custom domain serves at `https://robertmassaioli.github.io/openapi-merge/`,
  not the domain root, VitePress's `base` is set to `/openapi-merge/`. This cannot be verified by a local dev server
  (which always serves at `/`), so it is the one thing in this proposal that needs a post-merge, post-Pages-enable
  eyeball rather than a pre-merge test.

---

## 4. Content plan

Structured as three sections plus a landing page, so the nav mirrors the "which package do I want" split already
established in the root README:

- **Guide** — which package to use, quick start for each, a development/contributing page (mirrors the root README's
  "Developing on openapi-merge" section, expanded).
- **CLI reference** — configuration file reference (every field), `init`, CLI flags, formatting, cross-document `$ref`s,
  the security/trust model (`inputRoot`/`outputRoot`), exit codes, OpenAPI version support, worked examples.
- **Library reference** — `merge()` and its types, `MergeOptions` in depth, merging behaviour (first-wins vs. merged
  fields, and where they differ per input), per-input options, worked examples, and a pointer into the generated
  `/api/` reference for exact type shapes.

Every factual claim (exit codes, version support, defaults) is written from current source
(`packages/openapi-merge-cli/src/exit-codes.ts`, `packages/openapi-merge/src/data.ts`, `servers.ts`,
`security-schemes.ts`), not copied from the READMEs — this branch predates #151's README fixes, and the source is the
only thing guaranteed current on both branches.

---

## 5. Testing

- `bun run lint` / `bun run test` at the repository root pass unaffected (no changes to `src/` in either package).
- `bun run --cwd packages/docs-site build` succeeds: runs the TypeDoc step, then `vitepress build`, with zero errors.
- `bun run --cwd packages/docs-site preview` manually checked: home page, guide, CLI reference, library reference and
  `/api/` all resolve; internal links between pages work.
- `packages/docs-site/public/api` and `.vitepress/{cache,dist}` confirmed gitignored before the first build (checked
  with `git status` immediately after, not just declared in `.gitignore`).
