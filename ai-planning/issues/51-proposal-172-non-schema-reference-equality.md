# Implementation Proposal: Issue #172 — Equality for Non-Schema References

**GitHub issue:** [#172 — `deepEquality` is not handling non-schema references properly](https://github.com/robertmassaioli/openapi-merge/issues/172)
**Status:** ✅ Implemented on branch `issue-172-non-schema-ref-equality-proposal`; validated with the focused fixture and library checks below.
**Value:** 4/5 — valid, identical component definitions can currently make a merge throw instead of deduplicating.
**Effort:** 2/5 — fix the reference-resolution contract used by structural comparison and cover the heterogeneous component types already supported by `CrossDocumentLookup`.

## 1. Review: the issue is correct

The reported error matches the current implementation. `deepEquality` recursively compares object properties, and whenever it encounters two `$ref` objects it unconditionally resolves both through `Lookup.getSchema()` in `component-equivalence.ts`. That accessor only accepts Schema Objects. `InternalLookup.getSchema()` resolves a pointer and then checks `SwaggerTypeChecks.isSchema`; a valid Header Object at `#/components/headers/header_name` therefore returns `undefined`, which `isSchemaOrThrowError()` converts into the reported exception.

`CrossDocumentLookup` already has typed accessors for headers, responses, parameters, examples, request bodies, links, callbacks, and security schemes. The comparator does not use those accessors: its API receives only two `Lookup` values and asks for schemas for every reference it sees. This is why schema-reference tests do not catch the heterogeneous-component failure.

The `dispute.alwaysApply = false` detail is consistent with the failure. When same-named components are compared, `processComponents` calls the equality function before it can decide whether a conflict needs dispute renaming. The exception occurs during that comparison, before normal conflict handling.

One detail in the issue's reproduction sketch needs tightening: path references alone are not sent through `deepEquality`; the reported stack enters through `processComponents`, which compares same-named component definitions. The exact fixture should therefore identify the duplicated component whose contents lead the recursive comparison to `#/components/headers/header_name` (for example, duplicate response components containing that Header reference). The stack trace establishes that such a comparison occurred, but the issue text does not show the full YAML needed to confirm its abbreviated path-only recipe.

The issue's exact YAML was not available, so the literal path-only recipe is still not independently reproduced. The added end-to-end test follows the reported stack's actual path: two inputs collide on a response component whose nested Header references are resolved during `processComponents`.

## 2. Alternatives

### A. Add a comparison resolver to `CrossDocumentLookup` — recommended

Give structural equality a narrow, comparison-specific resolver contract and implement it through `CrossDocumentLookup`. It should reuse the existing local/cross-document traversal and cycle guard, and return a resolved target plus its kind when that kind is known, without assuming every target is a Schema Object. `deepEquality` should refuse to equate two references known to target different component kinds. Wire the resolver into the two production call sites in `paths-and-components.ts` and `external-references.ts`; both already construct `CrossDocumentLookup`. Keep the third-party `SwaggerLookup.Lookup` interface unchanged.

The resolver must still enforce valid reference targets where their kind is known, rather than allowing two malformed scalar or wrong-kind targets to compare equal just because their raw JSON matches. Preserve schema title backfill for schema references: `getSchema()` adds the component name as a missing `title`, and that affects equality today. Either apply that same rule in the comparison resolver for schema targets or explicitly prove and document why changing it is safe. `pathItems` currently have no typed lookup accessor, so this approach also needs a deliberate policy for that component kind.

This is the best balance for this bug: it centralizes local and external reference handling, supports nested mixed kinds, and avoids copying pointer parsing into the comparator. Its main cost is making the resolver's validation and schema-title semantics explicit.

**Implementation result:** this approach worked as expected in the regression tests. Whole component references dispatch to their typed lookup (including `pathItems`); nested and non-component references first retain schema resolution/title backfill, then accept another non-array OpenAPI object. Unresolved refs still fail through `deepEquality`'s existing error path. The name-collision rule remains in force: equal response components can collapse even when their Header refs use different names, while both differently named Header components remain in the output.

### B. Dispatch to typed getters based on the reference target

Inspect the reference target and call `getHeaders`, `getResponse`, `getSchema`, and so on. This reuses existing type checks and schema-title behavior, but it couples equality to JSON Pointer parsing and component bucket names. It becomes brittle for aliases, external identities, references to non-component locations, and `pathItems`, for which no typed accessor currently exists. Keep this logic inside the lookup if chosen; do not grow a second resolver in `component-equivalence.ts`.

### C. Expand/canonicalize reference graphs before comparing

Resolve references into expanded values once and compare those. This could make the comparator simpler, but creates a larger change involving expansion, graph identity, cycles, and memory usage. It is not justified for this narrow defect unless a broader normalization refactor is already planned.

### D. Treat matching `$ref` strings as equal

This is a small shortcut, but it is semantically unsafe: the same local reference string in two input documents can resolve to different definitions. It would hide real conflicts and is rejected.

### E. Treat non-schema references as unequal instead of throwing

This avoids the exception but prevents valid duplicate definitions from deduplicating, potentially renaming identical components under dispute handling. It is a useful fail-closed fallback only if correct resolution proves infeasible.

## 3. Recommended implementation details

Implement alternative A with a small local resolver type or explicit resolver callbacks; do not add a method to the third-party lookup interface using a cast. Return `{ kind, value }` for recognized component buckets, and compare kinds before comparing values. Reuse `CrossDocumentLookup`'s single recursive walk and null checks. Preserve schema title backfill on schema targets, validate targets when the referenced component kind is known, and retain the established error for unresolved references.

Also replace `ReferenceRecord`'s closure-wide permanent `seen` set with an active-pair guard scoped to one top-level comparison. A pair revisited while it is currently being resolved can break a recursive cycle; remove it when that comparison unwinds. Retaining pairs across completed comparisons can incorrectly make a later comparison return `true` after an earlier one was unequal or failed. This is adjacent to the resolver change but belongs in the same comparator correction because it affects whether results are trustworthy.

## 4. Behavior and compatibility

- Identical resolved component definitions continue to deduplicate, including when their nested `$ref`s target headers or other non-schema objects.
- Different resolved definitions continue through the existing conflict/dispute path.
- Schema references keep their current title backfill behavior; two component schemas with identical bodies but different implicit names must continue to compare according to that established behavior.
- A missing or unsupported target must not become equal merely because it is a reference. Preserve the current unresolved-reference outcome unless a separate API decision changes error reporting.
- Cross-document refs should resolve only through documents already known to the merge, matching `CrossDocumentLookup`'s current boundary; this proposal does not add I/O or reference fetching.
- Cyclic reference pairs are provisionally accepted only while the same pair is active in the current comparison, not cached across separate component comparisons.

## 5. Regression coverage for implementation

Add focused tests at both comparator and merge levels:

1. `deepEquality` resolves equivalent `#/components/headers/...` references without throwing.
2. End-to-end: two inputs define the same-named response component `R`, each with a header entry `{ $ref: '#/components/headers/H' }`, and define `H`; merge with `dispute.alwaysApply = false`. `R` should deduplicate without throwing. Paths may reference `R`, but the duplicate response component is what forces comparison through `processComponents`.
3. Different referenced Header contents remain different and follow the existing dispute/conflict behavior.
4. A heterogeneous nested comparison can resolve both Header and Schema refs, guarding against a root-component-type-only workaround.
5. Schema refs preserve implicit-title equality behavior, including same bodies under different component names.
6. Two successive comparisons of the same ref pair remain correct when the first comparison is unequal; this guards the active-pair fix.
7. Existing cycle, unresolved local ref, unknown external ref, and known cross-document lookup behavior remains covered. Include equal content with different reference text and identical local ref text resolving to different per-input content.

The issue's prose mentions path definitions, but the stack trace enters through `processComponents`, not the path merge. The response-component fixture above is the focused regression shape; retain or refine it once the reporter's full YAML is available.

## 6. Scope

This is a library correctness fix. It should not require a new merge option or a change to the CLI. The implementation should avoid duplicating pointer parsing or cross-document cycle handling inside `component-equivalence.ts`; the lookup abstraction already owns those concerns.

## 7. Outcome and assessment

The implementation changed `CrossDocumentLookup` and `deepEquality`, then wired the comparison resolver through both component-dedup paths (`paths-and-components.ts` and `external-references.ts`). The resolver returns a target kind for recognized component references, so same-shaped references to different component kinds do not collapse. It also changed reference-pair tracking from a closure-wide permanent record to an active recursion guard. That adjacent fix proved worthwhile: the regression test demonstrates that a failed comparison no longer poisons the next comparison of the same pair, while active cyclic structures still terminate and compare their remaining fields.

Validation on this branch:

- `bun test` in `packages/openapi-merge`: **607 passed, 0 failed** across 23 files.
- `bun run typecheck`: passed.
- `bun run build`: passed.
- `bun x eslint src --format=visualstudio`: passed with no problems.

The implementation matched the chosen option well: the Header repro now deduplicates, different Header contents remain distinct even when their local `$ref` strings match, equal content reached through different Header names can still make their containing response equal, schema title backfill remains intact, and known/unknown cross-document handling stays within the existing lookup boundary. One deliberate limitation remains: references outside a recognized component bucket are only checked to resolve to a non-null, non-array object; their precise OpenAPI kind cannot be inferred from the pointer alone. A future change could add context-specific validation if the library needs to reject those malformed references more strictly.
