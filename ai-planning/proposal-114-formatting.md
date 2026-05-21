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

Extend the `Configuration` type in `packages/openapi-merge-cli/src/data.ts` with an optional `formatting` block whose `indent` field is a **discriminated union** keyed on `strategy`:

```typescript
/**
 * Indent using a fixed number of space characters per level.
 */
export type SpaceIndent = {
  strategy: 'spaces';
  /**
   * Number of space characters per indentation level.
   * Must be an integer between 1 and 8 (typical editor defaults).
   *
   * @default 2
   */
  width: number;
};

/**
 * Indent using a single tab character per level.
 *
 * Note: This is only valid for JSON output. YAML 1.1 disallows tabs as
 * indentation, so a YAML output combined with `strategy: 'tabs'` is rejected
 * at configuration-validation time (see section 6).
 */
export type TabIndent = {
  strategy: 'tabs';
};

export type Indent = SpaceIndent | TabIndent;

export type OutputFormatting = {
  /**
   * Indentation strategy for the output file. A discriminated union so
   * there is exactly one source of truth for "tabs vs. spaces" and so
   * the TypeScript compiler / JSON Schema validator can guarantee no
   * contradictory combinations (e.g. tabs + a space width).
   *
   * @default { strategy: 'spaces', width: 2 }
   */
  indent?: Indent;
};

export type Configuration = {
  inputs: ConfigurationInput[];
  output: string;

  /**
   * Optional formatting rules for the output (JSON/YAML indentation).
   * Defaults to `{ indent: { strategy: 'spaces', width: 2 } }`, preserving
   * the current behaviour.
   */
  formatting?: OutputFormatting;
};
```

### Example configurations

```jsonc
// Default behaviour — equivalent to omitting `formatting` entirely
{ "formatting": { "indent": { "strategy": "spaces", "width": 2 } } }

// 4-space indentation
{ "formatting": { "indent": { "strategy": "spaces", "width": 4 } } }

// Tab indentation (JSON output only)
{ "formatting": { "indent": { "strategy": "tabs" } } }
```

### Why a discriminated union here

This shape was chosen over a flat `{ indent: number; useTabs: boolean }` after we noticed the flat version is internally contradictory: it allows nonsense combinations like `{ indent: 4, useTabs: true }` (does the 4 mean "4 spaces" or "4 tabs"?), and the boolean is redundant once we also accept tabs as a value.

A discriminated union eliminates that ambiguity by construction:

- **Type safety** — TypeScript narrows on `indent.strategy` and refuses to read `width` on a `TabIndent`, or to omit `width` on a `SpaceIndent`. Every reachable state is well-defined.
- **No contradictory states** — there is no way to express "tabs of width 4" or "spaces but use tabs". Configuration-load-time validation reduces to checking the `width` range for `SpaceIndent`.
- **JSON Schema friendly** — Ajv handles tagged-union schemas natively via the `discriminator` keyword (or via a small `oneOf` with `const` on `strategy`). Both styles are well-supported by `typescript-json-schema` which we already use.
- **Future-proof** — adding new indent strategies later (e.g. `{ strategy: 'mixed', ... }` for the rare repos that demand it) is a single new variant; no flag explosion.

### Rejected alternative: flat `{ indent, useTabs }`

```typescript
// REJECTED — kept here only as a record of the design discussion
type OutputFormatting = {
  indent?: number | "tab";   // overlapping responsibility with useTabs
  useTabs?: boolean;          // redundant
};
```

Why it was rejected:

- Two fields can express the same intent (`indent: "tab"` vs. `useTabs: true`), so the spec needs a precedence rule no user will remember.
- Allows undefined combinations like `{ indent: "tab", useTabs: false }`.
- The `number | "tab"` union still requires a `oneOf` in JSON Schema, so the supposed "simpler validation" argument did not hold.
- The proposal's own internal "Recommendation" line contradicted the type literal above it, which is itself evidence that the shape was confusing.

CLI flag shortcuts may still flatten this for ergonomics (e.g.
`--indent 4`, `--tabs`), but they parse into the discriminated-union
shape internally so the rest of the code sees only one model.

---

## 4. Library Impact

**None.** The `openapi-merge` library produces a JavaScript object. Formatting (indentation, tabs, JSON vs. YAML) is a CLI serialization concern, entirely owned by `writeOutput()` in `packages/openapi-merge-cli/src/index.ts`. No library changes required.

---

## 5. Implementation Steps

### Step 1: Extend Configuration Type
Update `packages/openapi-merge-cli/src/data.ts`:
- Add `SpaceIndent`, `TabIndent`, `Indent`, and `OutputFormatting` types as defined in section 3.
- Add optional `formatting?: OutputFormatting` to `Configuration`.

### Step 2: Centralise the default in one place

Add a `DEFAULT_INDENT` constant so the literal `{ strategy: 'spaces', width: 2 }` is never spread across the codebase:

```typescript
// packages/openapi-merge-cli/src/data.ts (or a small helpers file)
export const DEFAULT_INDENT: Indent = { strategy: 'spaces', width: 2 };
```

### Step 3: Update `writeOutput` / `dumpAsYaml`

Modify `packages/openapi-merge-cli/src/index.ts` (lines 113–124). The discriminated union lets us exhaustively switch on `indent.strategy`, which the TypeScript compiler enforces (`assertNever` ensures any future variant breaks the build until handled):

```typescript
import { Indent, OutputFormatting } from './data';
import { DEFAULT_INDENT } from './data';

function assertNever(x: never): never {
  throw new Error(`Unhandled indent strategy: ${JSON.stringify(x)}`);
}

/**
 * The single source of truth for translating an Indent into the value
 * that JSON.stringify / yaml.safeDump expect for their `space` /
 * `indent` argument. JSON accepts a string (for tabs) or a number;
 * YAML only accepts a number (tabs are rejected upstream by config
 * validation, so the YAML path can assume `strategy === 'spaces'`).
 */
function indentToJsonStringifyArg(indent: Indent): string | number {
  switch (indent.strategy) {
    case 'spaces': return indent.width;
    case 'tabs':   return '\t';
    default:       return assertNever(indent);
  }
}

function dumpAsYaml(blob: unknown, formatting?: OutputFormatting): string {
  const indent = formatting?.indent ?? DEFAULT_INDENT;
  if (indent.strategy !== 'spaces') {
    // Defensive: configuration validation should have rejected this already.
    throw new Error(
      `Tab indentation is not supported for YAML output (.yaml/.yml); ` +
      `YAML 1.1 disallows tab characters as indentation.`
    );
  }
  // Note: JSON stringify+parse strips undefined values; see js-yaml#571.
  return yaml.safeDump(JSON.parse(JSON.stringify(blob)), { indent: indent.width });
}

function writeOutput(
  outputFullPath: string,
  outputSchema: Swagger.SwaggerV3,
  formatting?: OutputFormatting,
): void {
  const indent = formatting?.indent ?? DEFAULT_INDENT;
  const fileContents = isYamlExtension(outputFullPath)
    ? dumpAsYaml(outputSchema, formatting)
    : JSON.stringify(outputSchema, null, indentToJsonStringifyArg(indent));

  fs.writeFileSync(outputFullPath, fileContents);
}
```

Update the call site (line 165):

```typescript
writeOutput(outputFullPath, mergeResult.output, config.formatting);
```

### Step 4: Regenerate Configuration Schema
Run from `packages/openapi-merge-cli`:
```bash
yarn gen-schema
```
This regenerates `src/configuration.schema.json` with validation rules for the new `formatting` block.

---

## 6. Validation Rules

Enforce at configuration load time (`packages/openapi-merge-cli/src/load-configuration.ts`). Because we use a discriminated union, most of the structural validation is free from the JSON Schema generated by `typescript-json-schema`:

1. **Tag check** (free from the schema): `indent.strategy` must be `"spaces"` or `"tabs"`. Anything else is rejected by Ajv before our code runs.
2. **`SpaceIndent.width`** (free from the schema): integer in range `[1, 8]` (inclusive). Typical values: 2, 4. Enforce via `minimum`/`maximum`/`type: integer` in the schema (add `@minimum 1` / `@maximum 8` JSDoc tags so `typescript-json-schema` emits the constraint).
3. **YAML + tabs conflict** (semantic, enforced in code after the schema check): if `indent.strategy === 'tabs'` and the resolved output extension is `.yaml` or `.yml`, reject with a clear error message such as: *"Tab indentation is not supported for YAML output; YAML 1.1 disallows tabs as indentation. Use `{ \"strategy\": \"spaces\", \"width\": N }` or output to JSON."* Surface this as `ExitCode.ErrorLoadingConfig`.
4. **Default**: when `formatting` or `formatting.indent` is omitted, behaviour is exactly today's (`DEFAULT_INDENT === { strategy: 'spaces', width: 2 }`).

Notes:

- A `TabIndent` with no `width` property is unrepresentable by construction, so there is no "tabs of width 4" combination to reject.
- A `SpaceIndent` with `width` missing is also unrepresentable, so users cannot omit the width and silently fall back. They either omit `formatting.indent` entirely (and get the default) or they specify `{ strategy: 'spaces', width: N }` in full.

---

## 7. Testing Strategy

The CLI has no Jest test suite today. Propose **extracting a helper function** (mirrors #93 proposal pattern). Note how clean the helper becomes once tabs vs. spaces lives in a single discriminated value rather than spread across two fields:

```typescript
export function formatOutput(
  blob: Swagger.SwaggerV3,
  isYaml: boolean,
  formatting?: OutputFormatting,
): string {
  if (isYaml) {
    return dumpAsYaml(blob, formatting);
  }
  const indent = formatting?.indent ?? DEFAULT_INDENT;
  return JSON.stringify(blob, null, indentToJsonStringifyArg(indent));
}
```

**Jest test file** (`packages/openapi-merge-cli/src/__tests__/format-output.test.ts`):

```typescript
import { formatOutput } from '../index';
import { Indent } from '../data';

const SPACES_2: Indent = { strategy: 'spaces', width: 2 };
const SPACES_4: Indent = { strategy: 'spaces', width: 4 };
const TABS:     Indent = { strategy: 'tabs' };

describe('formatOutput', () => {
  const mockBlob = { openapi: '3.0.3', info: { title: 'Test' } };

  it('formats JSON with 2-space indent by default', () => {
    const result = formatOutput(mockBlob, false);
    expect(result).toMatch(/\n  "/);
  });

  it('formats JSON with an explicit 4-space indent', () => {
    const result = formatOutput(mockBlob, false, { indent: SPACES_4 });
    expect(result).toMatch(/\n    "/);
  });

  it('formats JSON with tab indent when indent.strategy === "tabs"', () => {
    const result = formatOutput(mockBlob, false, { indent: TABS });
    expect(result).toMatch(/\n\t"/);
  });

  it('rejects YAML output with tab indent (defensive — config validation should have caught it)', () => {
    expect(() => formatOutput(mockBlob, true, { indent: TABS }))
      .toThrow(/YAML.*tab/i);
  });

  it('formats YAML with default 2-space indent', () => {
    const result = formatOutput(mockBlob, true);
    expect(result).toContain('openapi: 3.0.3');
  });

  it('formats YAML with an explicit 4-space indent', () => {
    const result = formatOutput(mockBlob, true, { indent: SPACES_4 });
    // js-yaml's dump produces 4-space nesting for the nested `info` block.
    expect(result).toMatch(/^info:\n    title:/m);
  });

  it('treats omitted indent and DEFAULT_INDENT as equivalent', () => {
    const omitted = formatOutput(mockBlob, false);
    const explicit = formatOutput(mockBlob, false, { indent: SPACES_2 });
    expect(omitted).toBe(explicit);
  });
});
```

Additional coverage worth adding (load-configuration tests):

- Schema rejects `{ indent: { strategy: 'tabs', width: 4 } }` (excess property) — proves the discriminator is enforced.
- Schema rejects `{ indent: { strategy: 'spaces' } }` (missing `width`).
- Schema rejects `{ indent: { strategy: 'something-else' } }` (unknown discriminator).
- Semantic validation rejects `strategy: 'tabs'` when `output` ends in `.yaml` / `.yml`.

---

## 8. Documentation Updates

### README (`packages/openapi-merge-cli/README.md`)
Add a new section on formatting:

```markdown
### Formatting

Control JSON and YAML indentation via the optional `formatting` block.
The `indent` field is a tagged object: pick either spaces (with a
width) or tabs. Omit `formatting` entirely to keep the default of
2-space indentation.

```jsonc
{
  "inputs": [...],
  "output": "./merged.json",
  "formatting": {
    // 4 spaces:
    "indent": { "strategy": "spaces", "width": 4 }

    // ...or tabs (JSON only):
    // "indent": { "strategy": "tabs" }
  }
}
```

**Note**: Tab indentation (`{ "strategy": "tabs" }`) applies to JSON only.
YAML 1.1 disallows tabs as indentation, so combining `strategy: "tabs"`
with a `.yaml`/`.yml` output is rejected at configuration-load time.
```

### JSON Schema `description` fields
Update the JSDoc on `SpaceIndent`, `TabIndent`, `Indent`, and
`OutputFormatting` so the regenerated `configuration.schema.json`
includes user-facing descriptions for each variant of the discriminated
union.

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

- [ ] `SpaceIndent`, `TabIndent`, `Indent`, and `OutputFormatting` types defined; `DEFAULT_INDENT` constant exported from `cli/src/data.ts`.
- [ ] `Configuration.formatting?: OutputFormatting` added to `cli/src/data.ts`.
- [ ] `dumpAsYaml` and `writeOutput` updated to accept the optional `formatting` argument, defaulting to `DEFAULT_INDENT`.
- [ ] `indentToJsonStringifyArg` helper exhaustively switches on `indent.strategy` and uses `assertNever` as a compile-time guard against future variants.
- [ ] Configuration validation rejects `indent: { strategy: 'tabs' }` for `.yaml`/`.yml` outputs with a clear error message and `ExitCode.ErrorLoadingConfig`.
- [ ] `formatting` block is optional; omitting it preserves the current 2-space JSON / 2-space YAML behaviour byte-for-byte.
- [ ] `yarn gen-schema` regenerates `configuration.schema.json` with the discriminated-union (`oneOf` on `strategy`) plus the `SpaceIndent.width` `[1, 8]` constraint.
- [ ] Jest tests added for `formatOutput` covering: JSON default, JSON 4-space, JSON tabs, YAML default, YAML 4-space, YAML+tabs rejection, default ≡ explicit `SPACES_2`.
- [ ] Jest / load-configuration tests added for: schema rejects extra `width` on `strategy: 'tabs'`, missing `width` on `strategy: 'spaces'`, and unknown `strategy` values.
- [ ] README updated with the new tagged-object syntax and the YAML+tabs limitation note.
- [ ] E2E test (manual or shell-based) confirms merged output respects `{ strategy: 'spaces', width: 4 }` and `{ strategy: 'tabs' }` for JSON.
- [ ] All existing tests pass; no breaking changes to public CLI API.
- [ ] CLI version bumped to `1.4.0`; library version unchanged.

---

## 12. Risks & Notes

1. **YAML spec limitation**: Clearly document that YAML does not support tab indentation. Reject at config-validation time rather than silently falling back.
2. **`js-yaml` limitations**: The `yaml.safeDump` API does not expose tab options; indent is always numeric. The discriminated union makes this constraint trivial to enforce: the YAML path can statically narrow to `strategy: 'spaces'` after the validation check.
3. **Backwards compatibility**: Fully maintained. Configs without `formatting` block work unchanged because `DEFAULT_INDENT` reproduces the historical behaviour.
4. **Discriminator key naming**: We chose `strategy` over `kind` and `type`. `type` was rejected because it collides with OpenAPI's `type` keyword in JSON Schema, which would confuse readers and tooling. `kind` was rejected because `strategy` more clearly conveys intent at config sites (e.g. `{ "strategy": "tabs" }` reads as "the indentation strategy is tabs", whereas `{ "kind": "tabs" }` reads as a type-tag without the same self-documenting quality). The same key is used across every discriminated union in the public API — see proposal-76 (`OutputOpenApiVersion`) for the precedent — so users learn it once.
