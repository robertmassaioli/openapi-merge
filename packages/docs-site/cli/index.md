# CLI reference

`openapi-merge-cli` merges one or more OpenAPI 3.0, 3.1 or 3.2 documents together according to a configuration file.
It's built on top of the [`openapi-merge`](/library/) library — every merging rule described in the
[Library reference](/library/) applies here too.

## Getting started

You need one or more OpenAPI files to merge and a configuration file — `openapi-merge.yaml` by default
(`openapi-merge.json` is also read, for configurations written before this tool wrote YAML). The
[`init`](#getting-started-init) command below writes a starting point for you.

Written by hand, a configuration looks like:

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

See [Configuration reference](/cli/configuration) for what every field means.

## Getting started: `init` {#getting-started-init}

To write that configuration file for you, run:

```bash
npx openapi-merge-cli init
```

It creates `openapi-merge.yaml` in the current directory, pre-filled with any OpenAPI 3.x files it finds alongside
it:

```
## Wrote openapi-merge.yaml with 2 inputs:
##   ./service-a.yaml
##   ./service-b.yaml
##   resolveExternalReferences and inputRoot are turned on by default -- see the
##   comments above them. Every other setting is included, commented out -- uncomment what you need.
## Edit openapi-merge.yaml, then run openapi-merge-cli to produce './openapi.yaml'.
```

The generated file is not just `inputs` and `output`. Two settings, `resolveExternalReferences` and `inputRoot`, are
turned **on** by default — see [Cross-document `$ref`s](/cli/cross-document-refs) for what the first one does; the
second bounds it to the directory `init` just scanned, which costs nothing since everything `init` found already
lives there. Every other optional setting this tool supports — both per-input (`dispute`, `pathModification`,
`operationSelection`, `description`, `duplicatePathHandling`, `tag`) and top-level (`outputRoot`, `formatting`,
`serversStrategy`, `securitySchemesStrategy`, `pruneUnusedComponents`, `info`) — is written out commented, with a
one-line explanation and a working example. Uncomment a block and it is immediately valid.

If you would rather start from the historical permissive defaults (both settings unset), delete or comment out the
two active lines — deleting an active line is exactly as valid as leaving a commented one uncommented.

Details worth knowing:

- **It identifies inputs by content, not by extension.** Every `.json`, `.yaml` and `.yml` file is opened and kept
  only if it has a top-level `openapi: 3.x`. That's what keeps `package.json` and CI config out of the result
  without a list of names to exclude.
- **It scans the current directory only.** Not recursive.
- **It will not overwrite an existing configuration** — `openapi-merge.yaml` *or* `openapi-merge.json` — unless you
  pass `--force`. `--force` only ever writes `openapi-merge.yaml`.
- **Swagger 2.0 files are named, not silently skipped.** Convert them with `swagger2openapi` first.
- **It warns if the files it found declare different OpenAPI minor versions**, since the merge requires them all to
  agree.
- If nothing is found, you still get a valid file with one placeholder input to replace.

## Running the merge

```bash
npx openapi-merge-cli
```

Reads the configuration from the current directory and writes the merged document. Point at a specific file with:

```bash
npx openapi-merge-cli --config path/to/openapi-merge.yaml
```

Full flag list: [Command-line flags](/cli/cli-flags).
