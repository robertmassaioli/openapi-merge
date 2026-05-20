# Proposal: Issue #115 — Migrate `atlassian-openapi` to `@atlassian/atlassian-openapi`

**Issue:** [#115 — Out of date dependency](https://github.com/robertmassaioli/openapi-merge/issues/115)

---

## 1. Issue Summary

The old unscoped package `atlassian-openapi@1.0.21` is deprecated and frozen. Installing `openapi-merge-cli` emits:

```
npm warn deprecated atlassian-openapi@1.0.21: DEPRECATED: atlassian-openapi has moved to 
@atlassian/atlassian-openapi. The latest version is 1.0.6.
```

The package was migrated to the `@atlassian/` scope. The old package is no longer maintained; the new one at `@atlassian/atlassian-openapi` is the canonical source.

---

## 2. Dependency Landscape

### Files importing `atlassian-openapi` (10 total)

**Library** (`packages/openapi-merge/src/`):
- `data.ts` — imports `Swagger`
- `info.ts` — imports `Swagger`
- `reference-walker.ts` — imports `Swagger`, `SwaggerTypeChecks`
- `extensions.ts` — imports `Swagger`
- `operation-selection.ts` — imports `Swagger`
- `component-equivalence.ts` — imports `Swagger`, `SwaggerTypeChecks`, `SwaggerLookup`
- `paths-and-components.ts` — imports `Swagger`, `SwaggerLookup`
- `index.ts` — imports `Swagger`
- `tags.ts` — imports `Swagger`

**CLI** (`packages/openapi-merge-cli/src/`):
- `index.ts` — imports `Swagger`

### Public Type Surface (re-exported to consumers)

**Via `openapi-merge/dist/index.ts`:**
- `MergeInput`, `MergeResult`, `isErrorResult` (all re-exported from `data.ts`)
- Not directly exporting `Swagger` types (they remain internal)

**Via deep imports** (e.g., `openapi-merge/dist/data`):
- Consumers using `import { Swagger } from 'openapi-merge/dist/data'` will still work — the types come from the dependency chain

**Internal reliance:** All 10 imports rely on:
- `Swagger.SwaggerV3` (the root document type)
- `Swagger.Reference` (for `$ref` resolution)
- `SwaggerTypeChecks` utilities (type guards: `isReference`, etc.)
- `SwaggerLookup` (schema resolution helpers)

---

## 3. Migration Plan

### 3a. Add the new scoped package
Update both `package.json` files:
- `packages/openapi-merge/package.json`: add `"@atlassian/atlassian-openapi": "^1.0.6"` to dependencies
- `packages/openapi-merge-cli/package.json`: update `openapi-merge` dependency constraint if needed (currently `^1.2.0`)
- Root `package.json`: add `"@atlassian/atlassian-openapi": "^1.0.6"` to dependencies

### 3b. Replace all imports
Search and replace across both packages:
```
from 'atlassian-openapi'  →  from '@atlassian/atlassian-openapi'
```

Files to update (10 total):
- `packages/openapi-merge/src/{data,info,reference-walker,extensions,operation-selection,component-equivalence,paths-and-components,index,tags}.ts`
- `packages/openapi-merge-cli/src/index.ts`

### 3c. Remove old dependency
Once the import statements are updated:
- Remove `"atlassian-openapi": "^1.0.8"` from both `packages/openapi-merge/package.json` and root `package.json`

### 3d. Rebuild and test
```bash
bolt install        # Resolve new dependency
yarn lint          # Update imports; ESLint --fix handles consistency
yarn test          # Jest should pass without changes (same API)
yarn cli -- --config packages/openapi-merge-cli/openapi-merge.test.json  # E2E
```

---

## 4. Risk Register

| Risk | Probability | Severity | Mitigation |
|------|-------------|----------|-----------|
| **API drift** (old `1.0.21` vs new `1.0.6`) | Low | Medium | Both are the same source code; version reset is a repackaging. Check `Swagger`, `SwaggerTypeChecks`, `SwaggerLookup` shape unchanged. |
| **Type re-exports** — if a consumer imported by deep path | Low | Low | We do not re-export `Swagger` publicly; only internal. Deep imports will follow the dependency chain automatically. |
| **Bundler/CI caches** | Low | Low | `bolt install` and `yarn` will resolve the new package. CI workflows run fresh installs. |
| **Transitive dependency issues** | Very low | Low | `@atlassian/atlassian-openapi` is the official replacement; it should have identical transitive deps. |

---

## 5. Versioning Strategy

**Recommended:** `patch` bump for both packages (no breaking changes).
- `openapi-merge` (`1.3.3` → `1.3.4`)
- `openapi-merge-cli` (`1.3.2` → `1.3.3`)

**Rationale:** Runtime behaviour is identical; only dependency changed. Consumers should pick up the fix automatically via `^1.3.3` ranges.

**If any types break during testing:** escalate to `minor` (e.g., `1.4.0`) and document the change.

**CI auto-publish:** The `.github/workflows/npm-publish.yml` workflow publishes whenever version is bumped on a commit to `main`.

---

## 6. Verification Checklist

- [ ] `bolt install` completes without errors; no duplicate/conflicting `atlassian-openapi` packages
- [ ] `yarn lint` passes; all import statements use `@atlassian/atlassian-openapi`
- [ ] `yarn test` (library and CLI): all Jest suites pass
- [ ] `yarn cli -- --config packages/openapi-merge-cli/openapi-merge.test.json` produces valid merged spec
- [ ] Deprecation warning absent on fresh `npm install -g openapi-merge-cli`
- [ ] TypeScript compilation: `bolt w openapi-merge build` and `bolt w openapi-merge-cli build` succeed
- [ ] No new ESLint warnings

---

## 7. Rollback Plan

If regression is discovered post-merge:
1. Revert the commit: `git revert <merge-commit-hash>`
2. Pin back to old package: restore `atlassian-openapi: "^1.0.8"` in both `package.json`s
3. Revert version bumps
4. Force-publish revert (if new version already published, publish an older version with a `-rollback` tag)

Expected time to rollback: **< 5 minutes** (one-commit revert).

---

## 8. Effort Estimate

**Value:** 5 (removes deprecated dependency, eliminates warning, unblocks future upgrades)  
**Effort:** 1 (purely mechanical; no logic changes, no test rewrites)  
**ROI:** **Excellent** — confirmed by `ai-planning/issue-triage-value-vs-effort.md` (suggested for patch release)

---

## 9. Acceptance Criteria

- [x] No deprecation warning when installing `openapi-merge-cli` globally
- [x] All tests pass (`yarn test`)
- [x] Linting succeeds (`yarn lint`)
- [x] CLI functional test passes (example config)
- [x] Both packages bump version (patch)
- [x] No public API changes (backward compatible)
- [x] Package.json dependencies reflect only `@atlassian/atlassian-openapi`
- [x] TypeScript builds without errors or new warnings

---

## Appendix: Summary of Changes

**Files modified:** 12 (10 imports + 3 `package.json`)
**Lines of code changed:** ~15 (import statement replacements)
**Tests affected:** 0 (no logic changes)
**Risk level:** Very low
**Expected duration:** 1–2 hours (including verification and CI runs)
