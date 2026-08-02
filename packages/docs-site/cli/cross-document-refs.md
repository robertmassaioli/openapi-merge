# Cross-document `$ref`s

If one input's `$ref` points at *another file* rather than somewhere inside itself —
`$ref: "../common/Errors.yml#/components/schemas/ServerError"` — two different things can happen, depending on
whether that file is one of your declared `inputs`.

## The target is already one of your `inputs`

The `$ref` is rewritten to point at wherever that component ended up in the merged document, automatically and
unconditionally — no configuration needed. This is always correct: the alternative is a `$ref` that's already
broken in the merged output, since the original relative path means nothing once the inputs are combined into one
document ([issue #104](https://github.com/robertmassaioli/openapi-merge/issues/104)).

## The target isn't one of your `inputs`

By default the `$ref` is left as-is (resolved to an absolute path or URL, so at least it's unambiguous, but still
not something the merged document can resolve on its own). Set `resolveExternalReferences: true` to have the CLI
follow it: load that file (or URL), pull in *just* the component the `$ref` asked for, and rewrite the `$ref` to
point at it locally — following further `$ref`s the same way, however many files deep, with cycles detected and
reported rather than hanging ([issue #10](https://github.com/robertmassaioli/openapi-merge/issues/10)).

```json
{
  "inputs": [{ "inputFile": "./api.yaml" }],
  "output": "./bundle.yaml",
  "resolveExternalReferences": true
}
```

A `$ref` this discovers but cannot load — a missing file, a failed fetch, a document that doesn't parse — is left
exactly as written and reported as a warning, not a hard failure, the same way an unresolvable `$ref` into a
declared input is also left alone rather than erroring.

::: tip
`resolveExternalReferences` widens what gets *read*, not just written — see [Security](/cli/security) for what
that means if your inputs aren't fully trusted.
:::
