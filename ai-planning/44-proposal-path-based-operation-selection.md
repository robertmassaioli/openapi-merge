# Proposal 44: Path-based operation selection, as an alternative to `includeTags`/`excludeTags`

**Status:** ✅ Implemented (Option B). See §8 for what was actually built.

**Triggered by review of [PR #67](https://github.com/robertmassaioli/openapi-merge/pull/67)** ("include and exclude based on paths"), at Robert's request: the underlying feature isn't implemented anywhere on `main`, and the specific PR isn't adoptable as-is (see §2) — this proposes several different shapes the feature could actually take.

## 1. The problem, and why `includeTags`/`excludeTags` doesn't already solve it

`operationSelection.includeTags`/`excludeTags` (`packages/openapi-merge/src/data.ts`) is the only way to select a subset of an input's operations today. PR #67's thread has Robert asking exactly the right question — "why not just tag/untag the operations you want?" — and getting two independent answers that hold up:

- **Two services can legitimately share a tag.** The PR's own example: an `admin` service and a `customer` service both tag their login-related operations `Login`, but only `account/login` should survive from `admin` while `account/get-customer` should not. Both operations carry the same tag; only path distinguishes them.
- **Not every input's tags are under the merge author's control.** A second commenter (`Fimeo`) reports generating their OpenAPI documents from a toolchain that doesn't let them customise operation tags at all — `includeTags`/`excludeTags` is simply unusable for that input, regardless of how the config is written.

Both are asking for the same missing primitive: select operations by where they live in the document (path, and optionally method), not only by what they're tagged.

## 2. Why PR #67 itself isn't adoptable as-is

- **Path matching is prefix regex, unescaped and unanchored at the end**: `new RegExp('^' + pathConfig.path)`. A config entry `{ path: '/user' }` also matches `/users` and `/user-profile` — nothing marks the intended path as fully matched. A path containing a literal `.` (plausible: `/v1.2/status`) is interpreted as "any character," matching things the author never wrote.
- **No tests** — none of the four combinations (include/exclude × standalone/combined-with-tags) are exercised.
- **Architecturally behind current `main`.** It predates `getPathItemOperations` (the shared abstraction every operation-bearing construct — standard methods, 3.2's `query`, `additionalOperations` — now goes through) and predates `TagMatcher` (issue #111's wildcard matcher, added specifically to fix an *identical* complaint about `includeTags`/`excludeTags` needing exact enumeration). Landing PR #67 today would mean rewriting most of it against the current shape of `operation-selection.ts` anyway — see §5, this turns out to be cheap.

None of that changes whether the feature is worth having — it clearly is (§1) — only that this PR isn't the way to get it.

## 3. Design options

All five share the same two structural questions, answered once here rather than per-option:

- **When does path selection run, relative to `pathModification`?** `runOperationSelection` runs on each input's own clone, before `pathModification` is applied (`paths-and-components.ts`: `dropPathItemsWithNoOperations(runOperationSelection(_.cloneDeep(originalOas), operationSelection))`, and `pathModification` is applied later, per survivor, inside the main per-input loop). A config entry for a given input must therefore be written against **that input's own original path spelling** — before any `stripStart`/`prepend` — not the path it will have in the merged output. PR #67 doesn't mention this at all; any implementation needs to say so explicitly, in the same place `pathModification` is documented, or an author will write a rule that silently matches nothing.
- **How does path selection combine with `includeTags`/`excludeTags` on the same input?** Two separate questions, only one of which has a precedent to lean on. *Exclude-by-path vs. exclude-by-tag*: `excludeTags` already documents "exclusion takes precedence" when an operation matches both an include and an exclude *tag* rule — extending that same precedence so an operation excluded by either path or tag is excluded, full stop, is a direct extension of an existing rule. *Include-by-path vs. include-by-tag*, when both are configured on the same input, is a genuinely new decision with no existing precedent in this codebase — `includeTags` and `excludeTags` are an include-then-exclude pair, not two include lists, so nothing today answers "what happens when two different *kinds* of include list are both configured." Recommend **both must pass** (an operation must clear every include list configured, of every kind, not just one) on its own merits: an include list's whole purpose is to narrow what survives, and a second, independently-configured include list that could be satisfied by clearing only the first would make the second one a no-op for any operation that already passed it — silently. Worth a dedicated test regardless of which way this is decided, since it's the one place two independently-simple mechanisms produce a result that isn't obvious from either alone.

### Option A — Exact match allow/deny list

```ts
includePaths?: Array<{ path: string; method?: HttpMethod | HttpMethod[] }>;
excludePaths?: Array<{ path: string; method?: HttpMethod | HttpMethod[] }>;
```

`path` matched by exact string equality against a path key in `oas.paths`/`oas.webhooks`. `method` omitted means every method on that path. Simplest possible implementation and the easiest to reason about (a config author can grep the input file for the exact string they wrote), but does not scale to "everything under `/admin/*`" — an input with fifty admin-prefixed paths needs fifty entries, and adding a fifty-first path silently isn't covered by either list unless someone remembers to add it. That's the exact failure mode issue #111 already fixed for tags (forgetting to update an enumerated list silently changes what's selected); repeating it here for paths would be a regression in kind, not just a missing feature.

### Option B — Wildcard pattern match, reusing `TagMatcher`'s exact design (recommended)

Same shape as Option A, but `path` accepts `*` as "any run of characters" — precisely `tag-matching.ts`'s existing `TagMatcher`/`patternToRegExp` (escape everything, then reinstate `*`, anchor both ends). `{ path: '/admin/*' }` covers every current and future admin path in one line; `{ path: '/admin/users', method: 'get' }` covers PR #67's exact motivating case with no wildcard needed.

This is the recommendation, for three reasons:

- It fixes PR #67's actual bug (§2's regex-escaping/unanchored-prefix problem) by construction — `*` is the only metacharacter, everything else in a path is matched literally, and the match is anchored at both ends, not just the start.
- It's the same mental model `includeTags`/`excludeTags` already teach — an author who has used one wildcard list already knows how the other one behaves. A `PathMatcher` here would either wrap `TagMatcher` directly (if this can be generalised to "matcher over a string" without change) or duplicate roughly 20 lines from `patternToRegExp`/the class it drives, if it needs its own type for the `{ path, method }` shape.
- Cheap to build on the current architecture. `removeOperations` (`operation-selection.ts`) is already a generic "remove every operation for which `shouldRemove` holds, across `paths` and `webhooks`, covering every 3.1/3.2 operation slot" helper — a path-based predicate plugs into exactly the same function `dropOperationsThatHaveTags`/`includeOperationsThatHaveTags` already use; no new traversal code, no new webhook/`additionalOperations` handling to get right a second time.

### Option C — Path-template–aware matching (a possible addition to B, not a replacement)

A different axis entirely: OpenAPI paths carry their own parameter templating (`/users/{id}`), and two services merged together may describe structurally-identical routes with differently-named parameters (`/users/{id}` vs. `/users/{userId}`). Exact-string matching (A) and literal-wildcard matching (B) both treat these as unrelated strings. A template-aware option would match on path *shape* — segment count and which segments are literal vs. parameterised — ignoring the parameter's chosen name.

This solves a real but different problem (multiple services' inconsistent parameter naming) than what PR #67's thread asked for (excluding one specific operation), and is meaningfully more code: normalising a path template into a comparable shape, deciding what "matches" means when one side has `{id}` and the other has a literal path segment, and documenting the result clearly enough that a config author isn't surprised by it matching more than they wrote. Worth keeping in mind if template-naming mismatches come up as their own request, but not needed to satisfy PR #67, and not recommended as part of this proposal's initial scope.

### Option D — Auto-derive tags from paths, extend nothing new (not recommended)

Instead of a second selection mechanism, inject a synthetic tag per path (or path segment) during merge, and let `includeTags`/`excludeTags` (already wildcarded, already tested) select against those. Zero new config surface, zero new matcher code.

Rejected: it works by changing what the *document* looks like (adding tags nobody wrote) to make an *existing* mechanism apply, rather than adding the primitive that was actually asked for. A config author reading `includeTags: ['__path:/admin/*']` has to know this tool invented that string; the two motivating cases in §1 both describe wanting to select by path directly, not by a path-shaped tag. It also collides with any tag an input already declares that happens to share a name with a synthetic one.

### Option E — Generic selector (JSON Pointer / JSONPath into the document) (future direction, not now)

The most general shape: `select`/`exclude` rules as JSONPath-style expressions against the parsed document, subsuming path, method, tag, operationId, and anything else someone eventually wants to filter on, in one mechanism.

Explicitly not recommended for this proposal. Every concrete request seen so far (this PR, `includeTags`/`excludeTags` itself, issue #111's wildcard fix) has been narrow and specific; a query language is a large surface to design, document and keep predictable (what happens when a pattern is malformed? What's the performance/complexity story for an input with thousands of operations?) for a need nobody has actually described yet. Worth remembering as the eventual shape *if* selection keeps growing new independent axes one at a time — not worth building ahead of that.

## 4. Recommendation

**Option B**, for the reasons in §3: it fixes PR #67's real bug, matches an idiom this config already teaches (`TagMatcher`'s wildcard, from issue #111), and costs little to build against the current `operation-selection.ts`/`getPathItemOperations` architecture. Keep §3's two structural answers (runs pre-`pathModification`; combines with tag rules as an additional required filter, exclusion still wins within each kind) as explicit, tested behaviour rather than something a user has to discover.

Option C is worth designing later if path-template-naming mismatches come up as their own request; Option D is actively worse than doing nothing; Option E is the right shape only once several independent selection axes exist and enumerating them all is itself the pain point, which is not where this tool is today.

## 5. Non-goals

- **Changing `TagMatcher`'s behaviour or issue #111's resolution.** Cited as precedent, not reopened. (Its wildcard-to-regex logic was extracted into a shared `wildcard-matching.ts` module so `PathMatcher` could reuse it without duplication — `TagMatcher`'s public API, class shape, and matching behaviour are unchanged, proven by `tag-matching.test.ts` passing unmodified. See §8.)

## 6. Testing plan

- Wildcard/exact matching unit tests mirroring `tag-matching.test.ts`'s coverage of `TagMatcher`, including a path containing a regex metacharacter (`.`, `+`, `(`) matched literally.
- `includePaths` alone, `excludePaths` alone, and both together on the same input (exclusion wins on overlap, matching `includeTags`/`excludeTags`'s documented precedent).
- Combined with `includeTags`/`excludeTags` on the same input: an operation must clear both kinds of include rule; excluded by either kind is excluded.
- 3.1 `webhooks` and 3.2 `query`/`additionalOperations` are covered by the same rules as standard methods (already true by construction if built on `removeOperations`/`getPathItemOperations` — a regression test locks it in rather than assuming it).
- A rule written against a path's *pre*-`pathModification` spelling behaves as documented; a rule written against the *post*-modification spelling does not silently match (proves the ordering in §3 is real, not just described).

## 7. Recommendation for PR #67 (Robert's call, not executed by this proposal)

Not mergeable as written (§2). Whether to close it now with a comment pointing at this proposal, or leave it open referencing it, is a judgement call about community-PR bookkeeping rather than a technical one.

## 8. What was actually built

Option B, matching this proposal, with three deviations worth recording:

- **`method` is typed `string | ReadonlyArray<string>`, not `HttpMethod | HttpMethod[]`.** `getPathItemOperations` also covers 3.2's `additionalOperations`, which carries arbitrary custom verbs (e.g. `PURGE`) that a closed `HttpMethod` union can't express. Matching is case-sensitive, consistent with existing custom-verb handling in `merge-path-items.ts`. One consequence: standard methods are stored lowercase in a parsed document, so a selector must be written `{ method: 'get' }`, not `'GET'` — documented in the CLI README.
- **The wildcard-to-regex primitive was extracted to `packages/openapi-merge/src/wildcard-matching.ts`**, and `tag-matching.ts` now imports it instead of defining its own copy. This keeps one implementation of a security-relevant escaping routine rather than two that could drift; `TagMatcher`'s public API and behaviour are unchanged (its existing test suite passes without modification).
- **`includePaths` on a document with 3.1 `webhooks` drops every webhook operation whose event name doesn't happen to match a path selector** (webhook event names essentially never look like `/admin/*`). This is the same allow-list semantics `includeTags` already has for untagged webhooks, not a new inconsistency, but it's easy to trip over — pinned with an explicit test and called out in the README.

Composition (§3's two structural answers) and pre-`pathModification` matching (§6) are implemented and regression-tested as specified, with no deviation.

Implementation: `packages/openapi-merge/src/{wildcard-matching,path-matching,tag-matching,data,index,operation-selection}.ts` and mirrored CLI-side types/schema/`init`/README in `packages/openapi-merge-cli/src/`. 479 tests passing in `openapi-merge` (100% coverage on the two new files), 260 in `openapi-merge-cli`, lint and typecheck clean in both packages.
