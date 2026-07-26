# Spec-Derived Edge Case Findings

**Status:** 📋 Findings record — two fixes applied, five gaps pinned by tests
**Date:** 2026-07-26
**Branch:** `test/spec-edge-cases`
**Spec:** OAS 3.2.0 — <https://spec.openapis.org/oas/v3.2.0.html>

---

## 0. What this is

65 edge-case tests derived from the **normative rules in the specification**
rather than from the implementation, across all three supported versions:

| Suite | Tests |
| --- | --- |
| `spec-edge-cases-30.test.ts` | 24 |
| `spec-edge-cases-31.test.ts` | 19 |
| `spec-edge-cases-32.test.ts` | 22 |

Writing them found **seven** divergences between the merge and the spec. Two
were defects in the 3.1 support shipped in phase 2 and are **fixed here**. Five
are pre-existing or by-design and are **pinned by tests** that say so, rather
than being asserted as correct or quietly ignored.

## 1. Fixed

### 1.1 A `$ref`-only Path Item was deleted outright

**Spec:** a Path Item may be a Reference Object; the `$ref` "MUST be in the form
of a URI, and the referenced structure MUST be in the form of a Path Item
Object".

`countOperationsInPathItem` returned 0 for `{ $ref: '#/components/pathItems/X' }`
and `dropPathItemsWithNoOperations` deleted the entry. Measured:

```
input : paths: { '/b': { $ref: '#/components/pathItems/Shared' } }
before: paths: {}          <- endpoint gone
after : paths: { '/b': ... }
```

This made phase 2's `components.pathItems` support **effectively unusable** — a
component path item is only useful if something references it, and every such
reference was being deleted. It also affected 3.0, which has always allowed
`$ref` in a Path Item.

Fixed by a new `pathItemHasContent` predicate: a `$ref` counts as content.

### 1.2 `operationSelection` never reached webhooks

`includeTags` / `excludeTags` iterated `oas.paths` only. A tagged webhook
operation was silently retained:

```
input : webhooks: { drop: { post: { tags: ['internal'] } } }, excludeTags: ['internal']
before: the operation survives
after : the operation is removed
```

Phase 2 claimed webhooks merge "like paths"; tag selection is part of that, so
this was a broken promise rather than an unimplemented extra. Fixed by extracting
a `removeOperations` walker that covers `paths` **and** `webhooks`, which also
removed the near-duplicate include/exclude loops.

## 2. Pinned, not fixed

Each has a test named `KNOWN GAP` or `KNOWN LIMITATION` explaining the rule and
the actual behaviour. They fail loudly if the behaviour changes, which is what
makes them safe to leave.

### 2.1 Templated paths that the spec calls identical are not detected

**Spec, Paths Object:** *"Templated paths with the same hierarchy but different
templated names MUST NOT exist as they are identical."* The spec names
`/pets/{petId}` and `/pets/{name}` as exactly this case.

The merge compares path strings, so both survive and the output is an **invalid
document**. Fixing it means comparing paths by template shape — normalising
`/pets/{x}` to `/pets/{}` before the duplicate check. Small, but it changes what
counts as a `duplicate-paths` error, so it deserves its own change and a note in
the changelog.

**Impact:** two teams who name the same path parameter differently get a
silently invalid merged spec. Plausible in the API-gateway use case this tool
targets.

### 2.2 A dispute prefix can produce component keys the spec forbids

**Spec, Components Object:** keys *"MUST use keys that match the regular
expression: `^[a-zA-Z0-9\.\-_]+$`"*.

`dispute: { prefix: 'My Service ' }` produces the key `My Service Thing`, which
contains spaces and does not match. Measured and pinned. The fix is to validate
the prefix/suffix at merge time and reject it, which is a new error type.

### 2.3 A deliberately empty Path Item is dropped

**Spec, Path Item Object:** *"A Path Item MAY be empty, due to ACL
constraints"* — an empty path item is how you say "this path exists but its
operations are not visible to you".

The merge deletes it. Arguably reasonable for a merge tool, but it destroys a
signal the spec explicitly provides, and unlike §2.1 the output stays valid.
Left as-is deliberately; changing it would resurrect empty path items that
`operationSelection` has just emptied, which is the behaviour the dropping exists
for.

### 2.4 Discriminator pointers are not rewritten on rename

Already tracked as **issues #99 and #106**, with proposals in
`issues/proposal-99-discriminator-mapping-prefix.md` and
`issues/proposal-106-discriminator-mappings.md`. Confirmed still present for
both `mapping` (3.0) and the new 3.2 `defaultMapping`:

```
oneOf $ref            -> #/components/schemas/Dog1   (correctly rewritten)
discriminator.mapping -> #/components/schemas/Dog    (stale)
```

The new tests add `defaultMapping` coverage those proposals predate.

### 2.5 A Link `operationRef` is not rewritten when its path moves

A Link's `operationRef` is a URI pointing at an Operation. Under
`pathModification.prepend: '/api'`, the path becomes `/api/thing` but a link
pointing at `#/paths/~1thing/get` is left dangling.

Related to §2.4 — both are "pointers the reference walker does not know about".
Worth fixing together as "rewrite every kind of internal pointer, not just
`$ref`".

### 2.6 Semantic schema equivalences are not deduplicated

`{ type: ['string','null'] }` and `{ type: ['null','string'] }` are the same
JSON Schema type set; deduplication is structural, so the second is renamed.
Same for `{ type: 'string', nullable: true }` versus its 3.1 replacement.

Out of scope by design — semantic schema comparison is a much larger feature —
and mitigated by the phase-1 rule that inputs must share a version. Recorded so
the behaviour is not a surprise.

### 2.7 A tag `parent` can be left dangling

3.2 tag hierarchies reference a parent by name. If `operationSelection` removes
the parent tag, the child keeps pointing at a name that is no longer present.
Nothing validates tag graphs.

## 3. Behaviours confirmed correct

Worth recording, because these were the plausible-failure candidates that turned
out fine:

- paths differing only in case, or by a trailing slash, stay distinct;
- a numeric disambiguation suffix skips names already taken (`Thing`, `Thing1`
  present → new component becomes `Thing2`);
- a reference whose target is itself a reference follows a rename;
- `$ref` with sibling keywords (legal in 3.1) is rewritten and the siblings kept;
- references inside callbacks are rewritten;
- a duplicate created *by* `pathModification` is detected, not just duplicates
  present in the inputs;
- `components`-only documents merge, per the rule that at least one of
  `components`/`paths`/`webhooks` must be present;
- webhook and path namespaces are separate — a webhook named `/pets` does not
  clash with a path `/pets`;
- `additionalOperations` keys are case-sensitive, and a custom `GET` coexists
  with the standard `get`;
- a `query` operation may carry a `requestBody`.

## 4. Suggested order for the remaining work

1. **§2.2 dispute-prefix validation** — smallest, purely additive, prevents
   emitting invalid keys.
2. **§2.1 templated-path equivalence** — highest user impact; produces invalid
   documents today.
3. **§2.4 + §2.5 together** — one change: teach the walker every internal
   pointer form (`discriminator.mapping`, `discriminator.defaultMapping`,
   `operationRef`). Closes two open issues.
4. §2.3, §2.6, §2.7 — leave unless someone asks.
