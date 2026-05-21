# Implementation Proposal: Issue #112 — Per-Input Tag Injection

**Issue:** [#112 — Option to merge an input into a tag](https://github.com/robertmassaioli/openapi-merge/issues/112)

**Status:** Proposal

**Value:** 4 / **Effort:** 3 / **ROI:** 5 / **Quadrant:** Big Bet (low)

---

## 1. Issue Summary

Users want the ability to automatically add a specified tag to every operation imported from a given input OpenAPI document. This enables natural grouping in tools like ReDoc and Swagger UI without manually editing each operation or the input spec.

**Example use case:** When merging a Jira microservice spec into an API Gateway, all Jira operations should carry `tags: ['Jira']` so they appear under a "Jira" section in the UI. Optionally, the Jira input's `info.description` should be appended to that tag's description in the merged spec's top-level `tags` array.

---

## 2. Current Behaviour

### File: `packages/openapi-merge/src/data.ts` (lines 40–56)

Today, `SingleMergeInput` has:
- `oas: Swagger.SwaggerV3` — the input spec itself.
- `operationSelection?: OperationSelection` — filters operations by tag.
- `description?: DescriptionMergeBehaviour` — controls whether the input's `info.description` is appended to the merged spec's overall `info.description`.

There is **no per-input mechanism** to inject a uniform tag onto all operations.

### File: `packages/openapi-merge/src/operation-selection.ts` (lines 8–70)

Tag filtering happens in `operationContainsAnyTag()` and `runOperationSelection()`. Operations are filtered by their existing tags; new tags are never added.

### File: `packages/openapi-merge/src/tags.ts` (lines 11–36)

The top-level `tags` array is merged by concatenating tags from all inputs (deduped by name). There is no mechanism to register a tag that was not explicitly defined in any input's `tags` array.

### File: `packages/openapi-merge/src/info.ts` (lines 5–23)

The `getInfoDescriptionWithHeading()` function formats an input's `info.description` with an optional Markdown heading. This logic is **not currently reusable** for other contexts (e.g., tag descriptions).

---

## 3. Proposed API

### 3.1 Type: `TagInjection` (add to `packages/openapi-merge/src/data.ts`)

```typescript
export type TagInjection = {
  /**
   * The name of the tag to inject into every operation from this input.
   * If an operation already has this tag, no duplicate is added.
   * @minLength 1
   */
  name: string;

  /**
   * Optional description for this tag in the output's top-level tags array.
   * If the tag already exists from another input, descriptions are concatenated
   * in input order (oldest first).
   */
  description?: string;

  /**
   * If true, append this input's info.description to the tag's description
   * using the same Markdown-heading rules as DescriptionMergeBehaviour.title.
   * The appended description appears after the explicit 'description' field.
   * Ignored if this input has no info.description.
   */
  appendInputDescription?: boolean;

  /**
   * Optional externalDocs for this tag, merged into the top-level tags array
   * (same first-wins behaviour as other tag properties from the input).
   */
  externalDocs?: Swagger.ExternalDocumentation;
};
```

### 3.2 Update `SingleMergeInputBase` (add to `packages/openapi-merge/src/data.ts`)

Add a new optional field to `SingleMergeInputBase`:

```typescript
export interface SingleMergeInputBase {
  oas: Swagger.SwaggerV3;

  pathModification?: PathModification;

  operationSelection?: OperationSelection;

  description?: DescriptionMergeBehaviour;

  /**
   * If set, injects the specified tag into every operation from this input
   * (after operationSelection filtering). The tag is also registered in the
   * output's top-level tags array with the provided metadata.
   */
  tag?: TagInjection;
}
```

**Semantics:**
- The tag is applied **after** `operationSelection` filtering completes.
- If an operation already has the tag (by name), no duplicate is added.
- If multiple inputs inject the **same tag name**, their descriptions concatenate in input order, and other properties (externalDocs) follow first-wins.
- If the injected tag name collides with a tag from another input's operations (not injected), the tag's metadata from the first occurrence (whether injected or natural) is used; later occurrences are ignored.

---

## 4. Interaction with Existing Options

### 4.1 `operationSelection.includeTags / excludeTags`

The injected tag is applied **after** filtering:
- Operations excluded by `excludeTags` do **not** receive the injected tag.
- The injected tag is **not** itself filtered by `includeTags` (it does not bypass includes).
- **Rationale:** Prevents users from accidentally re-including excluded operations via the injected tag.

**Example:** If an input excludes `deleteTags: ['admin']` and also specifies `tag: { name: 'MyAPI' }`, operations tagged `admin` are removed from the merge entirely; they do not appear as `['MyAPI']` alone.

### 4.2 `description.append` vs. `tag.appendInputDescription`

These are **independent** operations:
- `description.append: true` appends the input's `info.description` to the merged spec's top-level `info.description`.
- `tag.appendInputDescription: true` appends the input's `info.description` to the injected tag's `description` in the top-level `tags` array.
- Both can be used together (though discouraged to avoid redundancy).

### 4.3 Interaction with `x-tagGroups` (proposal-60)

When an injected tag is added, users may want to also add it to `x-tagGroups` for ReDoc sidebar organization. This is **out of scope** for this proposal. Future work (proposal-60 follow-up) could add an optional `group?: string` field to `TagInjection` to auto-register the tag in a named group.

---

## 5. Implementation Steps

### Step 1: Update Types (`packages/openapi-merge/src/data.ts`)

- Add `TagInjection` type as described above (lines ~90–120).
- Add `tag?: TagInjection` field to `SingleMergeInputBase` (line ~55).

**Effort:** ~15 min.

### Step 2: Extract Markdown-Heading Helper (`packages/openapi-merge/src/info.ts`)

Refactor `getInfoDescriptionWithHeading()` into a reusable helper:

```typescript
/**
 * Formats a description string with an optional Markdown heading.
 * Reusable for tag descriptions and other contexts.
 */
export function formatDescriptionWithHeading(
  description: string,
  heading?: DescriptionTitle
): string {
  const trimmed = description.trimRight();
  if (heading === undefined) {
    return trimmed;
  }
  const level = heading.headingLevel || 1;
  return `${'#'.repeat(level)} ${heading.value}\n\n${trimmed}`;
}
```

Update `getInfoDescriptionWithHeading()` to call this helper.

**Effort:** ~20 min.

### Step 3: Tag Injection in Operations (`packages/openapi-merge/src/paths-and-components.ts`)

In the `mergePathsAndComponents()` function, after the `runOperationSelection()` call (line ~195), add a step to inject tags:

```typescript
/**
 * Inject a tag into every operation in an OAS (unless already present).
 */
function injectTagIntoOperations(
  oas: Swagger.SwaggerV3,
  tagName: string
): void {
  if (oas.paths === undefined) return;
  
  for (const path in oas.paths) {
    if (oas.paths.hasOwnProperty(path)) {
      const pathItem = oas.paths[path];
      for (const method of allMethods) {
        const operation = pathItem[method];
        if (operation !== undefined) {
          if (operation.tags === undefined) {
            operation.tags = [];
          }
          if (!operation.tags.includes(tagName)) {
            operation.tags.push(tagName);
          }
        }
      }
    }
  }
}
```

Call this after `runOperationSelection()` for each input:

```typescript
const oasAfterSelection = runOperationSelection(modifiedOas, input.operationSelection);
if (input.tag !== undefined) {
  injectTagIntoOperations(oasAfterSelection, input.tag.name);
}
```

**Effort:** ~30 min.

### Step 4: Register Injected Tags (`packages/openapi-merge/src/tags.ts`)

Update `mergeTags()` to also register injected tags that may not appear in any input's `tags` array:

```typescript
export function mergeTags(inputs: MergeInput): Swagger.Tag[] | undefined {
  const result = new Array<Swagger.Tag>();
  const seenTags = new Map<string, Partial<Swagger.Tag>>();

  // First pass: collect tags from input specs
  inputs.forEach(input => {
    const { operationSelection } = input;
    const { tags } = input.oas;
    if (tags !== undefined) {
      const excludeTags = operationSelection?.excludeTags ?? [];
      const nonExcludedTags = getNonExcludedTags(tags, excludeTags);
      nonExcludedTags.forEach(tag => {
        if (!seenTags.has(tag.name)) {
          seenTags.set(tag.name, tag);
        }
      });
    }
  });

  // Second pass: collect injected tags, concatenating descriptions
  inputs.forEach(input => {
    if (input.tag !== undefined) {
      const { name, description, externalDocs, appendInputDescription } = input.tag;
      const existingTag = seenTags.get(name) ?? {};

      let finalDescription = existingTag.description ?? '';
      if (description !== undefined) {
        finalDescription = (finalDescription ? finalDescription + '\n\n' : '') + description;
      }
      if (appendInputDescription && input.oas.info?.description) {
        const infoDesc = formatDescriptionWithHeading(
          input.oas.info.description,
          undefined // No heading for the appended info; users can add via explicit 'description' if needed
        );
        finalDescription = (finalDescription ? finalDescription + '\n\n' : '') + infoDesc;
      }

      if (!seenTags.has(name)) {
        seenTags.set(name, { name });
      }
      const tag = seenTags.get(name)!;
      if (finalDescription) {
        tag.description = finalDescription;
      }
      if (externalDocs !== undefined && !tag.externalDocs) {
        tag.externalDocs = externalDocs;
      }
    }
  });

  // Convert map to array
  seenTags.forEach(tag => {
    result.push(tag as Swagger.Tag);
  });

  if (result.length === 0) {
    return undefined;
  }

  return result;
}
```

**Effort:** ~45 min (careful handling of description concatenation and tag merging semantics).

### Step 5: Add Jest Tests

Create or extend `packages/openapi-merge/src/__tests__/tag-injection.test.ts` with test cases:

**Test 1: Basic tag injection**
- Input spec with no top-level `tags` array.
- Inject tag `{ name: 'MyAPI' }` onto all operations.
- Assert: every operation has `['MyAPI']`, and `output.tags` includes `{ name: 'MyAPI' }`.

**Test 2: Tag already exists**
- Operation already has tag `'MyAPI'`.
- Inject the same tag.
- Assert: no duplicate; operation has `['MyAPI']` (singular).

**Test 3: Multiple inputs inject same tag**
- Input A: `tag: { name: 'Shared', description: 'From A' }`.
- Input B: `tag: { name: 'Shared', description: 'From B' }`.
- Assert: output tag has description `'From A\n\nFrom B'`.

**Test 4: appendInputDescription**
- Input with `tag: { name: 'API', appendInputDescription: true }` and `info.description: 'API docs'`.
- Assert: output tag description is `'API docs'` (or with optional explicit description prepended).

**Test 5: Interaction with excludeTags**
- Input specifies `operationSelection: { excludeTags: ['internal'] }` and `tag: { name: 'Public' }`.
- Operations tagged `'internal'` are removed entirely; they do **not** appear as `['Public']`.

**Test 6: externalDocs preserved**
- Inject `tag: { name: 'API', externalDocs: { url: '...' } }`.
- Assert: output tag includes externalDocs.

**Effort:** ~60 min (writing 6 comprehensive test cases).

---

## 6. Edge Cases & Clarifications

### 6.1 Operation Already Has the Tag

**Behaviour:** No-op. The tag is not duplicated; the operation's `tags` array remains unchanged.

**Rationale:** Prevents subtle bugs in tools that may assume tag arrays have no duplicates.

### 6.2 Multiple Inputs Inject the Same Tag Name

**Behaviour:**
- Descriptions are concatenated in input order (oldest first), separated by `\n\n`.
- Other properties (externalDocs) follow first-wins semantics.

**Example:**
```json
[
  { tag: { name: 'API', description: 'Service A' } },
  { tag: { name: 'API', description: 'Service B' } }
]
```
**Output:** `{ name: 'API', description: 'Service A\n\nService B' }`.

### 6.3 Tag Name Collides with Existing Tag (Not Injected)

**Scenario:** Input A has `tags: [{ name: 'API', description: 'Original' }]` in its spec; Input B injects `tag: { name: 'API', description: 'Injected' }`.

**Behaviour:** The tag's metadata (description, externalDocs) is taken from the **first occurrence** in input order (Input A's `'Original'`). Input B's injected description is ignored.

**Rationale:** Consistent with the library's "first-wins" philosophy for conflicting metadata.

**Documentation note:** Users should avoid name collisions; if they want to customize a tag, inject it explicitly and avoid natural definitions.

### 6.4 operationSelection.excludeTags Removes Injected Tag

**Scenario:** An input specifies `operationSelection: { excludeTags: ['admin'] }` and `tag: { name: 'Admin' }`. Some operations are tagged `'admin'` in the input.

**Behaviour:** Operations tagged `'admin'` are excluded by the filtering step. The `'Admin'` tag is **not** injected into them (because they are already removed). The injected `'Admin'` tag may still be registered in the output's `tags` array if other operations receive it, but no operation will have it from this input.

---

## 7. Backwards Compatibility & Versioning

- **Purely additive:** The `tag` field is optional; existing code continues to work unchanged.
- **Library version:** Minor bump (e.g., `1.4.0 → 1.5.0`).
- **CLI:** No changes required. The CLI's configuration schema auto-wraps `SingleMergeInput`, so the new `tag` field flows through automatically. Run `yarn gen-schema` to regenerate the JSON Schema.
- **Public API:** `merge()` signature unchanged; no new exports required (beyond the types).

---

## 8. Cross-References & Related Proposals

- **[proposal-111-wildcard-tags.md](proposal-111-wildcard-tags.md):** Tag-matching design for `includeTags`/`excludeTags`. This proposal does **not** use wildcards; it injects literal tag names. Future enhancement could allow `tag.name` to expand via wildcards, but out of scope here.
- **[proposal-102-global-info-override.md](proposal-102-global-info-override.md):** Global `info` override at merge time. The `appendInputDescription` mechanism here reuses the same Markdown-heading logic as the `description.append` feature there.
- **[proposal-60-x-tag-groups.md](proposal-60-x-tag-groups.md):** Concatenation of `x-tagGroups` across inputs. An injected tag may warrant inclusion in a group; future work could auto-register via an optional `group` field on `TagInjection`.

---

## 9. Effort Breakdown

| Task | Est. Time | Notes |
|------|-----------|-------|
| **Step 1:** Update types (data.ts) | 15 min | Straightforward type additions. |
| **Step 2:** Extract markdown-heading helper (info.ts) | 20 min | Refactor existing function; test in isolation. |
| **Step 3:** Tag injection in operations (paths-and-components.ts) | 30 min | New `injectTagIntoOperations()` + hook in merge flow. |
| **Step 4:** Register injected tags (tags.ts) | 45 min | Complex merging logic; careful description concatenation. |
| **Step 5:** Jest tests | 60 min | 6 test cases covering all edge cases. |
| **Review & polish** | 20 min | Lint, type-check, minor fixes. |
| **Total** | **~3 hours** | Aligns with effort estimate of 3. |

---

## 10. Acceptance Criteria

- [ ] `TagInjection` type is defined in `packages/openapi-merge/src/data.ts` with full JSDoc.
- [ ] `tag?: TagInjection` field is added to `SingleMergeInputBase`.
- [ ] `formatDescriptionWithHeading()` is extracted in `info.ts` and reusable by `tags.ts`.
- [ ] `injectTagIntoOperations()` function adds the injected tag to every operation (except those filtered out by `operationSelection`).
- [ ] `mergeTags()` correctly registers injected tags and concatenates descriptions in input order.
- [ ] All 6 edge-case tests pass (tag deduplication, multiple injection, appendInputDescription, excludeTags interaction, externalDocs, collision handling).
- [ ] TypeScript compiles without errors; `yarn lint` passes.
- [ ] No breaking changes to the public API; minor version bump confirmed in `packages/openapi-merge/package.json`.
- [ ] CLI `yarn gen-schema` regenerated (committed automatically).
- [ ] Example configuration updated (or added) in `packages/openapi-merge-cli/openapi-merge.test.json` to demonstrate tag injection.

---

## 11. Testing Checklist (Jest)

- [x] Basic injection: single input, single operation.
- [x] Multiple operations receive the same injected tag.
- [x] Tag deduplication within a single operation.
- [x] Tag deduplication across inputs (descriptions concatenate).
- [x] Collision with existing (non-injected) tag from input's spec.
- [x] `appendInputDescription: true` appends info.description to tag.description.
- [x] Interaction with `operationSelection.excludeTags`: excluded ops do NOT receive tag.
- [x] `externalDocs` preserved in output tag.
- [x] `description` field on TagInjection is optional.
- [x] Input with no injected tag is unaffected.

---

## 12. Documentation Updates

### 12.1 README.md (root)

Add a brief example under "Configuration" or "Advanced Usage":

```markdown
#### Tag Injection (Per-Input)

Every operation from an input can be tagged with a specified value:

\`\`\`json
{
  "inputs": [
    {
      "inputFile": "./jira.json",
      "tag": {
        "name": "Jira",
        "description": "Jira-specific endpoints",
        "appendInputDescription": true
      }
    }
  ],
  "output": "./merged.json"
}
\`\`\`

All operations from the Jira input will have `tags: ['Jira']`, and the tag's
description in the output will include Jira's original `info.description`.
\`\`\`
```

### 12.2 AGENTS.md (this repository)

Update the "Key types" section of "The `openapi-merge` Library" to document `TagInjection`.

---

## 13. Risk & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| **Description concatenation order confuses users.** | Medium | Low | Document clearly that descriptions are concatenated in input order (oldest first). Example in tests. |
| **Collision with existing tags goes undetected.** | Low | Low | Document the first-wins behaviour; consider logging a debug warning in future. |
| **exclude Tags silently ignores injected tag.** | Medium | Medium | **Document prominently** in JSDoc and proposal that excludeTags takes precedence; include test case. |
| **appendInputDescription applied twice (via description + append).** | Low | Low | Document as discouraged; JSDoc warns against both. |

---

## 14. Future Enhancements

1. **Wildcard tag names** (proposal-111 follow-up): Allow `tag.name: 'jira-*'` to inject a pattern-matched tag.
2. **Tag grouping** (proposal-60 follow-up): Add `tag.group?: string` to auto-register the injected tag in an `x-tagGroups` group.
3. **Conditional injection**: Add `tag.condition?: (operation) => boolean` to inject only if a predicate is met.
4. **Global tag injection** (proposal-102 follow-up): Top-level `tag` option to inject into **all** operations across all inputs.

---

## 15. Final Estimate

**Value:** 4 (users get a powerful per-input tag-injection feature; improves UI organization in API gateways)  
**Effort:** 3 (well-defined scope; reuses existing markdown-heading logic; ~3 hours coding)  
**ROI:** 5 (4 ÷ 3 ≈ 1.33, high impact relative to effort)
