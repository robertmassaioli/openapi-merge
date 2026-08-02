# Implementation Proposal: External-Ref Equality in Component Dedup

**Origin:** [PR #87 — "external ref equality"](https://github.com/robertmassaioli/openapi-merge/pull/87), opened 2022-12-23 by @stropho, still open, unmerged.

**Status:** Options and tradeoffs — not yet a design, let alone an implementation. Written to evaluate PR #87 on today's codebase before deciding whether to merge it, adapt it, or supersede it.

**Value:** 3 | **Effort:** 1–4 depending on option chosen (§4)

---

## 0. What this document is

PR #87 proposes a five-line fix for a real crash. Reading it as "merge or
close" undersells the decision: the codebase has grown a large, dedicated
subsystem for cross-document references since this PR was opened
(`external-references.ts`, issues #10/#104, proposals 36–39), and that
subsystem changes what "the right fix" looks like — in the PR's favour, as it
turns out (§2). This document is kept at options-and-tradeoffs altitude, in
the style of
[`37-proposal-10-external-ref-bundling.md`](issues/37-proposal-10-external-ref-bundling.md),
because the PR's own author flagged the real uncertainty themselves: *"in
case anybody considers this change might have some unwanted effect, it could
possibly be hidden behind some configuration option."* That instinct was
worth taking seriously — §2 traces exactly how the codebase already answers it.

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
proposals 36–38) were built to support.

### 1.2 The `library` and the `cli` see this differently — verified, not assumed

`packages/openapi-merge` (the library `deepEquality` lives in) never
normalizes a `$ref` — by design, it "deliberately has no file-path or
network awareness" (`external-references.ts`'s own docstring). Fed the raw
document above directly, it throws exactly as shown.

`packages/openapi-merge-cli` is a different story, and this matters enough
to the rest of this document that it's worth showing the exact source rather
than asserting it. Every CLI merge run passes through
`discoverExternalDocuments` (`external-reference-discovery.ts:167`), which
calls `normalizeCrossDocumentRefs` on **every declared input**
unconditionally — before `merge()` is ever called — rewriting each
cross-document `$ref` in place to `<absolute identity>#<fragment>`. The call
site in `index.ts:420-423` says why in so many words:

> Normalising each input's own refs and resolving anything that names
> *another* declared input runs unconditionally -- that fix is always safe,
> since it only ever affects a `$ref` that would otherwise be silently
> broken.

`resolveExternalReferences` gates something narrower: whether a ref naming a
file *nobody declared as an input* gets followed and loaded into
`externalDocuments`. It does not gate normalization.

Net effect: **by the time `deepEquality` ever sees a cross-document `$ref`
coming from the CLI, that ref is already an absolute, canonical identity** —
`/Users/.../common/errors.yaml#/components/schemas/Foo`, never the author's
original `../common/errors.yaml#/Foo`. The crash in §1 is still real (it's a
library-level bug, reachable directly and, as shown next, still reachable
through the CLI too), but the *content* of the two `$ref` strings
`deepEquality` receives from a real CLI run is not what a first read of the
2022 PR would suggest.

## 2. What PR #87 actually does, and why the risk isn't what it first looks like

```diff
+ const isExternalRef = !x.$ref.startsWith('#')
+ if (isExternalRef && x.$ref === y.$ref) {
+   // as these refs are merged into a single output, they are going to reference the same external file
+   return true
+ }
```

Trusts that identical `$ref` *strings* denote identical *content*, without
resolving anything. The natural worry, and this document's first draft
argued exactly this: proposal 38's `inputRoot` lets every input live in its
own directory, so two inputs could each write a relative ref like
`./errors.yaml#/Foo` — identical strings — while meaning two different
physical files, and the heuristic would silently declare them equal.

**That worry doesn't hold, once §1.2 is accounted for.** Every CLI merge
normalizes cross-document refs to absolute identities *before* `deepEquality`
runs. Two inputs' relative refs that are lexically identical but mean
different files, per input, normalize to two different absolute identities —
so PR #87's string comparison correctly finds them *unequal*. Two refs that
normalize to the *same* absolute identity do so because
`resolveCrossDocumentIdentity` resolved them to the same physical file — so
treating them as equal is correct, not a guess. The heuristic isn't lucky
here; it's sound precisely *because* something else in the codebase already
guarantees its precondition (ref strings name canonical identities) before it
ever runs.

**What's still true:** that guarantee is a property of the CLI, not of the
`deepEquality`/`merge()` library contract. Anyone calling `openapi-merge`
directly with hand-built documents, skipping the CLI's normalization pass,
can still hand it two lexically-identical but semantically-different
external refs and get a wrong "equal." The library's own stance — no
file-path awareness, `externalDocuments` keys must already be caller-supplied
canonical identities — means this was already the contract for cross-document
refs to work *at all* (§3, Option C's residual case is the same gap under a
different name). PR #87 doesn't introduce that gap; it inherits it.

(The PR's test file otherwise still lines up with current code —
`toOAS(paths, components)` at `_helpers/oas-generation.ts` has the identical
signature the PR's test calls; only the import path moved. Its fixture
(`/external/file.yaml#/...`, both sides using the same literal string) models
exactly the CLI's post-normalization shape, not a raw un-normalized ref —
worth noting since it means the PR's own test was implicitly right about
which case matters, even without the author having traced why.)

## 3. Options

### Option A — Merge PR #87's heuristic, library-side, documented as caller's-responsibility

Trust identical `$ref` strings. Given §2, this is materially safer than it
first appeared: it's exactly correct for the CLI's actual pipeline today, and
for any future caller that normalizes cross-document refs before merging
(which, per the library's own design, is already the precondition for
cross-document resolution to work at all). The one thing worth adding beyond
the PR's own diff: a doc comment on `deepEquality`/`compare` stating the
precondition explicitly — *"a cross-document `$ref` is compared by string
identity; callers that don't canonicalize such refs before merging may get a
false positive here"* — so a future non-CLI caller doesn't have to
rediscover §2 the hard way. Effort: the PR's five lines, plus that comment
and updating the test's import path.

### Option B — Fail closed: replace the crash with a typed `MergeResult` error

Not needed as a substitute for Option A anymore (§2 removes the reason to
distrust it), but still worth doing *underneath* whichever option ships, for
the residual case Option A's own doc comment names: a caller who hasn't
normalized refs, or a ref shaped in a way `deepEquality` can't parse at all.
Catch that case in `deepEquality`'s call sites and surface a
`component-definition-conflict`-shaped `ErrorMergeResult` — the channel
every other dedup conflict in this codebase already uses — instead of an
uncaught `Error`. Small, contained, and consistent with how every other
conflict path in `paths-and-components.ts` already behaves.

### Option C — Resolve, don't guess: extend dedup to reuse the existing cross-document resolver

Give `deepEquality` a path parallel to its existing local-reference branch
(`component-equivalence.ts:84-91`) for cross-document refs: use
`splitCrossDocumentRef` to pull `{identity, fragment}` out of the `$ref`,
resolve `identity` against `MergeOptions.externalDocuments` or a sibling
input's `sourceIdentity`, fetch the *actual* target schema, and deep-compare
that — exactly as local refs already do via `xLookup.getSchema`.

This is the only option that doesn't rely on string identity at all, so it's
correct even for a caller that hasn't normalized its refs. But given §2, that
buys correctness for a caller this repo doesn't have (the CLI already
guarantees the precondition Option A needs) — it stops being "the fix that
avoids a data-loss bug" and becomes "the fix that generalizes to callers this
proposal can't identify a concrete need for yet." Worth keeping on the shelf,
not worth building ahead of a real request: real effort (deepEquality's
`Lookup` type would need `externalDocuments`/sibling-input context threaded
in, plumbing through `paths-and-components.ts:433`; `resolveIdentityFragment`
is currently private to `external-references.ts` and would need exporting)
for a correctness gain with no known caller today.

### Option D — Configurable strategy (the PR author's own suggestion)

A `MergeOptions` flag choosing string-identity trust vs. erroring vs. real
resolution. Given §2, the default answer (trust the string) is already safe
for the one real caller, so this is now solving a problem that doesn't
concretely exist yet rather than a live safety gap. Keep as a later option if
a non-CLI library consumer actually reports the gap Option C would close.

## 4. Recommendation

**Merge a corrected version of PR #87 (Option A)**, with:
- the doc comment from §3 naming the precondition explicitly, since the
  library can't enforce it, only warn about it;
- Option B's graceful failure underneath it, so a caller that doesn't meet
  the precondition gets a typed `MergeResult` error instead of an uncaught
  exception — belt-and-braces, not a substitute;
- the test file's import path updated to `_helpers/oas-generation`, its only
  mechanical rot.

Not recommended right now: Option C or D. Both solve a real gap in the
library's contract (unnormalized cross-document refs), but it's a gap that
predates this PR, is shared by every other cross-document feature in this
codebase, and has no reported caller hitting it — building either ahead of
that would be speculative generality this repo's own conventions argue
against (see `41`'s "don't broaden scope" note, and `23`'s non-goals). Revisit
if a non-CLI consumer of `openapi-merge` reports it.

## 5. What this means for PR #87 itself

Closer to mergeable than a first read suggests, once §1.2 is verified rather
than assumed — which is the whole reason this went through a proposal
instead of a straight review comment. The PR needs: the doc-comment
precondition from §4, the import-path fix, and ideally Option B landing
alongside it so the residual case fails safely instead of crashing. None of
that is a rewrite of the contributor's approach — it's the same fix, made
explicit about why it's safe.

### 5.1 Correction to this document's own first draft

This section exists because §2's conclusion reverses this document's
original recommendation, and the house convention (see proposal 23 §10.3) is
to record that rather than edit it away quietly. The first draft asserted
Option A was unsafe under `inputRoot`, reasoning from proposal 38's existence
without reading `external-reference-discovery.ts`'s normalization pass or the
comment at `index.ts:420-423` stating it runs unconditionally. Reading that
code directly reversed the conclusion. The lesson generalizes past this one
proposal: a `$ref`'s *literal text* and what it *resolves to* are two
different questions in this codebase, and any claim about which one a given
code path is looking at needs to be checked against the code, not inferred
from a feature's name.
