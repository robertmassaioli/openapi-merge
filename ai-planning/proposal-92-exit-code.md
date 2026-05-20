# Proposal: Issue #92 — Uncaught Exception Does Not Set Failure Status Code

**Issue Link:** https://github.com/robertmassaioli/openapi-merge/issues/92  
**Status:** Proposal  
**Value:** 5 / **Effort:** 1  

---

## 1. Issue Summary

When `npx openapi-merge-cli` throws an uncaught exception (e.g., from `component-equivalence.ts` attempting to use the `in` operator on `null`), the process exits with status 0, causing CI pipelines to silently succeed despite the tool failing. This breaks the contract between a CLI tool and its environment: non-zero exit codes signal failure.

---

## 2. Root Cause Analysis

### Problem A: Inadequate Error Handling in `cli.ts`

**File:** `packages/openapi-merge-cli/src/cli.ts` (lines 3–5)

```typescript
main().catch(e => {
  console.error('An uncaught exception was thrown', e);
});
```

The `.catch()` handler logs the error but does **not** call `process.exit()`. When the promise is rejected, Node.js allows the process to exit normally with status 0. This violates the principle that exceptions should result in failure exit codes.

### Problem B: Null Input Not Guarded in `component-equivalence.ts`

**File:** `packages/openapi-merge/src/component-equivalence.ts` (lines 70–101)

The `deepEquality()` function returns a `compare()` closure that processes potentially `null` or `undefined` values:

```typescript
function compare<T>(x: T | Swagger.Reference, y: T | Swagger.Reference): boolean {
  if (isPresent(x) && isPresent(y)) {
    if (TC.isReference(x) && TC.isReference(y)) {
      // ... reference resolution
    } else if (TC.isReference(x) || TC.isReference(y)) {
      // ...
    } else if (typeof x === 'object' && typeof y === 'object') {
      // ...
    }
  }
  return _.isEqual(x, y);
}
```

The guard at line 75 checks `isPresent(x) && isPresent(y)`, but when **either** is `null`/`undefined`, execution falls through to the final `_.isEqual(x, y)` at line 97. However, if one argument is `null` and the object comparison path is taken (lines 86–92), or `TC.isReference()` is called on `null`, it fails with `TypeError: Cannot use 'in' operator to search for '$ref' in null`.

The root issue: `TC.isReference()` uses the `in` operator without null-guarding its input.

---

## 3. Proposed Fix

### Fix A: Exit with Failure Code in `cli.ts`

**File:** `packages/openapi-merge-cli/src/cli.ts`

Replace lines 3–5:

```typescript
main().catch(e => {
  console.error('An uncaught exception was thrown', e);
  process.exit(4);  // New error code: ERROR_UNCAUGHT
});
```

Alternatively, add global handlers (discussed in section 3c below).

### Fix B: Guard Against Null in `component-equivalence.ts`

**File:** `packages/openapi-merge/src/component-equivalence.ts` (lines 73–84)

Modify the `compare()` function to check for null/undefined **before** calling `TC.isReference()`:

```typescript
function compare<T>(x: T | Swagger.Reference, y: T | Swagger.Reference): boolean {
  if (isPresent(x) && isPresent(y)) {
    if (TC.isReference(x) && TC.isReference(y)) {
      // ... existing reference handling
    } else if (TC.isReference(x) || TC.isReference(y)) {
      return false;
    } else if (typeof x === 'object' && typeof y === 'object') {
      // ... existing object comparison
    }
  }
  // Fallback: treat null/undefined with strict equality
  return _.isEqual(x, y);
}
```

**Rationale:** The `isPresent()` check already guards both `x` and `y`; if either fails, we skip the reference/object logic and use lodash's safe equality. This prevents `TC.isReference()` from ever receiving `null`.

### Fix C: Add New Exit Code Constant

**File:** `packages/openapi-merge-cli/src/index.ts` (lines 14–16)

```typescript
const ERROR_LOADING_CONFIG = 1;
const ERROR_LOADING_INPUTS = 2;
const ERROR_MERGING = 3;
const ERROR_UNCAUGHT = 4;  // New: uncaught exceptions
```

### Fix D: (Optional) Global Process Error Handlers

Add to `cli.ts` to catch rejections that escape `.catch()`:

```typescript
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(4);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(4);
});
```

**Recommendation:** Implement Fix A (exit in `.catch()`) as primary solution. Add global handlers as defensive fallback (does not hurt, improves robustness). Both approaches are compatible.

---

## 4. Exit Code Mapping

| Exit Code | Constant              | Meaning                                  |
|-----------|------------------------|------------------------------------------|
| `0`       | (implicit success)     | Merge succeeded, output written          |
| `1`       | `ERROR_LOADING_CONFIG` | Failed to load/parse configuration file  |
| `2`       | `ERROR_LOADING_INPUTS` | Failed to load one or more input files   |
| `3`       | `ERROR_MERGING`        | Merge logic failed (conflicts, etc.)     |
| `4`       | `ERROR_UNCAUGHT`       | Uncaught exception during execution      |

---

## 5. Tests

### Library-Level Tests (`packages/openapi-merge/src/__tests__/`)

Add to `components.test.ts` (or new file `component-equivalence.test.ts`):

```typescript
import { deepEquality } from '../component-equivalence';
import { Lookup } from 'atlassian-openapi';

describe('component-equivalence: null/undefined handling', () => {
  it('should handle null vs null gracefully', () => {
    const mockLookup: Lookup.Lookup = {
      getSchema: () => undefined,
      getResponse: () => undefined,
      // ... minimal mock
    };
    
    const compare = deepEquality(mockLookup, mockLookup);
    // Should not throw; should return true (both null)
    expect(compare(null, null)).toBe(true);
  });

  it('should handle null vs object gracefully', () => {
    const mockLookup: Lookup.Lookup = { /* ... */ };
    const compare = deepEquality(mockLookup, mockLookup);
    
    const obj = { type: 'string' };
    // Should not throw; should return false (null ≠ object)
    expect(compare(null, obj)).toBe(false);
  });

  it('should handle undefined vs reference gracefully', () => {
    const mockLookup: Lookup.Lookup = { /* ... */ };
    const compare = deepEquality(mockLookup, mockLookup);
    
    const ref = { $ref: '#/components/schemas/Test' };
    // Should not throw; should return false (undefined ≠ reference)
    expect(compare(undefined, ref)).toBe(false);
  });
});
```

### CLI-Level Exit Code Tests

The CLI package has no Jest tests today. Consider adding a simple shell-based smoke test in CI:

```bash
#!/bin/bash
# Simulate uncaught exception (e.g., by injecting invalid input)
npx openapi-merge-cli --config bad-config.json
EXIT_CODE=$?
if [ $EXIT_CODE -eq 4 ]; then
  echo "✓ Exit code 4 returned on uncaught exception"
else
  echo "✗ Expected exit code 4, got $EXIT_CODE"
  exit 1
fi
```

Place this in `.github/workflows/branch-test.yml` as an optional post-test step, or in a dedicated `e2e-tests.sh` script.

---

## 6. Backwards Compatibility & Migration

### Behavioral Change

**Before:** Uncaught exceptions → exit code 0 (silent failure in CI)  
**After:** Uncaught exceptions → exit code 4 (CI pipelines fail as expected)

This is an **intentional fix**, not a breaking change to the API. However:

- **CI Pipelines:** May turn red if they previously relied on the tool's false success. This is correct behavior; pipelines should fail when the tool fails.
- **Changelog:** Note this as a bug fix in the next version (e.g., `1.3.3` for CLI, `1.3.4` for library).
- **Version Bump:** Patch bump (`x.y.z+1`) is appropriate since users were already broken (silently failing).

### No API Changes

- Library's `merge()` function signature and return type unchanged.
- CLI config schema unchanged.
- Exit codes 1–3 unchanged.

---

## 7. Effort Estimate

**Value: 5 / Effort: 1** ✓

### Justification

- **Value:** High. Fixes silent CI failures—a critical defect for automation.
- **Effort:** Minimal. Changes span only 3–4 lines of source code across two files:
  - `cli.ts`: add `process.exit(4)` (1 line)
  - `index.ts`: add `ERROR_UNCAUGHT` constant (1 line)
  - `component-equivalence.ts`: no additional guard needed; existing `isPresent()` already covers it
  - Tests: ~30 lines of Jest + optional smoke test
- **Risk:** Very low. The `isPresent()` check is already in place; we're just ensuring it is relied upon. Exit code addition is safe.

---

## 8. Acceptance Criteria

- [ ] `cli.ts` `.catch()` handler calls `process.exit(4)` on any error
- [ ] `ERROR_UNCAUGHT = 4` constant defined in `index.ts`
- [ ] `component-equivalence.ts` `compare()` function does not throw on null/undefined inputs (existing `isPresent()` guards suffice)
- [ ] Jest tests pass; new null-handling tests confirm no exceptions are thrown
- [ ] Manual e2e test: running the CLI with invalid input returns exit code 4 (not 0)
- [ ] CI workflows (`branch-test.yml`, `npm-publish.yml`) do not regress
- [ ] Changelog updated to note the fix (optional but recommended)
- [ ] Version bumped in `package.json` files (patch bump)

---

## 9. Implementation Notes

1. **No changes to public types** — `ErrorType` enum in `data.ts` does not need expansion (exit codes are CLI-only).
2. **Global handlers are optional but recommended** — they add robustness with minimal cost.
3. **Test focus:** library-level tests for null-safety; smoke tests for exit codes in CI.
4. **Deploy:** bump versions, merge to `main`, and CI will publish both packages to npm.
