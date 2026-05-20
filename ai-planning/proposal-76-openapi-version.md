# Implementation Proposal: Issue #76 — Configurable OpenAPI Version

**Issue:** [#76 — fixing openapi version](https://github.com/robertmassaioli/openapi-merge/issues/76)

**Summary:** The library currently hard-codes `openapi: '3.0.3'` regardless of input versions. Tools like Postman are strict about the emitted version. This proposal enables version preservation/override without breaking existing code.

---

## 1. Design Options

### Option A: Auto-derive from first input
- Automatically use the first input's `openapi` field if present.
- Fallback to `'3.0.3'` if not set.
- **Pros:** Cheap, aligns with existing "first-wins" philosophy, intuitive.
- **Cons:** Surprising if the first input is a stub or non-standard version.

### Option B: Explicit top-level override only
- Add optional `openapi: string` field to CLI `Configuration`.
- No auto-derivation; explicit control only.
- **Pros:** Explicit is better than implicit; no surprises.
- **Cons:** Requires users to manually specify when they want preservation.

### Option C: Both auto-derive + explicit override (✓ **Recommended**)
- Try to derive from first input's `openapi` field.
- If an explicit override is configured, use that instead.
- **Pros:** Sensible defaults + explicit escape hatch; minimal surface; no foot-guns.
- **Cons:** Slight added complexity, but well worth the UX gain.

---

## 2. API Design

### Library (`packages/openapi-merge`)

**Current signature:**
```typescript
export function merge(inputs: MergeInput): MergeResult
```

**Proposal:** Introduce an optional second parameter to avoid breaking the public type:
```typescript
export interface MergeOptions {
  /**
   * Override the OpenAPI version in the merged output. 
   * If not provided, derives from the first input's `openapi` field (fallback: '3.0.3').
   * Must be one of: '3.0.0', '3.0.1', '3.0.2', '3.0.3'
   */
  openapiVersion?: string;
}

export function merge(inputs: MergeInput, options?: MergeOptions): MergeResult
```

**In `index.ts`:**
- Extract `openapiVersion` from options or auto-derive: `inputs[0]?.oas?.openapi ?? '3.0.3'`.
- Validate against allowed versions; reject `2.x` and `3.1.x` with actionable error pointing to issue #113.
- Pass the resolved version to the output object.

### CLI (`packages/openapi-merge-cli`)

**Extend `Configuration` type in `src/data.ts`:**
```typescript
export type Configuration = {
  inputs: ConfigurationInput[];
  output: string;
  
  /**
   * Optional: Override the OpenAPI version in the merged output.
   * If not provided, derives from the first input's `openapi` field.
   * Supported versions: '3.0.0', '3.0.1', '3.0.2', '3.0.3'
   * 
   * @pattern ^3\.0\.[0-3]$
   */
  openapi?: string;
};
```

**In `src/index.ts`:**
- Pass `config.openapi` (if present) as `options.openapiVersion` to the library's `merge()`.

---

## 3. Validation

**Allowed versions:** `'3.0.0'`, `'3.0.1'`, `'3.0.2'`, `'3.0.3'` only.

**Validation logic:**
```typescript
const ALLOWED_VERSIONS = ['3.0.0', '3.0.1', '3.0.2', '3.0.3'];

function validateOpenApiVersion(version: string): void | ErrorMergeResult {
  if (!ALLOWED_VERSIONS.includes(version)) {
    if (version.startsWith('2.')) {
      return {
        type: 'unsupported-openapi-version',
        message: `OpenAPI 2.x (Swagger) is not supported. Please use an OpenAPI 3.0.x spec.`
      };
    }
    if (version.startsWith('3.1')) {
      return {
        type: 'unsupported-openapi-version',
        message: `OpenAPI 3.1.x is not yet supported. See issue #113.`
      };
    }
    return {
      type: 'unsupported-openapi-version',
      message: `Invalid OpenAPI version: '${version}'. Must be one of: ${ALLOWED_VERSIONS.join(', ')}`
    };
  }
}
```

Add `'unsupported-openapi-version'` to the `ErrorType` union in `data.ts`.

---

## 4. Implementation Steps

1. **Extend `data.ts` (library):**
   - Add `MergeOptions` interface with optional `openapiVersion?: string`.
   - Export the new interface.
   - Add `'unsupported-openapi-version'` to `ErrorType`.

2. **Update `index.ts` (library):**
   - Change signature: `export function merge(inputs: MergeInput, options?: MergeOptions)`.
   - Before building the output, resolve the version:
     ```typescript
     const version = options?.openapiVersion ?? inputs[0]?.oas?.openapi ?? '3.0.3';
     const versionError = validateOpenApiVersion(version);
     if (versionError) return versionError;
     ```
   - Replace the hardcoded `openapi: '3.0.3'` with the resolved `version`.

3. **Update `Configuration` type (CLI):**
   - Add optional `openapi?: string` field with JSDoc annotation and JSON Schema constraints.

4. **Update `src/index.ts` (CLI):**
   - When calling `merge()`, pass: `merge(inputs, { openapiVersion: config.openapi })`.

5. **Regenerate the JSON Schema:**
   ```bash
   bolt w openapi-merge-cli run gen-schema
   ```

6. **Update test helper (`oas-generation.ts`):**
   - The helper's hardcoded `'3.0.3'` can remain; it's not user-facing.

---

## 5. Tests

Add to `packages/openapi-merge/src/__tests__/index.test.ts`:

```typescript
describe('merge - OpenAPI version handling', () => {
  it('should default to 3.0.3 when no version is specified', () => {
    const result = merge([{ oas: minimumValidOas }]);
    expect(result.output?.openapi).toBe('3.0.3');
  });

  it('should derive version from first input when available', () => {
    const oas300 = { ...minimumValidOas, openapi: '3.0.0' };
    const result = merge([{ oas: oas300 }]);
    expect(result.output?.openapi).toBe('3.0.0');
  });

  it('should override derived version with explicit option', () => {
    const oas300 = { ...minimumValidOas, openapi: '3.0.0' };
    const result = merge([{ oas: oas300 }], { openapiVersion: '3.0.2' });
    expect(result.output?.openapi).toBe('3.0.2');
  });

  it('should reject OpenAPI 2.x with actionable error', () => {
    const result = merge([{ oas: minimumValidOas }], { openapiVersion: '2.0' });
    expect(isErrorResult(result)).toBe(true);
    expect((result as any).type).toBe('unsupported-openapi-version');
    expect((result as any).message).toContain('Swagger');
  });

  it('should reject OpenAPI 3.1.x with pointer to issue #113', () => {
    const result = merge([{ oas: minimumValidOas }], { openapiVersion: '3.1.0' });
    expect(isErrorResult(result)).toBe(true);
    expect((result as any).message).toContain('#113');
  });

  it('should reject unsupported 3.0.x versions', () => {
    const result = merge([{ oas: minimumValidOas }], { openapiVersion: '3.0.5' });
    expect(isErrorResult(result)).toBe(true);
  });
});
```

---

## 6. Documentation Updates

### Library README
Add a section:
```markdown
### Controlling the OpenAPI Version

By default, the merged output uses OpenAPI 3.0.3. You can customize this:

**Option 1: Auto-derive from first input**
If your first input specifies an `openapi` field (e.g., `3.0.0`), it will be used.

**Option 2: Explicit override**
```typescript
const result = merge(inputs, { openapiVersion: '3.0.2' });
```

Supported versions: `3.0.0`, `3.0.1`, `3.0.2`, `3.0.3` only.
```

### CLI README / Configuration Schema
Update the `Configuration` section to document the new optional `openapi` field:
```markdown
#### `openapi` (optional)
Type: string  
Pattern: `^3\.0\.[0-3]$`  
Default: Derived from first input (fallback: `3.0.3`)

Override the OpenAPI version in the merged output. Must be one of `3.0.0`, `3.0.1`, `3.0.2`, or `3.0.3`.

Example:
```json
{
  "inputs": [...],
  "output": "./merged.json",
  "openapi": "3.0.0"
}
```

---

## 7. Backwards Compatibility & Versioning

- **Breaking changes:** None. The second parameter is optional and defaults to the current behaviour.
- **Version bumps:** `minor` for both `openapi-merge` and `openapi-merge-cli`.
- **Deprecation notes:** No deprecations required.

---

## 8. Effort & Value Estimate

- **Value:** 4/5 — fixes real integration pain (Postman, strict validators), aligns with first-input-wins philosophy.
- **Effort:** 1/5 — only two hardcoded occurrences (`index.ts` and test helper). Simple type extension, straightforward validation.
  - Library changes: ~30 lines (function signature, validation, output assignment).
  - CLI changes: ~10 lines (configuration field, pass-through).
  - Tests: ~40 lines.
  - Schema regeneration: automatic.

**ROI: 4/1 = 4.0 (excellent)**

---

## 9. Acceptance Criteria

- [ ] `merge()` accepts optional `MergeOptions` parameter.
- [ ] Library auto-derives OpenAPI version from first input's `openapi` field when available.
- [ ] Explicit `openapiVersion` in options overrides any derived or default version.
- [ ] Validation rejects `2.x`, `3.1.x`, and unsupported `3.0.x` versions with actionable errors.
- [ ] CLI `Configuration` accepts optional `openapi` field in config file.
- [ ] CLI passes the config's `openapi` field through to the library as `options.openapiVersion`.
- [ ] `configuration.schema.json` is regenerated and includes the new field with pattern constraint.
- [ ] All existing tests pass; new test cases cover default, derive, override, and error paths.
- [ ] `README.md` (library and CLI) documents the feature.
- [ ] Version-to-version end-to-end test confirms Postman-style tools accept the output.
- [ ] No breaking changes to the public API.
