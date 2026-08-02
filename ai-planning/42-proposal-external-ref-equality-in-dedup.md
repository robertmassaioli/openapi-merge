# Implementation Proposal: External-Ref Equality in Component Dedup

**Origin:** [PR #87 — "external ref equality"](https://github.com/robertmassaioli/openapi-merge/pull/87), opened 2022-12-23 by @stropho, still open, unmerged.

**Status:** Options and tradeoffs — not yet a design, let alone an implementation. Written to evaluate PR #87 on today's codebase before deciding whether to merge it, adapt it, or supersede it.

**Value:** 3 | **Effort:** 2–4 depending on option chosen (§4)

---

## 0. What this document is

PR #87 proposes a five-line fix for a real crash. Reading it as "merge or
close" undersells the decision: the codebase has grown a large, dedicated
subsystem for cross-document references since this PR was opened
(`external-references.ts`, issues #10/#104, proposals 36/37), and that
subsystem changes what "the right fix" looks like. This document is deliberately
kept at options-and-tradeoffs altitude, in the style of
[`37-proposal-10-external-ref-bundling.md`](issues/37-proposal-10-external-ref-bundling.md),
because the PR's own author flagged the real uncertainty themselves: *"in
case anybody considers this change might have some unwanted effect, it could
possibly be hidden behind some configuration option."* That instinct was
right, and it's worth taking seriously rather than merging the five lines as-is.

## 1. The bug, confirmed still present today

Reproduced empirically against current `main` (not assumed from the 2022
diff): `deepEquality` throws `Error: Could not resolve reference: <ref>`
when it's asked to compare two objects that both contain an *external*
`$ref` (one not starting with `#`).

```ts
const compare = deepEquality(lookup1, lookup2);
compare(
  { type: 'object', properties: { p: { $ref: '/external/file.yaml#/components/schemas/Ref' } } },
  { type: 'object', properties: { p: { $ref: '/external/file.yaml#/components/schemas/Ref' } } },
);
// throws: Could not resolve reference: /external/file.yaml#/components/schemas/Ref
```

### 1.1 Why: two facts, traced through the current source

1. `deepEquality` (`component-equivalence.ts:89-91`) resolves a `Reference`
   via `xLookup.getSchema(x)` — a plain `SwaggerLookup.InternalLookup` from
   `@atlassian/atlassian-openapi`. That library's `performLookup` explicitly
   returns `undefined` for any ref not starting with `#` (comment in its own
   source: *"Any references that don't start with a # are external, and thus
   not handled"*). `isSchemaOrThrowError` then throws.
2. `deepEquality` is only invoked, via `processComponents`
   (`paths-and-components.ts:70,80`), when **two different inputs declare a
   component under the same name** (`results[modifiedKey] !== undefined`).
   That's the realistic trigger: two OpenAPI documents from the same team,
   each independently `$ref`-ing a shared external file (e.g.
   `../common/errors.yaml#/ErrorResponse`) from within a same-named wrapper
   schema.

So this isn't a synthetic edge case — it's the ordinary shape of a
multi-document merge where teams share a components file by reference rather
than by copy-paste, which is exactly the workflow issues #10 and #104 (and
proposals 36–38) were built to support. The crash sits in the one dedup path
that subsystem doesn't touch.

### 1.2 Why the newer cross-document machinery doesn't already cover this

`external-references.ts` (built for #10/#104) resolves `<identity>#<fragment>`
refs — the same shape as this bug's refs — but only where they're
encountered while **walking the merged output's own reference graph**
(`walkComponentReferences`, wired into `createCrossDocumentResolver`). The
dedup comparison in `processComponents` runs earlier, directly over each
input's **raw, unmodified `components`** before any rewriting pass reaches
them. `deepEquality`'s two `Lookup`s are throwaway `InternalLookup`s built
fresh from the current document; they were never wired to
`MergeOptions.externalDocuments` or to sibling inputs' `sourceIdentity`, so
they have no way to resolve a cross-document ref even in principle. The two
subsystems don't overlap today — which is exactly why the crash predates
proposals 36–38 and survived them untouched.

## 2. What PR #87 actually does, and its correctness gap

```diff
+ const isExternalRef = !x.$ref.startsWith('#')
+ if (isExternalRef && x.$ref === y.$ref) {
+   // as these refs are merged into a single output, they are going to reference the same external file
+   return true
+ }
```

Trusts that identical `$ref` *strings* denote identical *content*, without
resolving anything. Cheap, and correct under one condition: that a given ref
string always names the same physical resource, everywhere it appears.

**That condition held in 2022 and no longer holds unconditionally.**
Proposal 38 (`inputRoot`, on by default since proposal 39) gives every input
its own base directory. Two inputs can each contain a schema `$ref`-ing a
relative path like `./errors.yaml#/Foo` — identical strings — while
`inputRoot` means they resolve to two *different physical files*, one per
input's own directory. PR #87's fix would silently declare those equal and
drop one copy. That's a **silent data-loss bug** dressed as a fix for a
crash, and it would be strictly worse than the crash it replaces: a crash is
loud, a wrong merge is not.

The comment in the PR's own diff — *"these refs are merged into a single
output, they are going to reference the same external file"* — was a fair
assumption for the merge core as it existed in December 2022, before
`inputRoot` existed. It is not a safe assumption today. This isn't a reason
to dismiss the PR; it's the reason this needs a proposal rather than a
one-line merge.

(The PR's test file otherwise still lines up with current code —
`toOAS(paths, components)` at `_helpers/oas-generation.ts` has the identical
signature the PR's test calls; only the import path moved.)

## 3. Options

### Option A — Merge PR #87's heuristic as-is

Trust identical `$ref` strings. Trivial (already written). Reintroduces the
silent-wrong-merge risk in §2 for any `inputRoot`-using multi-directory
setup — which is the *default* CLI configuration as of proposal 39. Not
recommended without at least a guard limiting it to refs whose identity is
known to be shared (e.g. matches a `sourceIdentity` or an `externalDocuments`
key, rather than an arbitrary unqualified path) — at which point it has
mostly become Option C.

### Option B — Fail closed: replace the crash with a typed `MergeResult` error

Catch the unresolvable-external-ref case in `deepEquality`'s call sites (or
have `compare` signal it rather than throw) and surface a
`component-definition-conflict`-shaped `ErrorMergeResult`, the same channel
every other dedup conflict in this codebase already uses. Small, contained,
and never wrong — it doesn't claim an equality it can't prove, it just stops
being an *uncaught* exception, which is inconsistent with how every other
conflict path in `paths-and-components.ts` behaves. Doesn't reduce false
conflicts: a merge that's actually safe (two inputs really do share one
external file) still fails and needs a manual rename/dispute workaround. Pure
downside-removal, not a feature — but it's a prerequisite piece of either
option below, since both still need a fallback for refs they can't resolve.

### Option C — Resolve, don't guess: extend dedup to reuse the existing cross-document resolver

Give `deepEquality` a path parallel to its existing local-reference branch
(`component-equivalence.ts:84-91`) for cross-document refs: use
`splitCrossDocumentRef` to pull `{identity, fragment}` out of the `$ref`,
resolve `identity` against `MergeOptions.externalDocuments` or a sibling
input's `sourceIdentity` (the same resolution `createCrossDocumentResolver`
already performs, currently private to `external-references.ts` and would
need a shared/exported entry point), fetch the *actual* target schema, and
deep-compare that — exactly as local refs already do via `xLookup.getSchema`.

This is the only option that's unconditionally correct: it doesn't assume
ref-string identity means content identity, so it isn't fooled by
`inputRoot`'s per-input directories. It's also the option most consistent
with the rest of the codebase, which already solved this exact
identity-resolution problem once for issue #10/#104 — this is applying that
solution to the one path it doesn't yet reach, not building something new.

Cost: `deepEquality` currently takes two bare `Lookup`s; it would need
either the `externalDocuments` map and sibling-input context threaded in, or
a pre-built resolver function passed alongside the lookups. Some plumbing
through `paths-and-components.ts:433` where `deepEquality` is constructed.
Genuinely more work than Options A or B — call it half a day including
tests, not five lines.

Residual case: a ref to a document the merge never received at all (no
`sourceIdentity` match, no `externalDocuments` entry) — PR #87's own literal
example — still can't be resolved. That case needs Option B's graceful
failure regardless of whether C is built.

### Option D — Configurable strategy (the PR author's own suggestion)

Add a `MergeOptions` flag — e.g.
`unresolvableExternalRefsStrategy: 'assume-equal-by-ref' | 'error'` (default
`'error'`) — so a caller who knows their own pipeline guarantees ref-path
stability (single shared root, no divergent `inputRoot`s) can opt into
Option A's cheaper heuristic explicitly, while the default stays safe. Real
work here is mostly wiring: a new field through `MergeOptions`, the ajv
config schema (`configuration.schema.json`), `init`'s generated YAML
(proposal 34), and documentation — the standard cost this codebase pays for
every new option (see proposal 39's own footprint). Worth doing only if
Option C's residual case (§3, "Option C", last paragraph) turns out to
matter to real users after C ships — an escape hatch for what C structurally
can't resolve, not a replacement for it.

## 4. Recommendation

Phase 1: **Option B.** Removes the uncaught exception — the most acute part
of PR #87's report — with no correctness risk, and is a prerequisite either
way. Small enough to be its own PR.

Phase 2: **Option C**, scoped to refs resolvable via `externalDocuments` or a
sibling input's `sourceIdentity` — which is the actual shape of PR #87's
motivating case (a component shared across documents that *are* part of the
same merge or declared as `externalDocuments`). This closes the bug
correctly rather than heuristically, reusing infrastructure this repo
already built and already trusts for the same class of problem elsewhere.

Phase 3, only if requested after Phase 2 ships: **Option D**, as a narrow
escape hatch for refs to documents genuinely outside the merge's knowledge —
not before, since it's easy to reach for prematurely and its entire value
depends on Phase 2 first proving where the real gap is.

Not recommended: **Option A** as originally submitted. It fixes the crash
but trades it for a silent-data-loss failure mode under the CLI's own
default configuration (`inputRoot`, on since proposal 39) — worse than what
it replaces, not better.

## 5. What this means for PR #87 itself

Not mergeable as-is (§2, §4). The right response to the contributor, if
Robert wants to send one, is to credit the report (the crash is real and
reproducible three years later) while explaining the `inputRoot` interaction
that makes the literal patch unsafe today — the same courtesy this repo's
`ai-planning/41` extended to PR #97 when closing it as superseded rather
than silently.
