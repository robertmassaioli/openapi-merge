# Implementation Proposal: OpenAPI Support, Phase 2 — Merging 3.1

**Status:** 📝 Proposal — implementation follows in this branch
**Type:** Feature
**Scope:** `packages/openapi-merge`, `packages/openapi-merge-cli`
**Date:** 2026-07-26
**Branch:** `feat/openapi-31-support`
**Phase:** 2 of 3 — follows [`26-proposal-oas-phase1-version-checking.md`](26-proposal-oas-phase1-version-checking.md)

---

## 0. TL;DR

Phase 1 made the library refuse 3.1 loudly. Phase 2 makes it **merge** 3.1, by
adding the four structural things 3.1 introduced and then widening
`SUPPORTED_MINOR_VERSIONS` to `['3.0', '3.1']`.

| 3.1 addition | What the merge must do |
| --- | --- |
| `webhooks` | merge like `paths`: dedupe, dispute names, unique `operationId`s, walk `$ref`s |
| `components.pathItems` | dedupe like every other component type |
| `paths` becomes optional | stop assuming it exists — a webhooks-only document is legal |
| `jsonSchemaDialect` | carry it through |

**A correction to an earlier proposal.**
[`24-proposal-openapi-3.2-support.md`](24-proposal-openapi-3.2-support.md) §2.4 called
`@atlassian/atlassian-openapi` a *hard blocker*, on the grounds that it types
`paths` as required and knows no 3.1 constructs. That is true but not blocking:
3.1 can be modelled as a **local type delta** over the existing types, verified
by compiling a webhooks-only document with `paths` omitted:

```ts
type Oas31 = Omit<Swagger.SwaggerV3, 'paths'> & {
  paths?: Swagger.Paths;
  webhooks?: { [key: string]: Swagger.PathItem | Swagger.Reference };
  jsonSchemaDialect?: string;
};
```

This compiles, and a 3.0-shaped document still fits it. So phase 2 does **not**
need a dependency swap, which removes the largest risk and most of the cost from
the estimate in that proposal. Replacing the dependency remains worth doing on
its own merits — it is unmaintained at 1.0.6 — but it is no longer on this
critical path and should not be bundled into a feature change.

## 1. Goals

1. `SUPPORTED_MINOR_VERSIONS` becomes `['3.0', '3.1']`, and that claim is true.
2. `webhooks` survive a merge with the same guarantees `paths` get.
3. `components.pathItems` dedupes like any other component type.
4. A webhooks-only document (no `paths` at all) merges.
5. `jsonSchemaDialect` is carried through.
6. The output declares the **version the inputs actually used**, not a hard-coded
   `3.0.3`.
7. Mixed 3.0 + 3.1 inputs are refused — the `mixed-openapi-versions` rule written
   and tested in phase 1 becomes reachable for the first time.

## 2. Non-goals

- 3.2. That is phase 3.
- Automatic upconversion of 3.0 inputs to 3.1. See
  [`25-proposal-mixed-version-inputs.md`](25-proposal-mixed-version-inputs.md); it is
  unblocked *by* this phase, not part of it.
- Replacing `@atlassian/atlassian-openapi` (see §0).
- Validating output against the published JSON Schema. Worth doing; separate.

## 3. Design

### 3.1 A local 3.1 type delta — `oas31.ts`

One module defines the document shape the merge works with. Everything else
keeps importing `Swagger` for the constructs 3.1 did not change.

Modelling only the delta keeps the change small and honest: we are not claiming
to have re-typed OpenAPI, only to have described what 3.1 added.

### 3.2 Webhooks merge exactly like paths

`webhooks` is a map of name → Path Item, structurally identical to `paths`. The
merge treats it the same way, which means it inherits — rather than
reimplements — dispute handling, `operationId` uniqueness, and reference
rewriting. Two inputs defining the same webhook name is a conflict in the same
sense as a duplicate path, and gets the same error.

This reuse is the main design decision in phase 2: sharing the machinery is what
keeps the diff small and stops webhooks becoming a second-class citizen with
subtly different behaviour.

### 3.3 Output version

`index.ts` currently writes `openapi: '3.0.3'` unconditionally. That cannot
survive 3.1 support. The output now declares the **highest full version among
the inputs**, which is well-defined because phase 1 guarantees they all share a
`major.minor`.

**This changes 3.0 behaviour**: inputs that all declare `3.0.0` now produce
`3.0.0` rather than `3.0.3`. That is more honest, and re-labelling within 3.0.x
is safe in both directions
([`issues/04-proposal-76-openapi-version.md`](issues/04-proposal-76-openapi-version.md) §1),
so no document becomes invalid. It is called out here because it is user-visible
and issue #76 is about exactly this field — #76 should build its configurable
strategy on top of this, not alongside it.

## 4. Test plan

- a webhooks-only 3.1 document merges, and its webhooks survive;
- webhooks from two inputs combine; a name collision errors like a duplicate path;
- `$ref`s inside webhooks are rewritten when the component they point at is renamed
  — the orphaned-`Pet` failure from the 3.2 proposal, inverted into a passing test;
- `operationId`s inside webhooks participate in uniqueness;
- `components.pathItems` dedupes and renames;
- `jsonSchemaDialect` is carried;
- output version is the highest input version, for both 3.0 and 3.1;
- mixed 3.0 + 3.1 gives `mixed-openapi-versions` (reachable at last) and exit 9;
- every existing 3.0 test still passes unchanged.

The end-to-end assertion that matters: **the exact 3.1 document from
`24-proposal-openapi-3.2-support.md` §0 — which used to merge to exit 0 with its
webhooks silently deleted — now merges with its webhooks intact.**

## 5. Natural stopping point

After phase 2 the tool merges 3.0 and 3.1, refuses 3.2 loudly, and refuses mixed
versions. Every construct in a supported version either merges or produces an
error; nothing is silently dropped. That is shippable and a reasonable place to
stop if 3.2 is never funded.

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Widening the `oas` type is a public API change for library consumers | It *widens* (accepts more), so existing callers still compile. Ship with the minor bump. |
| Webhooks reuse the paths machinery but are not paths | Tests assert webhooks and paths do not collide with each other |
| Output version change surprises 3.0 users | §3.3; documented in the README and the changelog note |
| 3.1 schema-dialect semantics (`nullable` etc.) affect deduplication | Out of scope: within a single version there is one dialect, and phase 1 forbids mixing. Recorded in `25-proposal-mixed-version-inputs.md` §7 |
