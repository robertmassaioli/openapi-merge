# Implementation Proposal: Issue #60 — Concatenate `x-tagGroups` Across Inputs

**Status:** Proposal (revised 2026-08-02 — verified against current `main`;
see §0)

**Issue:** [robertmassaioli/openapi-merge#60](https://github.com/robertmassaioli/openapi-merge/issues/60)

---

## 0. Revision note

`extensions.ts` itself is essentially unchanged from the original draft —
the "first-wins" merge it describes is verified accurate against current
`main`, line for line. What's changed is everything *around* it: the
implementation sketch in the original draft's §8 invented a `mergeTags(inputs,
mergedOutput): Swagger.SwaggerV3` signature that has never existed —
`tags.ts`'s real signature is `mergeTags(inputs: MergeInput): Swagger.Tag[] |
undefined`, and `x-tagGroups` filtering was sketched against the wrong
function shape entirely. §4–§6 below replace that sketch with one that
matches how `mergeExtensions`/`mergeTags` are actually wired together in
`packages/openapi-merge/src/index.ts` today, and §7 narrows scope
accordingly.

## 1. Issue Summary

When merging OpenAPI files that each define `x-tagGroups` at the top level
(a ReDoc convention: `[{ name: string, tags: string[] }, ...]`, used to
organize the sidebar), only the **first** input's `x-tagGroups` survives in
the output. Every other input's groups are silently dropped, even though
their `tags` (the plain OpenAPI field, not the extension) are correctly
merged and deduplicated into the output.

## 2. Current Behaviour, Verified Against `main`

Confirmed still exactly true. `packages/openapi-merge/src/extensions.ts`:

```typescript
function mergeExtensionsHelper(extensions: Extensions[]): Extensions {
  // ...
  const result = { ...extensions[0] };
  for (let extensionIndex = 1; extensionIndex < extensions.length; extensionIndex++) {
    const ext = extensions[extensionIndex];
    for (const extensionKey in ext) {
      if (result[extensionKey] === undefined && ext.hasOwnProperty(extensionKey)) {
        result[extensionKey] = ext[extensionKey];
      }
    }
  }
  return result;
}
```

Every top-level `x-*` key is first-wins, unconditionally — and this is
deliberate, not an oversight: `document-metadata.test.ts`'s `describe('extensions', ...)`
suite has a test titled *"should take the first extension definition at the
top level"*, pinning exactly this behaviour for arbitrary vendor extensions
like `x-atlassian-narrative`. That's the right default for an opaque
extension nobody can safely interpret. `x-tagGroups` is the one common
exception: its shape is regular (`{ name, tags: string[] }[]`) and its
semantics (grouping tag names for display) are well-known enough to
concatenate safely — the same argument the original draft made, still
valid.

**The inconsistency the issue points at is real and reproducible today:**
`tags` (the actual OpenAPI field) dedupe-merges across every input via
`mergeTags()` in `tags.ts`; `x-tagGroups` (the ReDoc extension referencing
those same tag names) keeps only the first input's groups. A tag surviving
the merge with no group naming it, or a group naming a tag from an input
whose group entry was silently discarded, is the exact symptom in the
issue. Reproduced directly against this branch's built library (two inputs,
each with one tag and one `x-tagGroups` entry):

```
tags:        [{"name":"user"},{"name":"admin"}]        <- both survive
x-tagGroups: [{"name":"User","tags":["user"]}]          <- "Admin" silently dropped
```

## 3. How `mergeExtensions` and `mergeTags` are actually wired together

This is the part the original draft's implementation sketch got wrong, and
it matters for scoping the fix correctly. In `packages/openapi-merge/src/index.ts`:

```typescript
const output: OpenApiDocument = mergeExtensions(
  {
    // ...
    tags: mergeTags(inputs),
    // ...
  },
  inputs.map(input => input.oas)
);
```

`mergeTags(inputs)` computes the deduped top-level `tags` array
**independently** of extension merging, and `mergeExtensions(mergeTarget,
oass)` spreads `{ ...mergeTarget, ...mergeExtensionsHelper(...) }` — the
extensions result is spread *last*, so whatever `mergeExtensionsHelper`
decides for a given key wins over anything pre-computed in `mergeTarget`.
That means:

- `mergeTags` has no visibility into `x-tagGroups` at all today (it only
  touches `Swagger.Tag[]`, not extensions), and
- a `x-tagGroups`-aware merge has to live *inside* `extensions.ts` — as
  the original draft's Option A/C recommended — not bolted onto `tags.ts`
  as its Step 2 sketch actually wrote it. The original sketch's own
  "Step 2: Update `tags.ts`" section calls a `mergeTags(inputs, mergedOutput)`
  signature that has never existed in this codebase.

## 4. Revised Design

Special-case `x-tagGroups` inside `mergeExtensionsHelper` (or a sibling
helper called from `mergeExtensions`), independent of `mergeTags`:

```typescript
type TagGroup = { name: string; tags: string[] };

function mergeTagGroups(perInputGroups: (TagGroup[] | undefined)[]): TagGroup[] | undefined {
  const tagsByGroup = new Map<string, Set<string>>();
  const groupOrder: string[] = [];

  for (const groups of perInputGroups) {
    for (const group of groups ?? []) {
      if (!tagsByGroup.has(group.name)) {
        tagsByGroup.set(group.name, new Set());
        groupOrder.push(group.name);
      }
      group.tags.forEach(tag => tagsByGroup.get(group.name)!.add(tag));
    }
  }

  if (groupOrder.length === 0) {
    return undefined;
  }
  return groupOrder.map(name => ({ name, tags: [...tagsByGroup.get(name)!] }));
}
```

Wired into `mergeExtensionsHelper` as a special case dispatched by key,
alongside (not replacing) the generic first-wins loop for every other
extension — matching the original draft's Option C, now against the real
function.

## 5. Scope cut: leave `excludeTags` interaction as a known limitation

The original draft's §6 wanted `excludeTags`-filtered tags also stripped out
of the merged `x-tagGroups`. Verified against current code: `mergeExtensions`
receives `inputs.map(input => input.oas)` — raw documents only, **not** the
`MergeInput[]` that carries `operationSelection.excludeTags` per input.
Making that filtering work would mean changing `mergeExtensions`'s signature
to take the full `MergeInput[]` instead of `OpenApiDocument[]`, which is a
larger, more invasive change than this issue's actual complaint.

`x-tagGroups` is not part of the OpenAPI spec — it's a ReDoc-only rendering
hint. A group naming a tag that no longer has any operations after
`excludeTags` filtering is cosmetically odd (ReDoc shows an empty section)
but not invalid, unsafe, or spec-violating. Recommend treating this as an
explicit **non-goal for a first cut**: concatenate and dedupe `x-tagGroups`
without threading `excludeTags` through it, and revisit only if someone
actually reports the cosmetic mismatch as a problem in practice.

## 6. Tests

Add to `packages/openapi-merge/src/__tests__/x-tensions.test.ts` (the
existing extensions suite lives in `document-metadata.test.ts`'s
`describe('extensions', ...)` block today — extend that, rather than the
non-existent file the original draft named):

- Concatenates `x-tagGroups` from multiple inputs, preserving first-seen
  group order.
- Dedupes tags within a group of the same name across inputs.
- Other `x-*` extensions (e.g. `x-atlassian-narrative`) remain first-wins —
  regression test for the existing pinned behaviour in §2.
- No input defines `x-tagGroups` → key absent from output (matches today).
- Only one input defines it → passed through unchanged (matches today, no
  regression from the single-input short-circuit in `mergeExtensionsHelper`).

## 7. Effort

| Task | Effort |
| --- | --- |
| `mergeTagGroups` + dispatch in `extensions.ts` | 30 min |
| Tests | 30 min |
| JSDoc / README note (if `x-tagGroups` is mentioned there — it currently isn't) | 10 min |
| **Total** | **~1.25 hours** |

Lower than the original ~1.5h estimate, since dropping the `excludeTags`
interaction (§5) removes the one piece that would have required a wider
signature change.

## 8. Opinion: is this worth building?

**Yes, and it's cheaper than the original estimate once scoped correctly.**
The problem is real, reproducible today, narrow, and the fix is a small,
self-contained addition to a file (`extensions.ts`) that already has exactly
one job. It doesn't touch the CLI, the schema, or any trust/containment
boundary, unlike #61 and #45. The only judgment call is §5's scope cut,
and I'd defend it: solving the *reported* problem (groups silently
disappearing) doesn't require solving a cosmetic edge case
(`excludeTags`-vs-`x-tagGroups` consistency) nobody has reported.

**Recommendation: implement, scoped to §4 + §6, with §5 as an explicit,
documented non-goal rather than a silent gap.**

## 9. Non-goals

- Filtering `x-tagGroups` by `excludeTags` (§5) — would require widening
  `mergeExtensions`'s signature to accept `MergeInput[]`; deferred until
  someone reports it as an actual problem, not merely a theoretical
  inconsistency.
- A generic, user-configurable per-extension merge strategy (the original
  draft's Option B). Nothing else has asked for this; `x-tagGroups` is the
  one extension with well-known, safely-mergeable semantics today.
- Any other ReDoc/vendor extension beyond `x-tagGroups`.
