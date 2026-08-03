# Merging behaviour

Inputs are processed sequentially: **the first input in the list takes precedence**, and subsequent inputs are
modified to merge seamlessly into it. This section is the reference for exactly what that means, field by field,
and for every way `merge()` can fail.

## What's actually merged vs. first-wins

For `paths`, `components`, `webhooks` and `tags`, the library **merges** the definitions from every input, so
there's no overlap and no information is dropped (subject to the conflict rules below).

For most other top-level elements, the default is that **the first input that declares it wins**, and later inputs'
values are discarded:

| Element | Default | Configurable? |
| --- | --- | --- |
| `info` | First input | Field-by-field override via [`MergeOptions.info`](/library/merge-options#info) |
| `servers` | First input with any | [`MergeOptions.serversStrategy`](/library/merge-options#serversstrategy): `'concat'` keeps every input's servers instead |
| `externalDocs` | First input with any | Not configurable |
| `components.securitySchemes` | **Merged** (not first-wins) | [`MergeOptions.securitySchemesStrategy`](/library/merge-options#securityschemesstrategy) can select `'first'` or `'error'` instead |
| A document-root `x-*` extension | First input that declares it | [`MergeOptions.extensionMergeStrategies`](/library/merge-options#extensionmergestrategies), per extension key |

Security schemes are the one component bucket that does **not** default to first-wins the way `info`/`servers`/
`externalDocs` do — see [Merge options → `securitySchemesStrategy`](/library/merge-options#securityschemesstrategy)
for why the default changed. `x-*` extensions are first-wins the same way `info`/`servers`/`externalDocs` are, but
unlike those three, the alternative isn't a single fixed strategy — see
[Merge options → `extensionMergeStrategies`](/library/merge-options#extensionmergestrategies) for the full,
per-extension configuration this one supports.

The intent behind first-wins-by-default: this library is aimed at putting several services behind one API gateway,
where the gateway's own `info`/`servers`/`externalDocs` are canonical and a backend's own values are an
implementation detail that shouldn't leak into the published document.

## `$self` (OpenAPI 3.1+)

`$self` declares a document's own identity. A merged document is not any one of its inputs, so carrying one input's
`$self` forward would assert an identity the output doesn't have — and because `$self` participates in reference
resolution, a stale value could change how relative `$ref`s resolve. It's kept only in the degenerate single-input
case, where the output really is that document, and dropped otherwise.

## Deduplication

Components (schemas, parameters, responses, etc.) that are structurally identical across inputs are collapsed into
one. Components that share a name but differ are renamed using that input's `dispute` setting (prefix or suffix),
or reported as a `component-definition-conflict` error if no dispute is configured. `operationId`s follow the same
pattern: a genuine collision that no dispute can resolve is an `operation-id-conflict`.

## Error types

Every failure `merge()` can return comes back as `{ type: ErrorType, message: string }`:

| `type` | When it fires |
| --- | --- |
| `no-inputs` | `inputs` was empty. |
| `duplicate-paths` | Two inputs declared the same path (or webhook) and `duplicatePathHandling` didn't resolve it. |
| `component-definition-conflict` | Two inputs defined a component with the same name but different content, and no `dispute` resolved it. |
| `operation-id-conflict` | Two operations ended up with the same `operationId` and no `dispute` resolved it. |
| `unsupported-openapi-version` | An input declared a version this library can't merge, or none at all. |
| `mixed-openapi-versions` | The inputs didn't all declare the same `major.minor` OpenAPI version. |
| `duplicate-webhooks` | Two inputs declared the same webhook name (3.1). |
| `cyclic-external-reference` | A component reachable from `MergeOptions.externalDocuments` transitively references itself. |
| `malformed-document` | A `null` sits in a slot the spec requires to be an object (or, for a discriminator mapping target, a string) — e.g. `schemas: { Widget: }`, an empty YAML value. |
| `extension-merge-conflict` | Two or more inputs disagreed on the value of an `x-*` extension (or a nested field/element within it) that [`extensionMergeStrategies`](/library/merge-options#extensionmergestrategies) configured with the `'error'` strategy at that point. The message names the exact path inside the extension's value where the disagreement was found. |

## Thrown vs. returned errors {#thrown-vs-returned-errors}

Almost everything above is *returned* as an `ErrorMergeResult` — `merge()` does not throw for a malformed merge.
There is one deliberate exception: `malformed-document` is detected deep inside a recursive reference-walk with no
error-return type threaded through dozens of intermediate call sites, so it's *thrown* as `MalformedDocumentError`
from wherever it's found, and caught narrowly at the top of `merge()` — converted into the `malformed-document`
result before it ever reaches your code
([issue #92](https://github.com/robertmassaioli/openapi-merge/issues/92)).

`MalformedDocumentError` is exported from the package root in case you need to recognise it in a context that
bypasses `merge()`'s own catch (it shouldn't, in normal use). Anything else thrown out of `merge()` — an internal
invariant violation, like "more than one matching key" during deduplication — represents a real bug in this
library, not a merge failure to handle, and is intentionally left to propagate rather than swallowed.

## Example: handling every error type

```ts
import { merge, isErrorResult } from 'openapi-merge';

const result = merge(inputs);

if (isErrorResult(result)) {
  switch (result.type) {
    case 'duplicate-paths':
    case 'component-definition-conflict':
    case 'operation-id-conflict':
      // Configuration problem: adjust `dispute` / `duplicatePathHandling` and retry.
      break;
    case 'unsupported-openapi-version':
    case 'mixed-openapi-versions':
      // The inputs themselves need to change (convert or align versions).
      break;
    default:
      console.error(result.message);
  }
}
```
