# Implementation Proposal: Issue #114 — Tab and Space Formatting Options

**Issue**: [#114 Provide tab and space formatting options](https://github.com/robertmassaioli/openapi-merge/issues/114)

---

## 1. Issue Summary

A user wants control over indentation in the CLI's output format. Today, the CLI hard-codes indentation to 2 spaces for both JSON and YAML output, making it difficult for users to merge specs that must conform to their repository's formatting rules (e.g., 4-space indentation or tabs).

---

## 2. Current Behaviour

In `packages/openapi-merge-cli/src/index.ts`:

- **Line 115**: `dumpAsYaml` uses `yaml.safeDump(blob, { indent: 2 })`
- **Line 121**: JSON output uses `JSON.stringify(outputSchema, null, 2)`

Both are hard-coded to 2-space indentation with no user control.

---

## 3. Proposed Configuration Schema

Extend the `Configuration` type in `packages/openapi-merge-cli/src/data.ts` with an optional `formatting` block:

```typescript
export type OutputFormatting = {
  /**
   * Indentation width (number of spaces) or the string "tab" for tab indentation.
   * Only applies to JSON output; YAML does not support tab indentation.
   * Must be an integer between 1 and 8 (typical editor defaults).
   *
   * @default 2
   * @examples [2, 4, "tab"]
   */
  indent?: number | "tab";

  /**
   * If true, use tab characters for indentation instead of spaces.
   * For JSON output only; YAML tab indentation is not supported by the YAML 1.1 spec.
   *
   * @default false
   */
  useTabs?: boolean;
};

export type Configuration = {
  inputs: ConfigurationInput[];
  output: string;
  
  /**
   * Optional formatting rules for the output (JSON/YAML indentation).
   * Defaults: 2-space indentation, no tabs.
   */
  formatting?: OutputFormatting;
};
```

### Rationale for Boolean + Numeric Approach

- **Type safety**: TypeScript discriminates clearly between `indent: 2` (spaces) vs. `useTabs: true` (tabs).
- **JSON Schema friendliness**: Ajv can validate `indent` as an integer and `useTabs` as a boolean natively, without complex `oneOf` logic.
- **User clarity**: Explicit boolean flag is unambiguous in JSON config.

Alternative (string sentinel like `indent: "tab"`):
- ✗ Requires `oneOf` union in JSON Schema, complicating validation.
- ✗ Less type-safe in TypeScript (must discriminate on string value).
- ✗ Conflicts with numeric interpretation.

**Recommendation**: Use `indent: number` + `useTabs: boolean`.

---

## 4. Library Impact

**None.** The `openapi-merge` library produces a JavaScript object. Formatting (indentation, tabs, JSON vs. YAML) is a CLI serialization concern, entirely owned by `writeOutput()` in `packages/openapi-merge-cli/src/index.ts`. No library changes required.

---

## 5. Implementation Steps

### Step 1: Extend Configuration Type
Update `packages/openapi-merge-cli/src/data.ts`:
- Add `OutputFormatting` type with `indent` and `useTabs` fields.
- Add optional `formatting?: OutputFormatting` to `Configuration`.

### Step 2: Update `writeOutput` Function
Modify `packages/openapi-merge-cli/src/index.ts` (lines 113–124):

```typescript
function dumpAsYaml(blob: unknown, formatting?: OutputFormatting): string {
  if (formatting?.useTabs && formatting.indent === undefined) {
    // YAML does not support tab indentation per YAML 1.1 spec
    throw new Error(
      'useTabs: true is not supported for YAML output (.yaml/.yml). ' +
      'YAML spec disallows tabs for indentation.'
    );
  }
  const indentWidth = formatting?.useTabs ? 2 : (formatting?.indent ?? 2);
  return yaml.safeDump(JSON.parse(JSON.stringify(blob)), { indent: indentWidth });
}

function writeOutput(
  outputFullPath: string,
  outputSchema: Swagger.SwaggerV3,
  formatting?: OutputFormatting
): void {
  const fileContents = isYamlExtension(outputFullPath)
    ? dumpAsYaml(outputSchema, formatting)
    : JSON.stringify(outputSchema, null, formatting?.useTabs ? '\t' : (formatting?.indent ?? 2));

  fs.writeFileSync(outputFullPath, fileContents);
}
```

Update the call site (line 165):
```typescript
writeOutput(outputFullPath, mergeResult.output, config.formatting);
```

### Step 3: Regenerate Configuration Schema
Run from `packages/openapi-merge-cli`:
```bash
yarn gen-schema
```
This regenerates `src/configuration.schema.json` with validation rules for the new `formatting` block.

---

## 6. Validation Rules

Enforce at configuration load time (`packages/openapi-merge-cli/src/load-configuration.ts`):

1. **`indent`** (optional): integer in range `[1, 8]` (inclusive). Typical values: 2, 4.
2. **`useTabs`** (optional): boolean. Default: `false`.
3. **YAML + tabs conflict**: If `useTabs: true` and output extension is `.yaml` or `.yml`, reject with clear error: *"Tab indentation is not supported for YAML output; YAML 1.1 spec disallows tabs for indentation. Use `useTabs: false` or output to JSON."*
4. **Defaults**: `indent: 2`, `useTabs: false` (preserves current behaviour).

---

## 7. Testing Strategy

The CLI has no Jest test suite today. Propose **extracting a helper function** (mirrors #93 proposal pattern):

```typescript
export function formatOutput(
  blob: Swagger.SwaggerV3,
  isYaml: boolean,
  formatting?: OutputFormatting
): string {
  if (isYaml) {
    return dumpAsYaml(blob, formatting);
  }
  return JSON.stringify(blob, null, formatting?.useTabs ? '\t' : (formatting?.indent ?? 2));
}
```

**Jest test file** (`packages/openapi-merge-cli/src/__tests__/format-output.test.ts`):

```typescript
import { formatOutput } from '../index';

describe('formatOutput', () => {
  const mockBlob = { openapi: '3.0.3', info: { title: 'Test' } };

  it('formats JSON with 2-space indent by default', () => {
    const result = formatOutput(mockBlob, false);
    expect(result).toContain('  ');
  });

  it('formats JSON with custom indent width', () => {
    const result = formatOutput(mockBlob, false, { indent: 4 });
    expect(result).toMatch(/\n    /); // 4-space indent
  });

  it('formats JSON with tab indent when useTabs is true', () => {
    const result = formatOutput(mockBlob, false, { useTabs: true });
    expect(result).toContain('\t');
  });

  it('throws error for YAML with tab indent', () => {
    expect(() => formatOutput(mockBlob, true, { useTabs: true }))
      .toThrow(/YAML.*tabs.*not supported/i);
  });

  it('formats YAML with default 2-space indent', () => {
    const result = formatOutput(mockBlob, true);
    expect(result).toContain('openapi: 3.0.3');
  });
});
```

---

## 8. Documentation Updates

### README (`packages/openapi-merge-cli/README.md`)
Add a new section on formatting:

```markdown
### Formatting

Control JSON and YAML indentation via the optional `formatting` block:

```jsonc
{
  "inputs": [...],
  "output": "./merged.json",
  "formatting": {
    "indent": 4,       // 1-8 spaces, default 2
    "useTabs": false   // default false
  }
}
```

**Note**: Tab indentation (`useTabs: true`) applies to JSON only. YAML output
always uses space indentation (YAML 1.1 spec requirement). If you attempt to
use `useTabs: true` with a `.yaml`/`.yml` output file, the CLI will reject the
configuration.
```

### JSON Schema `description` fields
Update `OutputFormatting` JSDoc to reflect the above constraints.

---

## 9. Versioning

- **CLI package** (`packages/openapi-merge-cli`): Bump `1.3.2` → `1.4.0` (minor release, backwards-compatible feature).
- **Library package** (`packages/openapi-merge`): No change; remains at current version.

---

## 10. Effort & Value Estimate

- **Value**: 3/5 (moderate user convenience; enables repo-integration workflows)
- **Effort**: 1/5 (isolated to CLI `writeOutput`, straightforward validation, no library changes)

**Estimated effort**: ~4–6 hours (type definitions, validation, testing, docs).

---

## 11. Acceptance Criteria

- [ ] `OutputFormatting` type defined and added to `Configuration` in `cli/src/data.ts`.
- [ ] `dumpAsYaml` and `writeOutput` updated to accept and apply formatting options.
- [ ] Configuration validation rejects `useTabs: true` for `.yaml`/`.yml` outputs with clear error message.
- [ ] `formatting` block is optional and defaults to `{ indent: 2, useTabs: false }`.
- [ ] `yarn gen-schema` regenerates `configuration.schema.json` with correct constraints.
- [ ] Jest tests added for `formatOutput` covering indent width, tabs, YAML rejection.
- [ ] README updated with formatting examples and YAML limitation note.
- [ ] E2E test (manual or shell-based) confirms merged output respects `indent: 4` and `useTabs: true` for JSON.
- [ ] All existing tests pass; no breaking changes to public CLI API.
- [ ] CLI version bumped to `1.4.0`; library version unchanged.

---

## 12. Risks & Notes

1. **YAML spec limitation**: Clearly document that YAML does not support tab indentation. Reject at config-validation time rather than silently falling back.
2. **`js-yaml` limitations**: The `yaml.safeDump` API does not expose tab options; indent is always numeric. This is fine; we validate and reject before reaching YAML serialization.
3. **Backwards compatibility**: Fully maintained. Configs without `formatting` block work unchanged.
