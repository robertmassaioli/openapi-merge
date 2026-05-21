# Implementation Proposal: Issue #40 — `dispute.alwaysApply` Must Rename `operationId`s

**Issue:** [#40 — dispute.alwaysApply ineffective on operationIds](https://github.com/robertmassaioli/openapi-merge/issues/40)

**Status:** Proposal

**Value:** 4 | **Effort:** 2 | **ROI:** High

---

## 1. Issue Summary

When a user sets `dispute.alwaysApply: true` in their merge configuration, the dispute prefix/suffix is applied unconditionally to component names (schemas, parameters, headers, etc.), preventing deduplication. However, `operationId` fields are **not** renamed unless they actually conflict with a previously-seen operation ID. This inconsistency violates the principle of `alwaysApply` and leaves users with unpredictable naming: some operation IDs are renamed, others are not, depending on the order of inputs and whether collisions occur.

**Expected behaviour:** When `alwaysApply: true`, *all* fields subject to dispute (including `operationId`) should be renamed uniformly, regardless of conflicts.

---

## 2. Root Cause Analysis

In `packages/openapi-merge/src/paths-and-components.ts`, the `findUniqueOperationId` function (lines 106–132) has this structure:

```typescript
function findUniqueOperationId(operationId: string, seenOperationIds: Set<string>, dispute: Dispute | undefined): string | ErrorMergeResult {
  if (!seenOperationIds.has(operationId)) {
    return operationId;  // ← SHORT-CIRCUIT: No conflict, return as-is
  }

  // Try the dispute prefix
  if (dispute !== undefined) {
    const disputeOpId = applyDispute(dispute, operationId, 'disputed');
    if (!seenOperationIds.has(disputeOpId)) {
      return disputeOpId;
    }
  }

  // ... fallback logic ...
}
```

**The problem:** Line 107–109 returns the `operationId` unchanged if no conflict is detected, completely bypassing the `dispute` logic. This means `alwaysApply` is never consulted for the "no conflict" path.

In contrast, the component-merging logic in `processComponents` (lines 25–75) checks `alwaysApply` directly when deciding whether to apply the dispute:

```typescript
// In dispute.ts, applyDispute() (line 24–34):
export function applyDispute(dispute: Dispute | undefined, input: string, status: DisputeStatus): string {
  if (dispute === undefined) {
    return input;
  }

  if (status === 'disputed' || dispute.alwaysApply) {  // ← Checks alwaysApply!
    return isDisputePrefix(dispute) ? `${dispute.prefix}${input}` : `${input}${dispute.suffix}`;
  }

  return input;
}
```

The asymmetry: `processComponents` calls `applyDispute(..., 'undisputed')` and lets `applyDispute` decide based on `alwaysApply`, but `findUniqueOperationId` returns early on the "no conflict" case before even consulting `dispute`.

---

## 3. Proposed Fix

**Move the `alwaysApply` check ahead of the conflict check** in `findUniqueOperationId`. If `alwaysApply` is true, apply the dispute immediately, regardless of whether the original ID conflicts.

### Before (current logic)

```typescript
function findUniqueOperationId(operationId: string, seenOperationIds: Set<string>, dispute: Dispute | undefined): string | ErrorMergeResult {
  if (!seenOperationIds.has(operationId)) {
    return operationId;  // ← Always return unchanged, even if alwaysApply is true
  }

  if (dispute !== undefined) {
    const disputeOpId = applyDispute(dispute, operationId, 'disputed');
    if (!seenOperationIds.has(disputeOpId)) {
      return disputeOpId;
    }
  }

  // ... fallback ...
}
```

### After (proposed logic)

```typescript
function findUniqueOperationId(operationId: string, seenOperationIds: Set<string>, dispute: Dispute | undefined): string | ErrorMergeResult {
  // Check alwaysApply first: if true, rename unconditionally
  if (dispute !== undefined && dispute.alwaysApply) {
    const disputeOpId = applyDispute(dispute, operationId, 'undisputed');
    if (!seenOperationIds.has(disputeOpId)) {
      return disputeOpId;
    }
    // If even the disputed version conflicts, fall through to numeric suffix logic
  } else if (!seenOperationIds.has(operationId)) {
    // No alwaysApply, and no conflict: return unchanged
    return operationId;
  }

  // Conflict case (either no dispute, or alwaysApply but disputed version also conflicts)
  if (dispute !== undefined && !dispute.alwaysApply) {
    const disputeOpId = applyDispute(dispute, operationId, 'disputed');
    if (!seenOperationIds.has(disputeOpId)) {
      return disputeOpId;
    }
  }

  // Incrementally find the right suffix
  for (let antiConflict = 1; antiConflict < 1000; antiConflict++) {
    const tryOpId = `${operationId}${antiConflict}`;
    if (!seenOperationIds.has(tryOpId)) {
      return tryOpId;
    }
  }

  // Fail with an error
  return {
    type: 'operation-id-conflict',
    message: `Could not resolve a conflict for the operationId '${operationId}'`
  };
}
```

**Key changes:**

1. **Lines 1–5 (new):** If `alwaysApply` is true, apply the dispute immediately, even if there's no conflict.
2. **Line 6–8 (new):** If the disputed version *also* conflicts, fall through to the numeric suffix fallback.
3. **Lines 9–15 (shifted):** Only attempt dispute resolution for the "conflict but no alwaysApply" case.
4. **Lines 17–28:** Numeric suffix fallback (unchanged).

This mirrors the behaviour of `applyDispute` in `dispute.ts`, which checks `alwaysApply` first (line 29 of that file).

---

## 4. Edge Cases

### 4.1 Operations with no `operationId`

**Current:** Silently skipped (line 135 of `paths-and-components.ts`: `if (operation.operationId !== undefined)`).

**After fix:** No change. Operations without an `operationId` field are not renamed. This is correct because there is nothing to rename.

**Test case:** None needed; the guard remains in place.

---

### 4.2 `DisputePrefix` vs `DisputeSuffix`

Both honour `alwaysApply` uniformly via the `applyDispute` function. The logic is symmetric:

```typescript
return isDisputePrefix(dispute) ? `${dispute.prefix}${input}` : `${input}${dispute.suffix}`;
```

**Test cases:**
- `DisputePrefix` with `alwaysApply: true` renames all `operationId`s with the prefix.
- `DisputeSuffix` with `alwaysApply: true` renames all `operationId`s with the suffix.

---

### 4.3 Deprecated `disputePrefix` (V1 input shape)

The deprecated `SingleMergeInputV1` shape accepts `disputePrefix?: string` but has no `alwaysApply` field. The V1→V2 conversion in `dispute.ts` (lines 2–16) wraps `disputePrefix` as:

```typescript
if (input.disputePrefix !== undefined) {
  return {
    prefix: input.disputePrefix
  };
}
```

This creates a `DisputePrefix` object **without** `alwaysApply`, so `alwaysApply` defaults to `undefined` (falsy). Therefore, V1 configurations are unaffected by this change and continue to rename only on conflicts.

**Backwards compatibility:** ✅ Preserved.

---

## 5. Backwards Compatibility

**Users NOT setting `alwaysApply: true`:** Behaviour is identical to today. The conflict-resolution logic is unchanged; only the `alwaysApply: true` path is modified.

**Users setting `alwaysApply: true`:** Will see MORE renames than before. This is an intentional fix, correcting the inconsistency. Users who upgrade and find `operationId`s now renamed when they previously were not should understand this as correct behaviour. **Recommend a changelog note:** "Fixed: `dispute.alwaysApply` now applies uniformly to `operationId` fields, preventing name variation based on input order or collision occurrence."

**Version bump:** Minor release (e.g., `1.3.0`), as the change is backwards-compatible for users not using `alwaysApply`, but is a behavioural enhancement for those who do.

---

## 6. Tests

Add Jest test cases to `packages/openapi-merge/src/__tests__/components.test.ts` or a new `paths.test.ts` suite:

### 6.1 `alwaysApply` renames all `operationId`s, even without conflict

```typescript
it('should rename operationIds when alwaysApply is true, even without conflict', () => {
  const first: Swagger.SwaggerV3 = toOAS(
    {
      paths: {
        '/users': {
          get: {
            operationId: 'getUsers',
            responses: { '200': { description: 'OK' } }
          }
        }
      }
    }
  );

  const second: Swagger.SwaggerV3 = toOAS(
    {
      paths: {
        '/posts': {
          get: {
            operationId: 'getPosts',
            responses: { '200': { description: 'OK' } }
          }
        }
      }
    }
  );

  const input: MergeInput = [
    { oas: first, dispute: { prefix: 'v1_', alwaysApply: true } },
    { oas: second, dispute: { prefix: 'v2_', alwaysApply: true } }
  ];

  const result = merge(input);
  expectMergeResult(result, {
    output: expect.objectContaining({
      paths: {
        '/users': {
          get: expect.objectContaining({ operationId: 'v1_getUsers' })
        },
        '/posts': {
          get: expect.objectContaining({ operationId: 'v2_getPosts' })
        }
      }
    })
  });
});
```

### 6.2 `alwaysApply` with `DisputeSuffix`

```typescript
it('should apply suffix to operationIds when alwaysApply is true with DisputeSuffix', () => {
  const first: Swagger.SwaggerV3 = toOAS({
    paths: {
      '/users': {
        get: {
          operationId: 'getUsers',
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  });

  const second: Swagger.SwaggerV3 = toOAS({
    paths: {
      '/posts': {
        get: {
          operationId: 'getPosts',
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  });

  const input: MergeInput = [
    { oas: first, dispute: { suffix: '_v1', alwaysApply: true } },
    { oas: second, dispute: { suffix: '_v2', alwaysApply: true } }
  ];

  const result = merge(input);
  expectMergeResult(result, {
    output: expect.objectContaining({
      paths: {
        '/users': {
          get: expect.objectContaining({ operationId: 'getUsers_v1' })
        },
        '/posts': {
          get: expect.objectContaining({ operationId: 'getPosts_v2' })
        }
      }
    })
  });
});
```

### 6.3 Deprecated `disputePrefix` (V1 shape) is unchanged

```typescript
it('should not rename operationIds with deprecated disputePrefix (V1) when no conflict', () => {
  const first: Swagger.SwaggerV3 = toOAS({
    paths: {
      '/users': {
        get: {
          operationId: 'getUsers',
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  });

  const second: Swagger.SwaggerV3 = toOAS({
    paths: {
      '/posts': {
        get: {
          operationId: 'getPosts',
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  });

  const input: MergeInput = [
    { oas: first, disputePrefix: 'v1_' },  // V1 shape, no alwaysApply
    { oas: second, disputePrefix: 'v2_' }
  ];

  const result = merge(input);
  expectMergeResult(result, {
    output: expect.objectContaining({
      paths: {
        '/users': {
          get: expect.objectContaining({ operationId: 'getUsers' })  // ← No prefix
        },
        '/posts': {
          get: expect.objectContaining({ operationId: 'getPosts' })  // ← No prefix
        }
      }
    })
  });
});
```

### 6.4 Conflict still triggers dispute when no `alwaysApply`

```typescript
it('should apply dispute prefix when operationId conflicts, even without alwaysApply', () => {
  const first: Swagger.SwaggerV3 = toOAS({
    paths: {
      '/users': {
        get: {
          operationId: 'getItem',
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  });

  const second: Swagger.SwaggerV3 = toOAS({
    paths: {
      '/posts': {
        get: {
          operationId: 'getItem',  // ← Same operationId
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  });

  const input: MergeInput = [
    { oas: first, dispute: { prefix: 'v1_' } },  // No alwaysApply
    { oas: second, dispute: { prefix: 'v2_' } }
  ];

  const result = merge(input);
  expectMergeResult(result, {
    output: expect.objectContaining({
      paths: {
        '/users': {
          get: expect.objectContaining({ operationId: 'getItem' })  // ← No conflict, no rename
        },
        '/posts': {
          get: expect.objectContaining({ operationId: 'v2_getItem' })  // ← Conflict, applies dispute
        }
      }
    })
  });
});
```

---

## 7. Cross-Link Related Issues

This fix is part of the **"Dispute Completeness"** cluster identified in the triage document (`ai-planning/issue-triage-value-vs-effort.md`, section 3.2):

- **#40** (this issue): `operationId` not renamed when `alwaysApply: true`.
- **#105**: Callback `operationId`s not handled by dispute/deduplication logic.
- **#106**: Discriminator mapping not updated when referenced schemas are renamed.
- **#99**: Response header references not updated during dispute resolution.

**Recommendation:** Bundle these issues in a single **"Dispute Completeness"** minor release (e.g., `1.3.0`). Coordinate the changelog to explain the dispute system enhancements holistically.

---

## 8. Effort Estimate

| Aspect | Estimate |
| --- | --- |
| Code change (modify `findUniqueOperationId`, ~20 lines) | 1 hour |
| Test cases (4 scenarios) | 1.5 hours |
| Integration testing (verify no regressions) | 0.5 hours |
| Changelog/docs | 0.5 hours |
| **Total** | **3.5 hours** |

**Effort score: 2/5** (fits "small fix" category)

---

## 9. Acceptance Criteria

- [ ] `findUniqueOperationId` in `packages/openapi-merge/src/paths-and-components.ts` checks `dispute.alwaysApply` **before** the no-conflict return.
- [ ] All four test scenarios pass.
- [ ] Existing Jest test suite passes without regression.
- [ ] ESLint clean.
- [ ] Users setting `alwaysApply: true` see all `operationId` fields renamed uniformly.
- [ ] Users NOT setting `alwaysApply` see no change in behaviour.
- [ ] Deprecated `disputePrefix` (V1 shape) continues to work as before.
- [ ] Changelog notes the behavioural improvement.

---

## 10. Implementation Checklist

1. [ ] Edit `packages/openapi-merge/src/paths-and-components.ts`: reorder logic in `findUniqueOperationId`.
2. [ ] Add four test cases to `packages/openapi-merge/src/__tests__/components.test.ts`.
3. [ ] Run `yarn test` to verify all 98+ tests pass.
4. [ ] Run `yarn lint` to verify ESLint is clean.
5. [ ] Update `CHANGELOG.md` (or release notes) to document the fix.
6. [ ] Bump the `version` field in `packages/openapi-merge/package.json` to a new minor (e.g., `1.3.0`).
7. [ ] Commit and push to `origin/main`; the `npm-publish.yml` workflow handles publication.
