# Implementation Proposal: Issue #149 — Interactive Library Playground (Option 4)

**Status:** ✅ Implemented — see §4.4 and §5 for what running it (not just
writing it) actually required.
**Value:** 3/5 — a live, zero-install demo lowers the bar for evaluating the
tool and doubles as a fast bug-report reproduction tool, per the issue's own
framing.
**Effort:** 2/5 as *code* (confirmed, §6); 3/5 once §4.4's build-tooling
debugging is counted — the library has no Node-specific dependencies
(verified, §2), so this is genuinely "one interactive page on an
already-existing microsite," not a new deployment target or sandboxing
technology, but it is the first thing in this repo to ask a bundler to
inline the library's multi-file CJS output, and that surfaced a real bug.

**Issue:** [#149 — Proposal: dramatically improve repository documentation (microsite + playground)](https://github.com/robertmassaioli/openapi-merge/issues/149)

---

## 1. Scope

Issue #149 lists four options. Options 1–2 (README enrichment + generated API
reference) shipped as [PR #151](https://github.com/robertmassaioli/openapi-merge/pull/151)
(`43-proposal-149-readme-and-api-docs.md`). Option 3 (the documentation
microsite) is live — `packages/docs-site`, a VitePress site deployed via
`.github/workflows/docs-deploy.yml`, with guide/CLI-reference/library-reference
sections and a generated TypeDoc API reference already in place
(`47-proposal-149-documentation-microsite.md`).

This proposal covers **option 4 only**: the interactive playground, described
in the issue as a stretch goal — "an in-browser playground ... where visitors
can paste in two or more OpenAPI documents and see the merged result live,
without installing anything," suggesting it "could start as a
StackBlitz/CodeSandbox embed ... before investing in a fully custom
playground."

## 2. The premise the issue speculates about doesn't hold — verified against current `main`

The issue frames the custom-playground option as needing "the library bundled
for the browser, or run through a WASM/Node-in-browser sandbox like StackBlitz
WebContainers" — implying real engineering weight to get the library running
outside Node. Checked directly:

```
$ grep -rn "^import\|require(" packages/openapi-merge/src/*.ts | grep -v __tests__ | grep -oP "from '\K[^']+" | sort -u
./component-equivalence  ./cross-document-lookup  ./data  ./dispute
./extension-merge-strategies  ./extensions  ./external-references  ./info
./merge-path-items  ./oas31  ./openapi-version  ./path-matching
./paths-and-components  ./prune-components  ./reference-walker
./safe-type-checks  ./security-schemes  ./servers  ./tag-injection
./tag-matching  ./tags  ./wildcard-matching
@atlassian/atlassian-openapi  jsonpointer  lodash  ts-is-present
```

Zero Node built-ins (`fs`, `path`, `net`, ...). The library does no I/O at
all — by design, per its own docs ("the library itself does no I/O, so the
caller loads the documents and hands them over"). Everything that touches the
filesystem or network lives in `openapi-merge-cli`, not `openapi-merge`. A
plain browser bundle via Vite (which VitePress already uses) is sufficient;
no WASM, no WebContainers, no sandboxed runtime.

This changes the cost/benefit of the two options the issue posed:

| | StackBlitz/CodeSandbox embed | Custom in-page component |
| --- | --- | --- |
| Effort | Lowest (an iframe + a pre-configured project) | Low, given §2's finding — not "fully custom" in the heavyweight sense the issue implied |
| Runs the *actual* published library code | No — a StackBlitz project pins its own copy, which drifts from `main` the moment either changes | Yes — same workspace symlink the CLI itself uses |
| Works offline / no third-party dependency | No — requires StackBlitz's servers to be up | Yes |
| Fast bug-report reproduction (issue's own stated goal) | Workable, but a third party's UI, not this project's | Yes, and can eventually deep-link a specific input pair |
| Ongoing maintenance | None from us, but no control either | Ours, but it's ~150 lines of Vue against a library with no I/O to keep compatible |

**Recommendation: build the custom in-page component.** The "start with an
embed" suggestion in the issue was hedging against the sandboxing cost the
issue assumed existed; that cost isn't real here, so the reason to defer to a
third-party embed goes with it.

## 3. Design

### 3.1 Where it lives

A new top-level page, `packages/docs-site/playground.md` (a leaf file, not
`playground/index.md` — §4.4 explains why that distinction actually matters
here), linked from the top nav (`.vitepress/config.mts`) alongside
Guide/CLI/Library/API. It hosts a single Vue component,
`packages/docs-site/.vitepress/theme/components/Playground.vue`, wrapped in
VitePress's `<ClientOnly>` — nothing about a live-editing demo benefits from
SSR, and it sidesteps any question of whether every dependency is SSR-safe.

### 3.2 What v1 does

- Two document editors by default (Add/Remove to change the count), each a
  plain `<textarea>`, prefilled with a small worked example (two
  microservice-shaped specs that merge into one gateway) so the page shows a
  real result before anyone types anything — matches the issue's own
  "quickstart... under five minutes" goal from option 3, applied here too.
- Parsing mirrors `openapi-merge-cli`'s own `readYamlOrJSON` exactly: try
  `JSON.parse` first, fall back to `js-yaml`'s `load()`, report both errors
  together if neither works. Users can paste JSON or YAML in either box, same
  as the real CLI accepts either.
- Runs `merge()` from `openapi-merge` directly — the same call the CLI itself
  makes, not a re-implementation.
- Live: re-merges on input change, debounced (~300ms) so it doesn't re-run on
  every keystroke.
- Output: pretty-printed, with a JSON/YAML toggle (cheap, since `js-yaml` is
  already a dependency for parsing input) — shows the same two output shapes
  the CLI can produce.
- Errors are shown, not swallowed, for all three failure modes the real tool
  has: a parse error (this playground's own `JsonOrYamlParseError`-equivalent,
  named per input), an `ErrorMergeResult` (`isErrorResult()`, e.g.
  `duplicate-paths`), and a thrown `MalformedDocumentError` (a `null` in a
  structural slot) — all three are exported from `openapi-merge` specifically
  so a caller doesn't have to guess at the shape.
- A one-line note on the page: everything runs in the browser; nothing is
  uploaded anywhere. Worth stating explicitly, since the issue's own second
  use case is "paste in the exact specs that produce unexpected merge
  output" — someone doing that with a real (possibly non-public) spec needs
  to know it isn't leaving their machine.

### 3.3 Non-goals for v1

- No UI for `dispute`, `pathModification`, `operationSelection`,
  `duplicatePathHandling`, or any other per-input option. The playground
  demonstrates the *default* merge behaviour on N documents; the config-file
  reference already documents the rest, and building a form for every option
  is a much larger, separate effort with its own design questions (a generic
  JSON-editing panel? One control per option? both are real UI projects).
- No shareable/deep-linkable state (e.g. encoding the pasted documents into
  the URL so a bug report can link directly to a reproduction). Genuinely
  useful given the issue's own bug-triage framing, but additive — can follow
  once the base playground exists, and needs its own decision about size
  limits and encoding.
- No StackBlitz/CodeSandbox embed as a stepping stone — per §2, skipped
  entirely rather than built and later replaced.

## 4. Implementation

### 4.1 Dependencies

`packages/docs-site/package.json` gains two runtime dependencies, matching
versions already used elsewhere in the workspace:

- `openapi-merge`: `^1.4.0` (the same range `openapi-merge-cli` already
  depends on; Bun's workspace resolution links it to the local package, not
  the registry).
- `js-yaml`: `^5.2.2`, `@types/js-yaml`: `^4.0.9` (matching
  `openapi-merge-cli`'s versions).

### 4.2 Build ordering

The playground imports `openapi-merge`'s compiled output (`main: dist/index`)
— the same thing the CLI imports, per the existing convention documented in
`guide/development.md` ("the CLI imports the library's compiled `dist/`, not
its TypeScript source directly"). `docs-site`'s own `build`/`dev` scripts
need to build the library first, since nothing upstream of them does today
(`docs-deploy.yml` currently only runs TypeDoc against the library's `src/`,
which needs no build step — that stops being the only requirement once the
playground also needs `dist/`):

```jsonc
// packages/docs-site/package.json (additions)
"scripts": {
  "build:lib": "bun run --cwd ../openapi-merge build",
  "dev": "bun run build:lib && vitepress dev",
  "build": "bun run build:lib && bun run build:api && bun run build:schema && vitepress build",
  // ...
}
```

No change needed to `.github/workflows/docs-deploy.yml` itself — it already
just calls `bun run --cwd packages/docs-site build`.

### 4.3 Files

| File | Purpose |
| --- | --- |
| `packages/docs-site/.vitepress/theme/components/Playground.vue` | The component (§3.2) |
| `packages/docs-site/playground.md` | The page, `<ClientOnly><Playground /></ClientOnly>` |
| `packages/docs-site/.vitepress/theme/index.ts` | A pass-through custom theme (`export default DefaultTheme`) — required the moment anything lives under `.vitepress/theme/`, see §4.4 |
| `packages/docs-site/.vitepress/config.mts` | Add `{ text: 'Playground', link: '/playground' }` to `nav`; mark `openapi-merge` SSR-external (§4.4) |
| `packages/docs-site/package.json` | §4.1, §4.2 |
| `packages/docs-site/guide/development.md` | One line noting the playground needs the library built (handled automatically by the scripts above, but worth naming for anyone reading the source directly) |

### 4.4 What actually running it (not just reading the code) found

None of this was visible from reading `data.ts`/`index.ts` or the VitePress
docs; all of it only surfaced by running `vitepress dev`/`build`/`preview`
end to end, reading the exact console error, and fixing that one thing at a
time rather than guessing:

1. **`.vitepress/theme/` needs an entry point the moment anything lives under
   it.** Putting `components/Playground.vue` under `.vitepress/theme/` makes
   VitePress treat that directory as a custom theme and look for
   `.vitepress/theme/index.{js,ts}` — without one, the build fails trying to
   load it. Fixed with a one-line pass-through (`theme/index.ts`:
   `export default DefaultTheme`).

2. **The real problem, found in three layers as each fix exposed the next:**
   `openapi-merge`'s published `dist/` is CJS spread across ~20 files that
   `require()` each other (`data.js`, `tags.js`, `paths-and-components.js`,
   ...) — not one bundled file, because nothing has ever needed it to be
   before now (the CLI imports it via plain Node `require()`, which handles
   a multi-file CJS package natively; nothing in this repo has previously
   asked a *bundler* to inline it). Rollup's CJS handling doesn't convert
   that chain cleanly:
   - First symptom: the SSR build step failed outright — `"merge" is not
     exported by .../dist/index.js"` — even though it's a plain
     `exports.merge = merge` assignment. A namespace import
     (`import * as openapiMerge from 'openapi-merge'`) got past this by not
     asking Rollup to verify a named-export list statically.
   - Next symptom, past that: the SSR *render* step then threw
     `ReferenceError: exports is not defined in ES module scope` — Rollup
     had inlined the CJS chain into an ESM chunk without full interop
     wrapping. Marking `openapi-merge` SSR-external
     (`vite: { ssr: { external: ['openapi-merge'] } }`) worked around this
     for the *server* bundle specifically.
   - Final symptom, only visible by testing the actual production build in
     a browser (§5) rather than trusting a green `vitepress build`: the
     *client* bundle had the identical `ReferenceError: exports is not
     defined` baked into a shipped asset
     (`assets/playground.md.*.js`) — the SSR-external fix above only
     affects the server bundle, and nothing addressed the client one.
   
   **The actual fix, replacing all three band-aids above:** pre-bundle
   `openapi-merge` into one self-contained ESM file with `bun build`
   (`build:merge-bundle` in `package.json`, output gitignored under
   `.vitepress/generated/`) — the same tool `openapi-merge-cli`'s own build
   already uses to bundle its dependencies, and empirically confirmed to
   produce a clean, correctly-CJS-interop-wrapped single file where Rollup's
   `commonjs` plugin does not. `Playground.vue` imports this generated file
   instead of `'openapi-merge'` directly (types still come from the real
   package — only the value import moved); the namespace-import and
   `ssr.external` workarounds were removed once this was in place, since
   neither is needed against a plain, single-file ESM module.

3. **The generated bundle needs excluding from lint**, the same way
   `.vitepress/dist` and `public/api` already are (`eslint.config.mjs`) —
   otherwise ESLint reports ~116 problems inside a 0.4MB third-party bundle
   that was never meant to be read, let alone fixed.

One structural choice, decided empirically rather than purely by design: the
page is `playground.md`, a leaf file, not `playground/index.md` as
originally sketched in §3.1's first draft. While debugging the issues above,
the folder form intermittently produced a `404 PAGE NOT FOUND` in *dev
mode* specifically, with the client router seemingly racing two candidate
module requests (`playground.md` and `playground/index.md`); whether that
was an independent VitePress dev-router quirk or simply a confusing symptom
of the CJS bug above competing with a genuinely-missing sibling file was
never conclusively isolated, since fixing §4.4.2 changed the entire error
surface. What's certain either way: a leaf file removes the ambiguity
outright, and matches how every other single-page section in this site is
already linked (`guide/which-package`, `cli/configuration`, no trailing
slash) — the folder+`index.md` form is for sections with more than one
page, which this isn't.

## 5. Verification plan — what was actually done, not just planned

No existing test suite in `docs-site` (verified — no test files, no test
script), so this wasn't going to invent a Vue testing setup for one
component. Given this is a browser-facing feature, "the build succeeded" was
deliberately not treated as sufficient — §4.4's client-bundle bug would have
shipped silently if it had been. Verification actually performed:

1. `bun install` picks up the new dependencies and links `openapi-merge` via
   the workspace (confirmed via the `node_modules/openapi-merge` symlink).
2. `bun run --cwd packages/docs-site build` succeeds end to end.
3. **The production build was driven in a real headless browser** (Playwright,
   against `vitepress preview`'s actual served output — not `vitepress dev`,
   which is a different code path and where §4.4's bugs were originally
   found and partially fixed before the client-bundle one was caught by
   testing `preview` specifically): default example merges correctly on
   load; editing "Document 2" to add a new path re-merges live and the new
   path appears in the output; pasting invalid content shows the parse error
   verbatim (JSON error and YAML error both quoted, matching §3.2's design);
   the JSON/YAML output toggle switches formats; zero browser console
   errors. Screenshots taken in both light and dark mode (VitePress's CSS
   custom properties, no extra theming logic needed) confirm the visual
   result.
4. `bun run --cwd packages/docs-site lint` (scoped to `.vitepress/`, which
   includes the new component and, before the ignore-list fix in §4.4.3,
   incorrectly also the generated bundle).

## 6. Effort

| Task | Effort (estimated) | Effort (actual) |
| --- | --- | --- |
| Dependencies + build-ordering wiring | 20 min | 20 min |
| `Playground.vue` (editors, parse, merge, output toggle, errors) | ~1.5 hours | ~1.5 hours |
| Page + nav entry | 15 min | 15 min |
| Diagnosing and fixing §4.4 (theme entry point, the three-layer CJS bundling bug, lint ignore, the leaf-vs-folder page structure) | not estimated | ~2 hours |
| Verification (§5) — headless-browser-driven, not just "the build passed" | 20 min | ~45 min |
| **Total** | **~2.5 hours** | **~4.5 hours** |

The original estimate was a reasonable guess at the *code* (§3.2), which was
in fact about right (~2 hours for the component and page). What it didn't
and couldn't account for was §4.4: this is the first time anything in this
monorepo has asked a bundler to inline `openapi-merge`'s multi-file CJS
`dist/` output, and the bug that surfaced only exists because of that —
nothing about it was visible from reading `data.ts`/`extensions.ts` or the
existing CLI/library code, which never exercises this path (the CLI
`require()`s the library directly under Node; nothing bundles it). Still
well under proposal 47's "higher effort" characterisation of the *whole*
microsite option, which was for building the microsite from nothing.
