# openapi-merge-cli

This tool is based on the [![npm](https://img.shields.io/npm/v/openapi-merge?label=openapi-merge&logo=npm)](https://bit.ly/2WnIytF) library. Please read
that README for more details on how the merging algorithm works.

This library is intended to be used for merging multiple OpenAPI 3.0 files together. The most common reason that developers want to do this is because
they have multiple services that they wish to expose underneath a single API Gateway. Therefore, even though this merging logic is sufficiently generic to be
used for most use cases, some of the feature decisions are tailored for that specific use case.

## Getting started

In order to use this merging cli tool you need to have one or more OpenAPI 3.0 files that you wish to merge. Then you need to create a configuration file,
called `openapi-merge.json` by default, in your current directory. It should look something like this:

``` json
{
  "inputs": [
    {
      "inputFile": "./gateway.swagger.json"
    },
    {
      "inputFile": "./jira.swagger.json",
      "pathModification": {
        "stripStart": "/rest",
        "prepend": "/jira"
      },
      "operationSelection": {
        "includeTags": ["included"]
      },
      "description": {
        "append": true,
        "title": {
          "value": "Jira",
          "headingLevel" : 2
        }
      }
    },
    {
      "inputFile": "./confluence.swagger.yaml",
      "dispute": {
        "prefix": "Confluence"
      },
      "pathModification": {
        "prepend": "/confluence"
      },
      "operationSelection": {
        "excludeTags": ["excluded"]
      }
    }
  ],
  "output": "./output.swagger.json"
}
```

In this configuration you specify your inputs and your output file. For each input you have the following parameters:

* `inputFile` or `inputURL`: the relative or absolute path (or URL), from the `openapi-merge.json`, to the OpenAPI schema file for that input (in JSON or Yaml format). Absolute paths (e.g. `/tmp/spec.yaml`) are honoured as-is.
* `dispute`: if two inputs both define a component with the same name then, in order to prevent incorrect overlaps, we will attempt to use the dispute prefix or suffix to come up with a unique name for that component. Please [read the documentation for more details on the format](https://github.com/robertmassaioli/openapi-merge/wiki/configuration-definitions-dispute).
* `pathModification.stripStart`: When copying over the `paths` from your OpenAPI specification for this input, it will strip this string from the start of the path if it is found.
* `pathModification.prepend`: When copying over the `paths` from your OpenAPI specification for this input, it will prepend this string to the start of the path if it is found. `prepend` will always run after `stripStart` so that it is deterministic.
* `operationSelection.includeTags`: Only operations that are tagged with the tags configured here will be extracted from the OpenAPI file and merged with the others. This instruction will not remove other tags from the top level tags definition for this input. **This filter works per operation, not per path**: if `GET /thing` carries the tag and `POST /thing` does not, the merged document contains `/thing` with only its `GET`. A path whose operations are all filtered out is dropped entirely.
* `operationSelection.excludeTags`: Only operations that are NOT tagged with the tags configured here will be extracted from the OpenAPI file and merged with the others. Also, these tags will also be removed from the top level `tags` element for this file before being merged. If a single REST API operation has an `includeTags` reference and an `excludeTags` reference then the exclusion rule will take precidence.
* `description.append`: All of the inputs with `append: true` will have their `info.description`s merged together, in order, and placed in the output OpenAPI file in the `info.description` section.
* `description.title.value`: An optional string that lets you specify a custom section title for this input's description when it is merged together in the output OpenAPI file's `info.description` section
* `description.title.headingLevel`: The integer heading level for the title, `1` to `6`. The default is `1`.

### Selecting only the operations with a particular tag

A common case (see [issue #100](https://github.com/robertmassaioli/openapi-merge/issues/100)) is merging several services but taking only the operations each one owns, identified by a tag:

``` json
{
  "inputs": [
    {
      "inputFile": "service1/swagger.json",
      "operationSelection": { "includeTags": ["Service1"] }
    },
    {
      "inputFile": "service2/swagger.json",
      "operationSelection": { "includeTags": ["Service2"] }
    },
    {
      "inputFile": "service3/swagger.json",
      "operationSelection": { "includeTags": ["Service3"] }
    }
  ],
  "output": "./dist/service.output.swagger.json"
}
```

Three things are worth knowing about how this behaves:

* **Untagged operations are excluded.** `includeTags` is an allow-list, so an operation with no tags at all does not survive it. If a service has operations you want that are not tagged, either tag them upstream or use `excludeTags` to remove what you do not want instead.
* **A partially-filtered path keeps its remaining operations.** Filtering is per operation; the path itself survives as long as one of its operations does.
* **The top-level `tags` array is only pruned by `excludeTags`.** `includeTags` deliberately leaves it alone, so a tag you filtered *in* keeps its description.

### Getting started: `init`

To write that configuration file for you, run:

``` bash
npx openapi-merge-cli init
```

It creates `openapi-merge.json` in the current directory, pre-filled with any
OpenAPI 3.x files it finds alongside it:

```
## Wrote openapi-merge.json with 2 inputs:
##   ./service-a.yaml
##   ./service-b.yaml
## Edit openapi-merge.json, then run openapi-merge-cli to produce './openapi.yaml'.
```

Details worth knowing:

* **It identifies inputs by content, not by extension.** Every `.json`, `.yaml`
  and `.yml` file is opened and kept only if it has a top-level `openapi: 3.x`.
  That is what keeps `package.json` and your CI configuration out of the result
  without a list of names to exclude.
* **It scans the current directory only.** Not recursive: descending would mean
  guessing which directories to skip, and picking up a vendored copy of somebody
  else's API is a worse outcome than finding nothing.
* **It will not overwrite an existing `openapi-merge.json`** unless you pass
  `--force`.
* **Swagger 2.0 files are named, not silently skipped**, so you know the scan saw
  them and why they were left out. Convert them with `swagger2openapi` first.
* **It warns if the files it found declare different OpenAPI minor versions**,
  because the merge requires them all to agree and would otherwise fail on your
  next command.
* If nothing is found, you still get a valid file with one placeholder input to
  replace.

And then, once you have your Inputs in place and your configuration file you merely run the following in the directory that has your configuration file:

``` bash
npx openapi-merge-cli
```

For more fine grained details on what `Configuration` options are available to you. [Please read the docs](https://github.com/robertmassaioli/openapi-merge/wiki/README).

If you wish, you may write your configuration file in YAML format and then run:

``` shell
npx openapi-merge-cli --config path/to/openapi-merge.yaml
```

And the merge should be run and complete! Congratulations and enjoy!

## Formatting

Control the indentation of the merged output via an optional `formatting`
block. Indentation is expressed as a discriminated union so contradictory
combinations (e.g. "tabs of width 4") are unrepresentable:

```jsonc
{
  "inputs": [...],
  "output": "./merged.json",

  // 4-space indentation (default is 2 spaces; same as today's behaviour).
  "formatting": { "indent": { "style": "spaces", "width": 4 } }
}
```

```jsonc
{
  "inputs": [...],
  "output": "./merged.json",

  // Tab indentation. JSON only — see note below.
  "formatting": { "indent": { "style": "tabs" } }
}
```

If `formatting` is omitted the output keeps the historical default of
two-space indentation.

**Note:** YAML 1.1 disallows tab characters as indentation. Combining
`{ "style": "tabs" }` with a `.yaml` or `.yml` output is rejected at
configuration-load time with a clear error message.

## Paths

Both `inputFile` and `output` accept either relative or absolute paths.
Relative paths are resolved against the directory that contains the
configuration file. Absolute paths (e.g. `/tmp/merged.yaml`,
`C:\build\out.json`) are used as-is. This means you can safely write the
merged spec into directories like `/tmp` or `/var/build/...` from CI.

## Cross-document `$ref`s

If one input's `$ref` points at *another file* rather than somewhere inside
itself -- `$ref: "../common/Errors.yml#/components/schemas/ServerError"` --
two different things can happen, depending on whether that file is one of
your declared `inputs`:

* **It's one of your `inputs` already.** The `$ref` is rewritten to point at
  wherever that component ended up in the merged document, automatically and
  unconditionally -- no configuration needed. This is always correct to do:
  the alternative is a `$ref` that is already broken in the merged output,
  since the original relative path means nothing once the inputs are combined
  into one document (issue #104).
* **It isn't one of your `inputs`.** By default the `$ref` is left as-is
  (now resolved to an absolute path or URL, so at least it's unambiguous, but
  still not something the merged document can resolve). Set
  `"resolveExternalReferences": true` in your configuration to have the CLI
  follow it: load that file (or URL), pull in *just* the component the `$ref`
  asked for, and rewrite the `$ref` to point at it locally -- following
  further `$ref`s the same way, however many files deep, with cycles
  detected and reported rather than hanging (issue #10).

```json
{
  "inputs": [{ "inputFile": "./api.yaml" }],
  "output": "./bundle.yaml",
  "resolveExternalReferences": true
}
```

A `$ref` this discovers but cannot load -- a missing file, a failed fetch, a
document that doesn't parse -- is left exactly as written and reported as a
warning, not a hard failure, the same way an unresolvable `$ref` into a
declared input is also left alone rather than erroring.

## Security

`openapi-merge-cli` reads, merges, and writes files using the paths specified
in your `openapi-merge.json` (or via `--config`). The tool assumes that this
configuration file is **trusted**, the same way you trust a `Makefile`,
`package.json`, or `webpack.config.js` in your repository. Do not run the CLI
against a configuration file from an untrusted source without restricting the
input and output locations.

`resolveExternalReferences` widens what gets *read*, not just written: with
it on, the files and URLs the CLI loads are no longer limited to what
`inputs` names -- it follows wherever a `$ref` in *any* loaded document
points, transitively. Leave it off (the default) unless your inputs are
trusted to the same degree the configuration file itself is.

For defence-in-depth in less-trusted contexts (for example a server that
accepts user-supplied configs), you can restrict where the CLI will write the
merged output:

* Add `"outputRoot": "/path/to/safe/dir"` to your `openapi-merge.json`, **or**
* Pass `--restrict-output-to /path/to/safe/dir` on the command line (the flag
  takes precedence over the config field).

When set, any resolved output path that does not lie under the configured
root is rejected at config-load time with a clear error message, and the CLI
exits with code `5` (`ExitCode.ErrorUnsafePath`). Symlink-out-of-jail tricks
are defeated by realpath-ing the closest existing ancestor of the output.

When unset, the CLI keeps its historical permissive default and writes
wherever you tell it to.

You can restrict where the CLI will *read* local files from the same way --
the read-side counterpart, and the one that matters most once
`resolveExternalReferences` is on, since that setting is what makes the
reachable file set transitive rather than confined to what `inputs` lists:

* Add `"inputRoot": "/path/to/safe/dir"` to your `openapi-merge.json`, **or**
* Pass `--restrict-input-to /path/to/safe/dir` on the command line (the flag
  takes precedence over the config field).

When set, any local file the CLI would read -- a declared `inputFile` or a
file `resolveExternalReferences` discovers -- that does not lie under the
configured root is refused, and the CLI exits with code `10`
(`ExitCode.ErrorUnsafeInputPath`). The offending file is never opened: the
check runs before the read is attempted, using the same realpath-based
containment check as `outputRoot`, extended to also realpath the file itself
(not just its parent directory) before comparing -- an input, unlike an
output, normally already exists, so a symlink planted as the file itself,
not just an ancestor directory, has to be defeated too. A declared
`inputFile` outside the root is reported before the merge starts at all; a
discovered file outside the root
aborts the merge the same way, rather than being left as an unresolved `$ref`
the way an ordinary missing or unparseable discovered file is. `inputURL` and
URLs discovered via `resolveExternalReferences` are unaffected -- `inputRoot`
bounds the filesystem, not the network.

When unset, the CLI keeps its historical permissive default and reads
whatever the inputs point to.

## Exit codes

The CLI's exit codes are part of its contract; scripts and CI pipelines can
branch on them.

| Code | Meaning |
| ---- | ------- |
| `0` | Success — the merge completed and the output was written |
| `1` | Failed to load or parse the configuration file |
| `2` | Failed to load one or more inputs (missing file, unreachable URL, unparseable content) |
| `3` | The merge itself failed (duplicate paths, unresolvable `operationId` conflicts, a cyclic cross-document `$ref` chain, …) |
| `4` | An uncaught exception escaped the CLI |
| `5` | The resolved output path escaped `outputRoot` / `--restrict-output-to` |
| `6` | An `inputURL` responded with a **4xx** status |
| `7` | An `inputURL` responded with a **5xx** status |
| `8` | An `inputURL` responded with some other non-2xx status |
| `9` | An input declared an unsupported OpenAPI version, or the inputs disagreed |
| `10` | A local file read escaped `inputRoot` / `--restrict-input-to` |

Codes `6`–`8` are separate from `2` on purpose. `2` means an input could not be
obtained at all — a missing file, an unreachable host, content that parses as
neither JSON nor YAML. `6`–`8` mean the server answered and refused.

They are separate from each other so that CI can branch on **retryability**:

* `6` (4xx) is the request's fault — a stale URL, missing credentials, a
  retired endpoint. Retrying changes nothing; the config needs to change.
* `7` (5xx) is the server's fault and is plausibly transient. If you merge
  specs published by other teams, you will see this during their deploys, and
  a retry is usually the right response.
* `8` is anything else outside the 2xx range. Ordinary redirects are followed
  automatically and never surface; in practice this is a `304 Not Modified`
  from a caching proxy. Read the printed status.

### OpenAPI version support

This tool merges **OpenAPI 3.0.x, 3.1.x and 3.2.x** documents. Every input must
declare a full `openapi` version (for example `"3.2.0"`), and all inputs must
agree on the `major.minor` version — patch differences such as `3.1.0` and
`3.1.1` are fine, since they are the same feature set, but 3.0, 3.1 and 3.2
inputs cannot be mixed with each other.

**3.1** support covers `webhooks` (which merge exactly like paths: same
duplicate rule, same `operationId` uniqueness, same `$ref` rewriting),
`components.pathItems`, `jsonSchemaDialect`, and documents with no `paths` at
all.

**3.2** support covers the `query` HTTP method and `additionalOperations`
(custom verbs such as `PURGE`), which participate fully in operation counting,
`operationId` uniqueness, `$ref` rewriting and tag-based selection. The new tag
fields `summary`, `parent` and `kind` are carried through, as are
`itemSchema`, discriminator `defaultMapping`, OAuth2 device-authorization
flows and `in: querystring` parameters.

`$self` is a special case: it declares a document's *own* identity, and a
merged document is not any of its inputs. It is kept when there is exactly one
input and **dropped** otherwise, rather than arbitrarily inheriting one input's
identity — which would also affect how relative `$ref`s resolve.

An input declaring a version this tool does not know, no version at all, or a
version that disagrees with the other inputs exits with code `9` and a message
naming the offending input.

**The output now declares the version the inputs used**, rather than always
`3.0.3`. Merging documents that declare `3.0.0` now produces `3.0.0`. Relabelling
within a minor is safe in both directions, so no document becomes invalid, but
the emitted value has changed.

For example, retrying only on a server-side failure:

```bash
openapi-merge-cli
case $? in
  0) echo "merged" ;;
  7) echo "upstream is down, retrying later"; exit 75 ;;  # EX_TEMPFAIL
  *) echo "merge failed permanently"; exit 1 ;;
esac
```

If you experience any issues then please [raise them in the bug tracker][1].

 [1]: https://github.com/robertmassaioli/openapi-merge/issues/new
