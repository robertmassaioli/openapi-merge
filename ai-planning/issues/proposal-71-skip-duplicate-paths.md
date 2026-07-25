# Implementation Proposal: Issue #71 — Configurable Duplicate Path Handling

**Issue:** [#71 — Possible to skip duplicate paths?](https://github.com/robertmassaioli/openapi-merge/issues/71)

**Status:** Proposal

**Value:** 4 | **Effort:** 3 | **ROI:** Medium

---

## 1. Issue Summary

Currently, when two inputs define the same path (after path modification), the merge fails with a hard error:

```
Error merging files: Input 2: The path '/api/associations' maps to '/api/associations'
and this has already been added by another input file (duplicate-paths)
```

Users with overlapping microservice specs want the merge to skip duplicate paths gracefully instead of failing. The issue asks for a config flag to control this behaviour.

---

## 2. Root Cause & Current Behaviour

In `packages/openapi-merge/src/paths-and-components.ts` (lines 291–296), the merge emits an error whenever a path key already exists:

```typescript
if (result.paths[newPath] !== undefined) {
  return {
    type: 'duplicate-paths',
    message: `Input ${inputIndex}: The path '${originalPath}' maps to '${newPath}' and this has already been added by another input file`
  };
}
```

This is a **first-input-wins** approach with no flexibility. The only way to avoid the error is to pre-process inputs externally.

---

## 3. Cross-Cluster Framing: The "Conflict Resolution" Family

This issue is one face of a **larger family** of conflict-resolution requests:

- **#71** (this): duplicate paths should be skippable.
- **#8**: component-definition conflicts should allow prefer-last or merge strategies.
- **#109**: paths with same name but different HTTP methods should be mergeable.

Rather than solve each ad-hoc, we **recommend designing a single configurable `conflictResolution` policy** that subsumes all three. This proposal focuses on paths; #8 and #109 should be coordinated in parallel.

---

## 4. Proposed Design

### 4.1 Add a `duplicatePathHandling` Option

Introduce a new optional field on `SingleMergeInputV2`:

```typescript
export type DuplicatePathHandling = 'error' | 'skip-later' | 'prefer-later';

export interface SingleMergeInputV2 extends SingleMergeInputBase {
  dispute?: Dispute;
  
  /**
   * Controls how duplicate paths (same path key after path modification) are handled.
   * - 'error' (default): emit 'duplicate-paths' error. Preserves current behaviour.
   * - 'skip-later': keep the first input's path definition, silently ignore later ones.
   * - 'prefer-later': keep the LAST input's definition, overwrite earlier ones.
   *
   * @default 'error'
   */
  duplicatePathHandling?: DuplicatePathHandling;
}
```

**Placement:** Per-input on `SingleMergeInput`, not global. Users typically want to express: "this gateway input wins, the rest are additive."

### 4.2 Merging Rules

- **`'error'` (default):** Current behaviour — fail on duplicate paths. No breaking change.
- **`'skip-later'`:** Keep the first input's definition; later inputs' paths with the same key are silently dropped.
- **`'prefer-later'`:** Keep the LAST (most recent) input's definition; overwrite earlier ones.

### 4.3 Per-Method Granularity (Optional but Recommended)

OpenAPI paths are structured as `paths["/x"]["get"]`, `paths["/x"]["post"]`, etc. A "duplicate path" could mean:

1. **Path key collision:** The same path key exists (current implementation).
2. **Path + method collision:** The same path key AND HTTP method both exist.

**Recommendation:** Implement per-method granularity so a later input can add `POST /x` without conflicting with an earlier input's `GET /x`.

The logic would be:

```typescript
// Before: if (result.paths[newPath] !== undefined) → error

// After: check per-method
const incomingPathItem: Swagger.PathItem = copyPathItem;
const existingPathItem: Swagger.PathItem | undefined = result.paths[newPath];

if (existingPathItem !== undefined) {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];
  for (const method of methods) {
    const incomingOp = incomingPathItem[method];
    const existingOp = existingPathItem[method];
    
    if (incomingOp !== undefined && existingOp !== undefined) {
      // Per-method conflict on (newPath, method)
      // Apply duplicatePathHandling logic here
    }
  }
  // Merge non-conflicting methods
}
```

This allows partial-path merging and is more granular. If adopting this, the error/skip/prefer logic applies per-method, not per-path.

---

## 5. Cross-Links to Related Proposals

- **proposal-76** and future **proposal-102** propose a new `merge(inputs, options?)` 2nd parameter. This feature (_duplicatePathHandling_) follows the same pattern: per-input configuration.
- **proposal-40** (`dispute.alwaysApply` for operationIds) is orthogonal but related: operationId conflicts are checked separately and use the existing dispute mechanism. This proposal does not change that.

---

## 6. Implementation Outline

### 6.1 Library Changes (`packages/openapi-merge`)

1. **Extend `data.ts`:**
   - Add `DuplicatePathHandling` type.
   - Add `duplicatePathHandling?: DuplicatePathHandling` to `SingleMergeInputV2`.

2. **Modify `paths-and-components.ts`:**
   - Extract the conflict-checking logic (lines 291–296) into a helper function.
   - Pass `duplicatePathHandling` from the input into that helper.
   - Implement per-method conflict detection (optional but recommended).
   - Log or track which paths were skipped (see Risk section).

3. **Update type exports in `index.ts`.**

### 6.2 CLI Changes (`packages/openapi-merge-cli`)

1. **Update `data.ts`** to include `duplicatePathHandling?: string` in `ConfigurationInput`.
2. **Regenerate the JSON Schema:**
   ```bash
   bolt w openapi-merge-cli run gen-schema
   ```
3. Update the CLI example configuration `openapi-merge.test.json` with a test case.

### 6.3 Documentation

- Update the main README with an example of `duplicatePathHandling`.
- Add a "Conflict Resolution" section explaining the three modes.

---

## 7. Tests

Add Jest cases to `packages/openapi-merge/src/__tests__/paths.test.ts`:

- **Default ('error'):** Two inputs with the same path still error. *(Regression test.)*
- **'skip-later':** First input's path is kept; second input's identical path is dropped.
- **'prefer-later':** Second input's path overwrites the first's.
- **Per-method granularity:** First input has `GET /x`, second input has `POST /x` — both are merged.
- **Per-method + skip-later:** First input has `GET /x` and `POST /x`, second input has `POST /x` with different definition — `GET` is kept, `POST` is skipped.
- **operationId collision still raises error:** Even with `skip-later` on paths, conflicting operationIds still error (different code path, proposal-40).

Example test outline:

```typescript
describe('duplicatePathHandling', () => {
  it('default: error on duplicate path', () => {
    const first = toOAS({ paths: { '/x': { get: {...} } } });
    const second = toOAS({ paths: { '/x': { post: {...} } } });
    const result = merge([{ oas: first }, { oas: second }]);
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorMergeResult).type).toBe('duplicate-paths');
  });

  it('skip-later: keeps first input path, ignores second', () => {
    const first = toOAS({ paths: { '/x': { get: {...} } } });
    const second = toOAS({ paths: { '/x': { get: {...} } } });
    const result = merge([
      { oas: first },
      { oas: second, duplicatePathHandling: 'skip-later' }
    ]);
    expect(isErrorResult(result)).toBe(false);
    expect(result.output.paths['/x'].get).toEqual(first.paths['/x'].get);
  });

  it('prefer-later: keeps second input path', () => {
    // ... similar structure
  });

  it('per-method: merges GET and POST on same path', () => {
    const first = toOAS({ paths: { '/x': { get: {...} } } });
    const second = toOAS({ paths: { '/x': { post: {...} } } });
    const result = merge([{ oas: first }, { oas: second }]);
    expect(isErrorResult(result)).toBe(false);
    expect(result.output.paths['/x'].get).toBeDefined();
    expect(result.output.paths['/x'].post).toBeDefined();
  });
});
```

---

## 8. Backwards Compatibility

- **Default unchanged:** `duplicatePathHandling` defaults to `'error'`, preserving the current error-on-duplicate behaviour.
- **Existing configurations:** Any JSON config without `duplicatePathHandling` is unaffected.
- **Version bump:** Minor version (e.g., `1.2.0` → `1.3.0`) in both `openapi-merge` and `openapi-merge-cli`.

---

## 9. Risk & Mitigation

**Risk:** Silently dropping operations can mask real schema drift or unintended overlaps.

**Mitigation:**
- **Logging:** When `skip-later` or `prefer-later` is active, log which paths were dropped and which input they came from. Integrate with the CLI's existing `LogWithMillisDiff` logger.
- **Transparency:** Document that this is opt-in and users are responsible for understanding their input specs.

We do **not** recommend adding a `skipped` field to `MergeResult.output` because that complicates the return type; logging is sufficient.

---

## 10. Effort Estimate

| Aspect | Estimate |
| --- | --- |
| Extend `data.ts` types | 0.5 iterations |
| Modify `paths-and-components.ts` (default logic) | 1.0 iteration |
| Per-method granularity (optional) | 1.5 iterations |
| CLI schema + config update | 0.5 iterations |
| Jest test coverage | 1.5 iterations |
| **Total** | **~3 iterations** |

**Effort reduces to ~2 if implemented alongside #8 and #109** as part of a unified "Conflict Policies" minor release.

---

## 11. Acceptance Criteria

- [ ] `SingleMergeInputV2` includes `duplicatePathHandling?: DuplicatePathHandling` field.
- [ ] `DuplicatePathHandling` type is exported from `src/data.ts`.
- [ ] Merge logic in `paths-and-components.ts` respects all three modes ('error', 'skip-later', 'prefer-later').
- [ ] Per-method granularity is implemented so `GET /x` + `POST /x` do not conflict.
- [ ] Default mode ('error') is unchanged; all existing tests pass.
- [ ] New Jest tests cover all three modes, per-method merging, and operationId-conflict orthogonality.
- [ ] CLI configuration schema is regenerated and example config includes a test case.
- [ ] Library and CLI documentation (README) is updated with examples.
- [ ] Minor version bumped in both packages.

---

## 12. Next Steps

1. **Decision:** Approve per-input `duplicatePathHandling` design vs. alternative (global option).
2. **Coordination:** Plan parallelization with #8 and #109 as a unified "Conflict Policies" release.
3. **Implementation:** Start with per-method granularity built-in (higher effort upfront, better UX long-term).
