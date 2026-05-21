# Implementation Proposal: Issue #33 — Merge `securitySchemes` Across Input Files

**Issue:** [#33 — Merge securitySchemes of input files](https://github.com/robertmassaioli/openapi-merge/issues/33)

**Status:** Proposal

**Value:** 4 | **Effort:** 3 | **ROI:** High

---

## 1. Issue Summary

Currently, `components.securitySchemes` from any input file except the first is silently dropped during merge. Users expect `securitySchemes` to be merged across inputs (deduplicated by name, with dispute fallback for conflicts) just like other component buckets (`schemas`, `responses`, `parameters`, `examples`, `requestBodies`, `headers`, `links`, `callbacks`).

This undocumented behavior causes validation errors: when a later input's `security` array references a `securityScheme` that was defined in that input but not in the first input, the final merged spec references a non-existent scheme.

---

## 2. Current Behaviour

### Component Buckets That Merge

In `packages/openapi-merge/src/paths-and-components.ts`, lines 203–262, the `mergePathsAndComponents` function loops over eight component buckets and calls `processComponents(...)` on each:

```
- schemas          (line 203–209)
- responses        (line 211–217)
- parameters       (line 219–225)
- examples         (line 228–234)
- requestBodies    (line 237–243)
- headers          (line 246–252)
- links            (line 255–261)
- callbacks        (line 264–270)
```

Each bucket is deduplicated by name, with `deepEquality` comparison; conflicts are resolved via `dispute` prefix/suffix or auto-incremented name suffix.

### `securitySchemes` Does NOT Merge

`securitySchemes` is **not** in the loop. The component object structure itself is never merged; the output's `result.components` only contains `securitySchemes` from the first input (if any) because later inputs' `components.securitySchemes` are never processed.

### Two Distinct Concerns: Top-Level `security` vs. `securitySchemes`

**Important:** There are two separate things that should not be confused:

1. **Top-level `security` array** (document-wide security requirements) — this is currently **first-wins** by design and intentionally not merged. This is part of issue #102 (global overrides), not #33.
2. **`components.securitySchemes`** (lookup table of named schemes) — this is the focus of #33 and should be merged like any other component bucket.

Security entries (both top-level and per-operation) reference scheme **names** (strings like `"apiKey"`, `"oauth2"`), not `$ref` pointers. When a scheme is renamed during dispute resolution, both top-level and per-operation security entries must be rewritten to use the new name.

---

## 3. Proposed Fix

### 3.1 Core Change: Add `securitySchemes` to the Merge Loop

In `packages/openapi-merge/src/paths-and-components.ts`, add a new conditional block after the `callbacks` block (after line ~270):

```typescript
if (oas.components.securitySchemes !== undefined) {
  result.components.securitySchemes = result.components.securitySchemes || {};

  processComponents(result.components.securitySchemes, oas.components.securitySchemes, deepEquality(resultLookup, currentLookup), dispute, (from: string, to: string) => {
    referenceModification[`#/components/securitySchemes/${from}`] = `#/components/securitySchemes/${to}`;
  });
}
```

This reuses the existing `processComponents` function with the same deduplication and dispute logic as other buckets.

### 3.2 Reference Rename Propagation

When a scheme name is modified (either by dispute or auto-increment), both `top-level` and `per-operation` `security` arrays must be updated:

- **Top-level `security`** at the document root (e.g., `oas.security`)
- **Per-operation `security`** (e.g., `paths['/foo'].get.security`)

Security entries reference schemes by **name key**, not `$ref`. The `referenceModification` map built during `processComponents` should be applied to rewrite these references.

**New function:** `walkSecurityReferences(security: SecurityRequirement[], modify: Modify)` in `reference-walker.ts`:

```typescript
export function walkSecurityReferences(security: Swagger.SecurityRequirement[], modify: Modify): void {
  if (security === undefined) return;
  
  for (const requirement of security) {
    for (const schemeName in requirement) {
      if (requirement.hasOwnProperty(schemeName)) {
        const newSchemeName = modify(`#/components/securitySchemes/${schemeName}`).replace('#/components/securitySchemes/', '');
        if (newSchemeName !== schemeName) {
          requirement[newSchemeName] = requirement[schemeName];
          delete requirement[schemeName];
        }
      }
    }
  }
}
```

After merging `securitySchemes`, walk the merged document to update all security references:

```typescript
// In mergePathsAndComponents, after processing all components:
if (Object.keys(referenceModification).some(k => k.startsWith('#/components/securitySchemes/'))) {
  walkSecurityReferences(output.security, /* mapping function */);
  // Also walk per-operation security entries
}
```

---

## 4. Reference Walker Coverage

The existing `walkComponentReferences(components, modify)` in `reference-walker.ts` (lines 228–301) does **not** include `securitySchemes`. Unlike schemas, responses, parameters, etc., security schemes do not contain nested `$ref` pointers—they are opaque objects (API key, OAuth2, etc.) that don't reference other components.

However, **`securitySchemes` entries themselves may be referenced by name in `security` arrays**, which must be updated when renamed. This is covered by the new `walkSecurityReferences` function (above).

---

## 5. Cross-Link: Dispute Completeness Cluster

This issue is part of the "Dispute Completeness" cluster (#40, #99, #105, #106):

- **#40**: `operationId` not renamed when `dispute.alwaysApply: true`
- **#99**: Discriminator mappings not updated when dispute renames schemas
- **#105**: Callback operationIds not renamed with dispute
- **#106**: Discriminator mappings in request/response bodies
- **#33**: Security scheme name references not updated when scheme is renamed

All share the same root cause: the reference-walker (or related rename-propagation logic) is missing a site where names are referenced. Bundling these in a single "Dispute Completeness" minor release is recommended.

---

## 6. Tests

Add Jest test cases to `packages/openapi-merge/src/__tests__/security.test.ts` (or a new `security-schemes.test.ts`):

### 6.1 Disjoint Security Schemes Both Appear

```typescript
it('should merge securitySchemes from both inputs if disjoint', () => {
  const first = toOAS({}, {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header'
      }
    }
  });

  const second = toOAS({}, {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: { implicit: { authorizationUrl: 'https://example.com/auth', scopes: {} } }
      }
    }
  });

  const result = merge(toMergeInputs([first, second]));
  expect(isErrorResult(result)).toBe(false);
  
  const output = (result as SuccessfulMergeResult).output;
  expect(output.components?.securitySchemes).toEqual({
    apiKey: first.components!.securitySchemes!.apiKey,
    oauth2: second.components!.securitySchemes!.oauth2
  });
});
```

### 6.2 Identical Schemes Deduplicate

```typescript
it('should deduplicate identical securitySchemes across inputs', () => {
  const scheme = {
    type: 'apiKey',
    name: 'X-API-Key',
    in: 'header'
  };

  const first = toOAS({}, {
    securitySchemes: { apiKey: scheme }
  });

  const second = toOAS({}, {
    securitySchemes: { apiKey: scheme }
  });

  const result = merge(toMergeInputs([first, second]));
  expect(isErrorResult(result)).toBe(false);
  
  const output = (result as SuccessfulMergeResult).output;
  expect(output.components?.securitySchemes).toEqual({
    apiKey: scheme
  });
});
```

### 6.3 Conflicting Schemes Trigger Dispute

```typescript
it('should rename conflicting securitySchemes with dispute prefix', () => {
  const first = toOAS({}, {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        name: 'X-API-Key-First',
        in: 'header'
      }
    }
  });

  const second = toOAS({}, {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        name: 'X-API-Key-Second',
        in: 'header'
      }
    }
  });

  const result = merge([
    { oas: first },
    { oas: second, dispute: { prefix: 'Second' } }
  ]);

  expect(isErrorResult(result)).toBe(false);
  
  const output = (result as SuccessfulMergeResult).output;
  expect(output.components?.securitySchemes).toHaveProperty('apiKey');
  expect(output.components?.securitySchemes).toHaveProperty('SecondapiKey');
});
```

### 6.4 Per-Operation Security References Updated

```typescript
it('should update per-operation security references when scheme is renamed', () => {
  const first = toOAS({
    '/foo': {
      get: {
        operationId: 'getFoo',
        responses: { '200': { description: 'OK' } }
      }
    }
  }, {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        name: 'X-API-Key-First',
        in: 'header'
      }
    }
  });

  first.paths!['/foo']!.get!.security = [{ apiKey: [] }];

  const second = toOAS({}, {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        name: 'X-API-Key-Second',
        in: 'header'
      }
    }
  });

  const result = merge([
    { oas: first },
    { oas: second, dispute: { prefix: 'Second' } }
  ]);

  expect(isErrorResult(result)).toBe(false);
  
  const output = (result as SuccessfulMergeResult).output;
  expect(output.paths!['/foo']!.get!.security).toEqual([
    { apiKey: [] }  // First input's scheme name, unchanged
  ]);
  expect(output.components?.securitySchemes).toHaveProperty('apiKey');
  expect(output.components?.securitySchemes).toHaveProperty('SecondapiKey');
});
```

---

## 7. Backwards Compatibility

**Breaking change:** Users who relied on silently-dropped `securitySchemes` (unlikely, as this was clearly a bug) will now see those schemes in the output. This is a **bug fix**, not a breaking change in intent, but the output shape changes.

**Version bump:** Minor version bump for the library (e.g., `1.3.0` → `1.4.0`).

---

## 8. Effort Estimate

| Phase | Estimate | Notes |
|-------|----------|-------|
| Add `securitySchemes` to merge loop | 0.5h | Reuse existing `processComponents` call |
| Implement `walkSecurityReferences` | 1h | Walk top-level and per-operation `security` |
| Integrate reference renaming | 1.5h | Hook rename-propagation into merge flow |
| Test coverage (4 test cases) | 1.5h | Unit tests in Jest |
| Manual QA + edge cases | 1h | Verify with multi-input configs |
| **Total** | **~5.5h** | Aligns with Effort 3 estimate |

---

## 9. Acceptance Criteria

- [ ] `securitySchemes` component bucket is processed in `mergePathsAndComponents` using the same `processComponents` call shape as other buckets.
- [ ] Identical `securitySchemes` across inputs are deduplicated by name.
- [ ] Conflicting `securitySchemes` trigger dispute prefix/suffix or auto-increment renaming.
- [ ] When a scheme is renamed, all references in `top-level security` and `per-operation security` arrays are updated.
- [ ] Jest test cases cover: disjoint merge, deduplication, conflict + dispute, and per-operation reference update.
- [ ] No regressions in existing component merge tests.
- [ ] Library version bumped (minor).
- [ ] Documentation or release notes mention the new behavior.

---

## 10. Implementation Checklist

1. [ ] Edit `packages/openapi-merge/src/paths-and-components.ts`:
   - Add `securitySchemes` block to the component merge loop (after callbacks).
   - Hook the `referenceModification` map to track scheme renames.
   
2. [ ] Edit `packages/openapi-merge/src/reference-walker.ts`:
   - Add `walkSecurityReferences(security, modify)` function.
   - Call it from `mergePathsAndComponents` after component merge, passing the rename map.

3. [ ] Edit `packages/openapi-merge/src/__tests__/security.test.ts` or create new `security-schemes.test.ts`:
   - Add 4+ test cases per section 6.

4. [ ] Run `yarn test` to verify all tests pass.

5. [ ] Update `packages/openapi-merge/package.json`: bump minor version.

6. [ ] Run `yarn lint` to ensure compliance.

7. [ ] (Optional) Update README or CHANGELOG to document the new behavior.
