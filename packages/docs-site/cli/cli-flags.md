# Command-line flags

## `openapi-merge-cli [flags]`

Run with no arguments to merge according to `openapi-merge.yaml` (or `openapi-merge.json`, if that's the only one
present) in the current directory.

| Flag | Description |
| --- | --- |
| `-c, --config <config_file>` | Path to the configuration file to use, instead of the default `openapi-merge.yaml`/`openapi-merge.json` lookup. |
| `--restrict-output-to <dir>` | Refuse to write output anywhere outside `<dir>`. Overrides `outputRoot` in the config if both are set. See [Security](/cli/security). |
| `--restrict-input-to <dir>` | Refuse to read any local input file from outside `<dir>`. Overrides `inputRoot` in the config if both are set. See [Security](/cli/security). |
| `--version` | Print the installed version and exit. |
| `--help` | Print usage, including the `init` subcommand below. |

## `openapi-merge-cli init [--force]`

Writes a starter `openapi-merge.yaml` in the current directory — see
[Getting started: `init`](/cli/#getting-started-init) for the full behaviour. `init` is deliberately not a
`commander` subcommand in the usual sense (so that a bare `openapi-merge-cli` with no arguments still runs the merge
rather than printing help), but it's dispatched the same way.

| Flag | Description |
| --- | --- |
| `--force` | Overwrite an existing `openapi-merge.yaml` even if one (or an `openapi-merge.json`) already exists. Without it, `init` refuses to run if either default config file is present. `--force` only ever writes `openapi-merge.yaml`. |
