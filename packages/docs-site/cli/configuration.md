# Configuration reference

Every field the CLI's configuration file (`openapi-merge.yaml` / `openapi-merge.json`) accepts, grouped as top-level
settings and per-input settings. `openapi-merge-cli init` will write all of these for you, commented out where
optional — see [Getting started: `init`](/cli/#getting-started-init).

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
