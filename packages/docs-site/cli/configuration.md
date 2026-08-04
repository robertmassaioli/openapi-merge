<script setup>
import { withBase } from 'vitepress';
</script>

# Configuration reference

Every field the CLI's configuration file (`openapi-merge.yaml` / `openapi-merge.json`) accepts, grouped as top-level
settings and per-input settings. `openapi-merge-cli init` will write all of these for you, commented out where
optional — see [Getting started: `init`](/cli/#getting-started-init).

The same fields are also published as a machine-readable
<a :href="withBase('/configuration.schema.json')">JSON Schema</a> — this is the exact file `ajv` validates every
config file against at runtime, not a hand-maintained copy that can drift from it. Point an editor's YAML language
server at it for live validation and autocomplete, by adding this as the first line of your config file:

```yaml
# yaml-language-server: $schema=https://robertmassaioli.github.io/openapi-merge/configuration.schema.json
```

(VS Code with the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)
understands this comment out of the box; other editors' YAML tooling generally supports the same convention.)

::: tip
That link only resolves after a full production build (`bun run --cwd packages/docs-site build`), since the schema
is copied into `public/` as part of that build — it 404s under `vitepress dev`, which doesn't run the copy step.
Use `bun run --cwd packages/docs-site build && bun run --cwd packages/docs-site preview` to see it locally.
:::

## Top-level fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `inputs` | `ConfigurationInput[]` | *(required)* | One entry per OpenAPI document to merge. At least one required. |
| `output` | `string` | *(required)* | Where to write the merged document. `.yaml`/`.yml` writes YAML, anything else writes JSON. Missing directories in this path are created automatically. |
| `outputRoot` | `string` | unset | Refuse to write the output anywhere outside this directory. See [Security](/cli/security). |
| `inputRoot` | `string` | unset | Refuse to read any local file — declared or discovered — from outside this directory. See [Security](/cli/security). |
| `formatting` | `OutputFormatting` | 2-space indent | Controls indentation of the emitted output. See [Formatting](/cli/formatting). |
| `serversStrategy` | `'first' \| 'concat'` | `'first'` | How the top-level `servers` array is combined. `'first'` keeps only the first input's servers (the API-gateway case); `'concat'` keeps every input's servers, deduplicated by URL. |
| `securitySchemesStrategy` | `'merge' \| 'first' \| 'error'` | `'merge'` | How `components.securitySchemes` is combined. `'merge'` combines them like any other component (renaming on conflict); `'first'` takes only the first input's schemes (may leave later operations referencing an undefined scheme); `'error'` combines identical definitions but fails on a genuine conflict instead of renaming around it. |
| `pruneUnusedComponents` | `boolean` | `false` | Drop components nothing in the merged output references. Useful alongside `operationSelection`, which can otherwise leave orphaned schemas behind. |
| `info` | `{ title?, version?, description? }` | unset | Override fields of the merged `info` object, field by field — setting only `title` doesn't require restating `version`. Without this, `info` comes entirely from the first input. |
| `extensionMergeStrategies` | `{ [extensionKey]: ExtensionMergeNode }` | unset | How a document-root `x-` extension's value is combined across inputs, keyed by extension name. Unset (or a key not mentioned) keeps the default: the first input to declare it wins. See [`extensionMergeStrategies`](#extensionmergestrategies) below. |
| `resolveExternalReferences` | `boolean` | `false` | Follow `$ref`s into files/URLs that aren't declared `inputs`, pulling in just the components they ask for. See [Cross-document `$ref`s](/cli/cross-document-refs). |

## Per-input fields

Each entry in `inputs` is either a file input or a URL input, plus the fields below (all optional except the source).

| Field | Type | Description |
| --- | --- | --- |
| `inputFile` **or** `inputURL` | `string` | Exactly one of these, per input. `inputFile` is a relative or absolute path; `inputURL` must be `http://` or `https://`. |
| `pathModification.stripStart` | `string` | Strip this prefix from every path in this input, if present. Runs before `prepend`. |
| `pathModification.prepend` | `string` | Prepend this to every path in this input. Runs after `stripStart`. |
| `operationSelection.includeTags` | `string[]` | Allow-list: only operations carrying one of these tags survive. Untagged operations are excluded. |
| `operationSelection.excludeTags` | `string[]` | Deny-list: operations carrying any of these tags are dropped, and the tags are removed from the top-level `tags` array for this input. |
| `operationSelection.includePaths` | `PathSelector[]` | Allow-list by path (and optionally method) instead of by tag. `path` supports a `*` wildcard. See [Examples](/cli/examples). |
| `operationSelection.excludePaths` | `PathSelector[]` | Deny-list by path (and optionally method). |
| `description.append` | `boolean` | Whether this input's `info.description` is appended into the merged `info.description`. |
| `description.title.value` | `string` | Optional Markdown heading text for this input's section of the merged description. |
| `description.title.headingLevel` | `number` (1–6) | Heading level for the title above. Default `1`. |
| `duplicatePathHandling` | `'error' \| 'skip-later' \| 'prefer-later' \| 'merge-operations'` | What to do when this input declares a path (or webhook) an earlier input already contributed. Default `'error'`. See below. |
| `tag` | `{ name, description? }` | Add a tag to every operation from this input, applied after `operationSelection` so it can't influence which operations survive. |
| `dispute` | `{ prefix, alwaysApply? } \| { suffix, alwaysApply? }` | How to rename a component that collides by name with one from another input. `alwaysApply: true` applies the prefix/suffix to every schema from this input, not just ones actually in conflict. |

### `operationSelection` precedence

Exclusion always wins over inclusion, and a path rule and a tag rule are independent gates:

- If an operation is matched by both an `includeTags` and an `excludeTags` entry, it's excluded.
- If it's matched by both `includePaths` and `excludePaths`, it's excluded.
- If it's matched by an exclude rule of *either* kind (path or tag), it's excluded.
- If `includeTags` and `includePaths` are both configured, the operation must pass *both* to survive.

### `duplicatePathHandling` values

- **`error`** (default) — fail the merge, the historical behaviour.
- **`skip-later`** — keep the path definition already present; drop this input's.
- **`prefer-later`** — replace the definition already present with this input's.
- **`merge-operations`** — combine them when their method sets don't overlap and their path-level fields agree (so
  `GET /thing` from one input and `POST /thing` from another end up in one path item). Refuses with the same
  `duplicate-paths` error whenever a union would be a guess: overlapping methods, differing path-level fields, or
  either side being a `$ref` path item.

Applies to `webhooks` (OpenAPI 3.1) the same way it applies to `paths` — they collide by event name instead of by
path string, but the resolution rules are identical.

### `extensionMergeStrategies` {#extensionmergestrategies}

By default, a document-root `x-` extension — `x-tagGroups`, `x-logo`, a vendor's own metadata — is **first-wins**:
whichever input declares it first supplies the value, and every other input's value for that same key is discarded
([issue #60](https://github.com/robertmassaioli/openapi-merge/issues/60)). `extensionMergeStrategies` lets you
combine one instead, keyed by extension name. Only the document root is covered — `x-` fields elsewhere (inside
`info`, a tag, a path item, a component) aren't reached by this option.

An extension's value can be any JSON shape, and different parts of it often need to combine differently — which is
why this isn't a single strategy per extension key. It's a small tree that mirrors the extension value's own JSON
structure: each node says what shape it expects (`kind`) and how to combine it (`strategy`), and can recurse into
child nodes for array elements or object fields.

```json
{
  "extensionMergeStrategies": {
    "x-tagGroups": {
      "kind": "array",
      "strategy": "union-by-key",
      "key": "name",
      "item": {
        "kind": "object",
        "strategy": "merge",
        "fields": {
          "tags": { "kind": "array", "strategy": "concat-unique" }
        }
      }
    }
  }
}
```

Each node is one of six shapes:

| `kind` | `strategy` | What it does |
| --- | --- | --- |
| `scalar` | `first` | Take the first input's value. |
| `scalar` | `last` | Take the last input's value that actually declared it (not necessarily the numerically-last input). |
| `scalar` | `error` | Fail the merge if the inputs disagree. Agreement — including only one input declaring it — is never a conflict. |
| `array` | `first` / `last` / `error` | The same three choices, taking or comparing one input's **whole array**, with no element-level combination. |
| `array` | `concat` | Concatenate every input's array, in input order, keeping duplicates. Optional `sortBy: "<field>"` sorts the result afterwards by a named field, for an array of objects; omitted, the result keeps concatenation order. |
| `array` | `concat-unique` | Same as `concat`, deduplicated afterwards by deep equality. |
| `array` | `union-by-key` | Elements sharing the same value at `key` — across *and within* inputs — are the same logical entry and are combined using the required `item` node. Elements whose key value appears only once still pass through `item`, applied to a single-element group. Output order is first-seen order across every input; there's no `sortBy` here, since preserving that order is the point of this strategy. |
| `object` | `first` / `last` / `error` | Take or compare one input's **whole object**, with no field-level combination. |
| `object` | `merge` | Combine field by field, using `fields` (a map from field name to its own node). A field not listed in `fields` — including `fields` omitted — defaults to `first`, applied wholesale regardless of that field's own shape. |

Worth knowing:

- **`kind` only changes behaviour for `concat`, `concat-unique`, `union-by-key` and `merge`** — the strategies that
  need to inspect the value's structure. `first`, `last` and `error` work on a value of any shape; in particular,
  `error` still reports a disagreement even if the actual value isn't the shape `kind` names, because silently
  doing nothing is the one thing `error` must never do.
- **A type mismatch degrades to `first`, and only for that one value** — not the whole document. If a node's
  `kind` says `array` but an input's value is an object (or a `union-by-key` element is missing the configured
  `key`), that value falls back to first-wins rather than the merge guessing at, or failing on, a shape it wasn't
  told to expect.
- **`error` always fails the entire merge**, at whatever depth it's configured — there's no partial-failure mode
  where a nested `error` merely drops that one field. The error message names the exact path inside the
  extension's value where the disagreement was found (e.g. `x-tagGroups[name=Admin].owner`).

The example above reproduces ReDoc's `x-tagGroups` merge — see
[Examples → Recreating `x-tagGroups`'s merge as configuration](/cli/examples#recreating-x-taggroups-s-merge-as-configuration)
for it worked through end-to-end, and
[Library reference → `extensionMergeStrategies`](/library/merge-options#extensionmergestrategies) for the same
reference in the library's TypeScript types.

## Full example

```json
{
  "inputs": [
    { "inputFile": "./gateway.swagger.json" },
    {
      "inputFile": "./jira.swagger.json",
      "pathModification": { "stripStart": "/rest", "prepend": "/jira" },
      "operationSelection": { "includeTags": ["included"] },
      "description": { "append": true, "title": { "value": "Jira", "headingLevel": 2 } }
    },
    {
      "inputFile": "./confluence.swagger.yaml",
      "dispute": { "prefix": "Confluence" },
      "pathModification": { "prepend": "/confluence" },
      "operationSelection": { "excludeTags": ["excluded"] }
    }
  ],
  "output": "./output.swagger.json"
}
```
