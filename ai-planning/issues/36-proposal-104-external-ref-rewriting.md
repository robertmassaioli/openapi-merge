# Implementation Proposal: Issue #104 — Incorrect `$ref` in Bundled File

**Issue:** [#104 — Incorrect `$ref` in bundled file](https://github.com/robertmassaioli/openapi-merge/issues/104)

**Status:** ✅ Implemented — on branch `feature/external-ref-resolution`,
**together with #10** (Option 2-refined, see
[37](37-proposal-10-external-ref-bundling.md)) in one change, at Robert's
explicit direction. §10 originally recommended shipping this independently
of #10; that recommendation was overtaken by events, not wrong given what
was known at the time -- see §10 for what actually happened and why building
them together turned out fine.

**Value:** 4 | **Effort:** 3 *(revised down from the triage doc's 4 — see §4)*

---

## 1. Issue summary

The reporter merges several OpenAPI files that share components across
files via `$ref`s to *other files on disk* — e.g. one input's response
schema is:

```yaml
$ref: "./../common/ServerError.yml#/components/schemas/ServerError"
```

`ServerError.yml` is itself one of the declared merge inputs. After
merging, the output still contains that exact string, character for
character:

```yaml
$ref: ./../common/ServerError.yml#/components/schemas/ServerError
```

which is broken: the merged document lives in a different location, the
relative path no longer resolves to anything meaningful relative to it, and
in any case the schema it wants is already present, correctly, at
`#/components/schemas/ServerError` in the very same merged document.

## 2. Reproduction — confirmed, still broken today

Stripped down (per the reporter's own comment that the original report has
far more YAML than the bug needs) and run against this repo's current
`main` via the built CLI:

```
specs/common/ServerError.yml:
  openapi: "3.0.0"
  components:
    schemas:
      ServerError: { type: object }

specs/a/Api.yml:
  openapi: "3.0.0"
  info: { version: 1.0.0, title: A }
  paths:
    /a:
      get:
        operationId: getA
        responses:
          "200": { description: ok }
          default:
            description: server error
            content:
              application/json:
                schema:
                  $ref: "../common/ServerError.yml#/components/schemas/ServerError"

openapi-merge.json:
  { "inputs": [{ "inputFile": "./specs/common/ServerError.yml" },
                { "inputFile": "./specs/a/Api.yml" }],
    "output": "./bundle.yml" }
```

Output:

```yaml
openapi: 3.0.0
paths:
  /a:
    get:
      operationId: getA
      responses:
        '200': { description: ok }
        default:
          description: server error
          content:
            application/json:
              schema:
                $ref: ../common/ServerError.yml#/components/schemas/ServerError   # <- unchanged, broken
components:
  schemas:
    ServerError: { type: object }   # <- right here, un-referenced by the broken $ref above
```

Confirmed by running the actual CLI end to end, not by reading the code.

## 3. Root cause

Two facts about the current architecture, both confirmed by reading the
code rather than assumed:

- **The `openapi-merge` library has zero knowledge of file paths.** It has
  no dependency on Node's `path` module (checked: no `import ... from
  'path'` anywhere in `packages/openapi-merge/src`) and `SingleMergeInput`
  (`data.ts`) carries only an already-parsed `oas` document plus merge
  options — nothing that identifies *where that document came from*. This
  is deliberate: the library is meant to be portable (usable outside Node),
  and file I/O is entirely the CLI's job (`loadOasForInput` in
  `openapi-merge-cli/src/index.ts`).
- **`$ref` rewriting only recognises the exact bare form
  `#/components/<type>/<name>`, per input.** `paths-and-components.ts`
  builds one `referenceModification` map per input (`{ '#/components/schemas/Dog':
  '#/components/schemas/Dog1', ... }`, populated only when *that input's
  own* component was renamed for a clash) and calls
  `walkAllReferences(oas, ref => ...)` **inside the same per-input loop
  iteration**, rewriting only refs that exact-match (or are a sub-path of)
  a key in *that input's own* map. A ref shaped
  `../common/ServerError.yml#/components/schemas/ServerError` never matches
  any key in any map — the lookup is pure string comparison against
  `#/components/...` strings — so it falls through the `walkAllReferences`
  callback unchanged. This isn't a bug in that logic; that logic was never
  asked to consider anything other than a bare in-document pointer.

There is no step anywhere that resolves a `$ref`'s file-path portion
against anything, because nothing downstream of file-loading carries a file
path at all.

## 4. Scope — narrower than the prior triage assumed

The triage doc (`issue-triage-value-vs-effort.md`) flagged #104 as possibly
needing #10 (general external-reference *bundling* — resolving a `$ref`
into **any** file on disk, whether or not it was ever given to the tool as
an input) first, and filed it as a "Big Bet" for a hypothetical 2.0. That
was written before reproducing it.

Having reproduced it: **every broken `$ref` in the reporter's own example
points at a file that is itself already a declared merge input.**
`ServerError.yml`, `GetInstrumentByCriteriaRequestBody.yml`, and
`InstrumentDetails.yml` are all in their `inputs` list. That is very likely
the common case in practice too — it's the natural shape for a team that
splits one API's components across files and hands *all* of them to this
tool.

That means the fix does not need general bundling (#10) at all. It needs
only: **recognise when a `$ref`'s file-path portion resolves to a file that
is already one of this merge's own inputs, and rewrite it to point at
wherever that input's component ended up in the merged document** —
exactly the same kind of rewrite the dispute/rename machinery already does
for in-document refs, just extended to also recognise refs that arrive
pre-qualified with a file path. A `$ref` into a file that was *not* given as
an input is explicitly out of scope here (§8) — that is genuinely #10's
territory, and stays exactly as broken/unsupported as it is today.

## 5. Design

### 5.1 The CLI computes an identity per file input, and normalises cross-input refs against it

`loadOasForInput` (`openapi-merge-cli/src/index.ts:241`) already computes
`fullPath = resolveConfigPath(basePath, input.inputFile)` — the resolved
absolute path — for every file input; it's just discarded after the read.
Two additions:

1. Attach it to the `SingleMergeInput` the CLI builds, as a new **optional**
   field on `SingleMergeInputBase` in the library — `sourceIdentity?: string`.
   Deliberately opaque to the library: it never parses or resolves this
   string, only compares it for exact equality against other inputs'
   `sourceIdentity`. (Named `sourceIdentity`, not `sourcePath` or `filePath`
   — `inputURL` inputs can carry one too; see §6.2.)
2. Before handing each input's `oas` to the library, walk its `$ref`s
   (reusing the library's own `walkAllReferences`, exported from
   `reference-walker.ts` — confirmed importable the same way the CLI
   already deep-imports `openapi-merge/dist/data` and
   `openapi-merge/dist/oas31`, i.e. `openapi-merge/dist/reference-walker`;
   no new traversal code needed) and, for any ref that does **not** start
   with `#` (i.e. has a file-path portion):
   - **Resolve, but rewrite only on a confirmed match.** A ref like
     `https://example.com/spec.yaml#/components/schemas/X` also doesn't
     start with `#`; naively resolving it with `path.resolve` against a
     local directory produces garbage (`/abs/dir/https:/example.com/...`),
     and if that garbage were written back into the document unconditionally,
     an absolute-URL ref that works perfectly well *today* would come out
     corrupted. The fix: resolve the candidate path, then only rewrite the
     `$ref` string if that resolved path exactly matches another input's
     `sourceIdentity` (computed once the *whole* input set is known, i.e.
     this really has to run after every input's `fullPath` has been
     collected, not per-input in isolation). No match — including anything
     that isn't a plausible relative/absolute filesystem path at all, like a
     URL or `urn:` — leaves the ref completely untouched, exactly as today.
   - **A ref with no fragment is a whole-document reference and is left
     untouched.** `$ref: "./common/ServerError.yml"` (no `#`) legally means
     "the entire document at that path." Splitting on `#` for a ref with
     none yields no fragment to rewrite, and there is no single local
     pointer in the merged output that means "that whole input" — so this
     case is explicitly excluded from rewriting, not treated as a
     degenerate case of the fragment logic.

   Everything that *does* match becomes `<resolved-absolute-path>#<fragment>`
   in the input document before it reaches the library, so the library never
   needs `path` semantics of its own — it only ever compares strings for
   exact equality against `sourceIdentity`.

### 5.2 The library gets a second, cross-input rewriting pass

Today, `mergePathsAndComponents`'s single loop does, per input: rename
components, rewrite that input's own bare refs using that input's own
rename map, copy the (now-correct) paths/webhooks into `result`. That local
step is **unchanged** — every existing test keeps passing unmodified.

Added, after the loop (once *every* input's rename map is known — this has
to wait, because input A might reference input C, which is processed
*after* A, and C's renames aren't known until C's own turn in the loop
completes):

1. Keep each input's `referenceModification` map (currently discarded at
   the end of each loop iteration) in an outer
   `Record<sourceIdentity, { [original: string]: string }>`.
2. Build `identityToInput: Record<sourceIdentity, inputIndex>` from every
   input that declared one. **An identity claimed by more than one input is
   treated as unmatched, not as "the first/last one wins."** The config
   format allows the same file to be listed twice (e.g. with different
   `pathModification` per copy), which would otherwise make
   `identityToInput` silently resolve to whichever input happened to be
   processed last, and a cross-file ref intending the *other* copy would
   get rewritten against the wrong rename map with no error. There's no
   principled way to guess which copy a ref meant, so refs matching an
   ambiguous identity are left exactly as they are today (§8) rather than
   guessed at.
3. `walkAllReferences(result, ref => ...)` **once**, over the fully
   assembled `result` (which already satisfies the shape
   `walkAllReferences` wants — `paths`/`webhooks`/`components`). For a ref
   not starting with `#`: split it into `[identity, fragment]` on the first
   `#`. If `identity` isn't in `identityToInput` (absent, or ambiguous per
   the previous point), leave the ref exactly as it is today (§8 — not one
   of this merge's inputs, or not resolvably one of them). If it is,
   resolve `fragment` against *that target input's own*
   `referenceModification` map — same lookup logic already used for local
   refs (exact match, then the existing "longest matching prefix" fallback
   for a nested path) — and rewrite the ref to the resulting local
   `#/components/...` string.

This is a genuine, if bounded, restructuring of the merge loop's central
function — not a two-line patch — which is why this is a proposal rather
than a fix straight to a PR. It touches the one function everything else in
the library is built on top of.

### 5.3 Ordering with `pruneUnusedComponents`

Falls out for free: `pruneUnusedComponents` (issue #94) runs as a
completely separate, later step in `merge()`'s top-level orchestration,
walking `$ref`s in the *finished* document to decide what's reachable.
Because §5.2's rewrite already turned every resolvable cross-file ref into
a normal `#/components/...` ref before that point, pruning sees a correctly
reachable graph without any changes of its own. (Verified by reading — not
yet by a test; that's part of §9.)

## 6. Decisions

### 6.1 Always on, or a new config flag? — recommend: always on, no flag

Unlike `pruneUnusedComponents` (destructive — might discard components a
consumer still wants) or `securitySchemesStrategy` (a genuine behavioural
choice with three defensible answers), this only ever *fires* when a `$ref`
resolves to a file that is itself a declared input — a state that is
**already unconditionally broken** today (a dangling reference in the
output). There is no existing behaviour worth preserving behind a flag:
nobody can be relying on today's output being a working document. Recommend
shipping this as unconditional, correctness-fixing behaviour, the same way
issue #106's discriminator-mapping rewrite or #99's rename-propagation
were — no new `Configuration` field.

### 6.2 `inputURL` inputs — in scope now, or deferred? — **overtaken: shipped from the start**

The same mechanism generalises: an `inputURL` input's `sourceIdentity`
would be the URL itself, and a relative cross-reference from it resolves
with `new URL(refFilePart, inputURL).href` instead of `path.resolve`. It's
not a large amount of extra code, but it is untested territory (no existing
coverage exercises `$ref`s inside a URL-loaded input at all) and it widens
what a first PR has to prove correct. **Recommend deferring** — ship §5 for
file inputs first, note URL inputs as explicitly unsupported by this pass,
and pick it up as a small, obvious follow-on once the file-input path has
landed and proven itself. Flag if you'd rather have both from the start.

**What actually happened:** building this together with #10 (§10) meant the
identity/resolution machinery had to handle both files and URLs from day one
regardless — #10's discovery worklist needs to load documents over HTTP
either way, so `inputURL` support for #104's narrower declared-input case
came along for free rather than as separate follow-on work. Covered by a
real in-process HTTP server test (`cli-external-references.test.ts`, matching
the existing `cli-remote-inputs.test.ts` pattern), not left untested as this
section worried it might be.

### 6.3 A cross-file ref that matches no declared input — silent, or a warning?

Out of scope for rewriting either way (§8), but two options for what the
CLI *says*: leave it exactly as silent as today, or have the CLI log a
one-line notice (`## Note: input N has a $ref to 'X', which is not one of
this merge's inputs -- left unresolved`) so a user gets a hint rather than
discovering a dangling ref by opening the output. **Recommend the notice**
— it's a few lines in `convertInputs`, costs nothing when it doesn't fire,
and turns "nothing happened where I expected a fix" into an actionable
message. Happy to drop it and stay silent if you'd rather keep `init`-style
output terse.

## 7. Scope of the change

- `packages/openapi-merge/src/data.ts` — new optional
  `sourceIdentity?: string` on `SingleMergeInputBase`.
- `packages/openapi-merge/src/paths-and-components.ts` — retain per-input
  `referenceModification` maps across the loop; add the pass-2 walk
  described in §5.2.
- `packages/openapi-merge-cli/src/index.ts` — `loadOasForInput`/
  `convertInputs` gains the ref-normalisation pre-pass (§5.1) and populates
  `sourceIdentity`; the §6.3 notice, if wanted.
- Possibly a small new module (e.g. `ref-normalisation.ts` in the CLI) to
  keep the file-path-resolution logic out of `index.ts`'s already-large
  surface, consistent with how `path-resolution.ts` and `file-loading.ts`
  are already split out.

Not touched: `duplicatePathHandling`, dispute/rename logic itself
(reused, not changed), `operationSelection`, security schemes, the CLI's
config file format (no new `Configuration` field per §6.1).

## 8. Not doing

- **General external-reference bundling (issue #10)** — resolving a `$ref`
  into a file that was never given to the tool as an input. That needs
  fetching and parsing arbitrary additional files, deciding how *their*
  refs and name clashes get folded in, and is the actual "Big Bet" the
  triage doc was gesturing at. This proposal deliberately does not attempt
  it — §4 is the finding that #104 doesn't require it.
- Recursive resolution through a chain of external files (A refs B refs C).
  Only refs pointing directly at one of the merge's own inputs are handled;
  each input is still expected to be parseable as a standalone document
  (paired with its own intra-document refs) the way the tool has always
  assumed.
- Rewriting refs inside a component's *own* definition differently from
  refs inside paths/webhooks — `walkAllReferences` already covers both
  uniformly; no special-casing needed.

## 9. Verification

Everything below ran, rather than being planned:

- The exact reproducer from §2, run through the real CLI end to end
  (`cli-external-references.test.ts`): the response schema's `$ref` comes out
  as `#/components/schemas/ServerError`, resolved and localised, with no
  `resolveExternalReferences` flag set at all.
- Cross-file ref to a component that *did* get renamed for a clash in the
  target input — `external-references.test.ts`'s
  `'resolves a ref to a component that was renamed for a clash in the target
  input'`.
- A cross-file ref to a file that is genuinely not an input, with discovery
  off: left unresolved (§8) — see the CLI test named for exactly this.
- A cross-file ref into `securitySchemes`: left unresolved, no crash —
  matches the local-rename carve-out from issue #33/#94.
- Forward reference (input 0 refs input 2, not yet processed) and backward
  reference (input 2 refs input 0, already processed) — both pass, the
  entire reason §5.2 is a second pass rather than folded into the loop.
- `pruneUnusedComponents: true` combined with a cross-document ref — the
  pulled-in component survives pruning because it really is referenced,
  confirming §5.3's "falls out for free" claim empirically.
- The same file listed as two separate inputs: any cross-file ref naming it
  is left untouched (§5.2's ambiguous-identity rule), not resolved against
  whichever copy was processed last.
- **§5.1's "byte-for-byte unchanged" prediction was wrong, and worth
  recording rather than quietly fixing.** An unmatched cross-document ref
  does *not* survive untouched end-to-end through the CLI — it comes out
  normalised to an absolute path (or URL), just not resolved to a local
  pointer. This falls out of the mechanism itself: normalising every
  declared input's own refs to a comparable absolute form is *how* #104
  matching works at all, and that normalisation runs before anything checks
  whether a match exists. Decided this was worth keeping rather than
  special-casing back to the original string: an absolute-but-unresolved
  path is more useful for debugging why a `$ref` didn't resolve than the
  original relative spelling, and it doesn't change whether the ref
  resolves, only what the leftover string looks like when it doesn't. The
  *library's* own contract is unaffected and still holds exactly as
  written: given an already-external-shaped ref and no matching
  `externalDocuments` entry, `merge()` itself leaves it untouched (see
  `external-references.test.ts`'s regression guard for that boundary
  specifically). What changed is a layer up, in what the CLI hands to
  `merge()` in the first place.
- Full workspace green: 439 library tests (18 files) and 186 CLI tests (14
  files), lint and typecheck clean in both packages. Coverage on the new
  files: 90%/97.04% (funcs/lines) on `external-references.ts`, 100%/98.85%
  on `external-reference-discovery.ts` — the remaining gaps are defensive
  branches unreachable from any real call site (mirrors a handful of
  already-accepted gaps elsewhere in `paths-and-components.ts`'s equivalent
  local-rename logic).

## 10. Relationship to #10

Issue #10 (general external-reference bundling — §8's "genuinely #10's
territory") has its own evaluation:
[37-proposal-10-external-ref-bundling.md](37-proposal-10-external-ref-bundling.md).
That document works through Robert's own 2021 design note on #10, reads it
as three architectures rather than two, and recommends "Option 2, refined"
— the CLI pre-resolves synchronously, `merge()` stays synchronous and
consults what it's given — while noting this proposal's own mechanism is a
narrower special case of exactly that option (37 §3).

**Decided (by Robert, directly) after both documents were written: build
both together, in one change**, rather than shipping this independently as
§8 originally recommended. That original recommendation was not wrong given
what was known writing it — declared-input matching genuinely doesn't need
general bundling, and is correct and shippable on its own. But once both
proposals existed side by side, unifying them turned out straightforward
rather than risky: the identity map, the deferred second pass, and the
per-target rename-resolution logic §3 predicted would be reused, *were*
reused without modification — `createCrossDocumentResolver` in
`external-references.ts` handles a `$ref` into a declared input and a `$ref`
into a `MergeOptions.externalDocuments` entry through the same recursive
function, distinguished only by which map the identity is found in. One
mechanism, not two coordinating ones. §6.2's `inputURL` deferral was the one
casualty of building them together — see that section for why it stopped
being worth deferring once #10's discovery worklist needed URL loading
regardless.
