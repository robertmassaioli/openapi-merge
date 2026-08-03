# Library reference

`openapi-merge` provides a single `merge()` function that takes an array of OpenAPI 3.0, 3.1 or 3.2 documents (each
with per-input options) and produces one combined OpenAPI document, or a typed error describing why the merge
failed. [`openapi-merge-cli`](/cli/) is a thin wrapper around this library — everything documented here applies to
the CLI too.

## Installing

```bash
npm install openapi-merge
```

## `merge()`

```ts
import { merge, isErrorResult } from 'openapi-merge';

const result = merge(inputs, options);

if (isErrorResult(result)) {
  console.error(`${result.message} (${result.type})`);
} else {
  console.log(result.output); // the merged OpenAPI document
}
```

```ts
function merge(inputs: MergeInput, options?: MergeOptions): MergeResult;
```

- **`inputs`** (`MergeInput`, i.e. `SingleMergeInput[]`) — one entry per document to merge, each `{ oas, ...
  per-input options }`. See [Per-input options](/library/per-input-options).
- **`options`** (`MergeOptions`, optional) — settings for the merge as a whole rather than any one input. See
  [Merge options](/library/merge-options).
- **Returns** a `MergeResult`: either `{ output: OpenApiDocument }` on success, or `{ type, message }` on failure —
  `isErrorResult()` narrows to the latter. See [Merging behaviour](/library/merging-behaviour) for what each error
  `type` means.

`merge()` is synchronous and never throws for a malformed merge: every failure mode comes back as a typed result.
(It *can* throw for a small class of programmer errors treated as internal invariants — see
[Merging behaviour](/library/merging-behaviour#thrown-vs-returned-errors).)

## Other exports

| Export | What it is |
| --- | --- |
| `merge` | The function above. |
| `isErrorResult` | Type guard narrowing a `MergeResult` to its error case. |
| `MalformedDocumentError` | The error class thrown (not returned) for a `null` in a structural slot — see [Merging behaviour](/library/merging-behaviour#thrown-vs-returned-errors). |
| `MergeInput`, `MergeResult`, `PathModification`, `OperationSelection`, `MergeOptions`, `ServersStrategy`, `SecuritySchemesStrategy` | Types, re-exported for consumers who want to name them explicitly. |

Every other type (`SingleMergeInput`, `SuccessfulMergeResult`, `ErrorMergeResult`, `Dispute`, `TagInjection`, …) is
part of the public shape reachable from these but not re-exported by name from the package root — see the
[Generated API reference](/library/api-reference) for the exact shapes.

## Next

- [Merge options](/library/merge-options) — the second argument to `merge()`.
- [Per-input options](/library/per-input-options) — everything you can set per document being merged.
- [Merging behaviour](/library/merging-behaviour) — what gets combined, what's first-wins, and every error type.
- [Examples](/library/examples) — a couple of end-to-end scenarios.
