# Proposal: Issue #102 — Global title/description override in config

**Issue Link:** https://github.com/robertmassaioli/openapi-merge/issues/102  
**Status:** Proposal  
**Value:** 3 / **Effort:** 2

---

## 1. Issue Summary

Currently, the merged OpenAPI spec's top-level `info` block (title, description, version, contact, license, etc.) is determined by a "first-input-wins" rule: it is copied verbatim from the first input file's `info` block. Users cannot override this via the CLI configuration; the only way to change the merged `title` or `description` is to edit the first input file directly.

**User request:** Add a top-level `info` section to the CLI configuration file that allows users to override (or partially customize) the merged spec's `info` block, e.g.:

```json
{
  "inputs": [ /* ... */ ],
  "output": "./merged.json",
  "info": {
    "title": "My API Gateway",
    "description": "Unified API for all microservices"
  }
}
```

This is especially valuable in API Gateway scenarios where the merged spec's metadata must reflect the gateway itself, not any individual microservice.

---

## 2. Current Behaviour

### Library (`packages/openapi-merge/src/info.ts`)

The `mergeInfos()` function (line 25–37) implements the merge:

```typescript
export function mergeInfos(mergeInput: MergeInput): Swagger.Info {
  const finalInfo = _.cloneDeep(mergeInput[0].oas.info);

  const appendedDescriptions = mergeInput
    .filter(i => i.description && i.description.append)
    .map(getInfoDescriptionWithHeading)
    .filter(isPresent);

  if (appendedDescriptions.length > 0) {
    finalInfo.description = appendedDescriptions.join('\n\n');
  }

  return finalInfo;
}
```

Key points:
- Line 26: **first-input-wins** — all fields (`title`, `version`, `contact`, etc.) come from `inputs[0].oas.info`.
- Lines 28–34: if any input has `description.append: true`, collected descriptions replace (not extend) the base description.
- **No way to override** `title` or other fields globally.

### CLI (`packages/openapi-merge-cli/src/index.ts`)

At line 152, `merge(inputs)` is called with no options argument:

```typescript
const mergeResult = merge(inputs);
```

The CLI `Configuration` type (packages/openapi-merge-cli/src/data.ts, line 197–213) has no `info` field:

```typescript
export type Configuration = {
  inputs: ConfigurationInput[];
  output: string;
};
```

---

## 3. Design Options

### Option A: CLI-Only Override

Add an optional `info?: Partial<Swagger.Info>` field to the CLI `Configuration` type. When present, apply it **after** the merge at the CLI level (e.g., in `index.ts` line 152–164). No library changes.

**Pros:**
- Minimal code; CLI-only concern.
- Users can quickly override `title` without touching the library.

**Cons:**
- Library consumers (e.g., programmatic callers) cannot use this feature.
- Violates the principle that the library should be self-contained and reusable.
- Inconsistent with the "first-class feature" status this deserves.

### Option B: Library-Level Option

Introduce an optional second argument to `merge()`: `merge(inputs, options?: { info?: Partial<Swagger.Info> })`, following the pattern established in [proposal-76](ai-planning/proposal-76-openapi-version.md). The library applies the override in `mergeInfos()`. The CLI then passes `config.info` as `options.info` when calling `merge()`.

**Pros:**
- Both library and CLI consumers benefit.
- Consistent with proposal-76's `options` pattern for future extensibility.
- Semantically clear: the override is a merge concern, not a post-processing concern.
- Reusable for non-CLI integrations.

**Cons:**
- Requires touching the library's public API.
- Must decide merge semantics upfront (see section 4 below).

### Option C: Both (Recommended)

Implement Option B (library-level), then surface it in Option A (CLI). This gives maximum flexibility and future-proofs the design.

**Recommendation: Proceed with Option C.** The library change is minimal, the pattern is proven (proposal-76), and the feature is too valuable to keep CLI-only.

---

## 4. Merge Semantics

When a user provides an `info` override, the following rules apply:

### 4.1 Shallow Override (Per-Key Basis)

The override is **shallow-merged** with the first input's `info`. That is, for each field in the override, use the override value; for each field NOT in the override, use the first input's value.

**Example:**

```json
/* First input's info */
{
  "title": "Microservice A",
  "version": "1.0.0",
  "description": "Details about A",
  "contact": { "name": "Alice" }
}

/* Config override */
{
  "info": {
    "title": "API Gateway"
  }
}

/* Result */
{
  "title": "API Gateway",              /* overridden */
  "version": "1.0.0",                  /* from input */
  "description": "Details about A",    /* from input */
  "contact": { "name": "Alice" }       /* from input */
}
```

**Justification:** Users often want to override just `title` or `description` without losing `version` or `contact` information from the first input.

### 4.2 Interaction with Description Appending

If a user provides `info.description` in the config AND any input has `description.append: true`, the config description becomes the **base** on which input descriptions are appended.

**Example:**

```json
/* Config */
{
  "info": {
    "description": "Global description"
  },
  "inputs": [
    {
      "inputFile": "a.json",
      "description": { "append": true, "title": { "value": "Service A" } }
    }
  ]
}

/* Result */
{
  "description": "Global description\n\n# Service A\n\nDetails from a.json"
}
```

**Justification:** The override is the "root" info, and appends are supplementary sections. This gives users full control over the header while still allowing service-level descriptions to be included.

---

## 5. API Design

### 5.1 Library: Introduce `MergeOptions`

In `packages/openapi-merge/src/data.ts`, add a new exported interface:

```typescript
export interface MergeOptions {
  /**
   * Optional global override for the merged spec's top-level `info` block.
   * Fields in this override take precedence over the first input's corresponding fields.
   * Fields not specified here default to the first input's values.
   *
   * This override is applied before per-input description appending logic.
   */
  info?: Partial<Swagger.Info>;
}
```

Update the `merge` function signature in `packages/openapi-merge/src/index.ts`:

```typescript
export function merge(inputs: MergeInput, options?: MergeOptions): MergeResult {
  // ...
}
```

**Backwards compatibility:** The second argument is optional; all existing call sites continue to work.

**Cross-reference:** This pattern mirrors proposal-76's `MergeOptions` for `openapi` version override, enabling future unification of both options into a single object.

### 5.2 CLI: Extend `Configuration`

In `packages/openapi-merge-cli/src/data.ts`, extend the `Configuration` type:

```typescript
export type Configuration = {
  /**
   * The input items for the merge algorithm. You must provide at least one.
   *
   * @minItems 1
   * @examples require('./examples-for-schema.ts').ConfigurationInputExamples
   */
  inputs: ConfigurationInput[];

  /**
   * The output file to put the results in. If you use the .yml or .yaml extension
   * then the schema will be output in YAML format, otherwise, it will be output in JSON format.
   *
   * @minLength 1
   */
  output: string;

  /**
   * Optional global override for the merged spec's top-level `info` block.
   * Fields in this override take precedence over the first input's corresponding fields.
   */
  info?: Partial<Swagger.Info>;
};
```

In `packages/openapi-merge-cli/src/index.ts`, line 152, pass the override to `merge()`:

```typescript
const mergeResult = merge(inputs, {
  info: config.info
});
```

Regenerate the JSON schema:

```bash
bolt w openapi-merge-cli run gen-schema
```

---

## 6. Implementation Steps

### Step 1: Update library types (`packages/openapi-merge/src/data.ts`)

- Add `MergeOptions` interface (3–5 lines).
- Export it from `index.ts` for CLI consumption.

### Step 2: Update `mergeInfos()` function

In `packages/openapi-merge/src/info.ts`:

- Modify signature: `export function mergeInfos(mergeInput: MergeInput, options?: MergeOptions): Swagger.Info`
- After line 26 (cloning first input's info), shallow-merge the override if present:

```typescript
const finalInfo = _.cloneDeep(mergeInput[0].oas.info);

if (options?.info) {
  Object.assign(finalInfo, options.info);  // shallow merge: override keys win
}

// ... rest of description-append logic unchanged
```

- Update the call site in `index.ts` to pass `options`.

### Step 3: Update CLI configuration types

In `packages/openapi-merge-cli/src/data.ts`:

- Add `info?: Partial<Swagger.Info>` field to `Configuration` (with JSDoc).
- Import `Partial` and `Swagger.Info` as needed.

### Step 4: Update CLI entry point

In `packages/openapi-merge-cli/src/index.ts`, line 152:

```typescript
const mergeResult = merge(inputs, {
  info: config.info
});
```

### Step 5: Regenerate JSON schema

```bash
bolt w openapi-merge-cli run gen-schema
```

This auto-generates `packages/openapi-merge-cli/src/configuration.schema.json` from the TypeScript types.

### Step 6: Add tests (see section 7 below)

---

## 7. Tests

### 7.1 Library Tests

In `packages/openapi-merge/src/__tests__/info.test.ts`, add cases:

**Test: Override title only**
```typescript
it('should override info.title when options.info.title is provided', () => {
  const first = toOAS({});
  first.info.title = 'Original Title';
  first.info.version = '1.0.0';

  const mergeInputs = toMergeInputs([first]);
  const output = toOAS({});
  output.info.title = 'Overridden Title';
  output.info.version = '1.0.0';

  expectMergeResult(merge(mergeInputs, { info: { title: 'Overridden Title' } }), {
    output
  });
});
```

**Test: Override title and description**
```typescript
it('should override both title and description, preserving other fields', () => {
  const first = toOAS({});
  first.info.title = 'Original';
  first.info.version = '2.0.0';
  first.info.contact = { name: 'Alice' };

  const mergeInputs = toMergeInputs([first]);
  const output = toOAS({});
  output.info.title = 'New Title';
  output.info.description = 'New Description';
  output.info.version = '2.0.0';
  output.info.contact = { name: 'Alice' };

  expectMergeResult(merge(mergeInputs, { 
    info: { title: 'New Title', description: 'New Description' } 
  }), { output });
});
```

**Test: Override description with append: true**
```typescript
it('should use override description as base when appending input descriptions', () => {
  const first = toOAS({});
  first.info.description = 'Input A description';
  const second = toOAS({});
  second.info.description = 'Input B description';

  const mergeInputs = toMergeInputs([first, second]);
  mergeInputs[1].description = { append: true, title: { value: 'Service B' } };

  const output = toOAS({});
  output.info.description = 'Override description\n\n# Service B\n\nInput B description';

  expectMergeResult(merge(mergeInputs, { 
    info: { description: 'Override description' } 
  }), { output });
});
```

**Test: No override provided (backwards compatibility)**
```typescript
it('should use first input info when no override is provided', () => {
  const first = toOAS({});
  first.info.title = 'First Title';
  
  const mergeInputs = toMergeInputs([first]);
  const output = toOAS({});
  output.info.title = 'First Title';

  expectMergeResult(merge(mergeInputs), { output });  // no options arg
});
```

### 7.2 CLI Tests

No Jest tests are added to the CLI package (it has no test suite currently). Manual e2e testing can be done via:

```bash
# Create a test config with an info override
cat > test-config.json << 'EOF'
{
  "inputs": [
    { "inputFile": "packages/openapi-merge-cli/confluence.swagger.yaml" }
  ],
  "output": "test-output.json",
  "info": {
    "title": "Custom Gateway API",
    "description": "Unified API"
  }
}
EOF

# Run the CLI
yarn cli -- --config test-config.json

# Inspect test-output.json to confirm title and description
cat test-output.json | grep -A2 '"info"'
```

---

## 8. Versioning & Release

- **Backwards compatible:** the second `options` argument to `merge()` is optional; all existing code continues to work.
- **Version bump:** minor bump (`x.1.0`) for both `packages/openapi-merge` and `packages/openapi-merge-cli` (they are independent packages; both may need bumps).
- **Release:** after version bump and merge to `main`, CI's `npm-publish.yml` automatically publishes both packages to npm.

---

## 9. Acceptance Criteria

- [ ] `MergeOptions` interface exists in `packages/openapi-merge/src/data.ts` with JSDoc for `info` field
- [ ] `merge(inputs, options?)` signature is updated in `packages/openapi-merge/src/index.ts`
- [ ] `mergeInfos()` accepts and applies the `options.info` override via shallow merge (using `Object.assign` or lodash `extend`)
- [ ] Override is applied **before** description-appending logic so appends stack on top of the override
- [ ] `Configuration` type in `packages/openapi-merge-cli/src/data.ts` includes `info?: Partial<Swagger.Info>`
- [ ] CLI entry point (`index.ts` line ~152) passes `{ info: config.info }` to `merge()`
- [ ] `configuration.schema.json` is regenerated via `yarn gen-schema` and committed
- [ ] All four new Jest cases in `info.test.ts` pass (override title, override title+description, override+append, no override)
- [ ] Existing tests in `info.test.ts` still pass (backwards compatibility)
- [ ] `yarn lint` and `tsc --noEmit` pass for both packages
- [ ] Manual e2e test confirms config override appears in output JSON/YAML
- [ ] Version bumped in both `package.json` files

---

## 10. Effort Estimate

**Value 3 / Effort 2 — Quick Win** (confirmed from issue-triage file)

### Justification

**Library changes (~15 minutes):**
- Add `MergeOptions` interface to `data.ts` (~5 lines with JSDoc).
- Update `mergeInfos()` signature and add shallow-merge logic (~3 lines of actual logic).
- Update call site in `index.ts` to pass options (~2 lines).
- Four new Jest test cases (~40 lines total).

**CLI changes (~10 minutes):**
- Add `info` field to `Configuration` type (~3 lines with JSDoc).
- Update `index.ts` to pass `config.info` to `merge()` (~2 lines).
- Regenerate schema via `yarn gen-schema` (~1 command).

**No complexity:**
- Shallow merge is straightforward; no deep recursion or complex deduplication needed.
- Existing tests provide a pattern to follow.
- Schema regeneration is automatic.

**Total time:** ~25 minutes of active coding + test runs.

---

## 11. Implementation Notes

1. **Order of operations in `mergeInfos()`:** The override must be applied **before** the description-append logic, so that user-provided descriptions can still have sub-sections appended underneath. This is intuitive: the config-level description is the "header," and input-level descriptions are "content."

2. **Shallow vs. deep merge:** `Object.assign` performs a shallow merge (only top-level keys are overridden). This is the correct choice because `Swagger.Info` fields like `contact` and `license` are objects, and users should not have to re-specify the entire object if they only want to override `title`. Shallow merge preserves any per-field defaults from the first input.

3. **No validation changes needed:** The CLI already validates the configuration against `configuration.schema.json`, which is auto-generated. Regenerating the schema will automatically add validation for the new `info` field using Swagger.Info's constraints (if any).

4. **Shared `MergeOptions` future:** This `MergeOptions` interface mirrors the pattern in proposal-76 (for `openapi` version override). A future proposal may unify them into one options object, e.g., `{ info?: ..., openapi?: ... }`.

