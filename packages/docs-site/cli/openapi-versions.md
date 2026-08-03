# OpenAPI version support

`openapi-merge-cli` (via the `openapi-merge` library) merges **OpenAPI 3.0.x, 3.1.x and 3.2.x** documents. Every
input must declare a full `openapi` version (for example `"3.2.0"`), and all inputs must agree on the
`major.minor` version — patch differences such as `3.1.0` and `3.1.1` are fine, since they're the same feature set,
but 3.0, 3.1 and 3.2 inputs cannot be mixed with each other.

An input declaring a version this tool doesn't know, no version at all, or a version that disagrees with the other
inputs exits with code `9` (see [Exit codes](/cli/exit-codes)) and a message naming the offending input.

## What each version adds

### 3.1

- `webhooks` — merged exactly like `paths`: the same duplicate-path rule, the same `operationId` uniqueness check,
  the same `$ref` rewriting.
- `components.pathItems`.
- `jsonSchemaDialect`.
- Documents with no `paths` at all (valid in 3.1, since `webhooks` can carry everything).

### 3.2

- The `query` HTTP method and `additionalOperations` (custom verbs such as `PURGE`) — both participate fully in
  operation counting, `operationId` uniqueness, `$ref` rewriting and tag-based selection.
- New tag fields `summary`, `parent` and `kind`, carried through.
- `itemSchema`, discriminator `defaultMapping`, OAuth2 device-authorization flows, and `in: querystring`
  parameters.

## `$self`

`$self` (3.1+) declares a document's *own* identity. A merged document is not any one of its inputs, so carrying an
input's `$self` forward would assert an identity the output doesn't have. It's kept only when there's exactly one
input — the degenerate case where the output really is that document — and dropped otherwise, rather than
arbitrarily inheriting one input's identity, which would also affect how relative `$ref`s resolve.

## Output version

The output declares the version the (agreeing) inputs used, rather than always `3.0.3`. Merging documents that
declare `3.0.0` produces `3.0.0`. Relabelling within a minor version is safe in both directions, so no document
becomes invalid — but if you were relying on the output always being exactly `3.0.3`, that's no longer guaranteed.
