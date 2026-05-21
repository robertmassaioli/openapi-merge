# Proposal: Issue #105 — Callback `operationId` Not Included in Dispute Resolving

**Issue Link:** https://github.com/robertmassaioli/openapi-merge/issues/105

**Status:** Proposal

**Value:** 4 / **Effort:** 2

---

## 1. Issue Summary

OpenAPI 3.0 allows full `Operation` objects to be nested inside `callbacks`, each potentially bearing its own `operationId`. Today, when merging multiple specs, the dispute renaming machinery only applies to top-level `paths.*.<method>.operationId`. Callback-nested operationIds are silently ignored, causing two inputs that define callbacks with identical operationIds to collide in the merged output. This breaks codegen tools that expect operationIds to be globally unique across the entire merged spec.

**Example:** Two microservices both define a callback with `operationId: 'onWebhookReceived'`. The merged spec contains both with the same ID, violating the uniqueness contract.

---

## 2. Root Cause Analysis

### Where Operations Are Renamed Today

In `packages/openapi-merge/src/paths-and-components.ts`, the function `ensureUniqueOperationIds()` (lines 146–168) walks all top-level `PathItem` objects and calls `ensureUniqueOperationId()` (lines 134–144) on each HTTP method's `Operation`:

```typescript
function ensureUniqueOperationIds(pathItem: Swagger.PathItem, seenOperationIds: Set<string>, dispute: Dispute | undefined): ErrorMergeResult | undefined {
  const operations = [
    pathItem.get,
    pathItem.put,
    pathItem.post,
    // ... etc
  ];

  for (let opIndex = 0; opIndex < operations.length; opIndex++) {
    const operation = operations[opIndex];
    if (operation !== undefined) {
      const result = ensureUniqueOperationId(operation, seenOperationIds, dispute);
      // ...
    }
  }
}
```

### Why Callbacks Are Missed

In `packages/openapi-merge/src/reference-walker.ts`, the `walkCallbackReferences()` function (lines 165–177) correctly iterates over path-items nested inside callbacks and walks their references. However, **no corresponding `operationId` uniqueness check happens during this traversal**.

The workflow is:
1. Line 179–205 in `reference-walker.ts`: `walkOperationReferences()` walks `operation.callbacks` and calls `walkCallbackReferences()` on each.
2. Line 165–177: `walkCallbackReferences()` iterates over path-items and calls `walkPathItemReferences()`.
3. Line 207–226: `walkPathItemReferences()` walks the operations in each path-item.

But in `paths-and-components.ts`, after references are transformed (line 298–304), the top-level `ensureUniqueOperationIds()` is called **only on the top-level `paths`** (line 304), never recursively on operations discovered within callbacks.

---

## 3. Proposed Fix

### Extract a Reusable Helper

Create a new helper function `ensureUniqueOperationIdInOperation()` that encapsulates the logic from `ensureUniqueOperationId()` but also recursively processes any callbacks within the operation:

**In `packages/openapi-merge/src/paths-and-components.ts` (after line 144):**

```typescript
function ensureUniqueOperationIdInOperation(
  operation: Swagger.Operation,
  seenOperationIds: Set<string>,
  dispute: Dispute | undefined
): ErrorMergeResult | undefined {
  // Step 1: Ensure the operation's own operationId is unique
  if (operation.operationId !== undefined) {
    const opId = findUniqueOperationId(operation.operationId, seenOperationIds, dispute);
    if (typeof opId === 'string') {
      operation.operationId = opId;
      seenOperationIds.add(opId);
    } else {
      return opId;
    }
  }

  // Step 2: Recursively process callbacks
  if (operation.callbacks !== undefined) {
    for (const callbackKey in operation.callbacks) {
      if (operation.callbacks.hasOwnProperty(callbackKey)) {
        const callback = operation.callbacks[callbackKey];
        // A callback may be a reference or a Callback object
        if (!TC.isReference(callback)) {
          const result = ensureUniqueOperationIdsInCallback(callback, seenOperationIds, dispute);
          if (result !== undefined) {
            return result;
          }
        }
      }
    }
  }
}
```

### Add a Callback Walker for Operation IDs

Create a new helper to walk operation IDs inside callbacks:

**In `packages/openapi-merge/src/paths-and-components.ts` (after the callback-processing function):**

```typescript
function ensureUniqueOperationIdsInCallback(
  callback: Swagger.Callback,
  seenOperationIds: Set<string>,
  dispute: Dispute | undefined
): ErrorMergeResult | undefined {
  for (const pathItemKey in callback) {
    if (callback.hasOwnProperty(pathItemKey)) {
      const pathItem = callback[pathItemKey];
      // Path-item inside a callback may also be a reference
      if (!TC.isReference(pathItem)) {
        const result = ensureUniqueOperationIds(pathItem, seenOperationIds, dispute);
        if (result !== undefined) {
          return result;
        }
      }
    }
  }
}
```

### Update the Call Site

Update `ensureUniqueOperationIds()` to use the new recursive helper instead of the old non-recursive one:

**In `packages/openapi-merge/src/paths-and-components.ts` (lines 146–168):**

```typescript
function ensureUniqueOperationIds(pathItem: Swagger.PathItem, seenOperationIds: Set<string>, dispute: Dispute | undefined): ErrorMergeResult | undefined {
  const operations = [
    pathItem.get,
    pathItem.put,
    pathItem.post,
    pathItem.delete,
    pathItem.patch,
    pathItem.head,
    pathItem.trace,
    pathItem.options
  ];

  for (let opIndex = 0; opIndex < operations.length; opIndex++) {
    const operation = operations[opIndex];

    if (operation !== undefined) {
      // Use the new recursive helper instead of ensureUniqueOperationId
      const result = ensureUniqueOperationIdInOperation(operation, seenOperationIds, dispute);
      if (result !== undefined) {
        return result;
      }
    }
  }
}
```

### Import TC Type Guard

Ensure `TC` (the Swagger type-check module) is imported at the top of `paths-and-components.ts`:

```typescript
import { Swagger, SwaggerTypeChecks as TC } from "@atlassian/atlassian-openapi";
```

---

## 4. Edge Cases

### 4.1 Operations Without `operationId`

Operations without an explicit `operationId` are skipped (the `if` guard in the helper ensures this). No error is raised; they remain optional per the OpenAPI spec.

### 4.2 Reference-Only Callbacks

A callback value may be a `$ref` (e.g., `{ '$ref': '#/components/callbacks/MyCallback' }`). The helper checks `TC.isReference(callback)` before recursing, so reference-only callbacks do not cause crashes.

### 4.3 Path-Items as References Inside Callbacks

Inside a callback, the path-item value may also be a `$ref`. The updated `ensureUniqueOperationIdsInCallback()` function checks `TC.isReference(pathItem)` to guard against this.

### 4.4 Nested Callbacks-in-Callbacks

OpenAPI allows `callbacks` inside nested `Operation` objects (rare but valid). By recursing into `operation.callbacks` within `ensureUniqueOperationIdInOperation()`, the fix handles arbitrarily deep nesting.

---

## 5. Backwards Compatibility

### No Breaking Changes to Public API

The function signatures `findUniqueOperationId()` and `ensureUniqueOperationId()` remain unchanged. The new helpers are internal (file-scoped).

### Behavior on Existing Specs

- **If callbacks already have unique operationIds:** Merged output is identical (no change).
- **If callbacks have conflicting operationIds (the bug):** They will now be renamed using the dispute prefix or a numeric suffix, same as top-level operations. Codegen tools will now receive globally unique IDs.

### Dispute Prefix Honored

The dispute prefix or suffix configured for an input will apply to callback operationIds exactly as it does for top-level operationIds. This is consistent with the design goal: "any naming conflict goes through the dispute resolution engine."

---

## 6. Tests

Add Jest test cases to `packages/openapi-merge/src/__tests__/paths.test.ts` to cover:

### Test Case 1: Duplicate Callback operationIds are Renamed

```typescript
it('should ensure unique operationIds in callbacks', () => {
  const first = toOAS({
    '/webhook': {
      post: {
        callbacks: {
          myCallback: {
            '{$request.body#/callbackUrl}': {
              post: {
                operationId: 'onEvent',
                responses: {}
              }
            }
          }
        },
        responses: {}
      }
    }
  });

  const second = toOAS({
    '/other': {
      post: {
        callbacks: {
          anotherCallback: {
            '{$request.query#/url}': {
              post: {
                operationId: 'onEvent', // Same ID as first
                responses: {}
              }
            }
          }
        },
        responses: {}
      }
    }
  });

  const result = merge(toMergeInputs([first, second]));
  
  // Verify first callback operationId unchanged
  const firstCallbackOp = result.output.paths['/webhook'].post.callbacks.myCallback['{$request.body#/callbackUrl}'].post;
  expect(firstCallbackOp.operationId).toBe('onEvent');

  // Verify second callback operationId was renamed
  const secondCallbackOp = result.output.paths['/other'].post.callbacks.anotherCallback['{$request.query#/url}'].post;
  expect(secondCallbackOp.operationId).toBe('onEvent1');
});
```

### Test Case 2: Dispute Prefix Applied to Callback operationIds

```typescript
it('should apply dispute prefix to callback operationIds', () => {
  const first = toOAS({
    '/webhook': {
      post: {
        callbacks: {
          cb: {
            '{$url}': {
              post: {
                operationId: 'webhookReceived',
                responses: {}
              }
            }
          }
        },
        responses: {}
      }
    }
  });

  const second = toOAS({
    '/other': {
      post: {
        callbacks: {
          cb: {
            '{$url}': {
              post: {
                operationId: 'webhookReceived', // Same
                responses: {}
              }
            }
          }
        },
        responses: {}
      }
    }
  });

  const inputs = toMergeInputs([first, second]);
  inputs[1].dispute = { prefix: 'Service2' };

  const result = merge(inputs);
  
  const firstCallbackOp = result.output.paths['/webhook'].post.callbacks.cb['{$url}'].post;
  expect(firstCallbackOp.operationId).toBe('webhookReceived');

  const secondCallbackOp = result.output.paths['/other'].post.callbacks.cb['{$url}'].post;
  expect(secondCallbackOp.operationId).toBe('Service2webhookReceived');
});
```

### Test Case 3: Reference-Only Callbacks Don't Crash

```typescript
it('should skip $ref callbacks without crashing', () => {
  const first = toOAS({
    '/webhook': {
      post: {
        callbacks: {
          myCallback: { '$ref': '#/components/callbacks/MyCallback' }
        },
        responses: {}
      }
    }
  });

  const second = toOAS({
    '/other': {
      post: {
        operationId: 'getOther',
        responses: {}
      }
    }
  });

  expect(() => merge(toMergeInputs([first, second]))).not.toThrow();
});
```

---

## 7. Cross-Link to Dispute Completeness Cluster

This issue is part of a wider effort to make the dispute engine complete. Related issues:

- **#40** — "Component definitions with conflicting names should support renaming"
- **#99** — "Parameter names in callbacks not updated when dispute is applied"
- **#106** — "Request/response names in callbacks not included in dispute"
- **#111** (future) — "Wildcard tag matching in operationSelection"

Recommend bundling #40, #99, #105, #106, and #111 into a single minor release ("Dispute Completeness"). This ensures the renaming engine is consistent across all nested contexts.

---

## 8. Effort Estimate

**Estimated Value:** 4 (Medium) — fixes a real data-loss bug that breaks downstream tools.

**Estimated Effort:** 2 (Low) — the machinery already exists; only need to call it recursively.

### Justification

**Code changes:**
- `ensureUniqueOperationIdInOperation()`: ~15 lines (reusable recursive wrapper)
- `ensureUniqueOperationIdsInCallback()`: ~10 lines (callback iterator)
- Update `ensureUniqueOperationIds()` call site: 1 line
- Import `TC` if not already present: 0–1 lines (likely already imported)

**Testing:**
- 3–4 new Jest test cases in `paths.test.ts`: ~60 lines of test code
- No changes to library's public API

**Risk:** Minimal. The new helpers are small, follow existing patterns, and guard against references using `TC.isReference()`.

---

## 9. Acceptance Criteria

- [ ] New helper `ensureUniqueOperationIdInOperation()` created in `paths-and-components.ts` and handles operation ID + recursion into callbacks
- [ ] New helper `ensureUniqueOperationIdsInCallback()` created to walk callbacks and process nested path-items
- [ ] `ensureUniqueOperationIds()` updated to call `ensureUniqueOperationIdInOperation()` instead of `ensureUniqueOperationId()`
- [ ] Type guard `TC.isReference()` used to safely skip callback and path-item references
- [ ] At least 3 Jest test cases added covering: duplicate callback operationIds, dispute prefix application, and $ref-only callbacks
- [ ] All 98+ existing Jest tests pass without regression
- [ ] ESLint passes for both packages
- [ ] `tsc --noEmit` clean
- [ ] No changes to public API or `data.ts` types
- [ ] Proposal links to #40, #99, #106 for future bundling as "Dispute Completeness"

---

## 10. Implementation Notes

1. **Order of functions:** Keep `findUniqueOperationId()` before `ensureUniqueOperationIdInOperation()` (which calls it).
2. **Recursion depth:** Callback-in-callback nesting is rare but valid per OpenAPI. The recursive design handles it naturally.
3. **Import scope:** Ensure `TC` is in scope; it's already imported in most modules.
4. **Deployment:** This is a bug fix, not a breaking change. Consider a patch or minor version bump depending on release strategy.
5. **Documentation:** Update the CHANGELOG to note that callback operationIds are now included in dispute resolution.
