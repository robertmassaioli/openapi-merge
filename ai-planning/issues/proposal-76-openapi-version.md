# Implementation Proposal: Issue #76 — Configurable OpenAPI Version

**Issue:** [#76 — fixing openapi version](https://github.com/robertmassaioli/openapi-merge/issues/76)

**Summary:** The library currently hard-codes `openapi: '3.0.3'` regardless of input versions. Tools like Postman are strict about the emitted version. This proposal enables version preservation/override without breaking existing code.

---

## 1. OpenAPI version compatibility (mandatory background)

This section sets the rules every option in §2 must obey. None of the
configurable strategies are allowed to violate them.

- **3.0.0 → 3.0.1 → 3.0.2 → 3.0.3 are patch releases** of the same minor
  spec. Each adds only clarifications and example fixes; no new constructs
  are introduced and no existing construct changes shape. Therefore a
  document declaring `openapi: 3.0.0` is *by construction* also a valid
  3.0.3 document, and vice versa. Re-labelling a 3.0.x document with any
  other 3.0.x patch is **safe**.
- **3.0.x → 3.1.x is NOT backwards compatible.** 3.1 aligns with JSON
  Schema 2020-12 and introduces breaking changes (`nullable` removed in
  favour of type arrays; `example` deprecated in favour of `examples`;
  `exclusiveMinimum/Maximum` change from boolean to numeric; webhooks
  added; etc.). A 3.1.x document that uses any of these constructs cannot
  be safely re-labelled as 3.0.x.
- **2.0 (Swagger) → 3.x has a different document shape.** Not a version
  bump; would require a real converter and is out of scope (see #110).

Concrete rules this proposal enforces in code:

1. Re-labelling **within a single `major.minor` line** is always allowed.
2. Re-labelling **across `major.minor` lines** is **never** done automatically.
   Any strategy that would have to do so MUST fail with a clear error.
3. The CLI / library never *transforms* the document contents; the
   `openapi` field is the only thing that changes. So if the user
   explicitly says `'3.1.0'` and any input uses removed-in-3.1 constructs,
   the tool is producing an invalid document — this is the user's call.
   We emit a single warning in that case (best-effort) but do not block.

---

## 2. Design Options

The four strategies below all coexist as variants of a single discriminated
union. The default keeps today's behaviour (`'3.0.3'`); the others are
opt-in. The strategy is set globally on `MergeOptions`, not per-input —
the output document has exactly one `openapi` field.

### Option A: `{ strategy: 'fixed', version: string }` — **today's behaviour, the default**
- Always emit the given version (default `'3.0.3'`). Exactly what the
  library does today when `version` is unset.
- **Pros:** Zero surprises, zero churn for existing users.
- **Cons:** User must remember to update if Postman / other tooling cares.

### Option B: `{ strategy: 'first-input' }` — explicit "use input[0]'s declared version"
- Reads `inputs[0].oas.openapi`. If that input has no `openapi` field
  (malformed), falls back to `'3.0.3'` and warns.
- **Pros:** Aligns with the rest of the library's first-wins philosophy
  (info, servers, security…).
- **Cons:** Surprising if `input[0]` is a stub at an old version.

### Option C: `{ strategy: 'highest-input' }` — pick the highest 3.0.x patch across all inputs (✓ **Recommended for most users**)
- Walks every input's `openapi` field, groups by `major.minor`, and emits
  the highest patch within that line.
- If inputs span multiple `major.minor` lines (e.g. one 3.0.2, one
  3.1.0), this option **errors out** with `output-version-conflict`
  rather than silently coercing — that would violate §1 rule 2.
- If an input has no `openapi` field, it is skipped for the max
  computation; if no inputs have an `openapi` field at all, fall back to
  `'3.0.3'` and warn.
- **Pros:** Preserves the most-conservative claim that's still valid for
  every input; safer than "first-input" when the first input is a stub;
  matches what a careful human would do.
- **Cons:** Slightly more code to write and test.

### Option D: Combination via the discriminated union (✓ **Recommended overall shape**)
Expose all three as variants of a single discriminated union. The default
stays `{ strategy: 'fixed', version: '3.0.3' }` so no existing user
regresses. `'highest-input'` is the recommendation in the README. Users
who need a hard pin keep using `'fixed'`.

```ts
type OutputOpenApiVersion =
  | { strategy: 'fixed'; version: string }
  | { strategy: 'first-input' }
  | { strategy: 'highest-input' };

interface MergeOptions {
  /**
   * How to choose the `openapi` field of the merged output. Default:
   * { strategy: 'fixed', version: '3.0.3' } (preserves historical behaviour).
   * 'highest-input' is recommended for most users because it picks the
   * most-conservative version that's still valid for every input.
   */
  openapiVersion?: OutputOpenApiVersion;
}
```

A nullary tagged object is verbose (`{ strategy: 'highest-input' }`) but it
keeps every variant on the same shape so an exhaustiveness check via
`assertNever` is trivial. We pay the four extra characters at config
sites for compile-time guarantees that any future variant we add (e.g.
`{ strategy: 'lowest-input' }`, `{ strategy: 'derived-from-inputs', max: '3.0.x' }`)
gets a compile error at every dispatch site.

---

## 3. API Design

### Library (`packages/openapi-merge`)

**Current signature:**
```typescript
export function merge(inputs: MergeInput): MergeResult
```

**Proposal:** Introduce an optional second parameter to avoid breaking the public type. Cross-link: this same shared `MergeOptions` is the second-arg parameter referenced by proposals #102 (`info` override), #4 (`serversStrategy`), and #71 (`duplicatePathHandling`). Whichever lands first establishes the interface; later ones add fields. Build new public types module `packages/openapi-merge/src/options.ts` to hold them; `data.ts` continues to host per-input types.

```typescript
// packages/openapi-merge/src/options.ts
export type OutputOpenApiVersion =
  | { strategy: 'fixed'; version: string }
  | { strategy: 'first-input' }
  | { strategy: 'highest-input' };

export interface MergeOptions {
  /**
   * How to choose the `openapi` field of the merged output. Default:
   * { strategy: 'fixed', version: '3.0.3' } (preserves historical behaviour).
   */
  openapiVersion?: OutputOpenApiVersion;
}

// packages/openapi-merge/src/index.ts
export function merge(inputs: MergeInput, options?: MergeOptions): MergeResult
```

**In `index.ts`:** dispatch on the discriminated union:

```typescript
function resolveOpenApiVersion(
  inputs: SingleMergeInput[],
  chosen: OutputOpenApiVersion = { strategy: 'fixed', version: '3.0.3' },
): { kind: 'ok'; version: string } | ErrorMergeResult {
  switch (chosen.strategy) {
    case 'fixed':
      return validateVersion(chosen.version);
    case 'first-input': {
      const v = inputs[0]?.oas?.openapi;
      if (!v) {
        // Best-effort fallback, single warning via existing logger path.
        return { kind: 'ok', version: '3.0.3' };
      }
      return validateVersion(v);
    }
    case 'highest-input':
      return resolveHighestInput(inputs);
    default: {
      const _exhaustive: never = chosen;
      throw new Error(`Unknown openapiVersion.strategy: ${String(_exhaustive)}`);
    }
  }
}
```

The `assertNever` pattern (the `_exhaustive: never` line) guarantees a
compile error if a new variant is added without updating dispatch.

### CLI (`packages/openapi-merge-cli`)

**Extend `Configuration` type in `src/data.ts`:**
```typescript
export type Configuration = {
  inputs: ConfigurationInput[];
  output: string;

  /**
   * Optional. Strategy for choosing the `openapi` field of the merged
   * output. Default: { "strategy": "fixed", "version": "3.0.3" } — preserves
   * the historical CLI behaviour.
   *
   * Examples:
   *   { "strategy": "fixed", "version": "3.0.2" }
   *   { "strategy": "first-input" }
   *   { "strategy": "highest-input" }   // recommended for mixed-version inputs
   */
  openapiVersion?: OutputOpenApiVersion;
};
```

The CLI's `Configuration` re-exports `OutputOpenApiVersion` from the
library so users have a single source of truth.

**In `src/index.ts`:** when invoking `merge()`, pass:
```typescript
merge(inputs, { openapiVersion: config.openapiVersion });
```

---

## 4. Validation rules

The CLI's `configuration.schema.json` (regenerated from `data.ts` via
`typescript-json-schema`) gives us:

- Tag check on `strategy`.
- `version` is required only when `strategy === 'fixed'`.
- For the `fixed` variant, validate `version` against the
  `^3\.0\.[0-9]+$` pattern via the JSDoc `@pattern` annotation on the
  field.

Hand-written semantic validation in `resolveOpenApiVersion`:

```typescript
const ALLOWED_300_PATCHES = new Set(['3.0.0', '3.0.1', '3.0.2', '3.0.3']);

function validateVersion(version: string): { kind: 'ok'; version: string } | ErrorMergeResult {
  if (ALLOWED_300_PATCHES.has(version)) {
    return { kind: 'ok', version };
  }
  if (version.startsWith('2.')) {
    return {
      type: 'unsupported-openapi-version',
      message: `OpenAPI 2.x (Swagger) is not supported. Please use an OpenAPI 3.0.x spec.`,
    };
  }
  if (version.startsWith('3.1')) {
    return {
      type: 'unsupported-openapi-version',
      message: `OpenAPI 3.1.x is not yet supported by openapi-merge (see issue #113).`,
    };
  }
  return {
    type: 'unsupported-openapi-version',
    message: `Unsupported OpenAPI version: '${version}'. Must be one of: 3.0.0, 3.0.1, 3.0.2, 3.0.3.`,
  };
}
```

**`highest-input` strategy:** see §4a below for the dedicated algorithm.

### 4a. `highest-input` algorithm

```typescript
function resolveHighestInput(inputs: SingleMergeInput[]) {
  // 1. Collect declared versions from every input.
  const declared = inputs
    .map(i => i.oas?.openapi)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

  // 2. If none of the inputs declared a version, fall back & warn.
  if (declared.length === 0) {
    return { kind: 'ok', version: '3.0.3' };
  }

  // 3. Group by major.minor; refuse to coerce across minors (§1 rule 2).
  const minors = new Set(declared.map(v => v.split('.').slice(0, 2).join('.')));
  if (minors.size > 1) {
    return {
      type: 'output-version-conflict',
      message:
        `Inputs declare OpenAPI versions on multiple minor lines (${[...minors].join(', ')}). ` +
        `Cannot pick a highest-input version safely. Either align your inputs to a single ` +
        `3.0.x line, switch to { strategy: 'fixed', version: ... }, or upgrade once #113 lands.`,
    };
  }

  // 4. Pick the highest patch within that single minor line.
  declared.sort(semverCompare);
  const winner = declared[declared.length - 1];
  return validateVersion(winner); // still rejects unsupported patches (3.0.4 etc.)
}
```

`semverCompare` is a 6-line numeric comparator over the three dotted
parts; no need to pull in the `semver` package for three integers.

Add **two new `ErrorType` variants** to `data.ts`:

- `'unsupported-openapi-version'` — bad value at any step.
- `'output-version-conflict'` — inputs on incompatible minor lines under `highest-input`.

---

## 5. Implementation Steps

1. **New module** `packages/openapi-merge/src/options.ts`:
   - Defines `OutputOpenApiVersion` and `MergeOptions`. Re-exported by `index.ts`.

2. **`data.ts` (library):**
   - Add `'unsupported-openapi-version'` and `'output-version-conflict'` to `ErrorType`.

3. **`index.ts` (library):**
   - Add `options?: MergeOptions` to `merge()`.
   - Call `resolveOpenApiVersion(inputs, options?.openapiVersion)` early; bail out on error.
   - Replace the hard-coded `openapi: '3.0.3'` with the resolved version.

4. **`Configuration` type (CLI):**
   - Add optional `openapiVersion?: OutputOpenApiVersion` field with JSDoc.

5. **`src/index.ts` (CLI):**
   - When calling `merge()`, pass `{ openapiVersion: config.openapiVersion }`.

6. **Regenerate the JSON Schema:**
   ```bash
   bolt w openapi-merge-cli run gen-schema
   ```

7. **Update test helper (`oas-generation.ts`):**
   - The helper's hardcoded `'3.0.3'` can remain; it's not user-facing and matches the new default.

---

## 6. Tests

Add to `packages/openapi-merge/src/__tests__/index.test.ts` (or a new
`openapi-version.test.ts`):

```typescript
describe('merge - OpenAPI version handling', () => {
  it('defaults to 3.0.3 when no options are provided (regression)', () => {
    const result = merge([{ oas: minimumValidOas }]);
    expect((result as SuccessfulMergeResult).output.openapi).toBe('3.0.3');
  });

  // --- fixed ---
  it('emits the configured version under { strategy: "fixed", version }', () => {
    const result = merge(
      [{ oas: minimumValidOas }],
      { openapiVersion: { strategy: 'fixed', version: '3.0.0' } },
    );
    expect((result as SuccessfulMergeResult).output.openapi).toBe('3.0.0');
  });

  // --- first-input ---
  it('uses the first input\'s openapi field under { strategy: "first-input" }', () => {
    const a = { ...minimumValidOas, openapi: '3.0.1' };
    const b = { ...minimumValidOas, openapi: '3.0.3' };
    const result = merge([{ oas: a }, { oas: b }], {
      openapiVersion: { strategy: 'first-input' },
    });
    expect((result as SuccessfulMergeResult).output.openapi).toBe('3.0.1');
  });

  it('falls back to 3.0.3 under "first-input" when input[0] has no openapi field', () => {
    const a = { ...minimumValidOas };
    delete (a as any).openapi;
    const result = merge([{ oas: a as any }], {
      openapiVersion: { strategy: 'first-input' },
    });
    expect((result as SuccessfulMergeResult).output.openapi).toBe('3.0.3');
  });

  // --- highest-input (new) ---
  it('picks the highest 3.0.x patch under { strategy: "highest-input" }', () => {
    const a = { ...minimumValidOas, openapi: '3.0.0' };
    const b = { ...minimumValidOas, openapi: '3.0.2' };
    const c = { ...minimumValidOas, openapi: '3.0.1' };
    const result = merge([{ oas: a }, { oas: b }, { oas: c }], {
      openapiVersion: { strategy: 'highest-input' },
    });
    expect((result as SuccessfulMergeResult).output.openapi).toBe('3.0.2');
  });

  it('emits 3.0.3 under "highest-input" when no input declares openapi', () => {
    const a = { ...minimumValidOas };
    delete (a as any).openapi;
    const result = merge([{ oas: a as any }], {
      openapiVersion: { strategy: 'highest-input' },
    });
    expect((result as SuccessfulMergeResult).output.openapi).toBe('3.0.3');
  });

  it('errors out under "highest-input" when inputs span multiple minor lines', () => {
    const a = { ...minimumValidOas, openapi: '3.0.2' };
    const b = { ...minimumValidOas, openapi: '3.1.0' };
    const result = merge([{ oas: a }, { oas: b }], {
      openapiVersion: { strategy: 'highest-input' },
    });
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorMergeResult).type).toBe('output-version-conflict');
    expect((result as ErrorMergeResult).message).toContain('3.0');
    expect((result as ErrorMergeResult).message).toContain('3.1');
  });

  // --- validation ---
  it('rejects OpenAPI 2.x with an actionable error', () => {
    const result = merge([{ oas: minimumValidOas }], {
      openapiVersion: { strategy: 'fixed', version: '2.0' },
    });
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorMergeResult).type).toBe('unsupported-openapi-version');
    expect((result as ErrorMergeResult).message).toContain('Swagger');
  });

  it('rejects OpenAPI 3.1.x with a pointer to issue #113', () => {
    const result = merge([{ oas: minimumValidOas }], {
      openapiVersion: { strategy: 'fixed', version: '3.1.0' },
    });
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorMergeResult).message).toContain('#113');
  });

  it('rejects unsupported 3.0.x patches', () => {
    const result = merge([{ oas: minimumValidOas }], {
      openapiVersion: { strategy: 'fixed', version: '3.0.7' },
    });
    expect(isErrorResult(result)).toBe(true);
  });
});
```

---

## 7. Documentation Updates

### Library README

```markdown
### Controlling the OpenAPI Version

By default, the merged output uses OpenAPI `3.0.3`. You can change this
via the optional second argument to `merge()`:

```ts
import { merge } from 'openapi-merge';

// 1. Hard-pin (today's default).
merge(inputs, { openapiVersion: { strategy: 'fixed', version: '3.0.2' } });

// 2. Inherit from the first input.
merge(inputs, { openapiVersion: { strategy: 'first-input' } });

// 3. Pick the highest version across all inputs (recommended).
merge(inputs, { openapiVersion: { strategy: 'highest-input' } });
```

Supported versions are `3.0.0`, `3.0.1`, `3.0.2`, `3.0.3`. The
`highest-input` strategy refuses to coerce across major.minor lines —
if your inputs declare both `3.0.x` and `3.1.x`, the merge errors out
rather than silently producing a document that may be invalid in one or
both schemas.
```

### CLI README

```markdown
#### `openapiVersion` (optional)

Strategy for choosing the `openapi` field of the merged output. Three
variants of a tagged-object discriminated union:

| Variant                                                | Behaviour                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `{ "strategy": "fixed", "version": "3.0.3" }` *(default)*  | Always emit the given version.                                              |
| `{ "strategy": "first-input" }`                            | Use the first input's `openapi` field; fall back to `3.0.3` if missing.     |
| `{ "strategy": "highest-input" }`                          | Use the highest 3.0.x patch across all inputs (recommended).                |

Example:
```json
{
  "inputs": [...],
  "output": "./merged.json",
  "openapiVersion": { "strategy": "highest-input" }
}
```
```

---

## 8. Backwards Compatibility & Versioning

- **Breaking changes:** None. The second parameter is optional; default
  behaviour is `{ strategy: 'fixed', version: '3.0.3' }`, byte-identical to
  today.
- **Version bumps:** `minor` for both `openapi-merge` and `openapi-merge-cli`.
- **Deprecation notes:** No deprecations required.

The CLI's old field name (`openapi: string`, which never shipped) is NOT
honoured; only `openapiVersion: OutputOpenApiVersion` is recognised. This
matches the discriminated-union approach used in #114.

---

## 9. Effort & Value Estimate

- **Value:** 4/5 — fixes real integration pain (Postman, strict
  validators); the new `highest-input` strategy turns the tool into a
  one-stop-shop for merged-spec consumers who don't want to track input
  versions by hand.
- **Effort:** 1/5 for the original fixed+first-input shape; **2/5**
  overall once `highest-input` and the cross-minor conflict detection
  are included. Still a Quick Win.
  - New file: `options.ts` (~30 lines).
  - Library changes: `~60` lines (signature, dispatch, validation,
    `resolveHighestInput`, `semverCompare`, two new `ErrorType` values).
  - CLI changes: `~10` lines (config field, pass-through).
  - Tests: `~120` lines covering all three variants and the four error
    paths.
  - Schema regeneration: automatic.

**Updated ROI: 4 \* 2 − 2 = 6 (still Quick Win).**

---

## 10. Acceptance Criteria

### Core fix (required)

- [ ] `MergeOptions` and the `OutputOpenApiVersion` discriminated union
      are exported from the library.
- [ ] `merge()` accepts an optional second `MergeOptions` parameter; the
      default is `{ strategy: 'fixed', version: '3.0.3' }`.
- [ ] Dispatch on `strategy` is exhaustive and protected by an `assertNever`
      check.
- [ ] `'unsupported-openapi-version'` and `'output-version-conflict'`
      are added to `ErrorType`.
- [ ] Validation rejects `2.x`, `3.1.x`, and unsupported `3.0.x` values
      with the specific messages quoted in §4.
- [ ] CLI `Configuration` accepts `openapiVersion: OutputOpenApiVersion`;
      `configuration.schema.json` is regenerated and contains the
      tagged-union shape.
- [ ] CLI passes `config.openapiVersion` through to the library.
- [ ] All existing library tests pass (regression); the new test cases
      in §6 cover default, fixed, first-input, highest-input, and every
      error path.
- [ ] Library and CLI `README.md` document all three variants.
- [ ] No breaking changes to the public API.

### `highest-input` specifics

- [ ] Returns the highest patch when inputs all share a single
      `major.minor` line.
- [ ] Returns `'output-version-conflict'` when inputs span multiple
      `major.minor` lines.
- [ ] Returns `3.0.3` (and emits a single warning via the existing
      logger path) when no input declares `openapi`.
- [ ] Patches that aren't in the allow-list (e.g. `3.0.7`) are still
      rejected after they "win" the max — `resolveHighestInput` reuses
      `validateVersion`.

### Spec-compatibility safety

- [ ] At no point does the tool re-label a document across `major.minor`
      lines automatically (§1 rule 2). Test cases above prove this for
      `highest-input`; `fixed` is explicit so the user owns the choice.
