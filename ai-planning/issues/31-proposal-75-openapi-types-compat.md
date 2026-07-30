# Implementation Proposal: Issue #75 — Accept `openapi-types` Documents

**Issue:** [#75 — Typescript `atlassian-openapi` is not compatible with `openapi-types` OpenAPI3 type](https://github.com/robertmassaioli/openapi-merge/issues/75)

**Status:** ✅ Implemented — written alongside the change rather than before it,
because the design could not be chosen without first measuring how the two type
systems actually diverge (§3).

**Value:** 3 | **Effort:** 2

---

## 1. Issue summary

A user parses specifications with `@apidevtools/swagger-parser`, which returns
`OpenAPIV3.Document` from `openapi-types`, then passes the result to `merge()`
and gets a compile error. They ask two things:

1. How does one solve this?
2. Why is Atlassian's OpenAPI type used here rather than the common one?

The second question deserves a direct answer: `@atlassian/atlassian-openapi`
provides `SwaggerLookup`, the `$ref` resolution this merge is built on, not just
the type declarations. Swapping it out is a much larger change than accepting a
second document type at the boundary, and the two describe the same JSON.

## 2. Symptom

```
Type 'Document<{}>' is not assignable to type 'OpenApiDocument'.
  Types of property 'paths' are incompatible.
    'string' index signatures are incompatible.
      Type '... | undefined' is not assignable to type 'PathItem32'.
```

`openapi-types` declares `PathsObject` values as possibly `undefined`; this
library's `PathItemMap` does not.

## 3. Why field-by-field widening was rejected

The obvious fix is to loosen `PathItemMap` to allow `undefined`. Measured, that
only moves the error:

```
components.responses  -> '{ [k: string]: ReferenceObject | ResponseObject }'
                         not assignable to '{ [k: string]: Reference | Response }'
  -> ResponseObject not assignable to Response
    -> property 'headers' incompatible
      -> ... and further down
```

The mismatches cascade. Loosening every one of them would weaken the types the
merge relies on internally — `getPaths(oas)[path]` would become
`PathItem32 | undefined` at every call site — to gain nothing, since the values
are structurally fine at runtime. Both libraries model the same JSON; they
simply disagree about how strictly to describe it.

## 4. Design: widen the input, narrow once

```ts
export type MergeInputDocument = OpenApiDocument | OpenAPIV3.Document | OpenAPIV3_1.Document;
```

`SingleMergeInputBase.oas` takes that union. `merge()` narrows it exactly once:

```ts
const narrowedInputs = inputs as NarrowedMergeInput;
```

Everything below the entry point continues to see the single concrete type, so
no internal code becomes union-aware and no internal type is weakened. One cast,
in one place, with the reasoning attached — rather than a union that every
internal function has to re-narrow, or a dozen loosened field types.

`openapi-types` moves from `devDependencies` to `dependencies`. It is a
types-only package: no runtime code, so it adds nothing to the bundle, but a
published `.d.ts` that names it must be able to resolve it.

## 5. What this does not do

It does not validate that the document is well formed. The cast asserts that an
`openapi-types` document is readable by this library, which is true because both
describe the same JSON — it does not assert the document is *valid*. That was
already the case for the library's own type and is unchanged.

## 6. Verification

`src/__tests__/openapi-types-compat.test.ts`:

- The exact call from the issue, `merge([{ oas: parsed }])` with
  `parsed: OpenAPIV3.Document`, plus the 3.1 equivalent.
- An `openapi-types` document merged together with a plain one.
- Components carried through from an `openapi-types` document.
- A pure type assertion that all three document types are assignable.

**The meaningful check is `bun run typecheck`, not `bun test`.** The reported
symptom is a compile error, and `bun test` transpiles without typechecking — so
these tests pass even against a broken build. Measured against `origin/main`,
the file produces **5 typecheck errors**, including the `Document<{}> is not
assignable` from the issue. That is the regression guard.

Gate green: lint, 389 tests, 48 artifact checks.
