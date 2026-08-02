# Proposal 47: Configurable merge strategies for `x-*` extensions

**Status:** ✅ Implemented. See §10 for what was actually built.

**Triggered by** an explicit request from Robert: "write a proposal for how we could purely use configuration in order to define custom merge behavior for custom `x-` tags that can be found around swagger files, as a more generic version of [issue #60](https://github.com/robertmassaioli/openapi-merge/issues/60)." Refined mid-discussion: an `x-*` value can be *any* JSON shape, so the configuration needs to describe how to merge that shape recursively — for a JSON object, per key; for an array, whether and how to combine elements; for a scalar, which input wins, or whether disagreement is even acceptable — not just pick one strategy for the extension as a whole. This proposal covers the general mechanism only — no implementation.

## 1. Where this sits relative to issue #60 and PR #127

Issue #60 is one specific complaint: `x-tagGroups`, a ReDoc convention for grouping tags in its sidebar, only keeps the first input's groups when several inputs each declare it. [`ai-planning/issues/12-proposal-60-x-tag-groups.md`](issues/12-proposal-60-x-tag-groups.md) analysed that issue and recommended **Option C**: hardcode a correct, concatenating merge for `x-tagGroups` specifically, *and* expose a configurable strategy mechanism so future extensions with similar needs would not each require a hardcoded special case.

[PR #127](https://github.com/robertmassaioli/openapi-merge/pull/127) (open, unmerged) implemented only the first half — **Option A**. Its description gives the reason: the configurable half was "speculative generality: no second extension has been asked for, it's public API that must then be supported forever... Adding it later is no harder — and by then its shape would be informed by two real cases instead of one hypothetical."

That objection is answered by this proposal's own trigger: Robert is now asking for the generic mechanism directly, independent of any second concrete extension, and — per the refinement above — has already supplied the shape it needs to have, informed by `x-tagGroups` as a concrete worked example (§4). This proposal is the "add it later" Option C left on the table.

This proposal does **not** revisit PR #127's `x-tagGroups` semantics as *shipped* — see §7.

## 2. Current behaviour, and where extension merging actually happens today

`x-*` fields turn up at many levels of an OpenAPI document — the root, `info`, individual tags, path items, operations, schemas — which is naturally where "extensions found around swagger files" points. This proposal only changes how **root-level** ones merge, because that is the only level where the merge currently makes a *choice* between two inputs' values rather than requiring them to already agree. The rest of this section shows the evidence for that.

`packages/openapi-merge/src/extensions.ts` merges `x-*` keys found on the **document root only** — `mergeExtensions` is called exactly once, from `index.ts`, after every other top-level field has already been assembled. Its `extractExtensions` helper reads keys directly off each input's `OpenApiDocument`; it never descends into `info`, `components`, individual `Tag` objects, path items, or operations. Today that function is first-wins for every key except `x-tagGroups` once PR #127 lands, which gets a hardcoded concatenate-and-dedupe-by-group-name merge instead.

That narrow scope is not an oversight — it is where the codebase actually has a decision to make. Checked directly, for each other place a value could be duplicated across inputs:

- **`info`** (`info.ts`) is cloned wholesale from `inputs[0].oas.info`. Any `x-*` extension nested inside `info` (e.g. ReDoc's `x-logo`) already travels with it, first-wins, by construction — there is no per-field merge step to configure.
- **`tags`** (`tags.ts`) dedupes whole `Tag` objects by `name`; the first `Tag` with a given name wins outright; a second input's `Tag` of the same name (and any `x-*` extension on it) is dropped entirely, not merged field-by-field.
- **Path items combined via `duplicatePathHandling: 'merge-operations'`** (`merge-path-items.ts`) require every path-level field — including any `x-*` extension on the Path Item Object — to be **exactly deep-equal** between the two inputs, or the merge refuses outright with `duplicate-paths`. There is no first-wins or concatenation here to make configurable; disagreement is a hard stop by design.
- **`components`** dedupes by structural equality or disputes (renames) a differing definition; it never deep-merges two versions of "the same" component, so a component's own `x-*` extensions are never merged either.

So the document root is the only place two inputs' values for the same key are actually *combined by a policy* rather than compared for equality or deduplicated wholesale. This proposal's mechanism therefore still only fires at that scope (§6's Option D covers why extending it further is out of scope). What changes from a first cut of this idea is not *where* it applies, but how expressive the merge policy needs to be *within one extension's own value*, once you're inside it.

## 3. Why a flat, per-key strategy is not enough

A natural first design is a flat map: `{ 'x-tagGroups': 'concat-array' }`. It fails on the actual motivating case. `x-tagGroups`'s correct merge (PR #127) is not "concatenate the arrays":

1. Two groups **with the same `name`** across inputs are the same group and must combine into one entry, not appear twice.
2. Within a combined group, the `tags` arrays concatenate **and deduplicate**.
3. Groups seen only once pass through unchanged.
4. Order is first-seen order across all inputs, not input-then-input.

That is a merge policy that differs *by position inside the value* — the array itself needs "combine same-named elements", and each combined element's `tags` field needs "concatenate and dedupe", and its `name` field needs "keep the one they agree on". A single strategy label applied to the whole `x-tagGroups` value cannot express this; it can only pick one blunt behaviour for the entire array (as PR #127's own §4 Option B/C already anticipated, without spelling out the shape). Since realistic extension values are exactly this — small structured objects and arrays of objects, not flat scalars — the configuration has to be a **tree that mirrors the extension value's own JSON shape**, with a merge strategy chosen independently at each node: this key merges this way, that nested array merges that way, and so on down.

## 4. The strategy tree

Each node in the tree corresponds to one point in the extension value's JSON shape and picks a strategy appropriate to that node's kind:

```ts
export type ExtensionMergeNode =
  // A leaf value: string, number, boolean, or null.
  | { kind: 'scalar'; strategy: 'first' | 'last' | 'error' }

  // A JSON array, combined wholesale.
  | { kind: 'array'; strategy: 'first' | 'last' | 'error' }
  // A JSON array, combined element-by-element. `sortBy` (optional) sorts the
  // result afterwards -- by a named field, for arrays of objects, or by plain
  // value comparison if omitted and the elements are scalars themselves.
  | { kind: 'array'; strategy: 'concat' | 'concat-unique'; sortBy?: string }
  // A JSON array of objects, where elements sharing the same value at `key`
  // across inputs are the *same* logical entry and are combined using `item`.
  // `item` is required, not defaulted: a default of wholesale `'first'` per
  // key would make `union-by-key` behave exactly like `concat-unique` on the
  // outer array minus true duplicates, silently defeating the reason to pick
  // this strategy over that one. Elements whose key value appears in only one
  // input pass through unchanged. Preserves first-seen order across all
  // inputs; there is no `sortBy` here, unlike the concat variants above --
  // "first-seen order" is the point of this strategy, not an accident of it.
  | { kind: 'array'; strategy: 'union-by-key'; key: string; item: ExtensionMergeNode }

  // A JSON object, combined wholesale.
  | { kind: 'object'; strategy: 'first' | 'last' | 'error' }
  // A JSON object, combined field by field. A field not listed in `fields`
  // defaults to `'first'`, applied to that field's value wholesale regardless
  // of its own shape -- an unconfigured field does not get guessed at.
  | { kind: 'object'; strategy: 'merge'; fields?: { [fieldName: string]: ExtensionMergeNode } };

export interface MergeOptions {
  // ...existing fields...
  /**
   * How to combine a document-root `x-*` extension's value across inputs,
   * keyed by extension name and shaped to mirror that value's own JSON
   * structure (issue #60, generalised).
   */
  extensionMergeStrategies?: { [extensionKey: `x-${string}`]: ExtensionMergeNode };
}
```

`x-tagGroups`, re-derived as pure configuration rather than the hardcoded TypeScript PR #127 ships, to show the tree is expressive enough for the case that motivated all of this:

```jsonc
{
  "x-tagGroups": {
    "kind": "array",
    "strategy": "union-by-key",
    "key": "name",
    "item": {
      "kind": "object",
      "strategy": "merge",
      "fields": {
        "tags": { "kind": "array", "strategy": "concat-unique" }
      }
    }
  }
}
```

This reproduces points 1–4 of §3 exactly. It does **not** reproduce PR #127's additional pruning step — dropping a group that ends up with zero tags — because "drop this array if empty" is a predicate on the *result*, not a merge policy for combining two inputs' values, and no primitive above expresses it. That is a real, known gap of this design relative to the hardcoded version (§7), not an oversight.

### Answering the specific questions raised

- *"If it's two different arrays, do we merge the values of both arrays together?"* — `concat` (keep duplicates) or `concat-unique` (dedupe by deep equality), your choice per array node.
- *"Do we sort them?"* — optional `sortBy` on either concat variant: a field name for arrays of objects. Omitted, the result keeps concatenation order (first-seen across inputs) regardless of element type — see §10, an earlier draft of this section left "omitted" ambiguous for arrays of scalars; concatenation order won, for the same reason every other unconfigured behaviour in this design defaults to the least surprising option. There is no arbitrary comparator — see §6, this stays pure configuration.
- *"Do we just take the first array or the second array?"* — `'first'` / `'last'` at the array node, when the two inputs' arrays are not meant to combine element-by-element at all (e.g. they are mutually exclusive alternatives, not a shared list).
- *"For two values that are merging, do we take the first value, the second value?"* — `'first'` / `'last'` at the relevant scalar node, chosen independently per field.
- *"Do we error out if there are values where we have to make a choice?"* — `'error'` at any node (scalar, array, or object): fails the merge if two or more inputs disagree at that point. Agreement across inputs (including only one input declaring it at all) is never a conflict, matching `securitySchemesStrategy: 'error'`'s existing precedent.

### `'error'` semantics at every node kind

`'error'` always means the same thing regardless of depth: if the inputs disagree at that node, **the whole merge fails** with a document-level error naming the extension key and the path inside it where the disagreement was found. There is no partial-failure mode where an `'error'` on a nested field merely drops that field or falls back to `'first'` — that would silently do the opposite of what configuring `'error'` was for. At `{ kind: 'object', strategy: 'error' }` (wholesale, no `fields`), "disagree" means the two values are not deep-equal; inside a `merge` node, each field's own node decides disagreement independently, and any one of them failing fails the merge.

### Type-mismatch handling

If a node's configured `kind` does not match the actual runtime shape (an `array` node applied to a key whose value is an object in one input, say), that subtree falls back to `'first'` rather than guessing or crashing — the same defensive posture PR #127 already established for `x-tagGroups` itself (`isTagGroupArray`: an unrecognised shape is left untouched). This applies at whatever depth the mismatch is found, so a good `tags` field inside an otherwise-malformed group still degrades gracefully rather than failing the whole document.

This is a deliberate tradeoff, not an unconsidered default: silently falling back to `'first'` means a typo in `key`, or an upstream field that got renamed, produces ordinary-looking first-wins output with no signal that the configured strategy never actually ran. Accepted here because it matches this library's existing bias (an unrecognised `x-tagGroups` shape is *also* left untouched rather than rejected) and keeps a single malformed input from failing an entire merge over one extension. A strict mode — treat a type mismatch as if that subtree were configured `'error'` — is the natural future addition for anyone who would rather find out. Not built here; nobody has asked for it yet, and it is a small, additive change on top of this mechanism whenever someone does.

## 5. Other options considered

### Option A — one global fallback strategy for every unconfigured `x-*` key

`MergeOptions.unknownExtensionStrategy: 'first' | ...`. Rejected: a single label, whatever it is, cannot express §3's case at all, and forcing the same policy onto every extension in a document that carries more than one is worse than today's uniform first-wins.

### Option B — flat, one level: `{ [extensionKey]: 'first' | 'concat-array' | 'deep-merge' | 'error' }`

An earlier draft of this proposal. Rejected once checked against `x-tagGroups` (§3): `'concat-array'` can only concatenate blindly, `'deep-merge'` can only apply one policy to every field of every object it finds, and neither can express "combine array elements that share a key, then apply a different strategy per field of the combined result." Superseded by §4.

### Option C — extend the tree to also reach non-document-root locations

E.g. a path like `components.schemas.*.x-internal`. Rejected for the same reason given in §2: none of those other locations (`info`, `tags`, path items, `components`) has an existing per-field merge step to attach a strategy to — they are whole-object first-wins/dedupe or hard-refuse-on-difference. Reaching them would first require designing a merge behaviour for path-level and component-level extensions specifically, which is a separate, larger proposal if a concrete need for it appears — not a checkbox to add here speculatively, which is the exact reasoning PR #127 used to defer the whole idea in the first place.

### Option D — deep-merge every extension unconditionally, no configuration

Rejected outright, unchanged from the first draft: `x-*` semantics are opaque to this library by definition, deep-merging two differently-shaped values under the same key can silently produce a value that is valid JSON but meaningless to whatever tool reads it, and it would be a breaking change for anyone currently relying on (undocumented but real) first-wins.

## 6. Non-goals

- **Custom merge functions supplied as code.** Robert's request was explicit — "purely use configuration" — and this library's whole configuration surface (both here and in the CLI) is JSON/YAML-serialisable; a function cannot cross that boundary for CLI users. `sortBy` is a named-field reference rather than a comparator function for the same reason: it stays representable in JSON.
- **Extension merging at any location other than the document root.** See §2 and Option C.
- **The "drop this array/object if it ends up empty" pruning PR #127 does for `x-tagGroups`.** A real gap identified in §4, not solved here. A future, narrower addition (e.g. a `dropIfEmpty` flag on an array node) could close it if a second case needs it — not designed speculatively now.
- **Revisiting PR #127's `x-tagGroups` semantics as shipped.** Cited as precedent and as the default this mechanism defers to when unconfigured (§7); not reopened here.

## 7. Interaction with PR #127's hardcoded `x-tagGroups` handling

An explicit `extensionMergeStrategies['x-tagGroups']` entry overrides PR #127's built-in concatenation; an unconfigured `x-tagGroups` keeps using it. §4 shows the tree *can* reproduce that built-in behaviour (modulo the empty-group pruning gap), but that is a demonstration of the mechanism's expressiveness, not a suggestion to reimplement PR #127 in terms of it — the hardcoded version is simpler, already covers the pruning step this mechanism cannot, and remains the sensible shipped default for that one key regardless of whether this proposal is built. This mechanism's value is for every *other* extension nobody has hardcoded a special case for.

## 8. Testing plan

- Each node kind and strategy in isolation: `scalar` (`first`/`last`/`error`, agree and disagree cases), `array` wholesale (`first`/`last`/`error`), `array` `concat`/`concat-unique` (with and without `sortBy`), `array` `union-by-key` (matching keys combine, unmatched keys pass through, order is first-seen), `object` wholesale (`first`/`last`/`error`), `object` `merge` (listed fields recurse, unlisted fields default to `first`).
- The full `x-tagGroups`-equivalent tree from §4, run against the same fixtures PR #127's own tests use, to demonstrate parity modulo the documented empty-group gap.
- Type-mismatch fallback at both the top level and nested inside a `merge`/`union-by-key` node, confirming only the mismatched subtree degrades to `first`, not the whole document.
- Unconfigured keys are unaffected: an extension not mentioned in `extensionMergeStrategies` keeps first-wins exactly as before, proving this is additive.
- Zero, one, and three inputs declaring the same configured key, to pin `'error'`'s agreement-is-not-a-conflict boundary at every node kind.
- Confirms no interaction with `pruneUnusedComponents`, `securitySchemesStrategy`, or `serversStrategy` — this is a document-root, `x-*`-only mechanism, disjoint from all three.

## 9. Sequencing (Robert's call, not decided by this proposal)

PR #127 is unmerged. This proposal's mechanism is additive to whatever PR #127 ships (§7's "interaction" note holds regardless of exact wording there), so there is no hard ordering requirement — but landing PR #127 first means this proposal's tests can assert against `x-tagGroups`'s real built-in behaviour rather than a hypothetical one.

## 10. What was actually built

Implemented as §4 describes, against `main` as it stood before PR #127 merged (still open at the time of this work) — so there is no built-in `x-tagGroups` default to interact with yet; §7's "explicit config always wins" rule is written to hold once PR #127 lands, but nothing here depends on it landing first. Four things worth recording:

- **`sortBy` omitted means no sorting, full stop** — not "sort naturally when the elements are scalars," which §4's original wording left ambiguous. Concatenation order (first-seen across inputs) is the result whenever `sortBy` is not given, for both `concat` and `concat-unique`, on arrays of any element type. Chosen for the same reason every other unconfigured behaviour in this design defaults to the least surprising option, and because "sort scalars but not objects when a field name is absent" is an asymmetry nobody asked for.
- **A latent bug in `init-command.ts` surfaced and was fixed.** `renderCommentedBlock` (which renders every `TOP_LEVEL_OPTIONAL_BLOCKS`/`PER_INPUT_OPTIONAL_BLOCKS` entry as commented YAML) prepended `# ` to a block's whole multi-line `explanation` string as one unit, rather than splitting it into lines first — so only the first line of a multi-line explanation ever got commented; the rest were emitted as bare, uncommented text, which `init`'s own tests caught immediately as invalid YAML the moment a multi-line explanation was added (this proposal's `extensionMergeStrategies` block is the first one). `renderActiveBlock`, the sibling function for `ACTIVE_TOP_LEVEL_DEFAULTS`, already did this correctly (`explanation.split('\n').map(...)`); `renderCommentedBlock` now matches it. Unrelated to this proposal's own design, found only because it was the first thing to exercise the code path.
- **The CLI's own `merge()` call was missing `extensionMergeStrategies` entirely**, independent of the type layer: `packages/openapi-merge-cli/src/index.ts` builds the `MergeOptions` object passed to the library by hand, listing each field (`serversStrategy`, `securitySchemesStrategy`, `pruneUnusedComponents`, `info`, ...), and the new field was absent until added — every end-to-end test using it failed with plain first-wins output until this one-line fix, which is exactly the kind of wiring gap this proposal's own §8 testing plan was designed to catch rather than trust from the type-checker alone.
- **The recursive `ExtensionMergeNode` type generates a clean, self-referencing JSON Schema** (`$ref: '#/definitions/ExtensionMergeNode'` inside its own `union-by-key`/`merge` variants) via `typescript-json-schema` — verified directly against the generated `configuration.schema.json` before building out the rest of the CLI surface, since a recursive discriminated union failing to generate (hanging, or inlining infinitely) would have forced a redesign. It did not; the CLI's `data.ts` carries its own structurally-identical mirror of `ExtensionMergeNode`, matching this codebase's existing pattern for `PathSelector`/`OperationSelection`.

Implementation: `packages/openapi-merge/src/{extension-merge-strategies,extensions,data,index}.ts` (new `ExtensionMergeNode`/`ExtensionMergeStrategies` types, the recursive merge algorithm, the new `'extension-merge-conflict'` `ErrorType`, and `MergeOptions.extensionMergeStrategies`) and mirrored CLI-side types/schema/`init`/README in `packages/openapi-merge-cli/src/`. `extension-merge-strategies.test.ts` exercises the algorithm directly (every node kind, every strategy, type-mismatch fallback, nested error propagation with path names, and the full `x-tagGroups`-equivalent tree reproducing PR #127's own test scenarios); `document-metadata.test.ts` and `cli-merging.test.ts` cover the wiring into `merge()` and the CLI respectively. 100% coverage on `extension-merge-strategies.ts` and `extensions.ts`; no regressions elsewhere in either package.
