# Formatting

Control the indentation of the merged output via an optional `formatting` block. Indentation is expressed as a
discriminated union, so contradictory combinations (e.g. "tabs of width 4") are unrepresentable:

```jsonc
{
  "inputs": [ /* ... */ ],
  "output": "./merged.json",

  // 4-space indentation (default is 2 spaces).
  "formatting": { "indent": { "style": "spaces", "width": 4 } }
}
```

```jsonc
{
  "inputs": [ /* ... */ ],
  "output": "./merged.json",

  // Tab indentation. JSON only — see below.
  "formatting": { "indent": { "style": "tabs" } }
}
```

If `formatting` is omitted, the output keeps the historical default of two-space indentation.

::: warning
YAML 1.1 disallows tab characters as indentation. Combining `{ "style": "tabs" }` with a `.yaml`/`.yml` output is
rejected at configuration-load time with a clear error message, not a broken YAML file.
:::

## Paths

Both `inputFile` and `output` accept relative or absolute paths. Relative paths are resolved against the directory
containing the configuration file. Absolute paths (e.g. `/tmp/merged.yaml`, `C:\build\out.json`) are used as-is —
you can safely write the merged spec into `/tmp` or `/var/build/...` from CI.

Any directory in `output`'s path that doesn't exist yet is created automatically, including multiple missing levels
at once, so `"output": "./dist/service.output.swagger.json"` works even before `dist/` exists. If a directory can't
be created — a permissions error, or a path component that's already a regular file — the CLI exits with
`ErrorCreatingOutputDirectory` (see [Exit codes](/cli/exit-codes)) rather than a raw stack trace.
