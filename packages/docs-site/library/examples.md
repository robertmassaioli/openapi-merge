# Examples

## Filtering operations by tag while merging

```ts
import { merge, isErrorResult } from 'openapi-merge';

const result = merge([
  { oas: gatewaySpec },
  {
    oas: jiraSpec,
    pathModification: { stripStart: '/rest', prepend: '/jira' },
    operationSelection: { includeTags: ['included'] },
  },
  {
    oas: confluenceSpec,
    dispute: { prefix: 'Confluence' },
    pathModification: { prepend: '/confluence' },
    operationSelection: { excludeTags: ['excluded'] },
  },
]);

if (isErrorResult(result)) {
  throw new Error(`${result.type}: ${result.message}`);
}

console.log(result.output);
```

Same configuration shape as the [CLI's configuration file](/cli/configuration) — that's deliberate, since the CLI
is a thin wrapper that just deserialises YAML/JSON into these same objects and calls `merge()`.

## Pulling in an external document via `MergeOptions.externalDocuments`

This is what powers the CLI's `resolveExternalReferences` — the library itself does no I/O, so the caller loads the
documents and hands them over:

```ts
import { merge, isErrorResult } from 'openapi-merge';

const commonErrors = await loadDocument('./common/Errors.yml'); // your own loader

const result = merge(
  [{ oas: apiSpec, sourceIdentity: './api.yaml' }],
  {
    externalDocuments: {
      './common/Errors.yml': commonErrors,
    },
  },
);
```

A `$ref` in `apiSpec` shaped `../common/Errors.yml#/components/schemas/ServerError` is resolved against the key
`'./common/Errors.yml'` here (resolving that relative path to the same key is the caller's job — see
[Per-input options → `sourceIdentity`](/library/per-input-options#sourceidentity)). Only the specific components
actually referenced are pulled in; `commonErrors` is never included wholesale.

## Overriding the merged `info` and requiring stricter security-scheme handling

```ts
import { merge, isErrorResult } from 'openapi-merge';

const result = merge(inputs, {
  info: { title: 'Combined Gateway API', description: 'All backend services, one document.' },
  securitySchemesStrategy: 'error', // fail fast on a genuine scheme conflict, rather than renaming around it
  pruneUnusedComponents: true,      // this merge filters operations, so drop schemas nothing references anymore
});

if (isErrorResult(result)) {
  console.error(`${result.message} (${result.type})`);
}
```

See [Merge options](/library/merge-options) for the full set of second-argument settings.
