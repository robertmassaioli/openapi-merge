# Implementation Proposal: `init` Emits YAML With Every Optional Field Commented In

**Status:** ✅ Implemented.
**Type:** CLI / developer experience
**Scope:** `packages/openapi-merge-cli`
**Date:** 2026-08-01
**Branch:** `feature/init-yaml-with-optional-fields`

---

## 1. The problem

[33](33-proposal-cli-init-command.md) built `init` to write `openapi-merge.json` with only
`inputs` and `output` filled in, and explicitly declined to generate anything
else (§8): *"Generating anything beyond `inputs` and `output`... a generated
file full of options the user did not ask for is harder to read than a short
one."*

That was the right call for a first version. Since then `Configuration` has
grown a lot of optional behaviour — per-input `dispute`, `pathModification`,
`operationSelection`, `description`, `duplicatePathHandling`, `tag`, and
top-level `outputRoot`, `formatting`, `serversStrategy`,
`securitySchemesStrategy`, `pruneUnusedComponents`, `info` — and none of it is
discoverable from the generated file. Finding out any of this exists means
reading the README or the JSON Schema.

The ask: make `init` write YAML (comments require it — JSON has no comment
syntax) with every optional field present in the file, commented out, so a
user can see what exists and uncomment what they want.

## 2. What "good" looks like

- `init`'s output is still valid and mergeable with zero edits — the
  invariant from 33 must not regress.
- Every optional field on `Configuration` and `ConfigurationInputBase` —
  **and every required sub-field of an optional object** (e.g.
  `description.append`, `dispute.prefix`/`suffix`, `tag.name`,
  `formatting.indent.style`+`width`) — appears somewhere in the file,
  commented out, with enough of a description to be useful without opening
  the README. Uncommenting one block must always produce something the
  schema accepts; a block that shows only the optional leaves of a required
  shape breaks the feature's whole promise on first use. The deprecated
  `disputePrefix` (`DisputeV1`) is excluded — only the current (`V2`,
  `dispute`) shape is shown.
- The *active* (uncommented) part of the file is still just `inputs` and
  `output` — nothing behavioural changes for someone who ignores the
  comments and runs the tool as before.
- Running `init` twice in the same directory still produces identical output
  (existing invariant, §4 of 33).

## 3. Decisions

### 3.1 Filename: keep `openapi-merge.json`, or move to `openapi-merge.yaml`? — **decided: rename, with fallback**

The loader (`readYamlOrJSON` in `file-loading.ts`) parses either format
regardless of extension, so a `.json` file containing YAML would technically
still load. But shipping a `#`-commented file with no braces, named `.json`,
is actively misleading: editors syntax-highlight and lint it as JSON, and a
diff labelled `openapi-merge.json` full of YAML will confuse the exact users
this feature is trying to help.

**Recommendation:** rename the file `init` writes to `openapi-merge.yaml`,
and make `loadConfiguration`'s no-`-c` lookup try `openapi-merge.yaml`
first, falling back to `openapi-merge.json` if that's not present. This is
additive for *loading* — anyone with an existing `openapi-merge.json` keeps
working without touching anything.

It is **not** automatically additive for *`init`'s overwrite guard*, and
this is the part worth being deliberate about. Today's guard is
`fs.existsSync(STANDARD_CONFIG_FILE)` against one name. If the target
becomes `openapi-merge.yaml`, a user with a hand-edited `openapi-merge.json`
would get no refusal at all — `init` would happily write a second file next
to it. Nothing is deleted, but because the loader now prefers `.yaml`, the
freshly generated file silently *shadows* the hand-written `.json` on the
very next merge. That is the same failure 33 §4 called "the one
unrecoverable thing this command can do," just with a longer fuse before it
is noticed.

So the guard has to change alongside the rename: `init` refuses (without
`--force`) if **either** `openapi-merge.yaml` or `openapi-merge.json`
already exists. With `--force` it writes `openapi-merge.yaml` and leaves any
existing `openapi-merge.json` in place untouched — the console output says
so explicitly, including that the old file is now inert because `.yaml` is
preferred on load. If both names exist at ordinary load time (no `-c`),
`loadConfiguration` logs which one it chose.

Loose end noticed while reading the code: `STANDARD_CONFIG_FILE` is
currently defined twice — once exported from `init-command.ts`, and again as
a separate local constant inside `load-configuration.ts` that isn't imported
from the first. Worth collapsing to one constant while this file is open
regardless of which way 3.1 goes.

### 3.2 Per-input options: repeat the block on every input, or show it once? — **decided**

`dispute`, `pathModification`, `operationSelection`, `description`,
`duplicatePathHandling`, and `tag` are all *per input*, not top-level. A
directory with five specs gets five `inputs` entries — does each one carry
its own ~25-line commented block, or does the block appear once?

**Recommendation:** show the full commented block under the *first* input
only. Every subsequent input gets a single comment line pointing back to it
(`# per-input options — see the commented block above the first input; the
same fields apply here`). The fields are identical regardless of which input
they're attached to, so nothing is lost by cross-referencing instead of
repeating, and the file stays readable no matter how many inputs are found.
With zero inputs found (today's placeholder case), the block goes on the one
placeholder input, same shape as now.

### 3.3 How much explanation per field?

**Recommendation:** one short comment line per field (or per field group,
for nested objects like `formatting.indent`), lifted from the existing TSDoc
in `data.ts` rather than written fresh — that TSDoc is already the
authoritative wording, and hand-duplicating it in two places invites drift.
A worked example, not just a bare key:

```yaml
  # Combine each input's securitySchemes, or take only the first input's (issue #33).
  # securitySchemesStrategy: merge # merge | first | error
```

### 3.4 How is this actually generated?

`js-yaml`'s `dump()` has no notion of a comment attached to a key — comments
cannot survive an object round-trip, so this can't be "build a
`Configuration`, dump it, done" the way today's JSON output is. It has to be
assembled as a template: the *real* `inputs`/`output` (computed exactly as
today via `buildConfiguration`) rendered normally, interleaved with
hand-written commented sections for everything optional.

**Recommendation:** a new pure function alongside the existing ones in
`init-command.ts` — call it `renderInitYaml(configuration, options)` — kept
testable the same way `buildConfiguration` already is: assert on the
returned string, no temp directory needed. `index.ts` keeps doing only the
file I/O around it, unchanged in kind.

**What was actually built** differs from the sketch above in two small ways.
The signature ended up `renderInitYaml(chosenInputs, output)` — a list of
input paths and the output path, not a full `Configuration` and an options
bag — because the caller (`runInit`) already had exactly those two values
and there was nothing an options bag would have carried. `chosenInputs`
(the "use the placeholder if nothing was found" decision) was pulled out of
`buildConfiguration` into its own exported function so `runInit` could
compute the same input list once and hand it to both `buildConfiguration`
(for `.output`) and `renderInitYaml`, rather than the two ever being able to
disagree.

A design alternative — typing each optional field's data as a real object
dumped through `js-yaml` instead of a hand-written YAML string, keyed by
field name so a future `Configuration` field is a compile error until
documented — was raised mid-implementation and evaluated in
[35](35-proposal-commented-yaml-section-type.md). Decided against for now
(Option C there): the hand-written-string version below is what shipped,
validated per-field and validated *in its actual rendered position* (§6).

## 4. Scope of the change

Touches:

- `init-command.ts` — new rendering function; `STANDARD_CONFIG_FILE`
  probably becomes `openapi-merge.yaml` (§3.1).
- `index.ts` — write the rendered string instead of
  `JSON.stringify(configuration, null, 2)`.
- `load-configuration.ts` — default lookup tries `.yaml` then falls back to
  `.json`, logging which it picked; the duplicate `STANDARD_CONFIG_FILE`
  constant goes away.
- `exit-codes.ts` — its doc comment names `openapi-merge.json` specifically
  and should mention the `.yaml` default too.
- `README.md` — the "Getting started: `init`" section shows JSON output
  today and needs updating to match.
- Tests — `init-command.test.ts` and the `init` tests in
  `cli-invocation.test.ts` assume JSON (e.g. the `JSON.parse` of the
  generated file, and the overwrite-refusal tests that pre-write
  `openapi-merge.json`). These need to target whichever filename `init`
  defaults to, plus a new case covering the `.yaml`-then-`.json` fallback if
  3.1 is accepted.

Not touched: the merge algorithm, the `Configuration` type itself (no new
fields — this only documents existing ones), the JSON Schema, or how
user-supplied configs are loaded (`-c` keeps accepting JSON or YAML exactly
as it does today).

**Two files this section didn't predict**, found while implementing:

- `config-file-names.ts` — new. `STANDARD_CONFIG_FILE` was duplicated
  between `init-command.ts` and `load-configuration.ts` (§3.1's loose end);
  rather than pick one owner and have the other import it, both now import
  `STANDARD_CONFIG_FILE_YAML` / `STANDARD_CONFIG_FILE_JSON` /
  `STANDARD_CONFIG_FILE_CANDIDATES` from a third, dependency-free module.
- `__tests__/_helpers/cli-harness.ts` — the shared CLI test harness
  discarded `console.log` entirely (`console.log = (): void => undefined`).
  Testing the new "using `X`" / "`Y` is no longer used" log lines needed
  stdout captured the same way `stderr()` already was; added a `stdout()`
  accessor alongside it. Purely additive — every existing caller of the
  harness is unaffected.
- `AGENTS.md` — its description of the CLI's default config filename was
  also stale and got the same one-line update as `exit-codes.ts`.

## 5. Not doing

- Interactive prompts — still out of scope, per 33 §3 Option D.
- Recursive directory scanning — still out of scope, per 33 §3 Option E.
- Requiring YAML for hand-written configs, or changing what `-c` accepts.
  JSON configs keep working exactly as they do today; this only changes what
  `init` itself writes.

## 6. Verification

Everything below is what actually ran, not a plan — the "planned" heading
this section had before implementation is gone per this directory's
convention of updating proposals with results.

- **Structure**: `renderInitYaml` tested for zero inputs (placeholder case),
  one input, and several inputs, including that the full per-input block
  appears exactly once regardless of input count (§3.2) and that a scanned
  path containing YAML-special characters (`./a: b.yaml`) still round-trips
  through `yamlScalar()` to something that parses and validates.
- **The active part is inert**: `loadYaml(rendered)` deep-equals
  `buildConfiguration(inputs)` exactly — not just "the whole file
  validates," which would pass even if a comment leaked stray text into the
  active document.
- **Per-field validity, not "uncomment everything."** The fields don't form
  one valid document when all uncommented at once — `dispute` is `prefix`
  XOR `suffix`, an input is `inputFile` XOR `inputURL` — so a single
  all-uncommented pass would fail ajv for reasons that have nothing to do
  with whether the generator did its job. Each block is uncommented in
  isolation instead, merged into a base document, and validated against the
  real `configuration.schema.json` via ajv — the same schema
  `loadConfiguration` uses.
- **That validity check closes the loop through the real rendered text, not
  just the source string.** An earlier pass of this testing validated
  `block.yaml` — the hand-written source — directly, which cannot catch a
  bug in how `renderCommentedBlock` actually applies indentation. A
  follow-up test takes the literal string `init` writes, strips the
  comment marker off one block *in place* (top-level, zero indent; and
  per-input, the `+4` hop into a list item that a naive `+2`-per-level
  renderer would get wrong — see 35 §3.2), and validates the whole
  resulting document. Confirmed to actually catch that regression: forcing
  the per-input indent constant from 4 spaces to 2 and rerunning turned this
  test red while every other test (including the block-in-isolation ones)
  stayed green.
- **Coverage** is asserted with an explicit list of expected field names,
  cross-checked by hand against `data.ts`'s `Configuration` and
  `ConfigurationInputBase`/`DisputeV2` — the fallback §6 anticipated, taken
  because the JSON Schema's `oneOf` branches
  (`ConfigurationInputV1`/`V2`, `DisputePrefix`/`Suffix`) made walking the
  *generated schema's* property keys awkward.
- **Idempotence**: `init` then `init --force` with unchanged inputs produces
  byte-identical output (33's invariant, re-checked now that a second run
  needs `--force` to get there at all).
- **The round trip**: `init` then merge the result unedited, kept from 33
  and re-pointed at `openapi-merge.yaml`.
- **The overwrite guard** (§3.1): refuses when only `.yaml` exists, when
  only a legacy `.json` exists, and when both do (message names both);
  `--force` writes `.yaml`, leaves a pre-existing `.json` byte-for-byte
  untouched, and logs that it is no longer used.
- **The default lookup** (`loadConfiguration`, no `-c`): resolves `.json`
  when it's the only one present, prefers `.yaml` when both are present
  (proved by checking *which config's `output` got written*, not just the
  log line), and names both candidates in the not-found error.
- Manual end-to-end smoke test outside the test suite: real temp directory,
  real files, `init` → inspect the generated YAML → merge it unedited →
  inspect the merged output. Run twice (single input, and two inputs with
  distinct paths) to eyeball the actual generated comments, not just their
  parsed structure.
- Full package suite: 198 tests (up from the pre-existing baseline),
  100% function coverage and 98.89% line coverage on
  `packages/openapi-merge-cli`. Whole-workspace `bun run test` (both
  packages, 421 + 198 tests) and `bun run lint` (ESLint + `tsgo
  --noEmit` for both packages) green.

## 7. A known characteristic: blanket-uncommenting a block breaks

Each block's explanation line and its YAML share one comment marker (`# `),
with no visual distinction between "prose, meant to stay a comment" and
"YAML, meant to be uncommented." A person selecting a whole block — the
explanation line included — and running their editor's toggle-line-comment
on all of it gets a document `loadYaml` cannot parse:

```
error: can not read a block mapping entry; a multiline key may not be an
implicit key
```

(Confirmed directly: stripping `# ` from an explanation line followed by
`formatting:` produces exactly this error, because the explanation reads as
an implicit top-level scalar key ahead of a mapping.)

Left as-is, for three reasons. It matches a common config-file convention —
`postgresql.conf`, most `docker-compose.yml` references — where a prose
comment sits above a single commented setting line and only the setting
line is meant to be touched; a person used to that convention already knows
not to uncomment the sentence above the key. It fails loud: a YAML parse
error with a line number, not a silent misconfiguration — the sort of
mistake a first run of the tool catches immediately, not one that ships. And
fixing it structurally (giving explanation and data different comment
markers, e.g. `##` for prose that must stay commented) reopens exactly the
`Section`-shaped redesign evaluated and declined in
[35](35-proposal-commented-yaml-section-type.md) §6 Option C. Worth
revisiting only if this turns out to bite people in practice.
