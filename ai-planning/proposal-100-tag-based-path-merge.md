# Implementation Proposal: Issue #100 — Merge Paths Based on Specific Tags

**Status:** Proposal

**Value:** 3 / **Effort:** 2 / **ROI:** 4 / **Quadrant:** Quick Win

**Issue:** [#100 — Merge paths based on specific tags](https://github.com/robertmassaioli/openapi-merge/issues/100)

---

## 1. Issue Summary

User asks: _"Can I merge multiple service Swagger files while selecting only the paths that have a specific tag?"_

In their scenario, they have three services and want to include only paths tagged `"Service1"` from service1's spec, while merging other services fully or with different tag selections.

---

## 2. Is This Already Supported?

**Yes, largely.** The existing `operationSelection.includeTags` (and the complementary `excludeTags`) already provide exactly this capability.

### Proof: Reading the Code

From `packages/openapi-merge/src/operation-selection.ts`:

```typescript
function operationContainsAnyTag(operation: Swagger.Operation, tags: string[]): boolean {
  return operation.tags !== undefined && operation.tags.some(tag => tags.includes(tag));
}

function includeOperationsThatHaveTags(originalOas: Swagger.SwaggerV3, includeTags: string[]): Swagger.SwaggerV3 {
  // Iterates all paths and methods; deletes any operation that does NOT have at least one tag from includeTags
}
```

This function is applied per-input, meaning:
- Each input in the merge can independently declare `operationSelection.includeTags: ["Service1"]`.
- Only operations (and thus their paths) that have at least one of those tags will be included.
- Exclusion of tags without those operations deletes the entire method from the path.

### Why It Solves the Issue

The user's goal:

> "Include only the paths from service1 Swagger that comply with the 'Service1' tag. Paths from service1 that don't comply should be excluded."

Maps directly to:

```json
{
  "inputFile": "service1/dist/functions/api/swagger.json",
  "operationSelection": {
    "includeTags": ["Service1"]
  }
}
```

---

## 3. Worked Example

Given three services with mixed tags, here is a complete `openapi-merge.json` that solves the user's stated problem:

```json
{
  "inputs": [
    {
      "inputFile": "service1/dist/functions/api/swagger.json",
      "operationSelection": {
        "includeTags": ["Service1"]
      },
      "description": {
        "append": true,
        "title": {
          "value": "Service 1 (Service1 tag only)",
          "headingLevel": 2
        }
      }
    },
    {
      "inputFile": "service2/dist/functions/api/swagger.json",
      "description": {
        "append": true,
        "title": {
          "value": "Service 2 (all operations)",
          "headingLevel": 2
        }
      }
    },
    {
      "inputFile": "service3/dist/functions/api/swagger.json",
      "operationSelection": {
        "includeTags": ["public"]
      },
      "description": {
        "append": true,
        "title": {
          "value": "Service 3 (public tag only)",
          "headingLevel": 2
        }
      }
    }
  ],
  "output": "./dist/service.output.swagger.json"
}
```

**Key Points:**
- Input 1 (service1) includes only operations tagged `"Service1"`.
- Input 2 (service2) includes all operations (no `operationSelection`).
- Input 3 (service3) includes only operations tagged `"public"`.
- If service1 has paths without the `"Service1"` tag, those methods are silently removed.
- If a path becomes empty (all methods removed), the path itself is deleted.

---

## 4. Identified Gaps

Upon careful review, there are **no code-level gaps**. The feature is fully implemented. However, there is **one documentation gap**:

### 4.1 Clarity: Exact Semantics of `includeTags`

The documentation in `packages/openapi-merge-cli/README.md` (line 60) says:

> "Only operations that are tagged with the tags configured here will be extracted from the OpenAPI file and merged with the others."

This is correct but terse. The user's question suggests confusion about whether `includeTags` works at the operation level or path level. **It works at the operation level**: if a path has multiple methods (GET, POST, etc.), and only one has the required tag, only that method is included.

### 4.2 Example in README

The current CLI README includes a simple example but does not show the `includeTags` / `excludeTags` pattern in action with a realistic scenario. Adding a worked example would help.

---

## 5. Cross-Links to Related Proposals

- **[#111 — Support wildcards in include/excludeTags](ai-planning/proposal-111-wildcard-tags.md)**: Once merged, users can write `"includeTags": ["service-*"]` to match any tag starting with `"service-"`. This would allow even more flexible filtering.
- **[#112 — Per-input tag injection](ai-planning/proposal-112-merge-into-tag.md)**: Allows automatic tag assignment to operations without modifying the source OpenAPI files. Complementary to `includeTags`.
- **[#71 — Configurable duplicate path handling](ai-planning/proposal-71-skip-duplicate-paths.md)**: Addresses conflict resolution when two inputs have overlapping paths (orthogonal to tag-based filtering).

---

## 6. Recommendation

**Close #100 as "documentation" and add a worked example to the CLI README.**

The feature already exists and is fully functional. The issue stems from lack of visibility, not missing code. A 5–10 line addition to the CLI README with a worked example (as shown in section 3) will immediately unblock users.

---

## 7. Documentation Work

### 7.1 Update `packages/openapi-merge-cli/README.md`

Add a new section after the existing parameter list (after line 64):

```markdown
### Tag-Based Path Filtering

You can include or exclude operations from a specific input based on their tags. This is useful when a single OpenAPI file contains multiple logical sub-APIs and you only want to merge a subset.

**Example:** Merge only the "public" endpoints from a service:

```json
{
  "inputs": [
    {
      "inputFile": "./my-service.swagger.json",
      "operationSelection": {
        "includeTags": ["public"]
      }
    }
  ],
  "output": "./output.swagger.json"
}
```

All operations without the "public" tag will be excluded from the merge. If a path becomes empty (all methods removed), the entire path is omitted from the output.

**Advanced:** Use `includeTags` and `excludeTags` together. If an operation has both a tag in `includeTags` and a tag in `excludeTags`, the exclusion takes precedence.

```json
{
  "operationSelection": {
    "includeTags": ["api"],
    "excludeTags": ["deprecated"]
  }
}
```

In this case, only operations tagged "api" are included, unless they are also tagged "deprecated".

**Future Enhancement:** Once [#111](https://github.com/robertmassaioli/openapi-merge/issues/111) is implemented, wildcards will be supported: `"includeTags": ["service-*"]` will match all tags starting with "service-".
```

### 7.2 Update Library README (root `README.md`)

Add a single paragraph to the merge rules section (after the "First-input-wins" and "Deterministic merge" lists):

```markdown
**Tag-based operation filtering:** Each input can declare `operationSelection.includeTags` and `operationSelection.excludeTags` to include or exclude operations from the merge. This is applied per-input, allowing different inputs to contribute different subsets of their operations. Exclusion takes precedence if an operation has tags in both lists.
```

---

## 8. No Code Changes Required

The existing `operationSelection` logic is sufficient. No new types, functions, or Jest tests are needed.

---

## 9. Effort Estimate

- **Documentation update:** ~15 minutes.
- **Review & commit:** ~5 minutes.
- **Total:** ~20 minutes.

**Revised Value/Effort:** Value 2 (it's mostly docs, not feature work) / Effort 1 (very light). **ROI: 2**.

---

## 10. Acceptance Criteria

- [ ] Add "Tag-Based Path Filtering" section to `packages/openapi-merge-cli/README.md` with a worked example.
- [ ] Add one paragraph to root `README.md` summarizing tag-based filtering in the merge rules.
- [ ] Close issue #100 with a reference to the new documentation and a link to #111 (wildcards).

---

## 11. Timeline

**Can ship immediately** as part of the "CLI Ergonomics" minor release (as suggested in the triage document). No code review or testing needed beyond verification that the documentation is clear.
