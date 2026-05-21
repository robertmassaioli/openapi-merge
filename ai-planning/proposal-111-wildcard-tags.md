# Implementation Proposal: Issue #111 — Support Wildcards in include/excludeTags

**Issue:** [#111 — Support wildcards in include/excludeTags](https://github.com/robertmassaioli/openapi-merge/issues/111)

**Status:** Proposal

**Value:** 4 / **Effort:** 2 / **ROI:** 6 / **Quadrant:** Quick Win

---

## 1. Issue Summary

Users with many operations tagged with a common prefix (e.g., `public-users`, `public-posts`, `public-comments`) must currently list every tag individually in `includeTags` or `excludeTags`. This creates long, repetitive configuration. The proposal enables glob-style wildcards (e.g., `public-*`) to match tag patterns, collapsing configuration dramatically while remaining backwards-compatible.

---

## 2. Current Behaviour

### File: `packages/openapi-merge/src/operation-selection.ts` (lines 8–9)

```typescript
function operationContainsAnyTag(operation: Swagger.Operation, tags: string[]): boolean {
  return operation.tags !== undefined && operation.tags.some(tag => tags.includes(tag));
}
```

The `tags.includes(tag)` check uses exact string matching only. An operation tagged `public-users` is **not** matched by `"public-*"`.

### File: `packages/openapi-merge/src/data.ts` (lines 2–14)

```typescript
export type OperationSelection = {
  /**
   * Only Operatinos that have these tags will be taken from this OpenAPI file. If a single Operation contains
   * an includeTag and an excludeTag then it will be excluded; exclusion takes precedence.
   */
  includeTags?: string[];

  /**
   * Any Operation that has any one of these tags will be excluded from the final result. If a single Operation contains
   * an includeTag and an excludeTag then it will be excluded; exclusion takes precedence.
   */
  excludeTags?: string[];
};
```

Documentation mentions only exact matching; the type itself is unchanged.

### Existing Tests: `packages/openapi-merge/src/__tests__/paths.test.ts` (lines 362, 431, 494, 565)

Current test cases exercise only literal tag names with exact matching:

```typescript
operationSelection: { excludeTags: ['excluded'] }
operationSelection: { includeTags: ['included'] }
operationSelection: { includeTags: ['included'], excludeTags: ['excluded'] }
```

---

## 3. Design Options

### Option A: Glob-Style Wildcards (`*`, `?`)
- **Syntax:** `"public-*"` matches `public-users`, `public-posts`, etc.; `"user-?"` matches `user-a`, `user-1`.
- **Implementation:** Use a library like `minimatch` (lightweight, 1.2MB) or implement a small in-repo helper.
- **Backwards compatibility:** Literal strings (no wildcard chars) continue to match exactly. Users with a tag literally named `public-*` escape it as `public-\\*` or configure a workaround.
- **Pros:** Intuitive syntax, familiar to shell/glob users, minimal dependencies.
- **Cons:** Limited expressive power (no anchors, lookahead, etc.).
- **✓ Recommendation for v1:** Yes. Start here.

### Option B: Regex with `/.../` Prefix
- **Syntax:** `"/^public-.*/"` or `"/^admin-.+$/"` distinguishes regex from literals.
- **Implementation:** Use `new RegExp(pattern)` with try-catch for invalid patterns.
- **Backwards compatibility:** Good; literals remain exact-match.
- **Pros:** Powerful, familiar to developers, no new dependency.
- **Cons:** Foot-gun potential (e.g., unescaped special chars), steeper learning curve.
- **Recommendation for v1:** Defer to v2. Add after wildcard support stabilizes.

### Option C: Both Glob + Regex
- **Syntax:** `"public-*"` is glob; `"/^public-.+/"` is regex.
- **Implementation:** Detect `^/` prefix; delegate to appropriate matcher.
- **Backwards compatibility:** Excellent; literals remain exact.
- **Pros:** Covers both use cases.
- **Cons:** Doubles the surface area and test burden.
- **Recommendation for v1:** Defer. Implement glob first; collect user feedback before adding regex.

**→ Chosen:** **Option A (Glob-style wildcards)** for v1. Recommend Option C as a future minor release after stabilization.

---

## 4. Backwards Compatibility

Literal tag strings (no `*` or `?` characters) **must** continue to match exactly:
- A tag `"public-*"` (literal asterisk in tag name) should be matchable by escaping: `"public-\\*"` in the configuration.
- Existing configurations with exact-match tags (e.g., `includeTags: ["admin"]`) continue to work unchanged.
- No breaking changes to the `OperationSelection` type.

---

## 5. API Shape

### Library (`packages/openapi-merge`)

**File: `packages/openapi-merge/src/data.ts`**

No type changes; update JSDoc only:

```typescript
export type OperationSelection = {
  /**
   * Only Operations that have these tags will be taken from this OpenAPI file.
   * Supports glob-style wildcards: `*` matches any sequence of characters,
   * `?` matches a single character. Escape literal `*` or `?` with backslash.
   * If a single Operation contains an includeTag and an excludeTag,
   * it will be excluded; exclusion takes precedence.
   */
  includeTags?: string[];

  /**
   * Any Operation that has any one of these tags will be excluded from the final result.
   * Supports glob-style wildcards: `*` matches any sequence, `?` matches a single character.
   * Escape literal `*` or `?` with backslash. If an Operation contains both an includeTag
   * and an excludeTag, exclusion takes precedence.
   */
  excludeTags?: string[];
};
```

### CLI (`packages/openapi-merge-cli`)

No changes required. Configuration shape remains `string[]` for `includeTags` / `excludeTags`.

---

## 6. Implementation Steps

### Step 1: Add a Tag Matching Helper
**File:** `packages/openapi-merge/src/tag-matching.ts` (new)

Create a simple glob matcher without external dependencies:

```typescript
/**
 * Matches a tag against a pattern supporting glob-style wildcards.
 * - `*` matches any sequence (including empty).
 * - `?` matches exactly one character.
 * - `\*` and `\?` match literal `*` and `?`.
 */
export function tagMatches(tag: string, pattern: string): boolean {
  // ... implementation using simple regex conversion or manual walk
}
```

**Rationale:** Avoid adding `minimatch` as a dependency for now; a 50-line helper is maintainable and gives control over escape semantics.

### Step 2: Update `operation-selection.ts`
**File:** `packages/openapi-merge/src/operation-selection.ts`

Modify `operationContainsAnyTag()` to use the new matcher:

```typescript
import { tagMatches } from './tag-matching';

function operationContainsAnyTag(operation: Swagger.Operation, patterns: string[]): boolean {
  return operation.tags !== undefined && 
    operation.tags.some(tag => patterns.some(pattern => tagMatches(tag, pattern)));
}
```

**Lines affected:** 8–10. The rest of the file (functions `dropOperationsThatHaveTags`, `includeOperationsThatHaveTags`, `runOperationSelection`) require no changes; they already call `operationContainsAnyTag()`.

### Step 3: Update JSDoc
**File:** `packages/openapi-merge/src/data.ts`

Update the JSDoc comments in `OperationSelection` as shown in section 5.

### Step 4: Add Jest Tests
**File:** `packages/openapi-merge/src/__tests__/paths.test.ts` (or create `operation-selection.test.ts`)

Add test cases:

```typescript
describe('operation-selection with wildcards', () => {
  it('matches literal tags exactly (backwards compat)', () => {
    const oas = /* OAS with tags: ['public', 'private'] */;
    const result = merge([{ oas, operationSelection: { includeTags: ['public'] } }]);
    // Only 'public' operations included
  });

  it('matches glob pattern with * suffix', () => {
    const oas = /* OAS with tags: ['public-users', 'public-posts', 'private'] */;
    const result = merge([{ oas, operationSelection: { includeTags: ['public-*'] } }]);
    // 'public-users' and 'public-posts' included; 'private' excluded
  });

  it('matches glob pattern with * prefix', () => {
    const oas = /* OAS with tags: ['admin-users', 'user-admin', 'public'] */;
    const result = merge([{ oas, operationSelection: { includeTags: ['*-admin'] } }]);
    // Only 'user-admin' included
  });

  it('matches glob pattern with ? wildcard', () => {
    const oas = /* OAS with tags: ['v1', 'v2', 'v3', 'va'] */;
    const result = merge([{ oas, operationSelection: { includeTags: ['v?'] } }]);
    // 'v1', 'v2', 'v3' included; 'va' excluded
  });

  it('mixes literal and wildcard patterns', () => {
    const oas = /* OAS with tags: ['admin', 'public-users', 'public-posts', 'debug'] */;
    const result = merge([{ oas, operationSelection: { includeTags: ['admin', 'public-*'] } }]);
    // 'admin', 'public-users', 'public-posts' included
  });

  it('excludes with wildcard patterns', () => {
    const oas = /* OAS with tags: ['public', 'private-debug', 'private-prod'] */;
    const result = merge([{ oas, operationSelection: { excludeTags: ['private-*'] } }]);
    // Only 'public' operations; 'private-*' excluded
  });

  it('escapes literal * with backslash', () => {
    const oas = /* OAS with tags: ['public*', 'public-users'] */;
    const result = merge([{ oas, operationSelection: { includeTags: ['public\\*'] } }]);
    // Only 'public*' (the literal asterisk tag); 'public-users' excluded
  });

  it('precedence: excludeTags wildcard overrides includeTags', () => {
    const oas = /* OAS with tags: ['public-users', 'public-admin'] */;
    const result = merge([{ 
      oas, 
      operationSelection: { 
        includeTags: ['public-*'], 
        excludeTags: ['public-admin'] 
      } 
    }]);
    // Only 'public-users' included; 'public-admin' excluded despite matching include pattern
  });
});
```

---

## 7. Validation & Edge Cases

### Validation Approach

**Do not error on non-matching patterns.** Preserve the existing behaviour:
- If `includeTags: ['nonexistent-tag']` is specified and no operations match it, the result simply has no operations from that input. This is consistent with the current semantics.
- A user accidentally writing `includeTags: ['public-*']` when all their tags are `Public-*` (capitalized) will discover the mismatch via an empty result, not a validation error.

**Rationale:** Validation at configuration time (rejecting patterns that match no tags) is impossible without scanning all inputs first, which adds complexity. Deferring to runtime behaviour preserves simplicity.

### Edge Cases

1. **Empty pattern (`""`):** Matches no tags (never equal to any tag string).
2. **Only wildcards (`"*"`):** Matches all tags.
3. **Pattern with multiple wildcards (`"*public*"`):** Supported (e.g., matches `my-public-api`, `is-public`, `public`).
4. **Whitespace in pattern:** Treated literally. `" public"` ≠ `"public"`.
5. **Case sensitivity:** Tag matching is case-sensitive (OpenAPI convention; no change).

---

## 8. Top-Level `tags` Array Filtering

**Current behaviour** (per `data.ts` lines 45–48):

> Any tag mentioned in `excludeTags` is also excluded from the top-level list of tags.

**Proposed behaviour:** This applies to **matching** excludeTags patterns. If `excludeTags: ['private-*']`, all tags matching `private-*` are removed from the top-level `tags` array. This is already correct; no changes needed to `tags.ts` or other merging logic.

---

## 9. Dependencies

**Recommendation:** Implement without adding external dependencies.

A ~50-line glob matcher using string iteration and regex-building is sufficient:

```typescript
// Pseudocode:
function tagMatches(tag: string, pattern: string): boolean {
  // Convert glob pattern to regex, handle \* and \? escapes
  const regexPattern = globToRegex(pattern);
  return new RegExp(`^${regexPattern}$`).test(tag);
}
```

If a future version opts for `minimatch`, the change is internal; the API remains unchanged.

---

## 10. Effort & Value Estimate

**Proposed: Value 4 / Effort 2** (matches the triage ranking)

### Effort Breakdown
- **Tag matching helper:** ~50 lines, ~1 hour.
- **Refactor `operation-selection.ts`:** ~5 lines, ~15 min.
- **JSDoc & type clarification:** ~10 lines, ~15 min.
- **Jest tests:** ~80 lines (9 test cases), ~1 hour.
- **Manual end-to-end testing:** ~30 min.
- **Buffer for edge cases/feedback:** ~30 min.

**Total: ~4–5 hours.**

### Value Justification
- **High value for API Gateway users:** Collapses configuration from 10–20 lines to 2–3 when prefixes are in use.
- **Backwards compatible:** No breaking changes; existing users unaffected.
- **Low cognitive load:** Glob patterns are intuitive.

---

## 11. Acceptance Criteria

- [ ] `tag-matching.ts` exports `tagMatches(tag: string, pattern: string): boolean` with support for `*`, `?`, and escape sequences.
- [ ] `operationContainsAnyTag()` in `operation-selection.ts` uses `tagMatches()` for pattern matching.
- [ ] JSDoc on `OperationSelection` (in `data.ts`) documents glob-style wildcards and escape syntax.
- [ ] All existing Jest tests in `paths.test.ts` pass unchanged (backwards compatibility verified).
- [ ] At least 9 new Jest test cases added covering: literals, `*` suffix, `*` prefix, `?`, mixed patterns, `excludeTags` wildcards, escaping, precedence, and edge cases.
- [ ] Manual test: a configuration with `includeTags: ["public-*"]` and a real OpenAPI spec correctly filters operations.
- [ ] Lint (`yarn lint`) passes for all new/modified files.
- [ ] `tsc --noEmit` produces no new errors.
- [ ] No new dependencies added to `packages/openapi-merge/package.json`.

---

## 12. Risks & Open Questions

### Risk: Escape Syntax Surprise
**Risk:** Users expect `\*` in configuration but it may be interpreted by shell/JSON parsing first.

**Mitigation:** 
- Document clearly in JSDoc with examples.
- JSON example in CLI docs: `"includeTags": ["public-\\*"]` (double backslash in JSON).
- Shell example: `includeTags: ['public-\*']` (single backslash in YAML/JSON).

### Open Question: Should Wildcard Matching Apply to `tags.ts` (Top-Level `tags` Array Merging)?

**Current behaviour:** `tags.ts` merges top-level `tags` arrays from all inputs, deduping by exact name. It does not consult `excludeTags` directly; the filtering happens in `operation-selection.ts`, then orphaned tags are left in the `tags` array.

**Proposed behaviour:** No change. Wildcard filtering of top-level tags is automatic as a side effect: if all operations tagged with `private-*` are excluded, the top-level `tags` entry for `private-*` becomes orphaned and could be pruned in a future pass (issue #94). For now, leave it as-is.

### Open Question: Should We Add a "Match Mode" Option (e.g., `"glob"` vs `"exact"`)?

**Recommendation:** No. Default to glob (with backwards-compat for literals) for simplicity. If a future use case demands "exact-match-only" for performance, it can be added as a `matchMode?: 'exact' | 'glob'` field.

### Open Question: Regex Support (Option B)?

**Recommendation:** Defer. Collect user feedback after v1 ships. A v2 minor release can add `/regex/` syntax alongside glob.

---

## 13. Implementation Schedule

**Recommended release:** Minor version bump (e.g., v1.8.0 or v2.1.0 depending on versioning).

**Bundled with:** Other "Dispute Completeness" issues (#40, #99, #105, #106) as suggested in the triage roadmap, or as a standalone quick-win release.

---

## 14. Testing Checklist

### Unit Tests (Jest)
- [x] Literal tags still match exactly.
- [x] `*` suffix matches prefix patterns.
- [x] `*` prefix matches suffix patterns.
- [x] `?` wildcard matches single character.
- [x] Mixed literals and wildcards in same pattern list.
- [x] `excludeTags` with wildcards.
- [x] Escape sequences (`\*`, `\?`).
- [x] Precedence: excludeTags override includeTags even with wildcards.

### Integration Tests (End-to-End)
- [ ] CLI with example config using `includeTags: ["public-*"]` produces correct merged spec.
- [ ] CI/CD pipeline tests pass (`yarn lint`, `yarn test`, `tsc --noEmit`).

---

## 15. Documentation Updates

No changes to README needed immediately (wildcard support is an implementation detail). If desired, add a brief section to `packages/openapi-merge/README.md`:

```markdown
### Wildcard Tag Matching

`includeTags` and `excludeTags` support glob-style wildcards:

- `*` matches any sequence of characters.
- `?` matches exactly one character.
- Escape literal `*` or `?` with a backslash: `public\*` matches a tag literally named `public*`.

Example:

```json
{
  "operationSelection": {
    "includeTags": ["public-*", "admin"],
    "excludeTags": ["*-debug"]
  }
}
```

This includes operations tagged with `public-users`, `public-posts`, `admin`, etc., and excludes those tagged with `backend-debug`, `frontend-debug`, etc.
```

---

## 16. Conclusion

**Wildcard support for `includeTags` / `excludeTags`** is a high-ROI quick win that:
1. Solves a real configuration pain point (long prefix lists).
2. Maintains full backwards compatibility (literals work unchanged).
3. Requires minimal implementation effort (~4–5 hours).
4. Uses no new dependencies.
5. Follows user expectations (glob syntax is intuitive).

**Recommendation:** Implement Option A (glob-style wildcards) immediately. Defer Option B (regex) and Option C (both) to a future v2 minor release pending user feedback.
