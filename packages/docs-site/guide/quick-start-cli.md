# Quick start: CLI

## 1. Install

You don't need to install anything up front — `npx` fetches it on demand. If you'd rather install it:

```bash
npm install --save-dev openapi-merge-cli
# or: bun add -d openapi-merge-cli
```

## 2. Generate a starting configuration

Run `init` in a directory containing your OpenAPI files:

```bash
npx openapi-merge-cli init
```

`init` scans the current directory (not recursively) for `.json`/`.yaml`/`.yml` files that declare a top-level
`openapi: 3.x`, and writes `openapi-merge.yaml` pre-filled with what it found — plus every other optional setting
this tool supports, included and commented out, each with a one-line explanation. See
[CLI reference → Getting started](/cli/#getting-started-init) for the full behaviour.

## 3. Edit the configuration

Open `openapi-merge.yaml`. At minimum you need `inputs` (one entry per file to merge) and `output`. A typical
gateway-style configuration looks like:

```yaml
inputs:
  - inputFile: ./gateway.swagger.json
  - inputFile: ./jira.swagger.json
    pathModification:
      stripStart: /rest
      prepend: /jira
    operationSelection:
      includeTags: [included]
  - inputFile: ./confluence.swagger.yaml
    dispute:
      prefix: Confluence
    pathModification:
      prepend: /confluence
output: ./output.swagger.json
```

The full field-by-field reference is in [CLI reference → Configuration](/cli/configuration).

## 4. Run the merge

```bash
npx openapi-merge-cli
```

This reads `openapi-merge.yaml` (or `openapi-merge.json`, for older configurations) from the current directory and
writes the merged document to the configured `output` path. Point at a specific file instead with:

```bash
npx openapi-merge-cli --config path/to/openapi-merge.yaml
```

## 5. Check the exit code in CI

The CLI's exit codes are part of its contract — see [CLI reference → Exit codes](/cli/exit-codes) for the full table
and which failures are worth retrying.

```bash
openapi-merge-cli
case $? in
  0) echo "merged" ;;
  7) echo "upstream is down, retrying later"; exit 75 ;;
  *) echo "merge failed permanently"; exit 1 ;;
esac
```

## Next steps

- [Selecting only some operations by tag or path](/cli/examples)
- [Following cross-document `$ref`s](/cli/cross-document-refs)
- [Restricting where the CLI reads/writes, for untrusted configs](/cli/security)
