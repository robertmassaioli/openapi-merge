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

### Option C — Resolve, don't guess: a `Lookup` that's external-ref-aware by construction

`SwaggerLookup.InternalLookup` (from `@atlassian/atlassian-openapi`) is not
missing external-ref support by oversight — its own source comment says so:
*"Any references that don't start with a # are external, and thus not
handled."* It was built assuming whoever calls it already has a single,
fully self-contained document — i.e. that bundling happened upstream, before
anything in this library ever sees a `Lookup`. That assumption is false for
`deepEquality`'s two call sites (`paths-and-components.ts:405-409`,
`external-references.ts:245-248`): both build a **fresh, ordinary
`InternalLookup`** per input, over exactly that input's own document, so
external refs are unreachable from either by design, not by bug.

Rather than teach `compare()` a second, parallel branch for cross-document
refs (an earlier draft of this option), fix it at the source: implement a
second class alongside `InternalLookup` that satisfies the same
`SwaggerLookup.Lookup` interface but *is* external-ref-aware —
`CrossDocumentLookup`, say. `deepEquality`'s own code
(`component-equivalence.ts:89-91`, `xLookup.getSchema(x)`) doesn't change at
all; it just gets handed a smarter `Lookup`.

**Shape**, keeping faith with this library's "no I/O" rule
(`external-references.ts`'s own docstring: *"`openapi-merge` deliberately has
no file-path or network awareness"*) — the class does zero fetching, only
in-memory resolution over documents the caller already loaded:

```ts
class CrossDocumentLookup implements SwaggerLookup.Lookup {
  constructor(
    localDocument: OpenApiDocument,
    // Every other document a cross-document $ref might name, keyed by the
    // exact identity string that appears before the `#` -- i.e. the same
    // map paths-and-components.ts already has in hand: MergeOptions.externalDocuments,
    // plus each sibling input's own document keyed by its sourceIdentity.
    knownDocuments: Record<string, OpenApiDocument>,
  ) { /* ... */ }

  getSchema(s: Swagger.Schema | Swagger.Reference): Swagger.Schema | undefined {
    if (!isReference(s)) return s;
    const split = splitCrossDocumentRef(s.$ref);
    if (split === undefined) {
      return this.local.getSchema(s); // local InternalLookup, unchanged behaviour
    }
    const doc = this.knownDocuments[split.identity];
    if (doc === undefined || split.fragment === undefined) return undefined;
    // Delegate the fragment to a (cached, lazily built) InternalLookup over
    // the target document -- recurses correctly if that document's own
    // component is itself a $ref, local or cross-document.
    return this.lookupFor(split.identity, doc).getSchema({ $ref: split.fragment });
  }
  // ...the same pattern for getExample, getHeaders, getLink, getParam,
  // getRequestBody, getResponse, getCallback, getSecurityScheme(ByName).
}
```

This is the only option that doesn't rely on string identity at all — it
resolves and compares real content, so it's correct even for a caller that
hasn't normalized its refs, closing the residual gap Option A's doc comment
has to name instead of close.

**Where this actually gains over Option A, precisely stated:** `compare()`
inside `deepEquality` is one shared function — both dedup call sites already
go through it, so Option A's string-comparison fix automatically covers both,
same as this would. The real difference is what each fix is *entitled to
assume*. Option A is correct only because something *outside*
`component-equivalence.ts` (the CLI's normalization pass, §1.2) already
guarantees canonical ref strings; that's a fact about one caller, recorded in
a doc comment because the type system can't check it, and silently wrong for
any caller where it doesn't hold. `CrossDocumentLookup` needs no such
assumption — it resolves the actual referenced content itself, so it's
correct for whoever calls `deepEquality`, CLI or not, without asking them to
have already done something specific first. It's also a better fit for this
library's stated design than teaching `compare()` cross-document awareness
directly would have been: the *lookup* is the seam this codebase already
uses to mean "how do I resolve a reference," and `InternalLookup` vs.
`IdLookup` (the other existing implementation, `SwaggerLookup.IdLookup`) are
already interchangeable at both call sites — this is a third implementation
of the same interface, not a new concept, and `compare()` itself stays
exactly as simple as it is today.

Cost: implementing all ten `Lookup` methods (mechanical — each follows the
`getSchema` pattern above), plus assembling `knownDocuments` at each call
site (`paths-and-components.ts` already tracks every input and
`externalDocuments`; `external-references.ts` already has both in scope
too, per its own docstring's description of what it resolves). No plumbing
through `MergeOptions` is needed beyond what already flows to these two
files. Call it a day including tests across both call sites — more than
Option A, comfortably less than reimplementing `createCrossDocumentResolver`'s
rename-aware resolution (which this doesn't need: dedup compares *content*,
so resolving straight into each document's own original component, without
tracking what it was renamed to elsewhere in the output, is sufficient and
notably simpler than what `external-references.ts:137` already does for its
different purpose).

Residual case, smaller than before but not zero: a ref naming a document
truly outside this merge's knowledge (no `sourceIdentity` match, no
`externalDocuments` entry) — PR #87's own literal example. `knownDocuments`
won't have it either, so `getSchema` returns `undefined` there just as
`InternalLookup` does today, and `deepEquality` still needs Option B's
graceful failure underneath it for that case.

### Option D — Configurable strategy (the PR author's own suggestion)

A `MergeOptions` flag choosing string-identity trust vs. erroring vs. real
resolution. Given §2, the default answer (trust the string) is already safe
for the one real caller, so this is now solving a problem that doesn't
concretely exist yet rather than a live safety gap. Keep as a later option if
a non-CLI library consumer actually reports the gap Option C would close.

## 4. Recommendation

Phase 1, to unblock PR #87 specifically: **merge a corrected version of it
(Option A)**, with:
- the doc comment from §3 naming the precondition explicitly, since the
  library can't enforce it, only warn about it;
- Option B's graceful failure underneath it, so a caller that doesn't meet
  the precondition gets a typed `MergeResult` error instead of an uncaught
  exception — belt-and-braces, not a substitute;
- the test file's import path updated to `_helpers/oas-generation`, its only
  mechanical rot.

Phase 2, as a follow-up rather than a blocker: **build Option C**
(`CrossDocumentLookup`). Unlike the version of "resolve properly" this
document first sketched, this one earns Phase 2 rather than "shelf it until
someone asks": it isn't speculative generality for a caller that doesn't
exist, it's a single, focused class that replaces the same
"`InternalLookup`-over-one-document, external refs unreachable" pattern
already duplicated everywhere this library builds a `Lookup` (§3), and it
removes the one thing Option A's doc comment can only warn about rather than
fix: Option A is correct *because* the CLI happens to normalize refs first —
a fact about one caller that a future caller has to know and honour.
`CrossDocumentLookup` needs no such fact; it resolves the actual content, so
it's correct on its own terms, for anyone, with no I/O added to the
library — consistent with the "no file-path or network awareness" rule this
codebase already holds itself to.

Phase 3, only if a concrete need shows up after Phase 2: **Option D.**
Its whole value is as an escape hatch for whatever `CrossDocumentLookup`'s
own residual case (a document truly outside the merge's knowledge) turns out
to matter for in practice — not worth guessing at ahead of that.

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
