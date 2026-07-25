# Proposal: Issue #92 — Uncaught Exception Does Not Set Failure Status Code

**Issue Link:** https://github.com/robertmassaioli/openapi-merge/issues/92
**Status:** ✅ **Fixed** — implemented and merged to `main` on 2026-05-21
**Value:** 5 / **Effort:** 1

---

## 0. Implementation Status

| Field | Value |
| --- | --- |
| Status | ✅ **Fixed** |
| Implemented on branch | `fix/92-uncaught-exit-code` |
| Merged to `main` in | `1c6695c` (merge commit) |
| Implementation commit | `d793f0b` — `fix(#92): propagate non-zero exit code on uncaught CLI errors` |
| Verification | 98/98 Jest tests pass; ESLint clean for both packages; `tsc --noEmit` clean for the CLI |
| Files touched | `packages/openapi-merge-cli/src/exit-codes.ts` (new), `cli.ts`, `index.ts`, `packages/openapi-merge/src/component-equivalence.ts`, `packages/openapi-merge/src/__tests__/component-equivalence.test.ts` (new) |
| Released to npm | ❌ Not yet — pending a `version` bump in `package.json` and a push to `origin/main` (CI's `npm-publish.yml` will then publish automatically) |

This proposal is preserved as a record of the design decision. The
"Proposed" wording in sections 3–9 is retained for historical context;
all proposed code is now live on `main`. The acceptance checklist in
section 8 has been updated to reflect what shipped vs. what remains.

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

Replace lines 3–5 (and import the new shared enum introduced in Fix C):

```typescript
import { ExitCode } from './exit-codes';

main().catch(e => {
  console.error('An uncaught exception was thrown', e);
  process.exit(ExitCode.ErrorUncaught);
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

### Fix C: Centralise Exit Codes in a Shared TypeScript `enum`

Today the CLI declares three loose `const` exit codes at the top of
`packages/openapi-merge-cli/src/index.ts` (lines 14–16):

```typescript
const ERROR_LOADING_CONFIG = 1;
const ERROR_LOADING_INPUTS = 2;
const ERROR_MERGING = 3;
```

These are not exported, are duplicated as magic numbers in any future
caller (e.g. `cli.ts` itself, which currently does not exit at all), and
have no compiler help to keep them collision-free. As we add a new code
for uncaught errors — and any future code for additional failure modes —
we should replace the loose constants with a single shared **`enum`** so
every site uses the same source of truth.

**Step 1 — Create a new module `packages/openapi-merge-cli/src/exit-codes.ts`:**

```typescript
/**
 * Centralised exit codes for the openapi-merge CLI.
 *
 * IMPORTANT: Exit codes are part of the CLI's public contract — CI
 * pipelines and scripts depend on them. Treat any change to an existing
 * value as a breaking change. New codes MUST be appended with the next
 * unused integer; never re-use a retired code.
 */
export enum ExitCode {
  Success            = 0,
  ErrorLoadingConfig = 1,
  ErrorLoadingInputs = 2,
  ErrorMerging       = 3,
  ErrorUncaught      = 4,
}
```

Notes on the choice of `enum`:

- A numeric `enum` is the most natural fit because `process.exit` expects
  a number, and `enum` members are themselves numbers (no `.valueOf()`
  ceremony needed).
- Using an `enum` rather than a `const`-object-with-`as const` lets us
  type API surfaces as `ExitCode` (e.g. `process.exit(code: ExitCode)`
  helpers), so the compiler will flag any accidental use of a stray
  magic number.
- `ExitCode.Success = 0` is included for completeness even though it is
  rarely passed explicitly; having it named makes happy-path code (and
  future tests) self-documenting.

**Step 2 — Replace the loose constants in `cli/src/index.ts`:**

```typescript
import { ExitCode } from './exit-codes';

// …

process.exit(ExitCode.ErrorLoadingConfig);  // was 1
process.exit(ExitCode.ErrorLoadingInputs);  // was 2
process.exit(ExitCode.ErrorMerging);        // was 3
```

The existing three `const`s should be deleted from `index.ts`.

**Step 3 — Use the same enum in `cli.ts` for the new uncaught-error path:**

```typescript
import { ExitCode } from './exit-codes';

main().catch(e => {
  console.error('An uncaught exception was thrown', e);
  process.exit(ExitCode.ErrorUncaught);
});
```

**Step 4 — (Optional) Re-export `ExitCode` from the CLI package entry**
so downstream callers that script around the CLI (e.g. shell wrappers
written in TypeScript) can reference the enum directly instead of
hard-coding integers:

```typescript
// packages/openapi-merge-cli/src/index.ts
export { ExitCode } from './exit-codes';
```

> **Future-proofing rule:** any new failure mode in the CLI should be
> represented by a new enum member appended to `ExitCode`. The mapping
> table in section 4 must be updated in the same commit so the docs and
> code do not drift.

### Fix D: (Optional) Global Process Error Handlers

Add to `cli.ts` to catch rejections that escape `.catch()`. These also
use the shared enum so the exit code for "something escaped" stays
consistent with the catch-handler above:

```typescript
import { ExitCode } from './exit-codes';

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(ExitCode.ErrorUncaught);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(ExitCode.ErrorUncaught);
});
```

**Recommendation:** Implement Fix A (exit in `.catch()`) as primary solution. Add global handlers as defensive fallback (does not hurt, improves robustness). Both approaches are compatible.

---

## 4. Exit Code Mapping

All values live in the `ExitCode` enum at
`packages/openapi-merge-cli/src/exit-codes.ts` (see Fix C). The table
below is the single source of truth for the docs; the enum is the single
source of truth for the code. When adding a new failure mode, update
both in the same commit.

| Exit Code | `ExitCode` member       | Meaning                                  |
|-----------|--------------------------|------------------------------------------|
| `0`       | `ExitCode.Success`       | Merge succeeded, output written          |
| `1`       | `ExitCode.ErrorLoadingConfig` | Failed to load/parse configuration file  |
| `2`       | `ExitCode.ErrorLoadingInputs` | Failed to load one or more input files   |
| `3`       | `ExitCode.ErrorMerging`  | Merge logic failed (conflicts, etc.)     |
| `4`       | `ExitCode.ErrorUncaught` | Uncaught exception during execution      |

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
  - `exit-codes.ts`: new module with the `ExitCode` enum (~15 lines incl. JSDoc)
  - `cli.ts`: import the enum and `process.exit(ExitCode.ErrorUncaught)` (2 lines)
  - `index.ts`: import the enum, delete the three loose `const`s, and reference `ExitCode.*` at each existing `process.exit` site (~5 line diff)
  - `component-equivalence.ts`: no additional guard needed; existing `isPresent()` already covers it
  - Tests: ~30 lines of Jest + optional smoke test
- **Risk:** Very low. The `isPresent()` check is already in place; we're just ensuring it is relied upon. Exit code addition is safe.

---

## 8. Acceptance Criteria

- [x] `packages/openapi-merge-cli/src/exit-codes.ts` exists and exports a `ExitCode` enum with `Success`, `ErrorLoadingConfig`, `ErrorLoadingInputs`, `ErrorMerging`, and `ErrorUncaught` members
- [x] No magic exit-code numbers remain in `cli/src/index.ts` or `cli/src/cli.ts`; all `process.exit(...)` call sites reference `ExitCode.*`
- [x] The three legacy `const ERROR_*` declarations in `index.ts` are removed
- [x] `cli.ts` `.catch()` handler calls `process.exit(ExitCode.ErrorUncaught)` on any error
- [x] `component-equivalence.ts` `compare()` / `shallowEquality` do not throw on null/undefined inputs (existing `isPresent()` guards + a new guard in `shallowEquality`)
- [x] Jest tests pass; new null-handling tests confirm no exceptions are thrown (98/98 suites green locally)
- [ ] Manual e2e test: running the CLI with invalid input returns exit code 4 (not 0) — *to be verified in CI / by maintainer on a real environment*
- [ ] CI workflows (`branch-test.yml`, `npm-publish.yml`) do not regress — *pending push*
- [ ] Changelog updated to note the fix (optional but recommended) — *pending*
- [ ] Version bumped in `package.json` files (patch bump) — *pending; will trigger npm-publish.yml*

---

## 9. Implementation Notes

1. **Shared enum is the only source of truth for exit codes.** Anyone
   adding a new failure mode must add a new `ExitCode` member and update
   the table in section 4 in the same commit. Avoid passing raw integers
   to `process.exit` anywhere in the CLI codebase.
2. **No changes to public types** — `ErrorType` enum in the library's
   `data.ts` does not need expansion (exit codes are CLI-only and live in
   a separate enum so the two concepts stay decoupled).
3. **Global handlers are optional but recommended** — they add robustness with minimal cost and reuse the same enum.
4. **Test focus:** library-level tests for null-safety; smoke tests for exit codes in CI (which can also import `ExitCode` from the compiled CLI bundle).
5. **Deploy:** bump versions, merge to `main`, and CI will publish both packages to npm.
