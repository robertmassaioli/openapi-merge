# Implementation Proposal: A Cycle Guard for Local Reference Chains

**Origin:** Found while writing edge-case tests for `CrossDocumentLookup` (proposal 42) — reported on [PR #150](https://github.com/robertmassaioli/openapi-merge/pull/150#issuecomment-5157546584), not yet fixed.

**Status:** ✅ Option B (full reimplementation, §2.1) chosen and implemented, at Robert's explicit direction, on [PR #150](https://github.com/robertmassaioli/openapi-merge/pull/150) — see §4. Option A (§2, the pre-walk) was written up first but not built; kept here for the record of what was considered and why B won.

**Value:** 3 (a hang is worse than a crash — no exit code, no stack trace, nothing for a caller to catch) | **Effort:** 1–2 for Option A, 2–3 for Option B (§4 shows what it actually took)

---

## 0. The problem, recapped

`deepEquality`'s `compare()` resolves a bare (`#`-prefixed) `$ref` via `InternalLookup` (`@atlassian/atlassian-openapi`), delegated to unchanged by `CrossDocumentLookup` for exactly this case. `InternalLookup.performLookup` recurses to follow a chain of local aliases, with **no cycle guard of its own**:

```js
performLookup(o, tCheck) {
  ...
  const result = jsonpointer.get(this.schema, ref.slice(1));
  if (isReference(result)) {
    return this.performLookup(result, tCheck);   // <- no visited-set, ever
  }
  return tCheck(result) ? result : undefined;
}
```

A document with two components referencing each other (`A: {$ref: '#/components/schemas/B'}`, `B: {$ref: '#/components/schemas/A'}`) sends this into unbounded recursion. Confirmed empirically with a 5-second hard timeout (exit 124, no output): on Bun this doesn't even reach a `RangeError` — the recursive call is a genuine tail call, so the stack never grows, and it just spins forever. This is orthogonal to cross-document refs entirely (proposal 42's own `seen`-guard doesn't apply — it only tracks cross-document identity+fragment pairs) and predates that work; it's reachable by any `deepEquality` comparison today, on `main`, with zero external refs involved.

## 1. Why it can't be fixed by adding a `seen` check where the existing guard lives

`CrossDocumentLookup`'s cross-document cycle guard works because *that* recursion is ours — every cross-document hop passes through our own `resolveWithSeen`, so we control where to check `seen`. The local chain is different: once we call `accessor(this.localLookup, value)`, the entire chain-walk happens **inside** `InternalLookup`, a third-party, unexported-internals class. We get one opaque call and one opaque return value; there is no hook to inspect an individual hop mid-flight. Any fix has to sit *outside* that call, not inside it.

## 2. Option A: a cheap pre-walk, not a reimplementation

Don't reimplement `InternalLookup`'s resolution (that's what `component-equivalence.ts`'s own docstring already chose not to do, precisely to avoid drifting from its type-specific `tCheck` predicates and the schema title-backfill quirk — redoing that for all nine accessors would be real surface area for something this narrow). Instead, walk the *same* chain ourselves, cheaply, using only `jsonpointer` and `TC.isReference` — no type predicates, no backfill, nothing accessor-specific — purely to answer "does this reference chain terminate?" If it does, hand off to the real, already-trusted `InternalLookup` call exactly as today. If it doesn't, bail before ever calling it.

```ts
private hasLocalCycle(ref: string, seen: Set<string> = new Set()): boolean {
  if (!ref.startsWith('#/') || seen.has(ref)) {
    return seen.has(ref);   // malformed or already visited -> let the real call handle/report it
  }
  seen.add(ref);

  const raw: unknown = jsonpointer.get(this.localDocument, ref.slice(1));
  if (!TC.isReference(raw) || !raw.$ref.startsWith('#')) {
    return false;   // terminal value, or hands off to a cross-document ref -- not this guard's concern
  }

  return this.hasLocalCycle(raw.$ref, seen);
}
```

Plugged into `resolveWithSeen`'s existing bare-ref branch, one line before the call that's there today:

```ts
if (split === undefined) {
  if (this.hasLocalCycle(value.$ref)) {
    return undefined;
  }
  const result = accessor(this.localLookup, value);
  ...
```

### Why this is safe

- **Zero behavioural change for every acyclic document** (the entire existing test suite): the pre-walk terminates the moment it hits a non-reference value or a cross-document ref, in the same number of hops `InternalLookup` itself would take — cheap, and it changes nothing about what gets returned.
- **No duplicated type logic**: `hasLocalCycle` never calls a `tCheck` predicate and never touches the title-backfill rule, so there's nothing to keep in sync with `InternalLookup`'s own (unexported) behaviour.
- **Consistent with the existing policy**: a detected cycle returns `undefined`, the same outcome `CrossDocumentLookup`'s cross-document guard already produces for a cyclic identity chain, and the same outcome `InternalLookup` already produces for a ref that's simply missing. `deepEquality`'s `isSchemaOrThrowError` surfaces it as `Could not resolve reference`, same message as any other unresolved ref — not a new failure mode.

### What this does *not* do

It doesn't turn a local cycle into a *named*, diagnosable error the way `external-references.ts` already does for a cross-document one (`cyclic-external-reference`, a distinct `ErrorMergeResult.type`). Giving a local cycle the same treatment would need `compare()` to signal an error rather than just return a boolean — a real change to `component-equivalence.ts`'s contract, not a guard bolted on the side. Worth doing, but a separate, larger change; not part of this fix. This proposal only turns a hang into the same generic "unresolved" outcome every other unresolvable ref already produces — strictly better (a caller gets *an* answer, even if not the friendliest one), not a finished diagnostic story.

### Alternatives to Option A, briefly

- **Fix it upstream in `@atlassian/atlassian-openapi`.** The correct long-term home for this — `InternalLookup` should not be recursable into an infinite loop for *any* caller, not just this one. Out of this repo's control and on nobody's timeline; not a reason to leave every caller here exposed in the meantime.
- **A depth counter instead of a `seen` set.** Turns a bug into a magic number (how deep is "clearly a cycle" vs "a legitimately long alias chain"?). `seen` answers the actual question — has this exact ref been visited before in this walk — with no threshold to tune or get wrong. (Applies equally to Option B below.)

### Effort and tests for Option A

Small: `hasLocalCycle` (~10 lines) plus its one call site in `cross-document-lookup.ts`. Tests: the pure local cycle, a three-component local cycle (`A -> B -> C -> A`), a long but genuinely acyclic alias chain (confirming no false positive), and the existing suite as a regression guard. No dependency changes — `jsonpointer` and `TC.isReference` are already imported for the cross-document path.

## 2.1 Option B: reimplement `InternalLookup`'s logic directly, cycle-guarded from the start

Raised as a question after this document's first draft: *is there an option where `CrossDocumentLookup` just reimplements all of `InternalLookup`'s logic, this time with a cycle guard built in?* Yes — and it turns out to do more than Option A does, for not much more code.

### Why this beats bolting a pre-walk onto the existing design

Today's `CrossDocumentLookup` (proposal 42) has **two parallel walking mechanisms**: delegate-to-the-real-`InternalLookup`-then-fall-back-to-a-custom-probe for a bare ref (`chaseForeignAlias`, needed because `InternalLookup` can't be asked to continue past a foreign ref it hits internally), and split-and-recurse for a cross-document ref. Option A would add a *third* mechanism (the pre-walk) that runs before the first one, just to answer a question the design can't otherwise answer: does this chain terminate?

Reimplementing `InternalLookup`'s own logic — its `tCheck` predicates are already public exports of `@atlassian/atlassian-openapi` (`SwaggerTypeChecks.isSchema`, `.isExample`, etc.), and its title-backfill rule is a few lines already fully read and understood while building proposal 42 — collapses all of this into **one** recursive walker that handles a bare ref and a cross-document ref identically at every hop, threading a single `seen` set through both. The cycle guard for a purely local chain isn't a separate feature bolted on afterward; it falls out for free from having one walk instead of three mechanisms layered on each other. Concretely:

```ts
// identity is undefined for the top-level local document, otherwise the
// identity of `doc` -- both are threaded through so a bare ref found while
// already inside another document resolves against *that* document, not
// back against the original caller's.
private resolveFrom<T>(
  identity: string | undefined,
  doc: OpenApiDocument,
  ref: string,
  tCheck: (v: unknown) => v is T,
  seen: Set<string>,
): T | undefined {
  const split = splitCrossDocumentRef(ref);
  if (split !== undefined) {
    if (split.fragment === undefined) return undefined;          // whole-document ref
    const target = this.knownDocuments[split.identity];
    if (target === undefined) return undefined;                 // out of scope, not an error
    return this.resolveFrom(split.identity, target, split.fragment, tCheck, seen); // redirect; always re-enters with a bare fragment next
  }

  // `ref` is bare here. This is the one place an actual fetch happens, so
  // it's the one place cycle-guarded: keyed by (identity, ref), not ref
  // alone, since the same fragment string can validly exist in two
  // different documents mid-chain.
  const key = `${identity ?? ''} ${ref}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  const raw: unknown = jsonpointer.get(doc, ref.slice(1));       // throws on a malformed pointer, same as InternalLookup does today
  if (TC.isReference(raw)) {
    return this.resolveFrom(identity, doc, raw.$ref, tCheck, seen); // re-split on the next call: could be bare (same doc) or cross-document
  }
  return tCheck(raw) ? raw : undefined;
}
```

The redirect branch deliberately does **not** touch `seen` itself — `splitCrossDocumentRef`'s `fragment` is always `#`-prefixed, so a redirect is always immediately followed by a canonical bare-fetch attempt, which *is* guarded. This avoids a subtlety worth naming: an earlier sketch checked `seen` using the raw `ref` string at the top of every call, before knowing whether it was about to redirect — which produces two different-looking keys for what is really the same (identity, fragment) destination reached two different ways, and can under- or over-count revisits. Keying only at the point of an actual fetch, by the (identity, ref) actually being fetched, is the version that's correct by construction, not by coincidence — verified by hand-tracing the mixed local/foreign cycle from §2.1.2 through both versions before picking this one.

Every accessor becomes a one-liner against `resolveFrom`:

```ts
getExample(e: Swagger.Example | Swagger.Reference): Swagger.Example | undefined {
  if (!TC.isReference(e)) return e;
  return this.resolveFrom(undefined, this.localDocument, e.$ref, TC.isExample, new Set());
}
```

`getSchema` keeps its own wrapper for the title-backfill quirk, applied once, after resolution:

```ts
getSchema(s: Swagger.Schema | Swagger.Reference): Swagger.Schema | undefined {
  if (!TC.isReference(s)) return s;
  const result = this.resolveFrom(undefined, this.localDocument, s.$ref, TC.isSchema, new Set());
  if (result === undefined || (result as { title?: string }).title !== undefined) return result;

  // Backfill uses the *fragment* portion only, never the identity prefix --
  // an identity containing its own slashes (a relative file path) would
  // otherwise throw off the segment count this check depends on.
  const fragment = splitCrossDocumentRef(s.$ref)?.fragment ?? s.$ref;
  const segments = fragment.split('/');
  return segments.length === 4 ? { ...result, title: segments[3] } : result;
}
```

`getSecuritySchemeByName` stays exactly as conceptually "always local" as before — it just builds a bare ref and calls `getSecurityScheme` on it, same as `InternalLookup` itself does.

### 2.1.1 A deliberate behaviour change: what the backfilled title anchors on

Today's design (delegate-then-retry) has an *incidental* property: because `chaseForeignAlias` re-enters with a fresh top-level `InternalLookup` call at every foreign-boundary crossing, the backfilled title ends up keyed to whichever hop was the *last* boundary crossed, not the ref the caller originally asked for — traced by hand for both existing tests that touch this:

| Scenario | Today's title | Option B's title |
| --- | --- | --- |
| Purely local chain `A -> B -> C` | `A` | `A` (unchanged — no boundary crossed) |
| Cross-document ref whose target is a local alias (`b.yaml#/Alias -> Real`) | `Alias` | `Alias` (unchanged — coincidence: the outermost ref's fragment already *is* the last hop before the alias) |
| Local alias bottoming out at a foreign doc (`Foo -> Bar -> external.yaml#/Baz`) | `Baz` | **`Foo`** |
| Cross-document chain spanning three identities (`b.yaml#/Middle -> c.yaml#/Inner`) | `Inner` | **`Middle`** |

The two changed rows are a deliberate choice, not an oversight: anchoring on the ref the caller actually asked for (`Foo`, `Middle`) is a simpler, single rule to state and verify than "whichever hop happened to be the most recent boundary crossing" — which was never a designed property of the original delegate-then-retry version, just what fell out of how the retry loop happens to be structured. Both existing tests' expected titles are updated accordingly, with a comment explaining why, per this repo's convention of recording a deliberate change rather than quietly editing a prior result away.

### 2.1.2 The cycle guard this design gets "for free"

Because every hop — local or cross-document — now goes through the *same* `resolveFrom`, a purely local cycle (`A: {$ref: '#/.../B'}`, `B: {$ref: '#/.../A'}`, no cross-document ref anywhere) is caught by the exact same `seen` check as a cross-document one, with no separate mechanism:

```
resolveFrom(undefined, local, '#/.../A', ...) -> key '\0#/.../A', not seen, add
  raw = {$ref:'#/.../B'} -> resolveFrom(undefined, local, '#/.../B', ...) -> key '\0#/.../B', not seen, add
    raw = {$ref:'#/.../A'} -> resolveFrom(undefined, local, '#/.../A', ...) -> key '\0#/.../A' -> ALREADY SEEN -> undefined
```

This closes proposal 43's original problem (§0) as a side effect of Option B, not as a separate patch — meaning Option A, if it had been built, would now be redundant rather than complementary. Also traced by hand (and covered by a test, §4): a *mixed* cycle that alternates a local hop with a repeated cross-document identity, which is a harder case than either the pure-local or the direct two-identity cross-document cycle already tested, and the one case that most clearly shows why keying by (identity, ref) at the canonical fetch point — rather than by ref alone, or by checking at every call regardless of whether it's a redirect — is the version that's actually correct.

## 3. Recommendation

Option B, chosen. It is not meaningfully more code than Option A once `TC`'s predicates are reused rather than reimplemented (they already are, in both designs), and it removes an existing awkwardness (`chaseForeignAlias`'s inference that an `undefined` from `InternalLookup` must mean "hit a foreign ref" rather than "genuinely missing") in the same change that adds the guard. The cost accepted: this repo now owns matching `InternalLookup`'s resolution behaviour exactly, rather than delegating to it — a real, ongoing maintenance commitment (§2.1's own tradeoff, weighed against Option A in the original answer to "is there an option"), judged worth it here because the logic being taken on is small, fully read, and fully tested rather than assumed.

## 4. Implementation

Built as designed in §2.1: `cross-document-lookup.ts` no longer imports or constructs `SwaggerLookup.InternalLookup` at all. `resolveFrom` is the one recursive walk; every accessor but `getSchema` is a two-line wrapper around it; `getSchema` keeps its own backfill step, applied once, after resolution. `getSecuritySchemeByName` builds a bare ref and calls `getSecurityScheme`, same as `InternalLookup` itself does.

One correction to §2.1's own sketch, caught by hand-tracing before it shipped: the first draft of `resolveFrom` checked `seen` at the top of *every* call, including the cross-document redirect step, keyed by the raw `ref` string as received. That produces two different-looking keys for the same eventual (identity, fragment) destination depending on whether it's reached via a fresh top-level call or a mid-chain redirect — under-counting some revisits and over-counting others. The version in §2.1 (`seen` checked only at the canonical bare-fetch point, never on a redirect) is what actually shipped; §2.1's own text already reflects this correction rather than the original sketch.

### Results

- `packages/openapi-merge/src/cross-document-lookup.ts`: rewritten, no `InternalLookup` dependency, no `chaseForeignAlias`, no `childLookups` cache (nothing left to cache — every hop is a fresh, cheap map lookup). Still 100%/100% function/line coverage.
- Two existing tests' expected titles updated per §2.1.1 (`Baz → Foo`, `Inner → Middle`), each with a comment explaining the deliberate anchor rule rather than a silent edit.
- New tests: a purely local cycle (now safe and fast to run at all — previously this exact input hung indefinitely), a three-component local cycle, a long (25-link) but genuinely acyclic local chain confirming no false-positive cycle detection, and the mixed local/cross-document cycle from §2.1.2. `cross-document-lookup.test.ts` went from 42 to 45 tests.
- Full suite: 494 tests (0 failures), `bun run lint` and `bun run typecheck` clean on both workspaces, `scripts/verify-node-runtime.sh`'s 48 bundled-artifact checks green on Node 25 and Bun, `bun audit` unchanged (the same pre-existing, unrelated `js-yaml` finding noted since proposal 41 — no new dependency was added, `jsonpointer` was already a direct dependency from proposal 42).

### 4.1 Found while merging `main`: a second, unrelated null-safety gap

Merging `main` after proposal 40 landed (`ai-planning/40-proposal-null-safe-document-walking.md` — `typeof null === 'object'` crashes wherever a structural slot is left empty in a source document) surfaced a gap of exactly that shape in this class, missed because it was built on a branch that diverged before proposal 40 existed. `resolveFrom` does its own `jsonpointer` fetch rather than going through `InternalLookup`, so it never inherited `safe-type-checks.ts`'s guard: a `null` schema (or callback, or request body, ...) slot threw a raw `TypeError` from inside `TC.isReference`, the same crash class proposal 40 closed everywhere else.

Fixed the same way proposal 40 already established: every accessor now threads an `expected` label (`'a Schema Object'`, `'a Callback Object'`, ...) through to `resolveFrom`, which passes each fetched value through `required()` before any `SwaggerTypeChecks` predicate sees it — turning the crash into one clear `MalformedDocumentError` naming what was expected and where. Four new tests (a null schema slot via a bare ref, via a cross-document ref, one confirming the label differs per accessor, and one confirming a genuine miss — `undefined`, not `null` — still doesn't throw). Full suite: 539 library tests, still 0 failures, still 100%/100% coverage on the file.
