# Exit codes

The CLI's exit codes are part of its contract — scripts and CI pipelines can branch on them.

::: tip Source of truth
This table mirrors the header comment in
[`packages/openapi-merge-cli/src/exit-codes.ts`](https://github.com/robertmassaioli/openapi-merge/blob/main/packages/openapi-merge-cli/src/exit-codes.ts),
which is pinned by a test (renumbering a code fails the build). If this page ever disagrees with that file, the
file is right — please [open an issue](https://github.com/robertmassaioli/openapi-merge/issues/new).
:::

| Code | Member | Meaning |
| ---: | --- | --- |
| `0` | `Success` | The merge completed and the output was written. |
| `1` | `ErrorLoadingConfig` | Failed to load, parse, or validate the configuration file. |
| `2` | `ErrorLoadingInputs` | Failed to obtain or parse one or more inputs (missing file, unreachable URL, content that's neither valid JSON nor YAML). |
| `3` | `ErrorMerging` | The merge itself failed: duplicate paths, an unresolvable `operationId` conflict, a cyclic cross-document `$ref` chain, etc. |
| `4` | `ErrorUncaught` | An exception escaped the CLI's own error handling — please report this as a bug. |
| `5` | `ErrorUnsafePath` | The resolved output path escaped `outputRoot` / `--restrict-output-to`. |
| `6` | `ErrorInputUrlClientStatus` | An `inputURL` responded with a **4xx** status. |
| `7` | `ErrorInputUrlServerStatus` | An `inputURL` responded with a **5xx** status. |
| `8` | `ErrorInputUrlUnexpectedStatus` | An `inputURL` responded with some other non-2xx status. |
| `9` | `ErrorOpenApiVersion` | An input declared an unsupported OpenAPI version, or the inputs disagreed. |
| `10` | `ErrorUnsafeInputPath` | A local file read escaped `inputRoot` / `--restrict-input-to`. |
| `11` | `ErrorCreatingOutputDirectory` | The output directory could not be created (permissions, read-only filesystem, or a path component that's an existing file). |

## Why `6`–`8` are separate from `2`

`2` means an input could not be obtained at all — a missing file, an unreachable host, content that parses as
neither JSON nor YAML. `6`–`8` mean the server answered and refused.

They're separate from *each other* so CI can branch on **retryability**:

- **`6` (4xx)** is the request's fault — a stale URL, missing credentials, a retired endpoint. Retrying changes
  nothing; the configuration needs to change.
- **`7` (5xx)** is the server's fault and is plausibly transient. If you merge specs published by other teams,
  you'll see this during their deploys, and a retry is usually the right response.
- **`8`** is anything else outside the 2xx range. Ordinary redirects are followed automatically and never surface;
  in practice this is a `304 Not Modified` from a caching proxy. Read the printed status.

## Example: retry only on a transient failure

```bash
openapi-merge-cli
case $? in
  0) echo "merged" ;;
  7) echo "upstream is down, retrying later"; exit 75 ;;  # EX_TEMPFAIL
  *) echo "merge failed permanently"; exit 1 ;;
esac
```
