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

## `extensionMergeStrategies`

```ts
extensionMergeStrategies?: { [extensionKey: string]: ExtensionMergeNode };
```

How a document-root `x-*` extension's value is combined across inputs
([issue #60](https://github.com/robertmassaioli/openapi-merge/issues/60)), keyed by extension name. By default —
and for any extension key not mentioned here — the merge is **first-wins**: whichever input declares the key first
supplies the value, and every other input's value for that same key is discarded. This option lets you replace
that default, per extension, with something that actually combines the values instead.

Only the document root is covered. `x-*` fields elsewhere in a document — inside `info`, a `Tag` object, a path
item, a component — aren't reached by this option; see [Merging behaviour](/library/merging-behaviour) for why
the document root is the only place this library has a first-wins *default* to override in the first place.

### Why this is a tree, not a single strategy per extension

An extension's value can be any JSON shape — a scalar, an array, an object, or an arbitrarily nested combination
of those — and different parts of that shape often need to combine differently. The example that motivates this
option, ReDoc's `x-tagGroups`, is exactly that case: it's an array of `{ name, tags }` objects, and combining it
correctly means

1. treating two groups with the same `name` (across inputs, or even within one input) as *the same group*, to be
   combined into a single entry rather than appearing twice;
2. concatenating and deduplicating each combined group's `tags`;
3. leaving a group seen only once untouched;
4. keeping first-seen order across every input.

No single label — `'concat'`, `'merge'`, whatever — expresses all four of those at once, because they apply at
different depths of the value: the array itself needs "combine same-named elements," and each combined element's
`tags` field needs "concatenate and dedupe." So `extensionMergeStrategies` configures a small tree that mirrors
the extension value's own shape instead: each node says what shape it expects (`kind`) and how to combine it
(`strategy`), and a node can recurse into child nodes for its array elements or object fields.

### Node reference

```ts
type ExtensionMergeNode =
  | { kind: 'scalar'; strategy: 'first' | 'last' | 'error' }
  | { kind: 'array'; strategy: 'first' | 'last' | 'error' }
  | { kind: 'array'; strategy: 'concat' | 'concat-unique'; sortBy?: string }
  | { kind: 'array'; strategy: 'union-by-key'; key: string; item: ExtensionMergeNode }
  | { kind: 'object'; strategy: 'first' | 'last' | 'error' }
  | { kind: 'object'; strategy: 'merge'; fields?: { [fieldName: string]: ExtensionMergeNode } };
```

Every node picks one of these six shapes:

| `kind` | `strategy` | What it does |
| --- | --- | --- |
| `scalar` | `first` | Take the first input's value. |
| `scalar` | `last` | Take the last input's value — "last", specifically, means the last one that actually declared this value, not the last input overall (see below). |
| `scalar` | `error` | Fail the whole merge if the inputs disagree. Agreement (including only one input declaring it at all) is never a conflict. |
| `array` | `first` / `last` / `error` | The same three choices as `scalar`, but taking or comparing one input's **whole array**, with no element-level combination. |
| `array` | `concat` | Concatenate every input's array, in input order, keeping duplicates. `sortBy` (optional) sorts the result afterwards by a named field, for an array of objects; omitted, the result keeps concatenation order. |
| `array` | `concat-unique` | Same as `concat`, but deduplicated by deep equality afterwards (or before `sortBy`, if given). |
| `array` | `union-by-key` | Elements sharing the same value at `key` — across *and within* inputs — are the same logical entry and are combined using the required `item` node. Elements whose key value appears only once pass through `item` applied to a single-element group. Output order is first-seen order across every input, flattened; there's no `sortBy` here, because preserving that order is the point of this strategy. |
| `object` | `first` / `last` / `error` | Take or compare one input's **whole object**, with no field-level combination. |
| `object` | `merge` | Combine field by field, using `fields` (a map from field name to its own `ExtensionMergeNode`). A field not listed in `fields` — including `fields` omitted entirely — defaults to `first`, applied to that field's whole value regardless of its own shape: an unconfigured field is never guessed at. |

Three behaviours are worth calling out explicitly:

- **`kind` only changes behaviour for `concat`, `concat-unique`, `union-by-key` and `merge`** — the four strategies
  that need to inspect the value's internal structure. `first`, `last` and `error` work on a value of *any* shape,
  so a `{ kind: 'scalar', strategy: 'error' }` node still reports a disagreement even if the actual value turns
  out to be an array or object. This is deliberate: silently doing nothing is the one behaviour `error` must never
  have, since its entire purpose is to tell you about a disagreement rather than pick a side.
- **A type mismatch degrades to `first`, and only for the affected value.** If a node's `kind` says `array` but an
  input's actual value is an object (or a `union-by-key` array has an element missing the configured `key`), that
  one value falls back to first-wins rather than the merge failing or guessing at a shape it wasn't told to
  expect — and only that value; a sibling field elsewhere in the same object still merges normally.
- **`error` always fails the whole merge**, at whatever depth it's configured. There's no partial-failure mode
  where a nested `error` merely drops that one field — if you want disagreement to fail loudly, it fails the
  entire `merge()` call, with a message naming the exact path inside the extension's value where it found the
  disagreement (e.g. `x-tagGroups[name=Admin].owner`).

### Example: recreating `x-tagGroups`'s merge as configuration

This is the tree that reproduces the four numbered points above, turning ReDoc's tag-group merging from something
this library would otherwise need a hardcoded special case for into ordinary configuration:

```ts
import { merge, ExtensionMergeNode } from 'openapi-merge';

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

const result = merge(inputs, {
  extensionMergeStrategies: {
    'x-tagGroups': tagGroupsMergeStrategy,
  },
});
```

Given

```jsonc
// input 1
{ "x-tagGroups": [{ "name": "User", "tags": ["get-user", "put-user"] }] }
// input 2
{ "x-tagGroups": [
  { "name": "User", "tags": ["delete-user"] },
  { "name": "Admin", "tags": ["admin-only"] }
] }
```

the merged document's `x-tagGroups` is

```json
[
  { "name": "User", "tags": ["get-user", "put-user", "delete-user"] },
  { "name": "Admin", "tags": ["admin-only"] }
]
```

— the `User` groups combined into one entry with every tag from both inputs, `Admin` (seen once) passed through
unchanged, and both in first-seen order. The one thing this tree does *not* reproduce is dropping a group that
ends up with zero tags after combining — that's a decision about the *result*, not a rule for combining two
inputs' values, and no node above expresses it; an empty `tags` array is left in the output rather than pruned.

See [Examples](/library/examples#recreating-x-taggroups-s-merge-as-configuration) for this same scenario run
end-to-end against real input documents.

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
