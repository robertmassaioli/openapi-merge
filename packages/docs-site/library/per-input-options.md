# Per-input options

Each entry in `MergeInput` (the first argument to `merge()`) is a `SingleMergeInput`: `{ oas, ...options }`. `oas` is
the only required field — an in-memory OpenAPI document. Everything else is optional.

## `sourceIdentity`

```ts
sourceIdentity?: string;
```

An opaque identity for this input — typically the resolved absolute path or URL it was loaded from
([issue #104](https://github.com/robertmassaioli/openapi-merge/issues/104)). The library never parses or resolves
this string; it only compares it for exact equality against the non-fragment portion of a `$ref` found elsewhere in
the merge. A `$ref` shaped `<this input's sourceIdentity>#/components/schemas/X` found anywhere in the merge is
treated as if it were the bare, in-document ref `#/components/schemas/X` *as seen from this input* — rewritten to
wherever this input's `X` ended up after deduplication/renaming, exactly like any other reference into this input.

Resolving the file-path or URL portion of a cross-document `$ref` against this identity (e.g. deciding that
`../common/Errors.yml` in one input refers to the same file as another input's own path) is the caller's job —
normally `openapi-merge-cli`, which knows about file paths and can do the async I/O this library deliberately does
not do.

## `pathModification`

```ts
pathModification?: { stripStart?: string; prepend?: string };
```

Rewrites every path (and 3.1 webhook name) imported from this input. `stripStart` removes that prefix if present;
`prepend` adds a prefix. `prepend` always runs after `stripStart`, so the two compose predictably.

## `duplicatePathHandling`

```ts
duplicatePathHandling?: 'error' | 'skip-later' | 'prefer-later' | 'merge-operations'; // default: 'error'
```

What to do when this input declares a path (or webhook) another input already added
([issue #71](https://github.com/robertmassaioli/openapi-merge/issues/71)):

- **`'error'`** (default) — fail with `duplicate-paths`, the historical behaviour.
- **`'skip-later'`** — keep the definition already present and drop this input's.
- **`'prefer-later'`** — replace the definition already present with this one.
- **`'merge-operations'`** — combine them when their method sets are disjoint and their path-level fields agree, so
  `GET /thing` from one input and `POST /thing` from another end up in one path item. Refuses with
  `duplicate-paths` whenever a union would be a guess: overlapping methods, differing path-level fields, or a
  `$ref` path item on either side.

Per input rather than global, because what people actually want to express is "this one input wins and the rest
are additive," which a single global setting can't say.

## `operationSelection`

```ts
operationSelection?: {
  includeTags?: string[];
  excludeTags?: string[];
  includePaths?: PathSelector[];
  excludePaths?: PathSelector[];
};
```

Filters which operations from this input are kept:

- **`includeTags`** — allow-list. Only operations carrying one of these tags survive; an operation with no tags at
  all does not. Does not remove other tags from this input's top-level `tags` definition.
- **`excludeTags`** — deny-list. Operations carrying any of these tags are dropped, and the tags themselves are
  removed from this input's top-level `tags` before merging.
- **`includePaths` / `excludePaths`** (`PathSelector[]`, `{ path: string; method?: string | string[] }`) — the same
  two allow/deny lists, but matched by path (with an optional `*` wildcard) and method instead of by tag. Matched
  against this input's own original path, before `pathModification` runs. `method` accepts a 3.2
  `additionalOperations` custom verb like `"PURGE"`, matched case-sensitively.

**Precedence**: exclusion always wins over inclusion. If an operation is matched by both an include and an exclude
rule — of the same kind or different kinds — it's excluded. If both `includeTags` and `includePaths` are set, an
operation must pass *both* to survive. See [CLI reference → Configuration](/cli/configuration#operationselection-precedence)
for the full precedence table (the library and the CLI share this logic exactly).

## `description`

```ts
description?: { append: boolean; title?: { value: string; headingLevel?: number } };
```

Controls how this input's `info.description` contributes to the merged `info.description`. `append: true` appends
it (in input order) to the merged description; `title` optionally wraps it in a Markdown heading (`headingLevel`
1–6, default 1).

## `tag`

```ts
tag?: { name: string; description?: string };
```

Adds a tag to every operation from this input ([issue #112](https://github.com/robertmassaioli/openapi-merge/issues/112)).
Lets a merged document distinguish which service each operation came from without anybody editing the upstream
specification. Applied *after* `operationSelection`, so an injected tag cannot influence which operations survive —
applying it first would make `includeTags: ['billing']` match operations solely because this input injects
`billing`, which would read as a filter doing nothing. If another input already contributed a tag of the same name,
that input's `description` wins (first-wins, as everywhere else in this merge).

## `dispute`

```ts
dispute?: { prefix: string; alwaysApply?: boolean } | { suffix: string; alwaysApply?: boolean };
```

How to resolve a naming collision when two inputs define a component with the same name but different content.
`prefix`/`suffix` names the string to disambiguate with; `alwaysApply: true` applies it to every schema from this
input, not just the ones actually in conflict (useful for keeping naming consistent, at the cost of possibly
preventing deduplication of components that would otherwise have collapsed).

::: details Deprecated: `disputePrefix` (v1 shape)
The original shape, `disputePrefix?: string` directly on the input (instead of `dispute: { prefix }`), still works
and is exercised by existing configurations, but is deprecated in favour of `dispute`. New code should use
`dispute`.
:::

## Full example

```ts
const input: SingleMergeInput = {
  oas: confluenceSpec,
  sourceIdentity: './confluence.swagger.yaml',
  pathModification: { stripStart: '/rest', prepend: '/confluence' },
  duplicatePathHandling: 'merge-operations',
  operationSelection: { excludeTags: ['internal'] },
  description: { append: true, title: { value: 'Confluence', headingLevel: 2 } },
  tag: { name: 'confluence', description: 'Operations from the Confluence service' },
  dispute: { prefix: 'Confluence', alwaysApply: false },
};
```
