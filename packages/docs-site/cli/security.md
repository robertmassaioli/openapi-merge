# Security

`openapi-merge-cli` reads, merges, and writes files using the paths specified in your `openapi-merge.yaml`/`.json`
(or via `--config`). The tool assumes that this configuration file is **trusted**, the same way you trust a
`Makefile`, `package.json`, or `webpack.config.js` in your repository. Do not run the CLI against a configuration
file from an untrusted source without restricting the input and output locations, below.

## Widened reads from `resolveExternalReferences`

`resolveExternalReferences` widens what gets *read*, not just written: with it on, the files and URLs the CLI loads
are no longer limited to what `inputs` names — it follows wherever a `$ref` in *any* loaded document points,
transitively. Leave it off (the default) unless your inputs are trusted to the same degree the configuration file
itself is.

## Restricting output: `outputRoot` / `--restrict-output-to`

For defence-in-depth in less-trusted contexts (for example, a server that accepts user-supplied configs), restrict
where the CLI will write the merged output:

- Add `"outputRoot": "/path/to/safe/dir"` to your configuration, **or**
- Pass `--restrict-output-to /path/to/safe/dir` on the command line (the flag takes precedence over the config
  field).

When set, any resolved output path that doesn't lie under the configured root is rejected at config-load time with
a clear error message, and the CLI exits with code `5` (`ErrorUnsafePath`). Symlink-out-of-jail tricks are defeated
by realpath-ing the closest existing ancestor of the output.

When unset, the CLI keeps its historical permissive default and writes wherever you tell it to.

## Restricting input: `inputRoot` / `--restrict-input-to`

The read-side counterpart, and the one that matters most once `resolveExternalReferences` is on — that setting is
what makes the reachable file set transitive rather than confined to what `inputs` lists:

- Add `"inputRoot": "/path/to/safe/dir"` to your configuration, **or**
- Pass `--restrict-input-to /path/to/safe/dir` on the command line (the flag takes precedence over the config
  field).

When set, any local file the CLI would read — a declared `inputFile` or a file `resolveExternalReferences`
discovers — that doesn't lie under the configured root is refused, and the CLI exits with code `10`
(`ErrorUnsafeInputPath`). The offending file is never opened: the check runs before the read is attempted, using
the same realpath-based containment check as `outputRoot`, extended to also realpath the file itself (not just its
parent directory) before comparing — an input, unlike an output, normally already exists, so a symlink planted as
the file itself, not just an ancestor directory, has to be defeated too.

A declared `inputFile` outside the root is reported before the merge starts at all; a discovered file outside the
root aborts the merge the same way, rather than being left as an unresolved `$ref` the way an ordinary missing or
unparseable discovered file is.

`inputURL` and URLs discovered via `resolveExternalReferences` are **unaffected** by `inputRoot` — it bounds the
filesystem, not the network.

When unset, the CLI keeps its historical permissive default and reads whatever the inputs point to.

## Summary

| Setting | Bounds | Config field | CLI flag | Exit code on violation |
| --- | --- | --- | --- | --- |
| Output containment | Where the merged file can be written | `outputRoot` | `--restrict-output-to` | `5` |
| Input containment | Which local files can be read | `inputRoot` | `--restrict-input-to` | `10` |

Neither is on by default; both are additive defence-in-depth for the case where the configuration or its inputs
aren't fully trusted — not something a typical local/CI usage needs to set.
