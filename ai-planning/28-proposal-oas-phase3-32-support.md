# Implementation Proposal: OpenAPI Support, Phase 3 — Merging 3.2

**Status:** 📝 Proposal — implementation follows in this branch
**Type:** Feature
**Scope:** `packages/openapi-merge`, `packages/openapi-merge-cli`
**Date:** 2026-07-26
**Branch:** `feat/openapi-32-support`
**Phase:** 3 of 3 — follows [`27-proposal-oas-phase2-31-support.md`](27-proposal-oas-phase2-31-support.md)

---

## 0. TL;DR

3.1 → 3.2 introduced **no breaking changes**; everything it added is additive.
That makes phase 3 much smaller than phase 2, and most of 3.2 already passes
through the merge untouched because it lives *inside* objects the merger copies
wholesale.

Only a handful of additions actually interact with merge logic:

| 3.2 addition | Why the merge must care |
| --- | --- |
| `query` method on Path Items | a **ninth** HTTP method — invisible to four hard-coded eight-method lists |
| `additionalOperations` | arbitrary custom verbs, same problem |
| `$self` | document identity — merging two is not obviously meaningful (§4) |
| tag `summary` / `parent` / `kind` | tags merge by name; new fields must survive |

Everything else — `itemSchema`, OAuth2 device flow, `oauth2MetadataUrl`,
discriminator `defaultMapping`, `dataValue` / `serializedValue`, server `name`,
`in: querystring` — sits inside operations, schemas, security schemes or
examples that the merger copies as opaque values. Phase 3 asserts that
pass-through rather than assuming it.

**The most important fix is `query` and `additionalOperations`,** because of how
the eight-method assumption fails. `countOperationsInPathItem` scores a path
item by counting the eight classic methods, and `dropPathItemsWithNoOperations`
**deletes any path item scoring zero**. A 3.2 path whose only operations are
`query` and `additionalOperations` therefore scores 0 and the entire endpoint is
silently deleted — measured in
[`24-proposal-openapi-3.2-support.md`](24-proposal-openapi-3.2-support.md) §0.

## 1. Goals

1. `SUPPORTED_MINOR_VERSIONS` becomes `['3.0', '3.1', '3.2']`, truthfully.
2. `query` and `additionalOperations` are first-class everywhere a method is
   considered: operation counting, `operationId` uniqueness, `$ref` walking, and
   tag-based operation selection.
3. `$self` has a defined, documented merge behaviour.
4. Tag `summary` / `parent` / `kind` survive a merge.
5. The additive 3.2 fields that need no logic are covered by tests proving they
   pass through.

## 2. Non-goals

- Automatic upconversion between versions
  ([`25-proposal-mixed-version-inputs.md`](25-proposal-mixed-version-inputs.md)).
- Validating output against the published 3.2 JSON Schema. Still worth doing;
  still separate.
- Replacing `@atlassian/atlassian-openapi`. Phase 2 showed the local type delta
  works; 3.2 extends the same delta.
- Interpreting `x-tagGroups` in terms of the new native tag `parent`/`kind`.
  That is issue #60's territory.

## 3. Design

### 3.1 One list of methods, not four

The eight-method assumption is currently duplicated in four places:

| File | Function |
| --- | --- |
| `paths-and-components.ts` | `countOperationsInPathItem` |
| `paths-and-components.ts` | `ensureUniqueOperationIds` |
| `reference-walker.ts` | `walkPathItemReferences` |
| `operation-selection.ts` | `allMethods` |

Four copies is why the `/search` deletion bug was possible at all: adding a
method means remembering four places, and forgetting one fails silently.

Phase 3 replaces all four with a single shared helper that yields every
operation in a Path Item — the nine standard methods plus every entry in
`additionalOperations`. Each call site then iterates that instead of naming
methods. Adding a tenth method in some future OpenAPI version becomes a one-line
change with no silent-failure mode.

This is the main structural decision in phase 3, and it is worth more than 3.2
support on its own.

### 3.2 `$self`

`$self` declares a document's own identity URI. Two inputs with different
`$self` values are two documents with two identities, and the merged output is a
third document that is neither.

Options: take the first (like `info`), drop it, or error. **Taking the first
would be wrong** — it would assert an identity the merged document does not
have, and `$self` participates in reference resolution, so a stale value can
change how relative `$ref`s resolve.

**Decision: drop `$self` from the output**, and do so silently only when there
is nothing to lose. Concretely: if exactly one input declares `$self` and it is
the only input, keep it; otherwise omit it. A merged document should not claim
to be one of its inputs.

### 3.3 Tags

`tags.ts` merges by `name` and copies the whole tag object, so `summary`,
`parent` and `kind` should already survive. Phase 3 asserts this rather than
assuming it, and checks that two inputs declaring the same tag name with
different `parent` values do not silently lose one.

## 4. Test plan

- a path item whose only operation is `query` **survives** — the regression test
  for the deleted `/search` endpoint;
- a path item whose only operations are in `additionalOperations` survives;
- `operationId`s inside `query` and `additionalOperations` participate in
  uniqueness;
- `$ref`s inside `query` and `additionalOperations` operations are rewritten;
- `excludeTags` / `includeTags` apply to `query` and `additionalOperations`;
- `$self` is dropped when merging more than one input, kept for a single input;
- tag `summary` / `parent` / `kind` survive;
- pass-through assertions for `itemSchema`, discriminator `defaultMapping`,
  OAuth2 device flow, and `in: querystring`;
- mixed 3.1 + 3.2 is refused with `mixed-openapi-versions`;
- every existing 3.0 and 3.1 test still passes.

## 5. Natural stopping point

After phase 3 the library merges every published OpenAPI 3.x version, refuses
mixed versions, and refuses anything it does not know. The four-way duplication
that made silent method-related loss possible is gone.

That completes the three-phase sequence. The obvious follow-ups —
validating output against the published JSON Schema, and auto-upconversion —
are both already written up and both now unblocked.

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Refactoring four call sites at once | 264 existing tests, all of which exercise these paths; the refactor is behaviour-preserving for 3.0/3.1 by construction |
| `additionalOperations` keys are arbitrary | Treated as opaque strings; only their Operation values are interpreted |
| Dropping `$self` surprises someone | Documented in the README and asserted by a test; §3.2 explains why keeping it would be worse |
| `query` colliding with a `querystring` parameter location | Unrelated namespaces; a test covers both appearing together |
