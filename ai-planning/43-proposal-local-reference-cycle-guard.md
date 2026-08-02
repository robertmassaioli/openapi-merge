# Implementation Proposal: A Cycle Guard for Local Reference Chains

**Origin:** Found while writing edge-case tests for `CrossDocumentLookup` (proposal 42) — reported on [PR #150](https://github.com/robertmassaioli/openapi-merge/pull/150#issuecomment-5157546584), not yet fixed.

**Status:** Proposal only — quick pass, not yet built.

**Value:** 3 (a hang is worse than a crash — no exit code, no stack trace, nothing for a caller to catch) | **Effort:** 1–2

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

## 2. Design: a cheap pre-walk, not a reimplementation

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

## 3. Alternatives considered, briefly

- **Fix it upstream in `@atlassian/atlassian-openapi`.** The correct long-term home for this — `InternalLookup` should not be recursable into an infinite loop for *any* caller, not just this one. Out of this repo's control and on nobody's timeline; not a reason to leave every caller here exposed in the meantime.
- **Reimplement local resolution fully**, replacing the delegation to `InternalLookup` outright (the design this repo's own docstring already rejected for `CrossDocumentLookup`'s cross-document case, for the same reason: nine different `tCheck` shapes plus the backfill quirk, all needing to match exactly). Strictly more work and more risk than the pre-walk for the same result.
- **A depth counter instead of a `seen` set.** Turns a bug into a magic number (how deep is "clearly a cycle" vs "a legitimately long alias chain"?). `seen` answers the actual question — has this exact ref been visited before in this walk — with no threshold to tune or get wrong.

## 4. Effort and tests

Small: `hasLocalCycle` (~10 lines) plus its one call site in `cross-document-lookup.ts`. Tests:

- The pure local cycle from `cross-document-lookup.test.ts`'s current code comment, now safe to write as a real, fast-executing test (`expect(() => ...).not.toThrow()` / `toBeUndefined()`), replacing that comment.
- A local cycle three components long (`A -> B -> C -> A`), to confirm it isn't a special-cased two-node check.
- A local alias chain that is long but genuinely acyclic (`A -> B -> C -> ... -> Z`, terminal), confirming the guard doesn't false-positive on legitimate depth.
- The existing suite (491 tests) as the regression guard that nothing about the acyclic path changed.

No dependency changes -- `jsonpointer` and `TC.isReference` are already imported in `cross-document-lookup.ts` for the cross-document path.
