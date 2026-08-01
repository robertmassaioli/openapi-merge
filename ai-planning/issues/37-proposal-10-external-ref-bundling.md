# Implementation Proposal: Issue #10 — Resolve and/or Bundle External References

**Issue:** [#10 — Resolve and/or bundle external references](https://github.com/robertmassaioli/openapi-merge/issues/10)

**Status:** ✅ Implemented — Option 2-refined (§2), chosen and built together
with [36](36-proposal-104-external-ref-rewriting.md) (issue #104) in one
change, at Robert's explicit direction, on branch
`feature/external-ref-resolution`. This document was written to stay at
options-and-tradeoffs altitude (§0) precisely because "should we become a
bundler at all" hadn't been decided yet; §9 records what was actually built
once it was.

**Value:** 5 | **Effort:** 5 *(unchanged from the triage doc — this is
genuinely the "Big Bet" it was filed as; §4 shows why #104 is a materially
smaller, separable problem, not a stepping stone that shrinks this one)*

---

## 0. What kind of document this is

Issue #104's proposal (36) ends with a concrete design because the fix is
small and bounded: extend machinery that already exists. This one is
deliberately kept at the level of **options and tradeoffs**. The reason:
the real first decision here isn't "how do we resolve external refs", it's
"should `openapi-merge` become a bundler at all" — and that decision has
a stated, three-year-old answer from Robert (§2) that a design spec would
just be presuming past. This document lays out the design space, checks
Robert's stated preference against how the codebase has changed since 2021,
and flags what a spike would need to prove — not a plan to execute.

## 1. Issue summary

> Many people define references in OpenAPI files such that those references
> are not internal to the OpenAPI file. As a result, they expect that when
> they use the `openapi-merge` library or CLI tool, that it will merge
> everything together for them.

Unlike #104, this is not scoped to refs pointing at files that happen to
already be declared merge inputs — it's the general case: a `$ref` to
*any* file (or URL) on disk, whether or not the user ever told this tool
about it.

## 2. What Robert already said, in 2021

The issue body isn't just a report — it's a design note with a stated
preference and an explicit rejection of the naive alternative. Worth
quoting rather than paraphrasing, since the exact reasoning matters:

> We could solve this problem in one of two ways:
> 1. Pre-bundle all of the references into each individual OpenAPI file and
>    then rely upon de-duplication to end up with a minimal OpenAPI file.
> 2. Support external references such that the merging algorithm can load
>    them all itself and then bundle only the components that are required.
>
> At this point in time. I think that I have a preference for Option 1
> because it means that we can offload this problem to another tool and
> then just ask people to integrate that together instead to form a
> cohesive whole. [...] We can also then just make the CLI tool integrate
> that by default so that the CLI tool works like people expect.
>
> It is also worth noting that the `merge` function currently expects all
> of the OpenAPI files to be pre-downloaded, that allows that function to
> be synchronous [...]. Attempting to load the schemas while we [merged]
> would be an architectural mistake, because it would be a poor separation
> of concerns. Instead the `merge` function could be modified to have a
> pre-downloaded mapping of `Reference => Schema` that it can use in a
> synchronous manner.

That's genuinely **three** distinct architectures, not two — the third is
buried in the "it's also worth noting" paragraph, describing how Option 2
would have to be built *if* it were ever chosen, not a restatement of
Option 1:

- **Option 1** (Robert's stated preference): run an existing, off-the-shelf
  bundler over *each input independently*, before it ever reaches
  `openapi-merge`. Each input becomes self-contained (no external refs);
  the library's existing cross-input deduplication does the rest.
  **Zero changes to the `openapi-merge` library.**
- **Option 2, as rejected**: `merge()` itself does file/network I/O to chase
  external refs while merging. Ruled out explicitly — breaks the
  synchronous, separation-of-concerns design the library has always had.
- **Option 2, refined** (Robert's own alternative if native support is ever
  wanted): keep `merge()` synchronous, but have the *caller* (the CLI) do
  all the async loading up front, producing a `Reference => Schema` map
  that `merge()` consults while it does its own path/component copying.
  Unlike Option 1, this keeps `openapi-merge` itself in the business of
  understanding what an external reference is and how to fold it in.

**Proposal 36 (#104) is a fourth point in this space** — a much narrower
special case of "Option 2, refined": the CLI still pre-resolves
synchronously and hands the library an identity map, but *only* for refs
matching files the user already declared as inputs. It never discovers or
loads a new file on the strength of a `$ref` alone. That's precisely why
36 is small enough to spec concretely and this one isn't.

## 3. Does #104 (Option "4") make this smaller? — Mostly, in one direction

Tempting conclusion: since 36 already builds the identity-matching and
cross-input rename-resolution machinery, doesn't "real" bundling reduce to
just widening it to *undeclared* files too? Traced through:

**For Option 1 (bundle per input, no library changes), no — it's an
entirely separate mechanism.** Bundling doesn't touch `openapi-merge` at
all; it runs before an input is even handed to `convertInputs`. 36's
identity/rename machinery is irrelevant to it. Building 36 first buys
nothing here except a smaller, already-solved special case of the same
user complaint, and possibly a faster ship for the common declared-input
pattern while a full bundler is still being evaluated.

**For Option 2-refined (native support inside `openapi-merge`), yes —
36 is a genuine down-payment.** The identity map, the deferred two-pass
rewrite (needed regardless of whether identities come from declared inputs
or discovered files, since forward/backward references are the same
problem either way), and the per-target rename-resolution logic would all
be reused; "widening" would mean: the CLI's identity set is no longer
fixed to `configInputs` up front, but grows as new external refs are
discovered, requiring a fixed-point loop (keep resolving until no new
external files are found) rather than 36's single pass over a known list.

So the honest answer depends entirely on which of the two live options (1
or 2-refined) gets chosen — which is precisely why this proposal doesn't
pick one yet.

## 4. Does Option 1 (bundle-then-dedup) actually fix #104's case?

Traced through the exact #104 repro (36 §2): bundling `Api.yml` would
inline the referenced `ServerError` schema directly into `Api.yml`'s own
`components.schemas.ServerError`, rewriting its `$ref` to a local one. When
`merge()` then processes the separately-declared `ServerError.yml` input,
`processComponents`' deduplication (`component-equivalence.ts`) compares
the two `ServerError` definitions and — **if `deepEquality` finds them
equivalent** — collapses them into one, leaving `Api.yml`'s now-local ref
correctly pointing at the survivor.

**Correctness holds; minimality does not, automatically.** Read
`deepEquality` rather than assumed: it's more forgiving than a naive
`_.isEqual` on the raw JSON — it resolves `$ref`s on *both* sides via each
document's own `SwaggerLookup` and compares the resolved structures
recursively, with cycle protection (`ReferenceRecord`), so bundling
artefact differences that only affect *how* something is referenced (not
its resolved shape) wash out. But it is still exact structural equality of
the resolved content, key-for-key (`arraysEquivalent(Object.keys(x),
Object.keys(y))` then a per-key recursive compare). It will **not** treat
two schemas as equivalent if the bundler's inlined copy differs from the
separately-declared input's version in any way that survives resolution —
an added `example`, a stripped `description`, different key ordering
doesn't matter but different *content* does — or if `Api.yml` already
declares its own clashing `ServerError` (forcing the bundler to invent a
disambiguated name before `openapi-merge` ever sees it), or if the input
carries `dispute.alwaysApply`.

In all of those cases the result is **correct but duplicated**: two
`ServerError`-shaped schemas under two names, both consistently referenced,
neither dangling. Strictly better than today's broken output, but not the
"minimal" result Robert's note assumes as automatic. Worth stating plainly
rather than promising a clean collapse every time.

## 5. What Option 1 actually costs, and what it would open up

Kept at the tradeoff level deliberately (§0) — these aren't blockers, they're
what a "yes, do this" decision needs to account for:

- **A new dependency, and a shift in what this tool is.** Today
  `openapi-merge-cli` reads exactly the files a config names. Option 1 means
  it also reads whatever those files' own `$ref`s point at, transitively —
  materially more surface, and a real (if small) supply-chain and
  maintenance commitment to whichever bundling library is chosen.
- **Failure behaviour changes.** Today a `$ref` to a missing/unreachable
  external file produces a broken-but-written output (the bug this and #104
  are both about). Bundling turns that into a **hard failure before any
  output is written** — arguably more correct, but a behaviour change worth
  naming, not just inheriting silently.
- **The input side gains the same class of risk the output side already
  took seriously.** Issue #93 restricted `outputRoot` with a realpath-based
  containment check (`path-resolution.ts`) specifically to stop a symlink
  or crafted relative path from writing outside an intended directory.
  Following `$ref`s out of untrusted input files is the mirror image on the
  *read* side — nothing today stops a config's inputs from reading anything
  the process can see, and bundling would make that reach transitive and
  automatic rather than confined to what's explicitly listed in `inputs`.
  Any real implementation needs a comparable containment story (an
  `inputRoot`-style restriction, or at minimum, explicit documentation of
  the trust boundary) before shipping this as an on-by-default behaviour
  the way Robert's note suggests ("make the CLI tool integrate that by
  default").

## 6. Library comparison for Option 1 (evidence, not a spec)

Two credible off-the-shelf bundlers, checked rather than assumed from
memory, since library capabilities drift:

- **`@redocly/openapi-core`** — exposes `bundle` / `bundleFromString`:
  resolves external `$ref`s, keeps internal ones. Redocly's own CLI
  (built on this package) advertises full OpenAPI 3.2, 3.1, 3.0 and Swagger
  2.0 support, current as of their 3.2 coverage post. That matters
  specifically for this repo, which has already invested three proposals
  (26/27/28) in clean 3.1/3.2 merge support — a bundler with a 3.1 gap would
  quietly undermine that work for exactly the inputs that use it.
- **`@apidevtools/swagger-parser`** — exposes `.bundle()` (external refs
  resolved and inlined, internal refs preserved) versus `.dereference()`
  (everything inlined, no refs survive — the wrong one for this use case,
  since `openapi-merge`'s own dedup depends on refs surviving). Very
  widely used (~2.4M weekly downloads, actively maintained per its own
  npm listing), but multiple community reports describe OpenAPI 3.1
  parsing gaps for this specific package. **Some of what surfaced in
  research was the separate, Java-based `swagger-api/swagger-parser`
  project, which is not this package** — the JS-specific claim needs a
  hands-on spike against a real 3.1 document before it's trusted either
  way, not another search.

Neither comparison is a recommendation to build against yet. It's evidence
that **the library choice is not a rubber stamp** — it needs to be spiked
against this repo's own 3.0/3.1/3.2 test fixtures before Option 1 is
committed to, given how much of this codebase's recent history is about
getting exactly that version support right.

## 7. Not resolved here *(at the time this was written — see §9 for what was decided)*

- Whether Option 1 or Option 2-refined is the right long-term shape. Robert's
  2021 preference is strong input, not a settled answer — it predates 3.1/3.2
  support, webhooks, and the current dedup/dispute machinery, all of which
  change the cost side of the comparison in §3.
- Whether Option 1 should be on-by-default (per the issue's suggestion) or
  opt-in behind a new `Configuration` flag. Given §5's failure-mode and
  trust-boundary changes, opt-in seems the safer starting point regardless
  of which option is chosen, but that's a decision for whoever picks up
  implementation, not this document.
- A containment/allow-list design for the input-side trust boundary (§5) —
  flagged as necessary, not designed.
- Naming/collision strategy for auto-discovered components under either
  option — sketched in passing (§4), not specified.

## 8. Relationship to #104

[36](36-proposal-104-external-ref-rewriting.md) is not superseded by this
document and shouldn't wait on it. It solves a real, narrower slice of this
same complaint — refs to files that are already declared inputs — with no
new dependency, no new failure mode, no new trust-boundary question, and a
concrete design ready to build. Whichever way #10 eventually goes, 36
remains correct and useful; at most, a future Option 1 or Option 2-refined
implementation might make 36's specific mechanism *redundant* (§3) rather
than wrong. Recommend treating them as independent: ship 36 on its own
merits, revisit this document separately when there's appetite for the
larger "should we become a bundler" decision.

They also don't conflict if both eventually ship, in either order. If
Option 1 (bundling) lands after 36: a bundler runs before `merge()` ever
sees an input, so by the time 36's cross-input pass walks the merged
result, every ref it would have rewritten is already local — its pass
simply finds nothing left to do. Inert, not wrong.

*(§8 was written when "eventually" was still an open question. §9 records
what happened when Robert decided not to wait.)*

## 9. What was actually decided and built

Robert's call, made directly after reading both this document and 36:
**build Option 2-refined, and build it so it also handles #104's narrower
case in the same mechanism, in one change.** Not Option 1 — no bundling
library dependency was added; `openapi-merge` still does no file I/O of its
own. The two open questions §7 left for "whoever picks up implementation"
were resolved as follows.

### 9.1 Option 1 vs Option 2-refined — Option 2-refined, and it worked cleanly

The library gained exactly what Robert's 2021 note sketched: `merge()`
stays fully synchronous, and `MergeOptions` gains `externalDocuments:
Record<identity, OpenApiDocument>` — a pre-loaded mapping the caller builds
with all its async I/O already done. Internally this is closer to
"`Reference => Schema`, resolved lazily and recursively" than a flat
pre-resolved map: `merge()` still has to walk into a pulled-in component's
*own* references (possibly into a third document, possibly back into a
declared input) itself, because only `merge()` knows where a declared
input's components ultimately land after deduplication. §3's prediction
held: the identity map, the deferred two-pass rewrite, and the per-target
rename-resolution logic that 36 needed for its narrower case were reused
without modification for the general case — one resolver
(`createCrossDocumentResolver` in `external-references.ts`), not two
coordinating mechanisms.

### 9.2 On-by-default vs opt-in — split, deliberately

Not one answer, but two, matching the always-on / opt-in split 36 itself
argued for at the mechanism level:

- Resolving a `$ref` into an **already-declared input** (#104's case): always
  on, no flag. Unconditionally safe, per 36 §6.1's reasoning — it only ever
  fires on a `$ref` that is already broken today.
- **Discovering** a `$ref` into a file or URL nobody declared as an input
  (#10's actual ask): gated behind a new opt-in `Configuration` field,
  `resolveExternalReferences` (default `false`). This is the one that
  changes the CLI's read surface and failure semantics (§5), so it stays a
  deliberate choice rather than a silent default -- even though the issue's
  own text suggested making it automatic.

### 9.3 The containment/allow-list gap — still open, flagged rather than fixed

**Not built.** §5 named this as a real concern and §7 explicitly deferred
designing it; nothing in this implementation closes that gap. With
`resolveExternalReferences: true`, a `$ref`'s relative path is resolved and
read with no restriction on how far outside the input's own directory it
may point -- the same way a declared `inputFile` itself has never been
restricted (there is no read-side equivalent of `outputRoot`). Turning the
flag on does not introduce a new *kind* of unrestricted read, but it does
make the reachable set transitive and automatic rather than confined to
what `inputs` explicitly lists, which is exactly the widening §5 called out.
Mitigated only by the flag being opt-in and the README (`## Security`)
saying so plainly -- an actual containment mechanism (an `inputRoot`, or a
realpath-based check mirroring `path-resolution.ts`'s existing
`outputRoot` guard) remains genuinely undesigned. Worth its own pass if
`resolveExternalReferences` sees use against less-trusted configurations.

### 9.4 Naming/collision strategy — the existing fallback, unmodified

§4 sketched this only in passing. What shipped: a pulled-in component has
no per-input `dispute` configuration to consult (it was never a declared
input), so a name clash falls back to exactly the numeric-suffix
disambiguation `processComponents` already applies when no dispute is
configured (`ServerError`, `ServerError1`, ...) — no new disambiguation
logic, no new config surface.

### 9.5 Verification

Full workspace green (439 library tests across 18 files, 186 CLI tests
across 14 files), lint and typecheck clean in both packages. Beyond what 36
§9 already covers for the always-on declared-input case: recursive pull-in
across a chain of undeclared documents; a genuine cyclic external reference
reported as a clean `cyclic-external-reference` merge error rather than a
stack overflow, including confirming a component with two references stops
processing the second once the first has already failed; a file-level cycle
between two discovered documents (mutual reference, no component-level
cycle) resolving fine, distinct from the genuine-cycle case above; a
discovered document that fails to load (missing file, and — via a real
in-process HTTP server, not a mocked `fetch`, matching this repo's existing
`cli-remote-inputs.test.ts` convention — an unreachable URL) producing a
warning and an unresolved (not corrupted, not fatal) ref rather than failing
the whole merge; and `resolveExternalReferences` rejected by the schema when
given a non-boolean value.
