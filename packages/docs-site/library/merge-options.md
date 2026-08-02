# Merge options

`merge()`'s optional second argument, `MergeOptions`, holds settings that apply to the merge as a whole rather than
to any single input. Every field is optional, and every default reproduces the behaviour that existed before the
option did — `merge(inputs)` with no second argument is unchanged.

## `pruneUnusedComponents`

```ts
pruneUnusedComponents?: boolean; // default: false
```

Drop components that nothing in the merged document references
([issue #94](https://github.com/robertmassaioli/openapi-merge/issues/94)). Off by default because pruning is
destructive — this library has always preserved every component it was given, and a document may carry
definitions referenced only from outside it. Turn it on when `operationSelection` is removing operations and you
expect the schemas only those operations used to go with them. Reachability is computed from the surviving
document, so a component still used by another endpoint is kept.

## `info`

```ts
info?: Partial<Swagger.Info>;
```

Override fields of the merged `info` object ([issue #102](https://github.com/robertmassaioli/openapi-merge/issues/102)).
`info` is otherwise taken entirely from the first input, so a merged document is titled after whichever service
happens to be listed first — misleading for an aggregate API that is none of its inputs. Merged field by field, so
overriding only `title` doesn't require restating the required `version`. Applied *after* description appending, so
an explicit `description` here wins over the appended one.

## `serversStrategy`

```ts
serversStrategy?: ServersStrategy; // 'first' | 'concat', default: 'first'
```

How the top-level `servers` array is combined ([issue #4](https://github.com/robertmassaioli/openapi-merge/issues/4)):

- **`'first'`** (default) — the first input that declares `servers` wins; the rest are discarded. This is the
  historical behaviour, and remains the default because the library is aimed at putting several services behind
  one API gateway, where the gateway's servers are canonical and a backend's own URLs are an implementation detail
  that must not leak into the published document.
- **`'concat'`** — every input's servers, in input order, deduplicated by URL alone (two entries with the same URL
  but different `description`s are treated as the same server described twice).

## `securitySchemesStrategy`

```ts
securitySchemesStrategy?: SecuritySchemesStrategy; // 'first' | 'merge' | 'error', default: 'merge'
```

How `components.securitySchemes` is combined ([issue #33](https://github.com/robertmassaioli/openapi-merge/issues/33)).
Unlike `serversStrategy`, whose default keeps the historical first-wins behaviour, **this one changed its default**:
first-wins here produced documents whose operations required a scheme the document didn't define, which is a
defect rather than a preference.

- **`'merge'`** (default) — combine them exactly as every other component bucket is combined: identical
  definitions collapse, differing ones are renamed using the input's `dispute` prefix/suffix (or a numeric
  suffix), and every security requirement naming a renamed scheme is rewritten to match.
- **`'first'`** — take the schemes from the first input that declares any, and drop the rest. The behaviour before
  this option existed. Right for an API gateway that owns authentication and doesn't want a backend's own scheme
  definitions in the published document — but a later input's operations may then require a scheme the output
  doesn't define.
- **`'error'`** — combine them like `'merge'`, but fail if two inputs define the same scheme name differently,
  rather than renaming around it. Identical definitions still collapse.

## `externalDocuments`

```ts
externalDocuments?: Record<string, OpenApiDocument>;
```

Documents this merge may need to pull individual components out of, keyed by the same opaque identity described on
each input's `sourceIdentity` ([issue #10](https://github.com/robertmassaioli/openapi-merge/issues/10)). Unlike an
input, a document here never contributes `paths`, `webhooks`, `info`, `security`, `tags` or anything else to the
output on its own — only the specific components a `$ref` elsewhere in the merge actually asks for are pulled in
(and, transitively, whatever those components' own references need), deduplicated against the rest of the output
exactly like any other component. A document listed here that nothing ends up referencing contributes nothing at
all.

Loading these — from disk, or over the network — is entirely the caller's job. By the time this reaches `merge()`,
every document is already an in-memory object and merging proceeds synchronously, same as always. This is exactly
what [`openapi-merge-cli`'s `resolveExternalReferences`](/cli/cross-document-refs) does the file/URL loading for.

## Full example

```ts
import { merge, ServersStrategy, SecuritySchemesStrategy } from 'openapi-merge';

const result = merge(inputs, {
  pruneUnusedComponents: true,
  info: { title: 'Combined Gateway API' },
  serversStrategy: 'concat' satisfies ServersStrategy,
  securitySchemesStrategy: 'error' satisfies SecuritySchemesStrategy,
});
```
