# Quick start: library

## 1. Install

```bash
npm install openapi-merge
# or: bun add openapi-merge
```

## 2. Call `merge()`

```ts
import { merge, isErrorResult } from 'openapi-merge';

const serviceA = {
  openapi: '3.0.2',
  info: { title: 'Service A', version: '1.0' },
  paths: {
    '/cats': {
      get: { summary: 'Get the cats', responses: { 200: { description: 'All of the cats' } } },
    },
  },
};

const serviceB = {
  openapi: '3.0.2',
  info: { title: 'Service B', version: '1.0' },
  paths: {
    '/dogs': {
      get: { summary: 'Get the dogs', responses: { 200: { description: 'All of the dogs' } } },
    },
  },
};

const result = merge([
  { oas: serviceA, pathModification: { prepend: '/one' } },
  { oas: serviceB, pathModification: { prepend: '/two' } },
]);

if (isErrorResult(result)) {
  console.error(`${result.message} (${result.type})`);
} else {
  console.log(JSON.stringify(result.output, null, 2));
}
```

`merge()` takes an array of inputs (each `{ oas, ...per-input options }`) and an optional second argument,
`MergeOptions`, for settings that apply to the merge as a whole. See:

- [Library reference → Per-input options](/library/per-input-options) for `pathModification`, `dispute`,
  `operationSelection`, `description`, `duplicatePathHandling` and `tag`.
- [Library reference → Merge options](/library/merge-options) for `pruneUnusedComponents`, `info`,
  `serversStrategy`, `securitySchemesStrategy` and `externalDocuments`.

## 3. Handle the result

`merge()` never throws for a malformed *merge* — every failure comes back as a typed `ErrorMergeResult` (`isErrorResult`
narrows to it), with a `type` and a human-readable `message`. See
[Library reference → Merging behaviour](/library/merging-behaviour) for what each error type means and when it fires.

## 4. Go deeper

- The full type shapes (`MergeInput`, `MergeOptions`, `MergeResult`, and every option type) are generated straight
  from the source in the [Generated API reference](/library/api-reference) — that's the place to check an exact
  field name or optionality rather than this guide.
- [Library reference → Examples](/library/examples) has a couple of end-to-end scenarios (tag-based filtering,
  pulling in an external document via `externalDocuments`).
