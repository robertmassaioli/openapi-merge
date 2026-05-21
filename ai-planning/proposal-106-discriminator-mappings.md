# Implementation Proposal: Issue #106 — Discriminator Mappings Not Prefixed Under Disputes

**Issue**: [#106 Discriminator mappings not prefixed under disputes](https://github.com/robertmassaioli/openapi-merge/issues/106)

**Status:** Proposal

**Value:** 4 / **Effort:** 2

---

## 1. Issue Summary

When a dispute renames a schema component (e.g., `Pet` → `JiraPet` via a prefix), any `discriminator.mapping` values that reference the renamed schema are **not** rewritten, resulting in dangling references in the merged OpenAPI spec. This causes the output to be malformed: operations using the discriminator will fail to resolve the mapping values because they still point to the original (now-nonexistent or incorrectly-named) schema.

**Example:**
- Input 1: `Animal` schema with `discriminator: { propertyName: "type", mapping: { "dog": "Dog", "cat": "Cat" } }` and components `Dog`, `Cat`.
- Input 2 (with dispute `prefix: "Zoo"`): same schema structure, components `Dog` → `ZooDog`, `Cat` → `ZooCat`.
- **Current (buggy) output**: discriminator mapping still says `"dog": "Dog"` (wrong—should be `"ZooDog"`).

---

## 2. Root Cause Analysis

### OpenAPI discriminator structure

The OpenAPI 3.0 `Discriminator` object has the following shape:

```typescript
{
  propertyName: string;
  mapping?: { [value: string]: string };
}
```

The `mapping` field is optional. When present, values in the mapping can take **two forms**:

1. **Bare schema name** (most common): `"dog": "Dog"` — implies `#/components/schemas/Dog`.
2. **Full `$ref` string** (also valid): `"dog": "#/components/schemas/Dog"`.

Both forms can appear in the same mapping.

### Why references are missed today

In `packages/openapi-merge/src/reference-walker.ts`, the `walkSchemaReferences()` function (lines 5–44) recursively visits `$ref` objects and nested schemas across:

- `allOf`, `oneOf`, `anyOf`, `not`, `items`, `properties`, `additionalProperties`

However, it **does not visit `discriminator.mapping`** keys or values. This means when a dispute applies a prefix/suffix rename to a component (e.g., `Dog` → `ZooDog`), the reference-walker never sees the mapping strings and never updates them.

### Where disputes are applied

In `packages/openapi-merge/src/paths-and-components.ts` (around line 25–74 in `processComponents`), renamed components are tracked via `addModifiedReference(oldName, newName)`. Later, `walkAllReferences` (line 2 import, invoked during merge) updates all `$ref` strings in paths and components using a rename map. However, the rename map application stops short of `discriminator.mapping` because `walkSchemaReferences` never traverses there.

### Related issues

This is the same root cause as **#99** ("Mapping resolution under dispute prefix") and is part of the broader dispute-completeness cluster (#40, #105, #106) identified in `issue-triage-value-vs-effort.md` section 3.2.

---

## 3. Proposed Fix

### Step 1: Extend `walkSchemaReferences` to handle discriminator mappings

Modify `packages/openapi-merge/src/reference-walker.ts` to add discriminator mapping traversal at the end of the schema walk (before the closing brace of the `else` block, around line 42):

```typescript
export function walkSchemaReferences(schema: Swagger.Schema | Swagger.Reference, modify: Modify): void {
  if (TC.isReference(schema)) {
    schema.$ref = modify(schema.$ref);
  } else {
    // … existing code (allOf, oneOf, anyOf, not, items, properties, additionalProperties) …

    // NEW: Walk discriminator mappings (if present)
    if (schema.discriminator !== undefined && schema.discriminator.mapping !== undefined) {
      for (const mappingKey in schema.discriminator.mapping) {
        /* eslint-disable-next-line no-prototype-builtins */
        if (schema.discriminator.mapping.hasOwnProperty(mappingKey)) {
          const mappingValue = schema.discriminator.mapping[mappingKey];
          // Normalize both bare names and full $ref strings to a common form
          const normalized = normalizeDiscriminatorMappingValue(mappingValue);
          schema.discriminator.mapping[mappingKey] = modify(normalized);
        }
      }
    }
  }
}
```

### Step 2: Add a helper to normalize mapping values

Before `walkSchemaReferences`, add a helper function to convert bare schema names to full `$ref` strings so the existing `modify` function can handle both forms uniformly:

```typescript
/**
 * Normalise a discriminator mapping value to a full $ref string.
 *
 * OpenAPI allows mapping values to be either:
 *   - Bare schema names (e.g. "Dog" → "#/components/schemas/Dog")
 *   - Full $ref strings (e.g. "#/components/schemas/Dog")
 *
 * This function converts both to the full $ref form so that the
 * modify function can apply renames uniformly. After modify returns,
 * denormalise the result back to match the input form.
 *
 * @param value - the mapping value from discriminator.mapping
 * @returns the full $ref string
 */
function normalizeDiscriminatorMappingValue(value: string): string {
  if (value.startsWith('#/')) {
    // Already a full reference
    return value;
  }
  // Bare schema name; convert to full $ref
  return `#/components/schemas/${value}`;
}

/**
 * Denormalise a $ref string back to its original form (bare name or full $ref).
 *
 * This is the inverse of normalizeDiscriminatorMappingValue: if the input
 * value was a bare name, extract just the schema name; if it was a full $ref,
 * return the full $ref.
 *
 * @param normalised - the full $ref string returned by modify
 * @param original - the original mapping value (for form detection)
 * @returns the denormalised value in the same form as the original
 */
function denormaliseDiscriminatorMappingValue(normalised: string, original: string): string {
  if (original.startsWith('#/')) {
    // Input was a full $ref; keep it as a full $ref
    return normalised;
  }
  // Input was a bare name; extract the schema name from the $ref
  const match = normalised.match(/^#\/components\/schemas\/(.+)$/);
  return match ? match[1] : normalised; // fallback to full $ref if regex fails
}
```

### Step 3: Update the discriminator mapping walk to preserve the original form

Revise the walk logic to denormalise after modification:

```typescript
    // NEW: Walk discriminator mappings (if present)
    if (schema.discriminator !== undefined && schema.discriminator.mapping !== undefined) {
      for (const mappingKey in schema.discriminator.mapping) {
        /* eslint-disable-next-line no-prototype-builtins */
        if (schema.discriminator.mapping.hasOwnProperty(mappingKey)) {
          const originalValue = schema.discriminator.mapping[mappingKey];
          const normalized = normalizeDiscriminatorMappingValue(originalValue);
          const modified = modify(normalized);
          schema.discriminator.mapping[mappingKey] = denormaliseDiscriminatorMappingValue(modified, originalValue);
        }
      }
    }
```

---

## 4. Cross-Walker Impact

The fix lives in `walkSchemaReferences`, which is the canonical place all references are traversed in the library. This function is invoked by higher-level walkers:

- `walkComponentReferences` (line 228) — walks all schemas in `components.schemas`
- `walkParameterReferences` (line 65) — walks parameter schemas
- `walkHeaderReferences` (line 102) — walks header schemas
- `walkResponseReferences` (line 134) — walks response schemas
- `walkRequestBodyReferences` (line 89) — walks request body schemas
- `walkMediaTypeReferences` (line 52, internal) — walks media type schemas

Because discriminators can appear on any schema (nested in properties, inside parameters, inside response bodies, etc.), fixing it at the `walkSchemaReferences` level automatically applies the fix to **all contexts** where schemas are referenced. This is the correct design choice: every schema can have a discriminator, so every schema walk must handle it.

---

## 5. Backwards Compatibility

This is a **bug fix**, not a feature. Existing inputs whose discriminator mappings:

- Do not reference disputed components → unchanged.
- Reference disputed components → now correctly rewritten (they were broken before).

**No breaking changes to the public API** (`openapi-merge/src/data.ts`). The fix is entirely internal to the reference-walker.

**Version bump:** Patch (or minor, if bundled with #99, #105 per the roadmap).

---

## 6. Tests

Add new Jest test cases to `packages/openapi-merge/src/__tests__/components.test.ts` (or create a new `discriminator.test.ts` file for clarity). Cover:

### Test 1: Bare discriminator mapping name under dispute

```typescript
it('rewrites bare discriminator mapping names when schema is disputed', () => {
  const first: Swagger.SwaggerV3 = toOAS({}, {
    Animal: {
      type: 'object',
      discriminator: {
        propertyName: 'petType',
        mapping: {
          'dog': 'Dog',
          'cat': 'Cat'
        }
      },
      oneOf: [
        { $ref: '#/components/schemas/Dog' },
        { $ref: '#/components/schemas/Cat' }
      ]
    },
    Dog: { type: 'object', properties: { breed: { type: 'string' } } },
    Cat: { type: 'object', properties: { color: { type: 'string' } } }
  });

  const second: Swagger.SwaggerV3 = toOAS({}, {
    Animal: { /* ... same ... */ },
    Dog: { /* ... same ... */ },
    Cat: { /* ... same ... */ }
  });

  const firstInput: SingleMergeInput = { oas: first };
  const secondInput: SingleMergeInput = {
    oas: second,
    dispute: { prefix: 'Zoo' }
  };

  const result = merge([firstInput, secondInput]);
  expect(isErrorResult(result)).toBe(false);

  if (!isErrorResult(result)) {
    const animal = result.output.components.schemas?.Animal;
    expect(animal.discriminator.mapping).toEqual({
      'dog': 'ZooDog',
      'cat': 'ZooCat'
    });
  }
});
```

### Test 2: Full $ref discriminator mapping under dispute

```typescript
it('rewrites full $ref discriminator mapping values when schema is disputed', () => {
  const first: Swagger.SwaggerV3 = toOAS({}, {
    Animal: {
      type: 'object',
      discriminator: {
        propertyName: 'petType',
        mapping: {
          'dog': '#/components/schemas/Dog',
          'cat': '#/components/schemas/Cat'
        }
      },
      /* ... oneOf ... */
    },
    Dog: { /* ... */ },
    Cat: { /* ... */ }
  });

  const second: Swagger.SwaggerV3 = toOAS({}, { /* same schemas */ });

  const firstInput: SingleMergeInput = { oas: first };
  const secondInput: SingleMergeInput = {
    oas: second,
    dispute: { prefix: 'Zoo' }
  };

  const result = merge([firstInput, secondInput]);
  expect(isErrorResult(result)).toBe(false);

  if (!isErrorResult(result)) {
    const animal = result.output.components.schemas?.Animal;
    expect(animal.discriminator.mapping).toEqual({
      'dog': '#/components/schemas/ZooDog',
      'cat': '#/components/schemas/ZooCat'
    });
  }
});
```

### Test 3: Discriminator in a parameter schema under dispute

```typescript
it('rewrites discriminator mappings nested in a parameter schema under dispute', () => {
  const first: Swagger.SwaggerV3 = {
    openapi: '3.0.3',
    info: { title: 'Test', version: '1.0' },
    paths: {
      '/pet': {
        post: {
          parameters: [
            {
              name: 'filter',
              in: 'query',
              schema: {
                discriminator: {
                  propertyName: 'type',
                  mapping: { 'dog': 'Dog', 'cat': 'Cat' }
                },
                oneOf: [
                  { $ref: '#/components/schemas/Dog' },
                  { $ref: '#/components/schemas/Cat' }
                ]
              }
            }
          ],
          responses: { '200': { description: 'OK' } }
        }
      }
    },
    components: {
      schemas: {
        Dog: { type: 'object' },
        Cat: { type: 'object' }
      }
    }
  };

  const second: Swagger.SwaggerV3 = toOAS({}, {
    Dog: { type: 'object' },
    Cat: { type: 'object' }
  });

  const firstInput: SingleMergeInput = { oas: first };
  const secondInput: SingleMergeInput = {
    oas: second,
    dispute: { prefix: 'Zoo' }
  };

  const result = merge([firstInput, secondInput]);
  expect(isErrorResult(result)).toBe(false);

  if (!isErrorResult(result)) {
    const paramSchema = result.output.paths['/pet'].post.parameters[0].schema;
    expect(paramSchema.discriminator.mapping).toEqual({
      'dog': 'ZooDog',
      'cat': 'ZooCat'
    });
  }
});
```

### Test 4: Mixed bare names and $refs in the same mapping

```typescript
it('handles mixed bare names and $refs in the same mapping', () => {
  // One input uses bare names, another uses full $refs (both valid per OpenAPI spec)
  const first: Swagger.SwaggerV3 = toOAS({}, {
    Animal: {
      discriminator: {
        propertyName: 'type',
        mapping: { 'dog': 'Dog' }  // bare name
      },
      oneOf: [{ $ref: '#/components/schemas/Dog' }]
    },
    Dog: { type: 'object' }
  });

  const second: Swagger.SwaggerV3 = toOAS({}, {
    Animal: {
      discriminator: {
        propertyName: 'type',
        mapping: { 'cat': '#/components/schemas/Cat' }  // full $ref
      },
      oneOf: [{ $ref: '#/components/schemas/Cat' }]
    },
    Cat: { type: 'object' }
  });

  const firstInput: SingleMergeInput = { oas: first };
  const secondInput: SingleMergeInput = {
    oas: second,
    dispute: { prefix: 'Zoo' }
  };

  const result = merge([firstInput, secondInput]);
  expect(isErrorResult(result)).toBe(false);

  if (!isErrorResult(result)) {
    const animal = result.output.components.schemas?.Animal;
    // First input's bare name should stay bare; second input's $ref should stay a $ref
    expect(animal.discriminator.mapping['dog']).toBe('ZooDog');
    expect(animal.discriminator.mapping['cat']).toBe('#/components/schemas/ZooCat');
  }
});
```

---

## 7. Cross-Link Related Issues

This fix resolves the following issues as part of the **"Dispute Completeness"** cluster identified in the roadmap:

- **#99** — "Mapping resolution under dispute prefix" — same root cause, should ship together.
- **#40** — General dispute/rename concerns.
- **#105** — Another aspect of dispute handling completeness.

All should be bundled into a single minor release once #99 is confirmed to have the same fix or a compatible one.

---

## 8. Effort Estimate

**Value: 4 / Effort: 2**

### Justification

**Code changes:**
- `reference-walker.ts`: +35 lines (two helper functions + discriminator walk logic, with JSDoc).
- Jest tests: +120 lines (4 test suites covering bare names, full $refs, nested parameter schemas, mixed forms).
- **Total: ~155 lines**, mostly tests.

**Why Effort = 2:**
- The fix is **localized** to one module (`reference-walker.ts`).
- The logic is **straightforward** (normalize, modify, denormalise).
- No CLI configuration changes; no schema generation needed.
- No changes to public API types.
- Existing test utilities can be reused.

**Why not Effort = 1:**
- Requires careful handling of two value forms (bare vs. full $ref) to preserve semantics.
- Test coverage is appropriately comprehensive (4 scenarios).

---

## 9. Acceptance Criteria

- [ ] `normalizeDiscriminatorMappingValue` and `denormaliseDiscriminatorMappingValue` helper functions added to `reference-walker.ts` with JSDoc.
- [ ] `walkSchemaReferences` extended to walk `schema.discriminator.mapping` (if present), normalizing values before calling `modify` and denormalizing after.
- [ ] Jest test suite includes 4 test cases: bare names, full $refs, nested in parameters, mixed forms in a single mapping.
- [ ] All tests pass; no regressions in existing test suites (98/98 jest tests green).
- [ ] ESLint passes with `--fix` on modified files.
- [ ] `tsc --noEmit` clean for the library.
- [ ] Manual e2e test (via `yarn test` or direct merge invocation) confirms discriminator mappings are updated when dispute prefix is applied.
- [ ] **Recommendation:** Ship together with #99 when confirmed compatible; coordinate in a single minor version bump.
- [ ] Version bump: minor (e.g., `1.5.0` → `1.6.0`), since this adds completeness to an existing feature (dispute handling).

---

## 10. Implementation Notes

1. **Order of application**: The helpers must correctly handle both input forms. Use defensive assertions (`/* eslint-disable-next-line no-prototype-builtins */`) to avoid prototype pollution, matching the style already used in `reference-walker.ts` (line 34, line 0).

2. **Form preservation**: The denormalise function uses a regex to extract the schema name. If the regex fails (malformed input), it falls back to returning the full $ref; this is safe because the OpenAPI spec will catch malformed refs during validation.

3. **Discriminator optional**: Only walk mappings if both `schema.discriminator` and `schema.discriminator.mapping` are defined. Bare discriminators without mappings require no action (they don't reference schemas by name).

4. **No changes to `dispute.ts` or `paths-and-components.ts`**: The fix is transparent to the dispute application logic; `applyDispute` continues to work as before, and the reference-walker automatically applies the renames to mappings.

5. **Testing pattern**: Follow the existing pattern in `components.test.ts` using `toOAS()` and `toMergeInputs()` helpers. The new tests can coexist in the same file or in a dedicated `discriminator.test.ts` for clarity.

---

## 11. Risks & Notes

1. **Spec interpretation**: The OpenAPI 3.0 spec allows both bare names and full `$ref` strings in discriminator mappings. Some tools may not handle this correctly, but we should preserve the original form to avoid introducing regressions in user schemas.

2. **Normalization edge case**: A bare name like `"#/foo"` (unlikely but syntactically valid) would be misinterpreted as a $ref by the normalization function. In practice, schema names follow identifier rules and do not contain slashes, so this is not a real risk. If needed, we could add a stricter check (e.g., no forward slash in the bare name).

3. **Future discriminator features**: OpenAPI 3.1 may introduce new discriminator fields. Keep the normalise/denormalise logic generic; adding support for new fields will only require adding new walk calls (no changes to the helper functions).

4. **Compatibility with #99**: Confirm that #99's proposed fix (if any) does not duplicate this logic. Both issues should reference each other in their implementation PRs to ensure coordinated review.
