# Examples

## Selecting only the operations owned by each service, by tag

A common case ([issue #100](https://github.com/robertmassaioli/openapi-merge/issues/100)) is merging several
services but taking only the operations each one owns, identified by a tag:

```json
{
  "inputs": [
    { "inputFile": "service1/swagger.json", "operationSelection": { "includeTags": ["Service1"] } },
    { "inputFile": "service2/swagger.json", "operationSelection": { "includeTags": ["Service2"] } },
    { "inputFile": "service3/swagger.json", "operationSelection": { "includeTags": ["Service3"] } }
  ],
  "output": "./dist/service.output.swagger.json"
}
```

Three things worth knowing about how this behaves:

- **Untagged operations are excluded.** `includeTags` is an allow-list, so an operation with no tags at all does
  not survive it. If a service has operations you want that aren't tagged, either tag them upstream or use
  `excludeTags` to remove what you don't want instead.
- **A partially-filtered path keeps its remaining operations.** Filtering is per operation; the path itself
  survives as long as one of its operations does.
- **The top-level `tags` array is only pruned by `excludeTags`.** `includeTags` deliberately leaves it alone, so a
  tag you filtered *in* keeps its description.

## Selecting operations by path instead of by tag

Not every input's tags are under your control — some generators don't let you customise them at all — and two
services can legitimately share a tag while only some of the operations under it should survive. `includePaths` /
`excludePaths` select by where an operation lives in the document instead:

```json
{
  "inputs": [
    {
      "inputFile": "admin-service/swagger.json",
      "operationSelection": { "excludePaths": [{ "path": "/admin/users", "method": "get" }] }
    },
    {
      "inputFile": "internal-service/swagger.json",
      "operationSelection": { "excludePaths": [{ "path": "/internal/*" }] }
    }
  ],
  "output": "./dist/service.output.swagger.json"
}
```

- **`path` supports a `*` wildcard**, matched the same way `includeTags`/`excludeTags` are: `*` matches any run of
  characters (including none), nothing else is special, and the match is anchored at both ends — `/admin/*`
  matches `/admin/users` but not `/other/admin/users`. A literal `.` or other regex-looking character
  (`/v1.2/status`) is matched literally, not interpreted.
- **`method` is optional.** Omit it to match every method on that path. Give a single method (`"get"`) or a list
  (`["get", "post"]`) to narrow it — including a 3.2 `additionalOperations` custom verb like `"PURGE"`, matched
  case-sensitively. Standard methods are lowercase in a parsed OpenAPI document (`get`, not `GET`) — a selector
  must match that spelling.
- **Selectors match this input's own original path**, before `pathModification` runs. Write the selector against
  the path as it appears in that input's own file, not the path it'll have in the merged output.
- **If an operation matches both an `includePaths` and an `excludePaths` selector, exclusion wins** — the same
  precedence `includeTags`/`excludeTags` already have. See
  [Configuration reference → `operationSelection` precedence](/cli/configuration#operationselection-precedence) for
  the full rule when tag and path selectors are combined.
- **`includePaths` on a document with 3.1 `webhooks` drops every webhook operation**, unless one of your selectors
  happens to match the webhook's event name — the same allow-list behaviour `includeTags` already has for untagged
  webhooks. If you need to keep webhooks while filtering paths, tag the webhook operations and use `includeTags`
  instead, or use `excludePaths` (which doesn't have this effect).

## Combining several inputs with dispute resolution

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

Here, `jira.swagger.json`'s paths lose their `/rest` prefix and gain a `/jira` one; only operations tagged
`included` are kept; and its description is appended to the merged `info.description` under a level-2 "Jira"
heading. `confluence.swagger.yaml` gets a `/confluence` prefix, drops operations tagged `excluded`, and any
component name it shares with another input is disambiguated with a `Confluence` prefix.
