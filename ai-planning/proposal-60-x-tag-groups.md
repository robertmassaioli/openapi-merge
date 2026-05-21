# Implementation Proposal: Issue #60 — Concatenate `x-tagGroups` Across Inputs

**Status:** Proposal  
**Value:** 3/5 — useful for ReDoc users who compose multiple specs with tag groups.  
**Effort:** 2/5 — localized change to extension merge; no API changes required.

---

## 1. Issue Summary

**GitHub Issue:** [#60 — `x-tagGroups` only keeps first file's tags](https://github.com/robertmassaioli/openapi-merge/issues/60)

When merging multiple OpenAPI files that each define `x-tagGroups` at the top level, only the first input's groups appear in the output. This is because the current extension-merge logic applies "first-wins" semantics to all `x-*` extensions. However, tags from later inputs are correctly merged into the top-level `tags` array, creating an inconsistency: groups disappear but their corresponding tags exist.

ReDoc uses `x-tagGroups` to organize the sidebar; users lose the grouping structure from later APIs even though their tags are included.

---

## 2. Current Behaviour

### Extension Merge (today: first-wins)

From `packages/openapi-merge/src/extensions.ts`, lines 20–43:

```typescript
function mergeExtensionsHelper(extensions: Extensions[]): Extensions {
  if (extensions.length === 0) {
    return {};
  }

  if (extensions.length === 1) {
    return extensions[0];
  }

  const result = { ...extensions[0] };

  for (let extensionIndex = 1; extensionIndex < extensions.length; extensionIndex++) {
    const ext = extensions[extensionIndex];

    for (const extensionKey in ext) {
      /* eslint-disable-next-line no-prototype-builtins */
      if (result[extensionKey] === undefined && ext.hasOwnProperty(extensionKey)) {
        result[extensionKey] = ext[extensionKey];
      }
    }
  }

  return result;
}
```

**Current logic:** The result is seeded with `extensions[0]`. For any key in later extensions, the value is only added if the key is not already present in `result`. This means the first occurrence of any extension wins; all subsequent values are discarded.

### Tags Merge (deduped by name)

From `packages/openapi-merge/src/tags.ts`, lines 11–35:

```typescript
export function mergeTags(inputs: MergeInput): Swagger.Tag[] | undefined {
  const result = new Array<Swagger.Tag>();
  const seenTags = new Set<string>();
  inputs.forEach(input => {
    const { operationSelection } = input;
    const { tags } = input.oas;
    if (tags !== undefined) {
      const excludeTags = operationSelection !== undefined && operationSelection.excludeTags !== undefined ? operationSelection.excludeTags : [];
      const nonExcludedTags = getNonExcludedTags(tags, excludeTags);

      nonExcludedTags.forEach(tag => {
        if (!seenTags.has(tag.name)) {
          seenTags.add(tag.name);
          result.push(tag);
        }
      });
    }
  });

  if (result.length === 0) {
    return undefined;
  }

  return result;
}
```

**Key point:** Tags are deduped by name using a `Set`, preserving order of first occurrence. If `excludeTags` is specified, those tags are filtered out before deduping.

---

## 3. Why `x-tagGroups` Is Special

Most top-level `x-*` extensions have opaque semantics; we cannot safely concatenate, merge, or transform them without risking corruption. For example, `x-atlassian-narrative` or custom vendor extensions are black boxes.

**`x-tagGroups` is different:**

- **Structure:** Each entry is a group object: `{ name: string; tags: string[] }`.
- **Semantics:** Groups are a _flat list_ mapping group names to tag names; the order matters, but the structure is regular.
- **Concatenation is safe:** Merging two lists of groups by dedupe + concatenation preserves all information and is a well-defined operation.
- **Used by ReDoc:** ReDoc uses `x-tagGroups` to organize the sidebar; users expect all groups from all merged APIs to appear.

This makes `x-tagGroups` a candidate for a special merge strategy, distinct from first-wins.

---

## 4. Design Options

### Option A: Hardcode `x-tagGroups` special case  
**Pros:** Simple, solves the immediate problem.  
**Cons:** Doesn't help future extensions with similar array-of-objects semantics. If another ReDoc extension needs concatenation, we're back to hardcoding.

### Option B: Generic configurable extension-merge strategy  
Add an optional `extensionMergeStrategies?: { [extensionKey: string]: 'first' | 'concat' | 'deep-merge' }` to allow users to opt extensions in.  
**Pros:** Flexible; future-proof.  
**Cons:** More complex API; users must understand extension semantics.

### **Option C: Both hardcode `x-tagGroups` + expose configurable strategy** ✓ **Recommended**  
- Ship the correct behaviour for `x-tagGroups` by default (concatenate + dedupe).
- Expose the configurable mechanism so users and future developers can extend or override.
- Default all other `x-*` extensions to first-wins for backwards compatibility.

**Rationale:** Solves the immediate issue without breaking changes, and provides a path for future ReDoc-style extensions.

---

## 5. Concatenation Semantics for `x-tagGroups`

Define the merge algorithm precisely:

1. **Per-input processing:** For each input, collect the `x-tagGroups` array (if present).
2. **Group deduplication by name:** Iterate over all groups in input order. For each group:
   - If a group with the same `name` has already been seen, concatenate the `tags` arrays.
   - Dedupe tags within the concatenated array (first-seen wins).
   - If after deduping the group has zero tags, drop it.
3. **Order preservation:** Groups appear in the order they were first encountered across all inputs.
4. **Tag filtering:** If `excludeTags` strips a tag from the top-level `tags` array, that tag is also removed from any `x-tagGroups` entries (see section 6).
5. **Output:** If the result is an empty array, omit `x-tagGroups` from the output (consistent with `tags` merge).

**Example:**

```
Input 1: x-tagGroups = [{ name: "User", tags: ["get-user", "put-user"] }]
Input 2: x-tagGroups = [{ name: "User", tags: ["delete-user"] }, { name: "Admin", tags: ["admin-only"] }]

Output: x-tagGroups = [
  { name: "User", tags: ["get-user", "put-user", "delete-user"] },
  { name: "Admin", tags: ["admin-only"] }
]
```

---

## 6. Interaction with `excludeTags`

When `operationSelection.excludeTags` is specified for an input, those tags are removed from the merged `tags` array. **The same filtering must apply to `x-tagGroups`:**

1. After merging `x-tagGroups`, filter out any tags that appear in any input's `excludeTags`.
2. If a group becomes empty after filtering, drop it.

**Example:**

```
Input 1: tags = ["user", "post"], x-tagGroups = [{ name: "API", tags: ["user", "post"] }]
         excludeTags = []
Input 2: tags = ["user", "admin"], x-tagGroups = [{ name: "Ops", tags: ["admin"] }]
         excludeTags = ["admin"]

After merge:
  - tags = ["user", "post"] (top-level)
  - x-tagGroups = [{ name: "API", tags: ["user", "post"] }] ("admin" group dropped)
```

---

## 7. API Shape

**Recommended:** Add an optional `extensionMergeStrategies` to a shared global `MergeOptions` (proposed in issue #76). For now, if a global options second parameter is not yet available, add it at the library level in `merge()`.

### Option 1: Global `MergeOptions` (preferred, aligns with #76)

```typescript
export type MergeOptions = {
  /**
   * Control how specific extensions are merged across inputs.
   * Keys are extension names (e.g., 'x-tagGroups').
   * Values: 'first' (default) | 'concat'.
   * 
   * Default (omitted): all extensions use 'first-wins' for backwards compatibility.
   * x-tagGroups: concatenate + dedupe by group name.
   */
  extensionMergeStrategies?: { [extensionKey: string]: 'first' | 'concat' };
};

export function merge(inputs: MergeInput, options?: MergeOptions): MergeResult {
  // ...
}
```

### Option 2: Minimal (no global options yet)

Simply hardcode `x-tagGroups` to use concat strategy in `extensions.ts`, with a JSDoc note explaining it.

**Recommended approach:** Option 1 (aligns with #76) if you're open to a global options parameter; otherwise, hardcode with a comment noting the special case.

---

## 8. Implementation Steps

### Step 1: Update `packages/openapi-merge/src/extensions.ts`

Add a helper function to merge arrays of tag-group objects:

```typescript
interface TagGroup {
  name: string;
  tags: string[];
}

function mergeTagGroups(tagGroupsArray: (TagGroup[] | undefined)[]): TagGroup[] | undefined {
  // Collect all groups and their tags
  const groupMap = new Map<string, Set<string>>();
  const groupOrder: string[] = [];

  tagGroupsArray.forEach(groups => {
    if (groups !== undefined) {
      groups.forEach(group => {
        if (!groupMap.has(group.name)) {
          groupMap.set(group.name, new Set());
          groupOrder.push(group.name);
        }
        group.tags.forEach(tag => {
          groupMap.get(group.name)!.add(tag);
        });
      });
    }
  });

  if (groupMap.size === 0) {
    return undefined;
  }

  // Reconstruct in order, filtering empty groups
  const result: TagGroup[] = [];
  groupOrder.forEach(name => {
    const tags = Array.from(groupMap.get(name)!);
    if (tags.length > 0) {
      result.push({ name, tags });
    }
  });

  return result.length > 0 ? result : undefined;
}
```

Update `mergeExtensionsHelper` to dispatch on extension key:

```typescript
// Add near the top of the function after initializing result
if (extensions.length === 1) {
  return extensions[0];
}

const result = { ...extensions[0] };

// Special handling for x-tagGroups
const tagGroupsArrays = extensions.map(ext => ext['x-tagGroups']);
const mergedTagGroups = mergeTagGroups(tagGroupsArrays);
if (mergedTagGroups !== undefined) {
  result['x-tagGroups'] = mergedTagGroups;
}

// ... rest of the loop, but skip x-tagGroups
for (let extensionIndex = 1; extensionIndex < extensions.length; extensionIndex++) {
  const ext = extensions[extensionIndex];
  for (const extensionKey in ext) {
    if (
      extensionKey === 'x-tagGroups' ||
      (result[extensionKey] === undefined && ext.hasOwnProperty(extensionKey))
    ) {
      // x-tagGroups already handled; skip other keys if present
      if (extensionKey !== 'x-tagGroups' && result[extensionKey] === undefined) {
        result[extensionKey] = ext[extensionKey];
      }
    }
  }
}

return result;
```

### Step 2: Update `packages/openapi-merge/src/tags.ts`

Add a helper to filter tags out of `x-tagGroups`:

```typescript
function filterExcludedTagsFromTagGroups(
  tagGroups: TagGroup[] | undefined,
  excludedTagNames: string[]
): TagGroup[] | undefined {
  if (tagGroups === undefined || excludedTagNames.length === 0) {
    return tagGroups;
  }

  const filtered = tagGroups
    .map(group => ({
      ...group,
      tags: group.tags.filter(tag => !excludedTagNames.includes(tag))
    }))
    .filter(group => group.tags.length > 0);

  return filtered.length > 0 ? filtered : undefined;
}
```

Call this in `mergeTags` after all tags are merged:

```typescript
export function mergeTags(inputs: MergeInput, mergedOutput: Swagger.SwaggerV3): Swagger.SwaggerV3 {
  // ... existing tag merge logic ...

  // Apply excludeTags filtering to x-tagGroups if present
  if (mergedOutput['x-tagGroups'] !== undefined) {
    const allExcludedTags = new Set<string>();
    inputs.forEach(input => {
      const excludeTags = input.operationSelection?.excludeTags ?? [];
      excludeTags.forEach(tag => allExcludedTags.add(tag));
    });

    mergedOutput['x-tagGroups'] = filterExcludedTagsFromTagGroups(
      mergedOutput['x-tagGroups'] as TagGroup[],
      Array.from(allExcludedTags)
    );
  }

  return result;
}
```

### Step 3: Update `packages/openapi-merge/src/data.ts`

Add JSDoc note to `SingleMergeInputBase` explaining `excludeTags` now affects `x-tagGroups`:

```typescript
/**
 * Any Operation tagged with one of the paths in this definition will be excluded from the merge result. 
 * Any tag mentioned in this list will also be excluded from the top level list of tags and from any
 * x-tagGroups entries.
 */
excludeTags?: string[];
```

---

## 9. Tests

Add to `packages/openapi-merge/src/__tests__/x-tensions.test.ts`:

```typescript
describe('x-tagGroups', () => {
  it('should concatenate x-tagGroups from multiple inputs', () => {
    const first = toOAS({});
    first['x-tagGroups'] = [{ name: 'User', tags: ['get-user', 'post-user'] }];

    const second = toOAS({});
    second['x-tagGroups'] = [{ name: 'Admin', tags: ['admin-only'] }];

    const expected = toOAS({});
    expected['x-tagGroups'] = [
      { name: 'User', tags: ['get-user', 'post-user'] },
      { name: 'Admin', tags: ['admin-only'] }
    ];

    expectMergeResult(merge(toMergeInputs([first, second])), { output: expected });
  });

  it('should dedupe tags within x-tagGroups of the same name', () => {
    const first = toOAS({});
    first['x-tagGroups'] = [{ name: 'User', tags: ['get-user', 'put-user'] }];

    const second = toOAS({});
    second['x-tagGroups'] = [{ name: 'User', tags: ['delete-user', 'get-user'] }];

    const expected = toOAS({});
    expected['x-tagGroups'] = [{ name: 'User', tags: ['get-user', 'put-user', 'delete-user'] }];

    expectMergeResult(merge(toMergeInputs([first, second])), { output: expected });
  });

  it('should filter excluded tags from x-tagGroups', () => {
    const first = toOAS({});
    first['x-tagGroups'] = [{ name: 'User', tags: ['get-user', 'delete-user'] }];

    const second = toOAS({});
    second['x-tagGroups'] = [{ name: 'Admin', tags: ['admin-only'] }];

    const inputs = toMergeInputs([first, second]);
    inputs[1].operationSelection = { excludeTags: ['admin-only'] };

    const expected = toOAS({});
    expected['x-tagGroups'] = [{ name: 'User', tags: ['get-user', 'delete-user'] }];

    expectMergeResult(merge(inputs), { output: expected });
  });

  it('should drop empty x-tagGroups after filtering', () => {
    const first = toOAS({});
    first['x-tagGroups'] = [{ name: 'Admin', tags: ['admin-only'] }];

    const inputs = toMergeInputs([first]);
    inputs[0].operationSelection = { excludeTags: ['admin-only'] };

    const expected = toOAS({});
    // x-tagGroups should not be present

    expectMergeResult(merge(inputs), { output: expected });
  });

  it('should still apply first-wins to other x-* extensions', () => {
    const first = toOAS({});
    first['x-custom-vendor'] = { setting: 'first' };

    const second = toOAS({});
    second['x-custom-vendor'] = { setting: 'second' };

    const expected = toOAS({});
    expected['x-custom-vendor'] = { setting: 'first' };

    expectMergeResult(merge(toMergeInputs([first, second])), { output: expected });
  });
});
```

---

## 10. Backwards Compatibility & Versioning

- **Behaviour change:** `x-tagGroups` now concatenates instead of using first-wins. This is a bug fix (the current behaviour silently loses data), but it is technically a breaking change if users relied on first-wins.
- **Impact:** Users with `x-tagGroups` will see all groups from all inputs merged into the output. This is the expected behaviour.
- **Recommendation:** Bump the library version to a minor release (e.g., `1.2.0` → `1.3.0`); call out in the changelog: "**Fixed:** `x-tagGroups` is now concatenated and deduped across inputs instead of using first-wins."
- **Other extensions:** Unaffected; they continue to use first-wins.

---

## 11. Acceptance Criteria

- [ ] `mergeTagGroups` function correctly concatenates and dedupes groups by name.
- [ ] Tags within merged groups are deduped (first-seen wins).
- [ ] Empty groups after deduping are dropped.
- [ ] `x-tagGroups` is omitted from output if no groups remain.
- [ ] `excludeTags` filtering is applied to `x-tagGroups` entries.
- [ ] Groups with zero tags after filtering are dropped.
- [ ] Other `x-*` extensions continue to use first-wins (backwards compatible).
- [ ] All existing tests pass.
- [ ] New test cases cover concatenation, deduping, filtering, and interaction with `excludeTags`.
- [ ] Library bumped to minor version.
- [ ] Changelog updated with bug-fix entry.

---

## 12. Effort Estimate

**Confirmed:** Value 3/5, Effort 2/5.

**Time breakdown:**
- Implement `mergeTagGroups` and update `extensions.ts`: ~30 min.
- Update `tags.ts` to filter `x-tagGroups`: ~20 min.
- JSDoc updates: ~10 min.
- Write and run tests: ~30 min.
- **Total:** ~1.5 hours.

