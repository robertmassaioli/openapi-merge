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

## Recreating `x-tagGroups`'s merge as configuration

ReDoc uses the `x-tagGroups` extension to organise its sidebar into named groups of tags. By default this library
treats every `x-*` extension as first-wins, so merging two documents that each declare `x-tagGroups` would keep
only the first one's groups. `extensionMergeStrategies` fixes that without this library needing to know anything
about ReDoc specifically — the shape below is ordinary configuration, not a special case:

```ts
import { merge, isErrorResult, ExtensionMergeNode, OpenApiDocument } from 'openapi-merge';

const userService: OpenApiDocument = {
  openapi: '3.0.3',
  info: { title: 'User service', version: '1.0.0' },
  paths: {
    '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } } },
    '/users/{id}': { put: { operationId: 'updateUser', responses: { '200': { description: 'ok' } } } },
  },
  'x-tagGroups': [{ name: 'User', tags: ['listUsers', 'updateUser'] }],
} as OpenApiDocument;

const adminService: OpenApiDocument = {
  openapi: '3.0.3',
  info: { title: 'Admin service', version: '1.0.0' },
  paths: {
    '/users/{id}': { delete: { operationId: 'deleteUser', responses: { '200': { description: 'ok' } } } },
    '/audit-log': { get: { operationId: 'getAuditLog', responses: { '200': { description: 'ok' } } } },
  },
  'x-tagGroups': [
    { name: 'User', tags: ['deleteUser'] },
    { name: 'Admin', tags: ['getAuditLog'] },
  ],
} as OpenApiDocument;

// Groups sharing a `name` combine into one entry; each combined entry's `tags`
// concatenate and deduplicate. A group seen only once (`Admin`, here) passes
// through unchanged. See "Node reference" in Merge options for every field.
const tagGroupsMergeStrategy: ExtensionMergeNode = {
  kind: 'array',
  strategy: 'union-by-key',
  key: 'name',
  item: {
    kind: 'object',
    strategy: 'merge',
    fields: {
      tags: { kind: 'array', strategy: 'concat-unique' },
    },
  },
};

const result = merge(
  [{ oas: userService }, { oas: adminService }],
  { extensionMergeStrategies: { 'x-tagGroups': tagGroupsMergeStrategy } },
);

if (isErrorResult(result)) {
  throw new Error(`${result.type}: ${result.message}`);
}

// 'x-tagGroups' isn't a named field of OpenApiDocument -- extensions never
// are -- so reading one back needs a small cast, same as writing one above.
const output = result.output as OpenApiDocument & { 'x-tagGroups': unknown };
console.log(output['x-tagGroups']);
// [
//   { name: 'User', tags: ['listUsers', 'updateUser', 'deleteUser'] },
//   { name: 'Admin', tags: ['getAuditLog'] },
// ]
```

Without `extensionMergeStrategies` configured, `result.output['x-tagGroups']` would instead be exactly
`userService`'s original array — `adminService`'s groups, and its addition to `User`, silently discarded. See
[Merge options → `extensionMergeStrategies`](/library/merge-options#extensionmergestrategies) for the full node
reference this example draws from, including what a `scalar`, `first`/`last`, plain `concat`, and `error` node do.
