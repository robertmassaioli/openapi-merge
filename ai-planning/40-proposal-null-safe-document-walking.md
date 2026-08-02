# Proposal 40: Null-safe document walking — closing the `typeof x === 'object'` gap systematically

**Status:** Proposal (not yet implemented)

**Triggered by review of [PR #97](https://github.com/robertmassaioli/openapi-merge/pull/97)** ("fix : null check if the type of the param is 'object'"), at Robert's request: assess the underlying problem, find every other place it can occur, and decide whether the right fix is to silently handle it or to error.

> **Which PR this assumes:** the request named no PR number — I inferred #97 from the "should this error instead of being fixed" framing matching a defensive null-check fix, and confirmed the file it touches is real and still open. If a different PR was meant (e.g. #88 or #87), say so; the investigation below stands regardless, since it traces the underlying bug class rather than just that one diff, but the framing in §1 is specific to #97/#77.

**Short answer up front:** PR #97 is already superseded — the one line it touches was fixed more thoroughly by a separate commit chain in 2024. But the *pattern* it was reaching for is real, confirmed reachable through at least 20 other call sites across 6 files (one of them written this week, in proposal 38's own code), and the right fix for most of them is a **clear error naming the offending input and location**, not a silent workaround — see §3.

## 1. What PR #97 actually is, and why it's redundant

PR #97 (opened 2024-02-07, still open) changes one line in `packages/openapi-merge/src/component-equivalence.ts`:

```diff
-    } else if (typeof x === 'object' && typeof y === 'object') {
+    } else if (typeof x === 'object' && typeof y === 'object' && x !== null && y !== null) {
```

It is the **third** independent attempt at fixing this exact file:

| # | Date | What | Landed? |
| --- | --- | --- | --- |
| PR #77 | 2022-08-31 | Guard `x === null \|\| y === null` before `TC.isReference` | Never merged |
| PR #97 | 2024-02-07 | Add `x !== null && y !== null` to the object-typeof branch | Never merged |
| `f625540` → `8dd59b4` → `8d4af85` | 2024-05-27 to 2024-06-06 | A more thorough fix (`isPresent()` guard wrapping the whole `compare` branch, reviewed and landed by Robert) | **Merged, on `main`** |

`main`'s current `component-equivalence.ts` wraps the entire vulnerable branch in `isPresent(x) && isPresent(y)` *and* (redundantly, presumably from a later, unrelated touch) still carries inline `x !== null && y !== null` checks. It is fully protected, with dedicated regression tests in `component-equivalence.test.ts` naming issue #92 directly. PR #97's specific change is already covered, twice over.

**Recommendation: close #97 and #77 as superseded**, with a comment linking the commit chain above and this proposal — the pattern they were both reaching for is real, but the fix belongs at the scope this document covers, not as a fourth narrow patch to one file.

## 2. The actual underlying problem

`typeof null === 'object'` in JavaScript. Any code that checks `typeof x === 'object'` intending "is this a real object I can call `Object.keys` / index into / check `'$ref' in x` on" — without *also* excluding `null` — will treat `null` as a valid object and then crash on the very next operation. Issue #92's original report is exactly this:

```
TypeError: Cannot use 'in' operator to search for '$ref' in null
    at Object.isReference (.../atlassian-openapi/lib/type-checks.js:85:48)
    at compare (.../openapi-merge/dist/component-equivalence.js:63:51)
```

That crash site is fixed. The pattern that caused it is not contained to that file.

### 2.1 The root cause is upstream, not (mostly) in this repo

`@atlassian/atlassian-openapi`'s own type-checking helpers have the identical bug, confirmed by executing them directly:

```js
// node_modules/@atlassian/atlassian-openapi/lib/type-checks.js
function isReference(s) {
    return typeof s === 'object' && '$ref' in s;   // throws on null
}
function matchesObjectShape(o, allKeys, requiredKeys) {
    if (typeof o !== 'object') { return false; }    // null passes this check...
    const nonExtensionKeys = removeExtensions(Object.keys(o)); // ...then throws here
    ...
}
function isMediaTypeWithExamples(t) {
    return 'examples' in t;                          // no typeof guard at all --
}                                                      // throws on null, undefined, AND every primitive
```

`matchesObjectShape` backs `isSchema`, `isParameter*`, `isRequestBody`, `isExample`, `isPathItem`, `isResponse`, `isHeader*`, `isLink*`, `isCallback`, and every `is*SecurityScheme` check in the package — all equally broken on `null`. `isReference` and `isMediaTypeWithExamples` are the two of these this codebase actually calls (see §2.2), but the vulnerability in the dependency is much wider than this repo's exposure to it.

Behaviour, verified directly:

| Input to `TC.isReference` | Result |
| --- | --- |
| `null` | **throws** |
| `undefined` | `false` (safe — `typeof undefined === 'undefined'`) |
| `[]`, `5`, `'s'`, `true` | `false` (safe) |

That asymmetry matters: **every `!== undefined` guard in this codebase that was meant to also exclude `null` is a false sense of safety** — see §2.3.

### 2.2 Confirmed, reproduced crashes (not theoretical)

Three independent repros, run against the current CLI, using nothing more exotic than an empty YAML value — one of the easiest authoring mistakes to make:

**Repro 1 — a whole component left empty:**
```yaml
components:
  schemas:
    Widget:
```
→ `walkSchemaReferences` → `TC.isReference(schema)` → `TypeError` (Bun's phrasing: `s is not an Object. (evaluating '"$ref" in s')`; Node's: `Cannot use 'in' operator to search for '$ref' in null`) → **uncaught, `ExitCode.ErrorUncaught` (4), raw stack trace into `node_modules`.**

**Repro 2 — an empty operation, the single most likely YAML slip in the list:**
```yaml
paths:
  /a:
    get:
```
→ two *separate* unguarded crashes depending which pass reaches it first: `ensureUniqueOperationId` (`paths-and-components.ts:215`, `operation.operationId` on `null` — this fires in the *core, always-on* merge path, no flags needed) and, separately, `walkOperationReferences` (`reference-walker.ts:288`, `operation.parameters` on `null`).

**Repro 3 — the same shape, reached through proposal 38's own external-pull-in code, written this week:**
```yaml
# common.yaml, pulled in via resolveExternalReferences
components:
  schemas:
    Errors:
```
```yaml
# a.yaml
components:
  schemas:
    Widget:
      $ref: "./common.yaml#/components/schemas/Errors"
```
→ produces a **confusing double failure**: a `## WARNING: could not load '.../common.yaml' ... (s is not an Object...)` line (the crash *is* caught during discovery's try/catch, downgrading it to a warning — accidental protection, not designed), followed moments later by the *same* crash reached again through `pullInComponent` (`external-references.ts:215`) → `walkComponentReferences` → `walkSchemaReferences` → `TC.isReference`, this time **uncaught**. One malformed external file, two different outcomes, neither of them a real error message. This is worth stating plainly: **this exact bug class exists in code from this repo's most recent proposal**, not just in old, unexamined corners — the pattern is easy to reintroduce even right after thinking hard about a related class of input-safety problem (proposal 38's `inputRoot`).

All three exit non-zero — issue #92's *original* complaint (silent success on a crash) stays fixed — but what the user sees is an internal `TypeError` with a stack trace pointing into a dependency or compiled `dist/` output, naming neither the offending input nor where in it the problem is.

### 2.3 Every currently-reachable unsafe location

Audited by grepping every `typeof X === 'object'`/`!== 'object'`, every `TC.*`/`SwaggerTypeChecks.*` call, every `!== undefined` guard on a value that could legitimately be `null`, and every bare `Object.keys`/property access on a map entry, across both packages — then confirmed representative cases by executing them. Three sub-classes, each wanting a different fix:

**Class A — `typeof x === 'object'` without excluding `null` (inherited from the dependency).** Zero first-party instances of the *positive* form (every one already guards `!== null`, per `git grep`) — but one first-party instance of the *negated* form slipped through: `reference-walker.ts:42`, `typeof schema.additionalProperties !== 'boolean'`, where `typeof null !== 'boolean'` is `true`, so a `null` `additionalProperties` recurses instead of being skipped.

**Class B — `!== undefined` where `!= null` (or `??`) was meant.** The map itself is often already guarded this way (`oas.paths || {}`, `getPaths`/`getWebhooks`'s `??`) — the gap is almost always one level *down*, on the map's individual **entries**:

| File : line | Code | A `null` here comes from |
| --- | --- | --- |
| `reference-walker.ts:11,19,25` | `schema.not/allOf/oneOf/anyOf !== undefined` then recurse | `not: `, an `allOf` list item left blank |
| `reference-walker.ts:31` | `schema.items !== undefined` then recurse | `items: ` on an array schema |
| `reference-walker.ts:42` | `additionalProperties !== 'boolean'` (Class A, see above) | `additionalProperties: ` |
| `reference-walker.ts:107` | `discriminator.defaultMapping !== undefined` then `.startsWith` | `defaultMapping: ` |
| `reference-walker.ts:119` | `mediaType.schema !== undefined` then recurse | `content: { 'application/json': }` (the *media type itself* null, not just its `.schema`) |
| `reference-walker.ts:135` | `walkSchemaReferences(parameterOrRef.schema, ...)` — **no guard at all**, unlike the header equivalent at line 172 | `schema: ` on a parameter |
| `reference-walker.ts:172` | `header.schema !== undefined` then recurse | `schema: ` on a header |
| `paths-and-components.ts:127` | `pathItem.$ref !== undefined \|\| countOperationsInPathItem(...) > 0` | `paths: { '/a': }` or `webhooks: { w: }` — **fires before anything else touches the path item; the file already guards `paths: null` at the map level (comment: "a document in the wild can carry `paths: null`") but not individual path items** |
| `paths-and-components.ts:404` | `oas.components !== undefined` | `components:` present but empty |
| `paths-and-components.ts:448` | `incomingSchemes !== undefined` then `Object.keys` | `securitySchemes: ` |
| `oas31.ts:82` | `getPathItemOperations`'s `operation !== undefined` filter | `get: `, `post: `, any HTTP method left blank — **this single gap is what lets a null operation reach both `ensureUniqueOperationId` and `walkOperationReferences`; fixing it here closes two crash sites with one change** |
| `external-references.ts:201` | `raw === undefined` (proposal 38, this week) | a pulled-in component left blank in the *external* document |

**Class C — bare `Object.keys`/property access on a map entry, no `TC.*` involved.** Same root cause, no dependency call in the middle:

| File : line | Code | A `null` here comes from |
| --- | --- | --- |
| `paths-and-components.ts:215` | `operation.operationId !== undefined` | (via `oas31.ts:82`'s gap) |
| `paths-and-components.ts:268` | `Object.keys(requirement)` | `security: [ ]` (a blank list item) |
| `paths-and-components.ts:316` | `pathItem['$ref']` | `components: { pathItems: { P: } }` |
| `paths-and-components.ts:319-320` | `Object.keys(callback)` then `callback[expression]` | `callbacks: { C: { expr: } }` |
| `reference-walker.ts:86,280-281,316` | `.startsWith`, `walkPathItemReferences(pathItem, ...)`, `pathItem['$ref']` | a blank discriminator mapping target; a blank callback path item; a blank `components.pathItems` entry |
| `prune-components.ts:50,57` (only reachable with `pruneUnusedComponents: true`) | `Object.keys(requirement)` | `security: [ ]` at top level or per-operation |
| `merge-path-items.ts:34,60` | `Object.keys(pathItem)`, `existing.$ref !== undefined` | latent only — `paths-and-components.ts:127` throws first on a null path item today; **fixing 127 without fixing these moves the crash rather than removing it** |

**And `TC.isReference`/`TC.isMediaTypeWithExamples`/`TC.isParameterWithSchema`/`TC.isHeaderWithSchema` direct calls** (the four `TC.*` functions this codebase actually calls — confirmed no other `TC.*`/`SwaggerTypeChecks.*` function is called anywhere in `packages/*/src`):

`reference-walker.ts:8,113,121,132,156,169,171,212,244,275` and `paths-and-components.ts:315` — eleven call sites, one per structural slot type (schema, example, media-type-with-examples, parameter, request body, header, link, response, callback — each reachable from `components.<bucket>` entries, `operation.*` entries, and nested `content`/`headers`/`responses`/`links` maps throughout).

**CLI-specific finding, `external-reference-discovery.ts:179`:** the walk over a *declared* input's own refs (`normalizeCrossDocumentRefs`, unconditional, issue #104's fix) runs with **no try/catch at all**. The walk over a *discovered* document's refs, two dozen lines later at line 218, **is** wrapped, and degrades to a `DiscoveryWarning` on failure. So today, the exact same crash is a soft warning for a file `resolveExternalReferences` pulled in, and an uncaught `ExitCode.ErrorUncaught` crash for a file the user declared directly — an inconsistency nobody designed, just an artifact of where a `try` happened to already exist.

### 2.4 What's *not* broken — the legality split that matters for §3

`null` is completely legal content in plenty of OpenAPI positions: `example: null`, `default: null`, an `enum` array containing `null`, an Example Object's `value: null`, OAS 3.1's `type: ['string', 'null']`. Every one of these was tested directly against the current code and **all pass cleanly** — they are only ever reached by `component-equivalence.ts`'s `deepEquality`, which is the one file already fixed for exactly this reason.

Every crash in §2.2/§2.3, by contrast, requires a `null` in a slot the specification requires to be an object (a Schema, a Response, a Parameter, an Operation...) or a string (`additionalProperties`, `defaultMapping`) — **technically invalid OpenAPI**. That distinction is the whole argument for §3.

## 3. Should this error, or be silently handled?

Two different situations hide inside "found a null where an object was expected," and — as already effectively decided by the code that's already shipped — they deserve different answers.

### 3a. A null nested *inside* an otherwise well-formed value, reached only by equality comparison

`component-equivalence.ts`'s already-shipped fix: fall through to `_.isEqual`, treat `null` as an ordinary comparable value. **Keep this. No change.** A stray `null` nested inside a schema being compared for dedup purposes doesn't need to become a hard failure — the worst outcome of "not quite right" here is a missed deduplication (safe, conservative), never a corrupted document.

### 3b. A null occupying a structural slot the merge is about to act on directly (§2.3's ~20 sites)

**Recommendation: error, loudly and specifically. Do not silently work around it.** Three options were available and all were rejected but the third:

- *Skip it silently* — any `$ref` elsewhere pointing at that slot now resolves to nothing, and the merged output looks valid but is broken. This is the exact "quiet-and-wrong beats loud-and-blocked" mistake proposal 39 §9.5 already argued against, for the same underlying reason: a merge that appears to succeed while silently dropping content is a worse failure mode than one that stops and says so.
- *Invent structure* (treat `null` as `{}`) — fabricates content the input never had. An empty Schema/RequestBody/Operation object is not obviously more correct than refusing, and would silently change what the merged document says.
- *Error, with a message that names the exact offending location* — **recommended.** This is a genuine authoring mistake (an empty YAML block), and the fix belongs in the source document. The bar to clear: as clear and specific as `ErrorType: 'operation-id-conflict'` already is today, never a raw stack trace into `node_modules`.

## 4. Proposed design

### 4.1 The Class B/C sites split into two groups, and they need different fixes

An earlier draft of this section proposed a single mechanical rule for every Class B/C site: change `!== undefined` to `!= null`. That rule is wrong for a subset of these sites, and wrong in the specific way §3b already argues against — it would make `getPathItemOperations` (`oas31.ts:82`) silently *filter the null operation out of its returned list* rather than fail on it. Trace the consequence for Repro 2 (`paths: { /a: { get: } }`): the null `get` operation is dropped, `/a` ends up with zero operations, `dropPathItemsWithNoOperations` (`paths-and-components.ts:389`) removes the path entirely, and `merge()` returns success — the path silently vanishes from the output instead of the crash it produces today. That is strictly worse than the status quo by this proposal's own §3b reasoning: a crash at least reveals that something happened.

The sites split into two groups:

**Group 1 — self-healing once §4.2 lands.** Most Class B sites guard entry into a recursive `walk*References` call whose *first* action is a `TC.*` check — `reference-walker.ts:11,19,25` (`not`/`allOf`/`oneOf`/`anyOf`), `:31` (`items`), `:42` (`additionalProperties`, Class A), `:119` (`mediaType.schema`), `:135` (`parameterOrRef.schema`), `:172` (`header.schema`). Even with the `!== undefined` guard left exactly as-is, a `null` here flows straight into `walkSchemaReferences(null, ...)`, whose first line is `TC.isReference(schema)` — once that call is the wrapped, pointer-carrying version from §4.2, it throws a precise `MalformedDocumentError` on its own. **No separate fix needed for these sites beyond §4.2 + §4.3 landing.**

**Group 2 — nothing downstream re-validates; needs its own explicit `required()` guard that errors.** These sites lead directly to unguarded property access or list membership with no intervening `TC.*` call to catch a `null`, so each needs its own call to §4.2's `required()` helper (or equivalent), and — per §3b — that guard must **throw**, not filter or skip, wherever skipping would silently drop content the merge would otherwise have looked at:

| Site | Why it must error, not skip |
| --- | --- |
| `oas31.ts:82` (`getPathItemOperations`) | Filtering drops the operation from the returned list, which cascades into the path being dropped entirely (traced above). Fix: `required(operation, pointer, 'an Operation Object')` inside the filter/map, not a filter predicate. |
| `paths-and-components.ts:127` (`pathItemHasContent`) | Same shape: whatever this decides gets fed into whether the path item is kept at all. Filtering silently drops the whole path or webhook. |
| `paths-and-components.ts:404` (`oas.components !== undefined`) | Changing to `!= null` would silently skip processing the input's entire `components` block — everything the input declared there disappears from the merge, unannounced. |
| `reference-walker.ts:107` (`discriminator.defaultMapping`) | No `TC.*` call in the chain — `.startsWith` is called directly. Needs its own guard. |
| `external-references.ts:201` (`raw === undefined`) | Different in kind — see the standalone fix below, not part of this sweep. |

`paths-and-components.ts:448` (`incomingSchemes`/`securitySchemes`) is a genuine edge case worth flagging rather than resolving by rule: unlike the rows above, nothing else in the document can `$ref` into a securityScheme that was never usably declared, so treating a `null` `securitySchemes` block the same as an absent one is arguably safe rather than a silent drop of *reachable* content. Recommend erring on the side of consistency with the rest of this table (error) unless implementation turns up a reason not to — but call this one out specifically in review rather than applying the same reasoning as the others by rote.

### 4.1a Standalone fix, independent of the rest of this proposal: `external-references.ts:201`

`raw === undefined` is the *only* check for "this pulled-in component doesn't have real content," and it misses `raw === null` — a component that's present but empty (`Errors:` with nothing after it) skips the existing `{ kind: 'unresolved' }` fallback and instead flows on toward a crash. The fix is narrower than anything else in this proposal: change the condition to `raw === undefined || raw === null` (or `raw == null`) so a null pulled-in component is treated exactly like a missing one — both already mean "nothing usable was found here," and today's code only handles one of the two spellings of that. This doesn't require §4.2/§4.3 to land first, doesn't change any error-vs-skip decision (both branches already lead to the existing, already-shipped "unresolved" handling), and is a one-line fix to code written this session. Worth landing on its own regardless of what happens to the rest of this proposal.

### 4.2 A shared, null-safe wrapper around the four `TC.*` functions this codebase calls

Rather than adding a null check at each of the eleven Class-`TC.*` call sites individually — which is exactly how this bug has recurred three times in one file already (§1) — introduce one small module, e.g. `packages/openapi-merge/src/safe-type-checks.ts`:

```ts
import { Swagger, SwaggerTypeChecks as TC } from '@atlassian/atlassian-openapi';

export class MalformedDocumentError extends Error {
  constructor(public readonly pointer: string, public readonly expected: string) {
    super(`Expected ${expected} at '${pointer}', found null -- this usually means an empty ` +
      `value in the source document (a YAML key with nothing written after it).`);
    this.name = 'MalformedDocumentError';
  }
}

function required<T>(value: T | null, pointer: string, expected: string): T {
  if (value === null) {
    throw new MalformedDocumentError(pointer, expected);
  }
  return value;
}

export function isReference(s: unknown, pointer: string): s is Swagger.Reference {
  return TC.isReference(required(s, pointer, 'a Reference or object'));
}
// ...isParameterWithSchema, isHeaderWithSchema, same shape.
```

`isMediaTypeWithExamples` needs a wider guard than `required()` gives the other three: §2.1 found it has **no `typeof` guard at all** (`'examples' in t`), so it throws not just on `null` but on `undefined` and every primitive (`5`, `'s'`, `true`). Its wrapper needs `typeof t !== 'object' || t === null` as the trigger for `MalformedDocumentError`, not just `=== null` — a narrower guard here would leave the widest hole in the dependency only partially closed.

Every `TC.isReference(x)` in `reference-walker.ts`/`paths-and-components.ts` becomes `isReference(x, pointer)`, where `pointer` is threaded through the walk (see §4.3). This closes all eleven Class-`TC.*` sites with one new ~30-line file and eleven import/call-site edits, and is the single highest-leverage change in this proposal: it also means any *future* call site added to `reference-walker.ts` gets the guard automatically, closing off the "recurring, unnoticed regression" failure mode that produced PRs #77, #97, and this proposal.

### 4.3 Pointer-threading, so the error names *where*, not just *that*

`reference-walker.ts`'s walk functions are `void` today — no location context exists to put in an error message. Three ways to fix that, from cheapest to most precise:

- **Option A — no pointer, input-level only.** Catch any thrown error at the two outer boundaries (`merge()` in `openapi-merge`, and `normalizeCrossDocumentRefs`/`discoverExternalDocuments` in the CLI) and wrap it as `"Input <N> could not be processed: <message>"`. Cheapest — no signature changes anywhere. Weakest: for a document with many components, "somewhere in input 0" is not much better than today.
- **Option B — typed exception + pointer threading (recommended).** Add a `pointer: string` parameter to each `walk*References` function, extended with its own path segment (`/properties/${key}`, `/responses/${key}`, ...) at each recursive call, and throw `MalformedDocumentError` (§4.2) with the accumulated pointer at the point of failure. Exceptions propagate automatically — no return-type changes needed anywhere in the call chain, unlike Option C. Precise (`"Input 0: expected a Schema Object at '#/components/schemas/Widget/properties/broken', found null"`), and matches an existing convention already in this codebase: `component-equivalence.ts`'s `isSchemaOrThrowError` already throws a plain `Error` from deep inside a walk for an analogous "could not resolve reference" failure, rather than threading a return value.
- **Option C — full `ErrorMergeResult`-return threading.** Change every `walk*References` function's return type from `void` to `ErrorMergeResult | undefined`, matching `paths-and-components.ts`'s *own* existing idiom for `ensureUniqueOperationIds` et al. (`if (result !== undefined) return result;` propagated by hand at every call site). Most invasive — touches every function signature in `reference-walker.ts` plus every caller in `paths-and-components.ts`, `external-references.ts`, and the CLI's `external-reference-discovery.ts`. Not obviously more correct than B, since B's thrown error is caught in exactly the same two places C's returned error would need to be checked, just without touching every intermediate signature.

**Recommendation: Option B**, for the same reason proposal 37 recommended "Option 2, refined" over the more invasive alternative it also documented — full precision, without a rewrite whose blast radius is largely mechanical plumbing rather than new capability.

### 4.4 The CLI-specific asymmetry (§2.3's `external-reference-discovery.ts` finding)

Once §4.2/§4.3 make this a typed, catchable `MalformedDocumentError` rather than an arbitrary uncaught `TypeError`, `external-reference-discovery.ts`'s two walk sites should be made to agree on purpose, not by accident:

- **A declared input's own malformed content (issue #104's unconditional walk, line ~179):** hard failure. The config author is responsible for what they declared — same posture as `inputRoot`'s hard-fail-on-violation for declared inputs (proposal 38 §2.4).
- **A discovered document's malformed content (issue #10's opt-in walk, line ~218):** stays a soft `DiscoveryWarning`, ref left unresolved, exactly as a missing or unparseable discovered file already is — the config author may not have authored the discovered document, matching the reasoning already established for that path.

This is not a new decision — it is making the *existing, accidental* split (§2.3) into a *designed* one, by replacing "whichever of these two calls happens to sit inside a `try`" with an explicit, typed catch at each.

### 4.5 Secondary, non-blocking: consider an upstream fix

`@atlassian/atlassian-openapi`'s own `isReference`/`matchesObjectShape`/`isMediaTypeWithExamples` (§2.1) are broken for *every* consumer of that package, not just this one. Worth raising as an issue or PR against that repository once §4.1-4.3 ship here — but this repo does not control that package's release cadence, so nothing here should depend on it landing. §4.2's local wrapper makes this repo's own safety independent of whether the upstream ever fixes it.

## 5. Non-goals

- **Full OpenAPI-document schema validation at load time** (ajv against the official 3.0/3.1 JSON Schema, rejecting non-compliant input before `merge()` ever sees it) would catch this and a great deal else, but only protects CLI callers — `openapi-merge` is also used as a library directly, by callers who hand it already-parsed objects with no `loadOasForInput` in between. Defensive null-safety inside the library itself (this proposal) protects both; document-level schema validation is a separate, larger idea worth its own proposal if it's wanted.
- **Retrofitting `component-equivalence.ts`'s already-correct behaviour.** §3a is settled; this proposal does not revisit it.
- **A blanket `try { merge(...) } catch { return genericError }` at the top of `merge()`.** Rejected: it would mask unrelated internal bugs as "malformed document" errors, and (per §4.3's Option A tradeoff) gives up exactly the location precision that makes this fix worth doing. Message-text matching to distinguish "the null bug" from "an actual internal bug" was also considered and rejected: the two runtimes this project explicitly supports word the same `TypeError` differently (confirmed directly — Node: `"Cannot use 'in' operator to search for '$ref' in null"`; Bun/JavaScriptCore: `"s is not an Object. (evaluating '\"$ref\" in s')"`), so matching on message text would be non-portable across exactly the two runtimes proposals 29/30 went to specific effort to support.

## 6. Testing plan

- One test per structural slot type in §2.3's Class-`TC.*` table (schema, example, media-type, parameter, request body, header, link, response, callback) — a `null` in that position produces a `MalformedDocumentError` (or its `ErrorMergeResult` equivalent) naming the pointer, never a raw `TypeError` — mirroring the thoroughness of `component-equivalence.test.ts`'s existing issue-#92 regression suite, which this proposal explicitly holds up as the bar to match everywhere else.
- One test per Class B/C site in §2.3's tables — same shape, confirming each specific `!== undefined` → `!= null` fix.
- The three repros from §2.2, each as an end-to-end CLI test: a whole component left empty, an empty operation, and a malformed *external* document pulled in via `resolveExternalReferences` — the last one specifically asserting the confusing double-failure from §2.2's Repro 3 no longer happens (one clear outcome, not a warning followed by a crash).
- A regression test locking in §4.4's declared-vs-discovered asymmetry as an intentional design, not an accident: a malformed declared input hard-fails; a malformed discovered document warns and leaves the ref unresolved, merge still succeeds.
- Confirm the fix is portable across both supported runtimes (proposal 29/30) — run the new tests under both Bun and Node, since §2.2 already found the underlying `TypeError`'s wording differs between them.

## 7. Disposition of the two open community PRs

- **Close #97** (superseded by the `isPresent()` fix already on `main`, and by this proposal's broader fix for everything #97 didn't touch) — comment linking the commit chain in §1 and this proposal.
- **Close #77** (same reasoning, older and narrower) — same comment.
