# Proposal: Issue #4 — Configurable Servers Array Merge Strategy

**Status:** Proposal

**Value:** 3 | **Effort:** 2 | **ROI:** Medium

**Issue Link:** https://github.com/robertmassaioli/openapi-merge/issues/4

---

## 1. Issue Summary

Currently, when merging multiple OpenAPI 3.0 specifications, the library takes the `servers` array from the **first input only** and discards the `servers` arrays from all subsequent inputs. This is by design for the API-gateway use case (where the gateway defines the canonical server URLs), but breaks users who want to merge specs from microservices and expose all server variants in the combined document.

**User request:** Allow configurable merge of the `servers` array so that users can concatenate and deduplicate server entries across multiple inputs, rather than being forced to use the first input's servers only.

---

## 2. Current Behaviour

### Library Implementation (`packages/openapi-merge/src/index.ts`)

```typescript
const output: Swagger.SwaggerV3 = mergeExtensions(
  {
    openapi: '3.0.3',
    info: mergeInfos(inputs),
    servers: getFirstMatching(inputs, input => input.oas.servers),  // ← First-input-wins
    externalDocs: getFirstMatching(inputs, input => input.oas.externalDocs),
    security: getFirstMatching(inputs, input => input.oas.security),
    tags: mergeTags(inputs),
    paths,
    components,
  },
  inputs.map(input => input.oas)
);
```

The `getFirstMatching()` helper returns the first non-undefined `servers` array and discards the rest.

### API-Gateway Rationale (from README)

> "The most common reason that developers want to do this is because they have multiple services that they wish to expose underneath a single API Gateway. Therefore, even though this merging logic is sufficiently generic to be used for most use cases, some of the feature decisions are tailored for that specific use case."

This first-input-wins strategy for `servers` (along with `info`, `security`, `externalDocs`) reflects the assumption that the merged spec will be exposed through a single gateway with canonical servers. However, not all users follow this pattern; some want to merge microservice specs and preserve all available server configurations.

---

## 3. Proposed Design

Add a configurable `serversStrategy` option to the shared `MergeOptions` interface (per proposals #76, #102, #71).

### 3.1 Two Strategy Choices

- **`'first'`** (default, current behaviour) — use the first input's `servers` array only. Preserves backward compatibility; API-gateway use case continues to work unchanged.
- **`'concat'`** — concatenate `servers` arrays from all inputs in order, with URL-based deduplication.

### 3.2 Why Global, Not Per-Input

The `servers` array is a top-level document concern, not an input-level concern. Allowing per-input granularity (e.g., `input.serversStrategy`) would create confusion: which strategy wins if two inputs disagree? A single global strategy is cleaner and aligns with how `info`, `security`, and `externalDocs` are treated.

---

## 4. Concatenation Semantics (for `'concat'` Strategy)

### 4.1 Ordering

Inputs are processed in the order they appear in the `inputs` array. Each input's `servers` array entries are appended to the result in order.

### 4.2 Deduplication by URL

Two server entries are considered duplicates if their `url` fields are identical (case-sensitive). If a duplicate is found:
- The **first occurrence** is retained (consistent with the overall first-wins philosophy).
- The duplicate entry (from a later input) is skipped.
- Differences in `description` or `variables` are **not** considered when deduplicating; only the `url` is checked.

### 4.3 Empty and Missing Arrays

- If an input has no `servers` field (undefined) or an empty array, it is skipped without error.
- If **all** inputs have no servers, the result has no `servers` field (undefined), same as today.

---

## 5. Cross-Links: Shared `MergeOptions` Interface

This proposal integrates with the shared `MergeOptions` pattern (see #76, #102, #71):

- **#76** — `openapi?: string` for version override.
- **#102** — `info?: Partial<Swagger.Info>` for info override.
- **#71** — `duplicatePathHandling?: 'first' | 'error'` for path conflicts.

This proposal adds `serversStrategy?: 'first' | 'concat'` to the same interface, **not** as a separate per-input field. All options share the same second parameter to `merge()`, ensuring a consistent API.

---

## 6. API Design

### 6.1 Library: Extend `merge()` signature

Update `packages/openapi-merge/src/index.ts`:

```typescript
export function merge(inputs: MergeInput, options?: MergeOptions): MergeResult {
  // Pass options to mergeServers() below
  // ...
}
```

### 6.2 Library: Extend `MergeOptions` interface

Update `packages/openapi-merge/src/data.ts` to add:

```typescript
export interface MergeOptions {
  // ... existing fields from #76, #102, #71 ...

  /**
   * Strategy for merging the top-level `servers` array across inputs.
   * - `'first'` (default): use the first input's servers only (API-gateway use case).
   * - `'concat'`: concatenate all inputs' servers, deduplicated by URL.
   */
  serversStrategy?: 'first' | 'concat';
}
```

### 6.3 Create `mergeServers()` helper function

New module `packages/openapi-merge/src/servers.ts`:

```typescript
import { Swagger } from '@atlassian/atlassian-openapi';
import { MergeInput } from './data';

export function mergeServers(
  inputs: MergeInput,
  strategy: 'first' | 'concat' = 'first'
): Swagger.Server[] | undefined {
  if (strategy === 'first') {
    return getFirstMatching(inputs, input => input.oas.servers);
  }

  // 'concat' strategy: collect all servers, dedupe by URL, preserve order.
  const seenUrls = new Set<string>();
  const result: Swagger.Server[] = [];

  for (const input of inputs) {
    const servers = input.oas.servers;
    if (!servers || servers.length === 0) continue;

    for (const server of servers) {
      if (!seenUrls.has(server.url)) {
        seenUrls.add(server.url);
        result.push(server);
      }
    }
  }

  return result.length > 0 ? result : undefined;
}
```

### 6.4 Update `index.ts` to use `mergeServers()`

Replace the inline `getFirstMatching()` call with:

```typescript
servers: mergeServers(inputs, options?.serversStrategy ?? 'first'),
```

### 6.5 CLI: Extend `Configuration` interface

Update `packages/openapi-merge-cli/src/data.ts`:

```typescript
export interface Configuration {
  inputs: ConfigurationInput[];
  output: string;

  // ... existing fields ...

  serversStrategy?: 'first' | 'concat';
}
```

### 6.6 CLI: Pass options to merge()

Update `packages/openapi-merge-cli/src/index.ts` to pass `serversStrategy` from the config:

```typescript
const result = merge(convertedInputs, {
  openapi: config.openapi,
  info: config.info,
  serversStrategy: config.serversStrategy,
  // ... other options ...
});
```

### 6.7 Regenerate JSON Schema

After modifying `packages/openapi-merge-cli/src/data.ts`, run:

```bash
bolt w openapi-merge-cli run gen-schema
```

This updates `configuration.schema.json` to include the new `serversStrategy` field with the enum constraint.

---

## 7. Tests

### 7.1 Library Tests (`packages/openapi-merge/src/__tests__/servers.test.ts` — new file)

```typescript
import 'jest';
import { mergeServers } from '../servers';
import { toMergeInputs } from './test-utils';
import { toOAS } from './oas-generation';

describe('mergeServers', () => {
  describe("'first' strategy (default)", () => {
    it('should return the first input servers when strategy is first', () => {
      const inputs = toMergeInputs([
        toOAS({ servers: [{ url: 'http://service1.local' }] }),
        toOAS({ servers: [{ url: 'http://service2.local' }] }),
      ]);
      const result = mergeServers(inputs, 'first');
      expect(result).toEqual([{ url: 'http://service1.local' }]);
    });

    it('should return undefined if first input has no servers', () => {
      const inputs = toMergeInputs([
        toOAS({}),
        toOAS({ servers: [{ url: 'http://service2.local' }] }),
      ]);
      const result = mergeServers(inputs, 'first');
      expect(result).toBeUndefined();
    });
  });

  describe("'concat' strategy", () => {
    it('should concatenate servers from all inputs', () => {
      const inputs = toMergeInputs([
        toOAS({ servers: [{ url: 'http://service1.local' }] }),
        toOAS({ servers: [{ url: 'http://service2.local' }] }),
      ]);
      const result = mergeServers(inputs, 'concat');
      expect(result).toEqual([
        { url: 'http://service1.local' },
        { url: 'http://service2.local' },
      ]);
    });

    it('should deduplicate by URL, keeping first occurrence', () => {
      const inputs = toMergeInputs([
        toOAS({ servers: [{ url: 'http://api.local', description: 'First' }] }),
        toOAS({ servers: [{ url: 'http://api.local', description: 'Second' }] }),
        toOAS({ servers: [{ url: 'http://other.local' }] }),
      ]);
      const result = mergeServers(inputs, 'concat');
      expect(result).toEqual([
        { url: 'http://api.local', description: 'First' },
        { url: 'http://other.local' },
      ]);
    });

    it('should skip empty or missing servers arrays', () => {
      const inputs = toMergeInputs([
        toOAS({ servers: [{ url: 'http://service1.local' }] }),
        toOAS({}),
        toOAS({ servers: [] }),
        toOAS({ servers: [{ url: 'http://service2.local' }] }),
      ]);
      const result = mergeServers(inputs, 'concat');
      expect(result).toEqual([
        { url: 'http://service1.local' },
        { url: 'http://service2.local' },
      ]);
    });

    it('should return undefined if all inputs have no servers', () => {
      const inputs = toMergeInputs([toOAS({}), toOAS({})]);
      const result = mergeServers(inputs, 'concat');
      expect(result).toBeUndefined();
    });

    it('should preserve server variables and descriptions', () => {
      const inputs = toMergeInputs([
        toOAS({
          servers: [
            {
              url: 'https://{host}/v1',
              variables: { host: { default: 'service1.local' } },
              description: 'Service 1',
            },
          ],
        }),
        toOAS({
          servers: [
            {
              url: 'https://{host}/v2',
              variables: { host: { default: 'service2.local' } },
              description: 'Service 2',
            },
          ],
        }),
      ]);
      const result = mergeServers(inputs, 'concat');
      expect(result).toHaveLength(2);
      expect(result![0]).toHaveProperty('variables.host.default', 'service1.local');
      expect(result![1]).toHaveProperty('variables.host.default', 'service2.local');
    });
  });

  describe('default behavior (no strategy specified)', () => {
    it('should default to first strategy', () => {
      const inputs = toMergeInputs([
        toOAS({ servers: [{ url: 'http://service1.local' }] }),
        toOAS({ servers: [{ url: 'http://service2.local' }] }),
      ]);
      const result = mergeServers(inputs);
      expect(result).toEqual([{ url: 'http://service1.local' }]);
    });
  });
});
```

### 7.2 Integration Test in `index.test.ts`

Add to the existing merge test suite:

```typescript
describe('servers merging', () => {
  it('should use first input servers by default', () => {
    const inputs = toMergeInputs([
      toOAS({ servers: [{ url: 'http://service1.local' }] }),
      toOAS({ servers: [{ url: 'http://service2.local' }] }),
    ]);
    const result = merge(inputs);
    expect(result).toEqual({
      output: expect.objectContaining({
        servers: [{ url: 'http://service1.local' }],
      }),
    });
  });

  it('should concatenate servers when serversStrategy is concat', () => {
    const inputs = toMergeInputs([
      toOAS({ servers: [{ url: 'http://service1.local' }] }),
      toOAS({ servers: [{ url: 'http://service2.local' }] }),
    ]);
    const result = merge(inputs, { serversStrategy: 'concat' });
    expect(result).toEqual({
      output: expect.objectContaining({
        servers: [
          { url: 'http://service1.local' },
          { url: 'http://service2.local' },
        ],
      }),
    });
  });

  it('should deduplicate by URL in concat mode', () => {
    const inputs = toMergeInputs([
      toOAS({ servers: [{ url: 'http://api.local' }] }),
      toOAS({ servers: [{ url: 'http://api.local' }] }),
    ]);
    const result = merge(inputs, { serversStrategy: 'concat' });
    expect(result).toEqual({
      output: expect.objectContaining({
        servers: [{ url: 'http://api.local' }],
      }),
    });
  });
});
```

---

## 8. Backwards Compatibility & Versioning

- **Breaking changes:** None. The `options` parameter to `merge()` is optional; omitting it defaults to `serversStrategy: 'first'`, preserving the current behaviour.
- **Default:** `'first'` ensures existing code sees no change.
- **Version bump:** Minor version (e.g., `1.7.0` → `1.8.0`), since this adds opt-in functionality without breaking existing APIs.

---

## 9. Effort Estimate

**Value: 3/5** — Medium value. Solves a real use case for non-gateway scenarios without being critical.  
**Effort: 2/5** — Low-to-medium effort. Mostly straightforward:
- New `servers.ts` module (~40 LOC).
- Update type signatures in `data.ts` (~5 LOC).
- Update `index.ts` to call the new helper (~3 LOC).
- CLI config updates (~5 LOC).
- Tests (~100 LOC).
- Schema regeneration (automatic).

---

## 10. Acceptance Criteria

- [ ] `MergeOptions` interface in `data.ts` includes `serversStrategy?: 'first' | 'concat'` with JSDoc.
- [ ] New `servers.ts` module exports `mergeServers(inputs, strategy)` with proper semantics.
- [ ] `merge()` function signature updated to accept optional `MergeOptions` (consistent with #76, #102, #71).
- [ ] `merge()` calls `mergeServers(inputs, options?.serversStrategy ?? 'first')`.
- [ ] CLI `Configuration` interface in `data.ts` includes `serversStrategy?: 'first' | 'concat'`.
- [ ] CLI `index.ts` passes `serversStrategy` to `merge()` when present in config.
- [ ] `configuration.schema.json` regenerated via `yarn gen-schema`.
- [ ] Default strategy is `'first'` (regression test passes; existing merge results unchanged).
- [ ] `'concat'` strategy merges all servers in order, deduped by URL.
- [ ] Servers with `variables` and `description` are preserved correctly.
- [ ] Empty/missing arrays are handled gracefully.
- [ ] All new tests pass; no regressions.

---

## 11. Implementation Notes

1. **Order of merging in `servers.ts`:** The `Swagger.Server` type is simple; no complex reference-walking needed (unlike components). A single pass through inputs with a URL-set tracker is sufficient.

2. **URL comparison:** Use strict equality (`===`) on the `url` string. URLs are case-sensitive per RFC 3986; avoid normalization unless explicitly requested in a future issue.

3. **Interaction with other top-level fields:** `info`, `security`, `externalDocs` remain first-wins. Only `servers` gets the new configurable behaviour. Future issues may request similar configurability for those fields.

4. **CLI documentation:** Update the CLI README or generated schema docs to explain the new `serversStrategy` option with examples for both `'first'` and `'concat'` use cases.
