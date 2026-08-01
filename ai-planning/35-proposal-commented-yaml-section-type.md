# Evaluation: A `Section`/`CommentedYaml` Type for `init`'s Generated File

**Status:** Evaluation, requested mid-implementation of
[34](34-proposal-init-yaml-commented-options.md). **Decided: Option C** —
keep the current (string-based) implementation as already built; no further
change to `init-command.ts`'s internals. Kept for the record of the
trade-offs considered, in case a future field addition makes Option A worth
revisiting.
**Type:** CLI / developer experience — refactor of `init-command.ts`
**Scope:** `packages/openapi-merge-cli`
**Date:** 2026-08-01

---

## 1. The question

While implementing 34, each optional field is a hand-typed YAML string:

```ts
export type OptionalFieldBlock = {
  name: string;
  explanation: string;
  yaml: string;    // <- hand-written YAML text, e.g. "formatting:\n  indent:\n..."
};
```

`renderInitYaml` splits `yaml` on `\n` and prefixes every line with `# `.
It works — every block round-trips through a real ajv validation in the
current smoke test — but it works *by discipline*: nothing stops a block
from having a typo, a missing required sub-field, or simply not existing
for a field `data.ts` adds next month. The proposal was: replace the string
with a typed object dumped through `js-yaml`, wrapped in a `Section` that
also carries whether it's commented and what comment sits above it, with
the whole document built from `Section`s.

**Verdict: yes, it works, and it's worth doing** — with three extensions to
the shape as originally described. The best part of it isn't tidiness, it's
that one version of it turns a test-time safety net into a *compile-time*
one. §2 covers where it works as-is; §3 covers what has to be added; §4 is
the concrete shape; §5 is the one part of the current design it doesn't
replace.

## 2. Where the idea works exactly as described

Swap `yaml: string` for `data: Record<string, unknown>`, dumped through
`js-yaml` instead of hand-typed:

```ts
{
  name: 'tag',
  comment: "Add a tag to every operation from this input...",
  commented: true,
  data: { tag: { name: 'service-a', description: 'Endpoints from this input' } },
}
```

`dumpYaml(data)` produces the exact block currently hand-written, with three
concrete wins:

- **No hand-typed YAML syntax.** `dumpYaml` handles indentation and scalar
  quoting itself (it's already trusted for exactly this — `yamlScalar()` in
  the current code leans on the same mechanism for `inputFile` paths). A
  stray tab or misaligned `-` in a hand-typed string is a class of bug this
  removes outright.
- **Required sub-fields are enforced by the compiler, not just a test.**
  Type `data.description` as `DescriptionMergeBehaviour` (from `data.ts`)
  and TypeScript refuses to compile a block missing `append` — the exact
  failure mode 34's advisor review caught in the string-based version,
  now caught before `bun test` even runs.
- **Verified key ordering is preserved.** Checked empirically (`js-yaml`
  `dump()` on an object with keys in declaration order, no `sortKeys`
  configured) — insertion order survives, so a `Section`'s `data` renders
  fields in the order they're declared, matching the hand-typed version.

## 3. Where the literal `{ data, commented, comment }` shape falls short

Three gaps, found by mapping all twelve current blocks onto it, not by
inspection alone:

### 3.1 Per-line trailing comments have nowhere to live

Several blocks annotate one *specific* dumped line, not the block as a
whole:

```
    style: spaces # spaces | tabs (tabs are JSON-output only -- YAML forbids tab indentation)
```

`comment` in the proposed shape sits *above* the section; there's no slot
for a comment trailing a line inside `dumpYaml(data)`'s own output.

**Resolution:** fold the option list into the header comment instead of
keeping it inline:

```
# How the merged output file is indented. style: spaces or tabs (tabs are
# JSON-output only -- YAML forbids tab indentation). Defaults to 2 spaces.
# formatting:
#   indent:
#     style: spaces
#     width: 2
```

Loses a little locality (the options are one line up instead of on the same
line) but costs nothing structurally, and reads fine — checked against all
five enum-valued blocks (`formatting.indent.style`, `serversStrategy`,
`securitySchemesStrategy`, `duplicatePathHandling`, and the
`prefix`/`suffix` note on `dispute`). A per-key `inlineComments` side table
was considered and rejected for now — it's more machinery for a readability
difference this small; revisit only if a future block genuinely needs it.

### 3.2 The per-input block isn't a peer of the top-level ones — it's nested

`pathModification`, `tag`, `dispute`, etc. don't sit at the document's top
level; they sit *inside* the first `inputs[]` entry, indented under
`- inputFile: ...`. A flat `Section[]` has nowhere to express "these six
sections render one level deeper, under this specific list item, and only
under the first one."

**Resolution:** `Section` needs a `children?: Section[]` slot, and the
`inputs` entry itself becomes a `Section` whose children are attached only
to the first item. Bounded, not open-ended — but the indent arithmetic has
a wrinkle worth being precise about, checked empirically rather than
assumed: `js-yaml dump()` on a two-key map inside a list item puts a
sibling key at **4** spaces (`- inputFile: x` / `    tag: ...`), not 2 —
the `- ` sequence marker itself consumes 2 columns beyond the ordinary
1-level-in map nesting of 2. Below that first hop, further nesting *is* a
flat +2 per level (`tag:` → `  name:` is 4 → 6). So the renderer needs one
fixed **+4** step for "entering a sequence item's map" and an ordinary +2
for every level after — not a uniform +2 throughout, which is what the
current code's `PER_INPUT_BLOCK_INDENT = '    '` constant already encodes
correctly. A recursive renderer built on a uniform +2 assumption would
misindent the very first block it renders.

### 3.3 `inputs`/`output` are real data, not a static example — and only one of them is a list

Every current `Section` is a fixed example (`serviceA_`, `1.0.0`, ...).
`inputs`/`output` are *computed* from what the scan found, and `inputs` is a
*sequence* of items that can each carry different children, not a single
map. Modelling `inputs` as one `Section` requires either a `SequenceSection`
variant alongside the map-shaped one, or accepting that the required
skeleton stays hand-rendered and only the optional parts become `Section`s
(§5).

## 4. The shape that closes the gaps

A first cut wrote `data: Record<string, unknown>` — that compiles for
*anything*, so it does not actually catch a missing `description.append`;
`Record<string, unknown>` was the mistake to avoid, not the fix. Getting
real enforcement means keying the section tables by field name with a
**mapped type**, so each entry's `data` is pinned to that field's actual
(non-optional) type from `data.ts`:

```ts
type TopLevelOptionalKey = Exclude<keyof Configuration, 'inputs' | 'output'>;

type TopLevelSections = {
  [K in TopLevelOptionalKey]: { comment: string; data: { [P in K]-?: Configuration[P] } };
};

const TOP_LEVEL_SECTIONS: TopLevelSections = {
  outputRoot: { comment: '...', data: { outputRoot: '.' } },
  formatting: { comment: '...', data: { formatting: { indent: { style: 'spaces', width: 2 } } } },
  serversStrategy: { comment: '...', data: { serversStrategy: 'first' } },
  securitySchemesStrategy: { comment: '...', data: { securitySchemesStrategy: 'merge' } },
  pruneUnusedComponents: { comment: '...', data: { pruneUnusedComponents: false } },
  info: { comment: '...', data: { info: { title: 'My Merged API', version: '1.0.0', description: '...' } } },
};

type PerInputOptionalKey = keyof ConfigurationInputBase | keyof DisputeV2;
// pathModification | operationSelection | description | duplicatePathHandling | tag | dispute
// (not `Exclude<keyof ConfigurationInputBase, 'inputFile' | 'inputURL'>` -- those two keys live on
// ConfigurationInputFromFile / ConfigurationInputFromUrl, not on ConfigurationInputBase, so excluding
// them from it would be a no-op)

type PerInputSections = {
  [K in PerInputOptionalKey]: { comment: string; data: { [P in K]-?: (ConfigurationInputBase & DisputeV2)[P] } };
};
```

Two things follow from `{ [P in K]-?: ... }` rather than `Record<string, unknown>`:

- **`TopLevelSections`/`PerInputSections` force every key to be present** —
  the exhaustiveness win described below.
- **Each entry's `data` is typed as the real field**, so a nested required
  sub-field is enforced transitively for free. `data.description` is typed
  `DescriptionMergeBehaviour`, which requires `append`; a literal missing
  it is a compile error. `data.formatting` is typed `OutputFormatting`,
  so `indent: { style: 'spaces', width: 2 }` has `width` enforced by
  `SpaceIndent` the same way. This is the actual mechanism — not
  `Record<string, unknown>` — for the "compiler catches a missing
  required field" claim in §2.

The renderer type is separate from the table type and stays closer to the
first draft, since *it* only needs to walk a tree and doesn't need per-key
precision:

```ts
type RenderNode = { comment: string; commented: boolean; data: Record<string, unknown>; children?: RenderNode[] };
```

`TOP_LEVEL_SECTIONS`/`PER_INPUT_SECTIONS` are the source of truth (typed,
exhaustive); a thin `Object.values(...)` conversion turns them into
`RenderNode[]` for the actual walk. The exhaustiveness lives in the table's
type, not the renderer's.

**Exhaustiveness enforced by the compiler, not a hand-maintained list.** If
`data.ts` gains a new optional `Configuration` field tomorrow,
`TopLevelSections` gains a new required key and `TOP_LEVEL_SECTIONS`
**fails to typecheck** until an entry is added for it. The current
(string-based) design's equivalent safeguard is the coverage test planned
in 34 §6 — an explicit list of field names, cross-checked by hand against
`data.ts` when either changes. That test still catches a forgotten field,
but only when someone remembers to run it and notices the failure; the
mapped type catches it at `bun run typecheck`, before a test is even
written.

This is the one part of the idea that's a strict upgrade, not a wash: it
converts "a human has to remember to update two places" into "the build
breaks if they don't" — at the cost of the mapped-type machinery above,
which is real but confined to two type declarations.

## 5. What doesn't move: the required skeleton

`inputs`/`output` with their *real*, scan-derived values stay
purpose-written rendering (a `SequenceSection` with dynamic `data`, or just
the current direct string-building — either works). The `Section` model's
value is entirely in the *optional, commented* two-thirds of the file; it
was never going to also simplify "print what the scanner actually found,"
which has no comments and no static example to model.

## 6. Recommendation: three options, not one

The exhaustiveness win (§4) does not actually require the `Section`/tree
refactor — it only requires the *tables* being keyed by field name with a
mapped type. That's separable from switching the block bodies from
hand-typed YAML strings to `dumpYaml`-rendered objects. Worth naming as its
own option rather than bundling it into "adopt or don't":

**Option A — exhaustiveness only, keep hand-typed YAML strings.**
Re-key the existing `OptionalFieldBlock[]` arrays as
`Record<TopLevelOptionalKey, OptionalFieldBlock>` /
`Record<PerInputOptionalKey, OptionalFieldBlock>`. ~10 lines of change
against code that already works and already passes ajv for all 12 blocks.
Gets the build-breaks-on-a-forgotten-field guarantee; does not remove
hand-typed YAML syntax as a source of typos (still caught, just at test
time via 34 §6's per-field validity test, not at compile time).

**Option B — full refactor to typed `data` + `RenderNode` tree (§4/§5).**
Gets Option A's guarantee *and* removes hand-typed YAML syntax, at the cost
of: the mapped-type table declarations, the `RenderNode` tree and its
recursive renderer, the sequence-vs-map distinction for `inputs` (§3.3),
and moving five inline enum-option comments into header prose (§3.1) —
which means the README snippet already written for 34 needs a matching
edit, since it currently shows the inline style. Larger, but the current
implementation is not yet under test, so nothing this touches is load-
bearing elsewhere in the codebase — the cost is confined to
`init-command.ts` and its (not-yet-written) tests.

**Option C — neither; keep 34's implementation as already built.**
Already implemented, already validated against the real schema by the
throwaway smoke test used while building it. Zero further cost, and 34
never promised more than "correct," which it is.

**No default recommendation here** — this is a design-taste call between a
small guaranteed win (A), a larger but more thorough one (B), and shipping
what already works (C), and it was Robert's instinct that prompted this
evaluation in the first place. Whichever is chosen, 34 §6's test plan
applies unchanged in what it asserts (uncomment one field in isolation,
validate against the real schema) regardless of how the block bodies are
produced — so the tests can be written once, now, against whichever shape
is chosen, rather than written twice.
