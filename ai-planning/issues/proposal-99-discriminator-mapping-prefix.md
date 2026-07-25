# Implementation Proposal: Issue #99 — Discriminator Mapping Not Renamed Under Dispute Prefix

**Issue:** [#99 — Issue on discriminator mapping](https://github.com/robertmassaioli/openapi-merge/issues/99)

**Status:** Proposal

**Value:** 4 / **Effort:** 2 / **Incremental Effort (bundled with #106):** 0

---

## 1. Issue Summary

When a dispute renames a schema component (e.g., `Pet` → `JiraPet` via a prefix), the `discriminator.mapping` values that reference the renamed schema are **not** rewritten. This leaves the merged OpenAPI spec internally inconsistent: the `oneOf` array is correctly updated to use `#/components/schemas/JiraPet`, but the discriminator mapping still points to the original `Pet`, breaking schema resolution at runtime.

**Concrete example from issue #99:**
- Input 1 has a discriminator with mapping: `{ "pet": "#/components/schemas/Pet", "pet2": "#/components/schemas/Pet2" }`.
- When merged with a dispute prefix `"openapi1"`, the schemas are renamed to `openapi1Pet` and `openapi1Pet2`.
- The `oneOf` references are correctly updated: `$ref: '#/components/schemas/openapi1Pet'`.
- **But the mapping is not updated** and still reads: `{ "pet": "#/components/schemas/Pet", ... }` — a dangling reference.

---

## 2. Relationship to Issue #106

**#106** ("Discriminator Mappings Not Prefixed Under Disputes") is the **implementation-side** lens on the same root cause. **#99** is the **acceptance-test** lens — the user-facing symptom report.

**Key overlap:**
- Both describe the exact same bug: `discriminator.mapping` values are not walked when disputes rename schemas.
- Both require the same fix: extend `walkSchemaReferences` in `reference-walker.ts` to visit and rewrite discriminator mapping values.
- Both should ship together in the same minor release.

**Distinction:**
- **#106 proposal** covers the implementation details: how to normalize/denormalize mapping values (bare names vs. full `$ref` strings), where to hook into the walk, and how to preserve the original form.
- **#99 proposal** (this document) focuses on the acceptance criteria and edge cases specific to prefix/suffix disputes, and confirms that #106's fix also resolves #99's symptom.

**Recommendation:** Treat #99 as the test case specification and #106 as the implementation plan. Both should reference each other; PRs implementing the fix should cite both issues.

---

## 3. Reproducer

### Input 1: `openapi1.yml`

```yaml
openapi: 3.0.3
info:
  title: API 1
  version: 1.0.0
paths:
  /pet:
    post:
      operationId: addPet
      requestBody:
        content:
          application/json:
            schema:
              oneOf:
                - $ref: '#/components/schemas/Pet'
                - $ref: '#/components/schemas/Pet2'
              discriminator:
                propertyName: name
                mapping:
                  pet: '#/components/schemas/Pet'
                  pet2: '#/components/schemas/Pet2'
      responses:
        '200':
          description: OK
components:
  schemas:
    Pet:
      type: object
      properties:
        name:
          type: string
    Pet2:
      type: object
      properties:
        name:
          type: string
        age:
          type: integer
```

### Input 2: `openapi2.yml`

```yaml
openapi: 3.0.3
info:
  title: API 2
  version: 1.0.0
paths:
  /animal:
    get:
      operationId: getAnimal
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Dog'
components:
  schemas:
    Dog:
      type: object
      properties:
        name:
          type: string
```

### Merge Configuration

```json
{
  "inputs": [
    {
      "inputFile": "openapi1.yml",
      "dispute": { "prefix": "openapi1" }
    },
    {
      "inputFile": "openapi2.yml"
    }
  ],
  "output": "merged.json"
}
```

---

## 4. Expected vs. Actual Output

### Expected (Correct)

The discriminator mapping should reflect the renamed schema names:

```yaml
paths:
  /pet:
    post:
      requestBody:
        content:
          application/json:
            schema:
              oneOf:
                - $ref: '#/components/schemas/openapi1Pet'
                - $ref: '#/components/schemas/openapi1Pet2'
              discriminator:
                propertyName: name
                mapping:
                  pet: '#/components/schemas/openapi1Pet'
                  pet2: '#/components/schemas/openapi1Pet2'
components:
  schemas:
    openapi1Pet:
      type: object
      properties:
        name:
          type: string
    openapi1Pet2:
      type: object
      properties:
        name:
          type: string
        age:
          type: integer
    Dog:
      type: object
      properties:
        name:
          type: string
```

### Actual (Broken)

The mapping values remain unchanged, referencing non-existent (or wrong) component names:

```yaml
paths:
  /pet:
    post:
      requestBody:
        content:
          application/json:
            schema:
              oneOf:
                - $ref: '#/components/schemas/openapi1Pet'  # ✓ Correct
                - $ref: '#/components/schemas/openapi1Pet2' # ✓ Correct
              discriminator:
                propertyName: name
                mapping:
                  pet: '#/components/schemas/Pet'           # ✗ Wrong (should be openapi1Pet)
                  pet2: '#/components/schemas/Pet2'         # ✗ Wrong (should be openapi1Pet2)
```

---

## 5. Additional Edge Cases for Test Coverage

Beyond the basic reproducer in #106's proposal, #99 highlights several edge cases that deserve explicit test cases:

### 5.1 Bare Names in Discriminator Mapping (vs. Full `$ref` Strings)

Some OpenAPI authors use bare component names in mappings instead of full `#/components/schemas/X` references:

```yaml
discriminator:
  propertyName: kind
  mapping:
    dog: Dog          # Bare name, not '#/components/schemas/Dog'
    cat: Cat
```

When disputed with prefix `"api1"`, this should become:

```yaml
discriminator:
  propertyName: kind
  mapping:
    dog: api1Dog      # Bare name updated
    cat: api1Cat
```

**Test case requirement:** Ensure bare names are rewritten correctly under dispute, and the original form (bare vs. full `$ref`) is preserved in the output.

### 5.2 Mixed Mappings in the Same Object

A real-world discriminator might have inconsistent styles:

```yaml
discriminator:
  propertyName: type
  mapping:
    type_a: '#/components/schemas/TypeA'    # Full $ref
    type_b: TypeB                            # Bare name
    type_c: '#/components/schemas/TypeC'    # Full $ref
```

Under dispute prefix `"svc1"`, all three must be rewritten consistently:

```yaml
discriminator:
  propertyName: type
  mapping:
    type_a: '#/components/schemas/svc1TypeA'
    type_b: svc1TypeB
    type_c: '#/components/schemas/svc1TypeC'
```

### 5.3 Discriminator Mapping Key Collisions Across Inputs

Consider two inputs where the discriminator key is the same but the component name differs:

- Input 1: `mapping: { "animal": "Pet" }`
- Input 2: `mapping: { "animal": "Dog" }`

Under a no-dispute merge, these should dedup if the values are identical; under dispute, both schemas are renamed independently, so the keys might collide. The merge should either error or apply dispute logic consistently to both. This is a policy question (covered in proposal #106's "conflict policies") but #99 should call it out as a scenario.

### 5.4 Discriminator Mapping on Nested Schemas

Discriminators can appear nested inside properties, request bodies, response bodies, and parameters. The dispute fix must apply uniformly:

```yaml
components:
  schemas:
    Container:
      type: object
      properties:
        payload:
          oneOf:
            - $ref: '#/components/schemas/TypeA'
            - $ref: '#/components/schemas/TypeB'
          discriminator:
            propertyName: kind
            mapping:
              a: '#/components/schemas/TypeA'
              b: '#/components/schemas/TypeB'
```

When the schema is renamed via dispute, the nested discriminator mapping must also be updated.

### 5.5 Empty Discriminator Mapping

Some specs define a discriminator but leave the mapping empty:

```yaml
discriminator:
  propertyName: type
  mapping: {}
```

This should not crash; it should pass through unchanged (no rewriting needed).

---

## 6. How the #106 Fix Covers #99

The implementation proposed in #106 — extending `walkSchemaReferences` to visit `discriminator.mapping` values — directly resolves #99. The acceptance criteria for this proposal are:

- [ ] **Test: Bare names in discriminator mapping are renamed under dispute prefix**
  - Input with `mapping: { "pet": "Pet", "pet2": "Pet2" }` and dispute prefix `"svc"`.
  - Output should have `mapping: { "pet": "svcPet", "pet2": "svcPet2" }`.
  
- [ ] **Test: Full `$ref` strings in discriminator mapping are renamed under dispute prefix**
  - Input with `mapping: { "pet": "#/components/schemas/Pet", ... }` and dispute prefix `"svc"`.
  - Output should have `mapping: { "pet": "#/components/schemas/svcPet", ... }`.

- [ ] **Test: Mixed bare and full refs are handled correctly**
  - Input with mixed styles; output preserves the original style for each value.

- [ ] **Test: Nested discriminators in properties/parameters/responses are all renamed**
  - Input with discriminator inside a property schema, parameter schema, and response body schema.
  - All three should have their mappings rewritten under dispute.

- [ ] **Test: Discriminator mapping on renamed component is consistent with oneOf**
  - Input with `oneOf: [$ref: Pet, ...]` and `mapping: { "pet": Pet, ... }`.
  - Both should be renamed identically under dispute.

- [ ] **Test: Empty discriminator mapping does not crash**
  - Input with `discriminator: { propertyName: "type", mapping: {} }`.
  - Should pass through unchanged.

---

## 7. Backwards Compatibility

This is a pure bug fix with no breaking changes to the public API:

- **Input shape** unchanged: `SingleMergeInput` and `dispute` remain the same.
- **Output schema** unchanged: the merged OpenAPI still has the same shape; only the content is corrected.
- **Deprecation**: No deprecated features are affected.
- **Dispute logic**: The same `applyDispute()` function is used; no behavior change there.

**Version bump:** Patch or minor version bump; the fix is non-breaking.

---

## 8. Cross-Link to Dispute Completeness Cluster

This issue is part of the **dispute completeness** cluster alongside:
- **#40** — `operationId` not renamed when `alwaysApply: true`.
- **#105** — Callback `operationId` not included in dispute.
- **#106** — Discriminator mappings not renamed (implementation plan).
- **#111** — Wildcard support in include/excludeTags.

**Recommended bundling:** All five issues should be resolved in a single "Dispute Completeness" minor release, with coordinated PRs and test coverage across all scenarios.

---

## 9. Effort Estimate

| Aspect | Estimate |
|--------|----------|
| Design + code review | Negligible (spec already written in #106) |
| Implementation (reference-walker change) | Included in #106 |
| **Incremental effort for #99 over #106** | **~0 hours** |
| Tests (already in #106 + additional edge cases here) | ~1 hour (to add bare-name, nested, and empty-mapping tests) |
| Documentation / release notes | ~0.5 hours |
| **Total incremental cost** | **~1.5 hours** |

**Justification:** The fix is entirely covered by the implementation in #106. This proposal adds no new implementation burden; it only specifies the acceptance tests that confirm #106's fix also resolves #99. The tests mentioned in section 6 should be added to the PR that implements #106.

---

## 10. Acceptance Criteria

- [ ] All test cases from section 6 pass (bare names, full refs, mixed, nested, empty mapping).
- [ ] Merged spec with discriminator mapping under dispute prefix is internally consistent: the `mapping` values match the renamed `oneOf` schemas.
- [ ] Round-trip preservation: if the input used bare names, the output uses bare names; if full refs, the output uses full refs.
- [ ] No error on empty `discriminator.mapping`.
- [ ] All existing tests (components, paths, etc.) still pass.
- [ ] Proposal #106 is merged and passing tests before or simultaneous with #99 tests being added.

---

## 11. Implementation Notes

1. **Hook point:** The fix goes into `walkSchemaReferences` in `reference-walker.ts`, as described in #106.
2. **Helper functions:** The normalization / denormalization helpers (`normalizeDiscriminatorMappingValue`, `denormalizeDiscriminatorMappingValue`) are specified in #106; no changes needed here.
3. **Order of merging:** Complete #106 first; then add the #99-specific test cases to the PR.
4. **Test file:** Add tests to `packages/openapi-merge/src/__tests__/components.test.ts` (or a dedicated `discriminator.test.ts` if the test suite becomes large).

---

## 12. Risks & Notes

1. **Test coverage:** Ensure the test matrix covers both `DisputePrefix` and `DisputeSuffix`, and both `alwaysApply` modes.
2. **Compatibility with OpenAPI tools:** Some third-party tools may not handle bare names in discriminator mappings correctly. By preserving the original form (bare vs. full ref), we avoid introducing regressions.
3. **Future work:** After #106 and #99 are merged, consider extending discriminator handling to callback discriminators (if those exist in the spec) as a follow-up.

