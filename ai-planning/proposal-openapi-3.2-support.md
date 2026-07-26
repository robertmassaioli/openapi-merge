# Implementation Proposal: Supporting OpenAPI 3.1 and 3.2

**Status:** 📝 Proposal — awaiting decision on scope (§4)
**Type:** Feature / correctness
**Scope:** `packages/openapi-merge`, `packages/openapi-merge-cli`, the type dependency
**Date:** 2026-07-26
**Latest spec at time of writing:** OpenAPI **3.2.0**, released 2025-09-19

---

## 0. TL;DR

The library targets OpenAPI 3.0. The current specification is **3.2.0**. The gap
is not "we lack some 3.1 features" — it is worse than that:

> **The library never reads the `openapi` field of any input.** It cannot tell a
> 3.2 document from a 3.0 one, merges it under 3.0 assumptions, silently drops
> everything it does not recognise, and stamps the result `openapi: "3.0.3"`.

Verified against the built CLI, not inferred. Two documents declaring
`openapi: 3.1.1` merged to **exit code 0** with:

- the entire `webhooks` object **silently gone** — it was the whole content of
  one input;
- `components.pathItems` **silently gone**;
- the schema it referenced left behind as an **orphan** — `Pet` is still in
  `components.schemas` and nothing in the output references it any more;
- output labelled `3.0.3` while still containing 3.1-only syntax
  (`type: ["string","null"]`, numeric `exclusiveMinimum`), so it is
  simultaneously **mislabelled and invalid** against the version it claims.

A 3.2 document fares worse. A path item whose only operations are `query` and
`additionalOperations` is counted as having **zero** operations and the entire
path is deleted:

```
input : "paths": { "/search": { "query": {...}, "additionalOperations": { "PURGE": {...} } } }
output: "paths": {}                                          exit code 0
```

Silent, total loss of an endpoint, reported as success.

This proposal separates three deliverables that "support the latest version"
usually conflates (§4). **Only the first is unambiguously worth doing**, and it
is small: stop pretending. Detect what we cannot handle and fail loudly.

---

## 1. What the current spec actually is

| Version | Released | Relationship |
| --- | --- | --- |
| 3.0.3 | 2020 | what this library targets |
| 3.1.0 / 3.1.1 | 2021-02 | **breaking** vs 3.0 |
| **3.2.0** | **2025-09-19** | **additive** vs 3.1 — no breaking changes |

That asymmetry is the single most important planning fact in this document:
**3.0 → 3.1 is the hard step; 3.1 → 3.2 is nearly free.** Effort is not linear
in version distance. A 3.1-capable merger is most of the way to 3.2.

### 1.1 The machine-readable schemas

Verified reachable (HTTP 200) at the time of writing:

| Spec | JSON Schema | Meta-schema |
| --- | --- | --- |
| 3.0 | `https://spec.openapis.org/oas/3.0/schema/2021-09-28` | JSON Schema draft-04 subset |
| 3.1 | `https://spec.openapis.org/oas/3.1/schema/2022-10-07` | `https://json-schema.org/draft/2020-12/schema` |
| **3.2** | **`https://spec.openapis.org/oas/3.2/schema/2025-09-17`** | `https://json-schema.org/draft/2020-12/schema` |

The URL shape is `spec.openapis.org/oas/<minor>/schema/<iteration-date>`; the
`/latest` alias that appears in some documentation **404s** — use the dated
iteration. OAS 3.1 also defines its own JSON Schema dialect at
`https://spec.openapis.org/oas/3.1/dialect/base`, which is the default value of
the new `jsonSchemaDialect` field.

Read straight from the 3.2 schema, the top-level properties are:

```
$self, components, externalDocs, info, jsonSchemaDialect, openapi,
paths, security, servers, tags, webhooks
```

Three of those — **`$self`, `jsonSchemaDialect`, `webhooks`** — do not exist in
3.0 and are silently discarded today. And the 3.2 `path-item` object allows:

```
$ref, additionalOperations, delete, description, get, head, options,
parameters, patch, post, put, query, servers, summary, trace
```

`query` and `additionalOperations` are new; the library knows the other eight
methods only.

## 2. What breaks, precisely

### 2.1 The version is never inspected

`grep` for any read of an input's `openapi` field across both packages returns
**nothing**. The only writes are:

- `packages/openapi-merge/src/index.ts:44` — `openapi: '3.0.3'`, unconditional;
- `packages/openapi-merge/src/paths-and-components.ts:202` — a dummy `'3.0.1'`
  for the internal lookup.

So the library does not decline 3.1; it *cannot perceive* 3.1. Every failure
below follows from that.

### 2.2 Structures that are dropped

| Construct | Since | Why it is lost |
| --- | --- | --- |
| `webhooks` | 3.1 | not in the merge, not walked for `$ref`s |
| `components.pathItems` | 3.1 | `paths-and-components.ts` enumerates exactly nine component types: `schemas responses parameters examples requestBodies headers securitySchemes links callbacks` |
| `jsonSchemaDialect` | 3.1 | not copied |
| `$self` | 3.2 | not copied |
| `query` operation | 3.2 | not one of the eight methods |
| `additionalOperations` | 3.2 | not one of the eight methods |

The eight-method assumption is hard-coded in three places —
`countOperationsInPathItem` and `ensureUniqueOperationIds` in
`paths-and-components.ts`, and `walkPathItemReferences` in
`reference-walker.ts`.

`countOperationsInPathItem` is the dangerous one: `dropPathItemsWithNoOperations`
deletes any path item it scores zero, which is how the `/search` path in §0
disappeared entirely.

### 2.3 Schema Object semantics change under 3.1

3.1 adopts JSON Schema 2020-12 wholesale. Relevant to a *merger* — which
compares schemas for equality to deduplicate them:

- `nullable: true` is gone; `type: ["string","null"]` replaces it. The library's
  `deepEquality` compares structurally, so a 3.0 `{type: string, nullable: true}`
  and its correct 3.1 translation are **not equal** and will be emitted as two
  components rather than deduplicated.
- `exclusiveMinimum` / `exclusiveMaximum` change from booleans to numbers. A 3.0
  document is parsed without error by 3.1 tooling but **means something
  different** — the classic silent breakage.
- `type` may be an array.
- `$ref` may have sibling keywords, which 3.0 forbade.

**Accuracy note:** the `example` → `examples` change applies to the **Schema
Object** keyword only. The Media Type Object's `example`/`examples` fields are
unchanged and both remain valid in 3.1 and 3.2. Conflating the two would break
working documents.

### 2.4 The blocking dependency

`@atlassian/atlassian-openapi@1.0.6` is a hard blocker for anything beyond §4.1:

- it types `paths` as **required**, but 3.1 makes it optional (a webhooks-only
  document is legal and has no `paths` at all);
- its `.d.ts` files contain **zero** occurrences of `webhooks`,
  `jsonSchemaDialect`, `pathItems`, `$self`, `querystring` or
  `additionalOperations`;
- **1.0.6 is the newest version published.** There is no upgrade.

It also supplies runtime helpers, not only types — `TC.isReference` (13 uses),
`SwaggerLookup.InternalLookup` (2), `Lookup.getSchema` (2), plus
`isParameterWithSchema`, `isMediaTypeWithExamples`, `isHeaderWithSchema`.
Replacing it means replacing those too.

Options, all checked:

| Option | 3.1 | 3.2 | Note |
| --- | --- | --- | --- |
| `@atlassian/atlassian-openapi` 1.0.6 | ❌ | ❌ | current; no newer release exists |
| `openapi-types` 12.1.3 | ✅ | ❌ | has `OpenAPIV3_1`, `webhooks`, `jsonSchemaDialect`; no 3.2 |
| **`openapi3-ts` 4.6.0** | ✅ | ✅ | ships `oas30`/`oas31` entry points and a `model/openapi32.d.ts` containing `$self`, `additionalOperations`, `querystring` |
| Generate from the published schema | ✅ | ✅ | the repo already runs `typescript-json-schema`; §1.1 gives the exact schema URL |

`openapi3-ts` is the only off-the-shelf option that types 3.2. Neither it nor
`openapi-types` provides the lookup/type-check runtime helpers, so those move
in-house either way — roughly 60 lines, and the repo now has the test coverage
to do it safely.

## 3. Why this matters more than a normal feature request

The merge is used in CI pipelines to publish a gateway spec. Every failure above
is **silent and exits 0**. A team upgrading one microservice to 3.1 — which they
have had five years to do — gets a published spec that has quietly lost their
webhooks, with no warning in the logs and a green build.

Compare the `inputURL` status bug fixed on `fix/input-url-http-status`: same
shape of defect, same remedy. Fail loudly rather than produce plausible garbage.

## 4. Three deliverables, three costs

### 4.1 Stop corrupting — detect and refuse *(recommended, small)*

Read the `openapi` field of every input. If any input is not `3.0.x`, fail with
a clear message naming the input and its version, rather than merging it under
3.0 assumptions.

- New `ErrorType`: `'unsupported-openapi-version'`.
- New CLI exit code (next unused integer — currently **9**), following the
  convention in `packages/openapi-merge-cli/src/exit-codes.ts`.
- Emit the *input* version rather than a hard-coded `3.0.3` where all inputs
  agree — this is where `proposal-76`'s `MergeOptions` belongs (§6).

**Effort: ~half a day.** Ships correctness immediately and is a prerequisite for
everything else. Note it is a **behaviour change**: documents that merge today
(wrongly) would start failing. That is the point, but it warrants a minor
version bump and a changelog entry.

### 4.2 Pass 3.1/3.2 through without loss *(medium)*

Carry the unrecognised-but-legal constructs through the merge:

- copy `webhooks`, and walk it for `$ref`s and `operationId` uniqueness exactly
  as `paths` is walked;
- add `pathItems` to the component-type list — it dedupes like any other;
- copy `jsonSchemaDialect` and `$self` (first-wins, like `info`; but see §7 —
  `$self` is a document identity and merging two is not obviously meaningful);
- teach the three eight-method sites about `query` and `additionalOperations`,
  including `countOperationsInPathItem`, or the §0 path-deletion bug persists;
- make `paths` optional throughout.

Requires the §2.4 dependency swap. **Effort: ~3–4 days**, most of it the
dependency work, not the merge logic.

### 4.3 Merge 3.1/3.2 semantically *(large, and partly undecided)*

The genuinely hard part, and where the spec stops giving answers:

- **Schema equality across dialects.** Is 3.0 `{type: string, nullable: true}`
  the same component as 3.1 `{type: [string, null]}`? For deduplication to work
  across a mixed-version merge, something must normalise. This is a design
  decision, not an implementation detail.
- **`$self` collision.** Two inputs with different `$self` values are two
  documents with two identities. Which survives, and does the answer make the
  output's relative `$ref` resolution wrong?
- **`operationId` uniqueness across `additionalOperations`**, whose keys are
  arbitrary custom verbs.
- **Mixed-version inputs.** Merging a 3.0 and a 3.1 input requires either
  upconverting the 3.0 one or refusing. Upconversion is a whole feature.

**Effort: 1–2 weeks**, and it should not start until §4.1 and §4.2 have shipped
and the mixed-version question has an owner.

## 5. Recommendation

**Do §4.1 now, on its own branch.** It is half a day, it converts a silent
data-loss bug into a clear error, and it is correct regardless of whether §4.2
is ever funded.

**Treat §4.2 as the real "support 3.2" project** and schedule it deliberately —
its cost is dominated by replacing a type dependency that has no upgrade path,
which is worth doing anyway.

**Do not start §4.3** without first deciding the mixed-version policy, because
every other choice in it follows from that.

## 6. Relationship to `issues/proposal-76-openapi-version.md`

Proposal 76 covers which version *label* to emit and correctly states that
3.0 → 3.1 is not backwards compatible. It assumes every input is 3.0.x and the
only question is which 3.0 patch to stamp on the output.

This proposal is about *support*, and it partly supersedes that framing: the
prior question is whether the inputs are 3.0 at all — which, per §2.1, nothing
currently checks. The two fit together cleanly:

- §4.1 here supplies the version *detection* that 76 assumes;
- 76's `MergeOptions` argument to `merge()` is the natural home for a target
  version option, and should be implemented once rather than twice.

They should be implemented together, 76 second.

## 7. Open questions

1. **Is passing 3.1/3.2 through without merging it honest?** Copying `webhooks`
   from one input is easy; two inputs both defining `newPet` needs the same
   dispute machinery as paths. §4.2 as written is only safe for single-input or
   non-overlapping webhooks — that limitation must be enforced, not assumed.
2. **Should mixed-version merges be allowed at all?** Refusing is defensible and
   much cheaper than upconversion.
3. **Does `$self` even survive a merge conceptually?** Dropping it with a warning
   may be more honest than picking one arbitrarily.
4. **Is the CLI's own config schema affected?** It is generated by
   `typescript-json-schema` from `data.ts` and describes the *merge config*, not
   OpenAPI documents, so probably not — worth confirming before §4.2.

## 8. How the claims here were verified

Every factual claim was produced by running something, not by reading a
changelog:

- version and release date: `spec.openapis.org/oas/v3.2.0.html`;
- schema URLs: `curl` against each, HTTP 200, `$id` and `$schema` read from the
  fetched documents; the `/latest` alias confirmed to 404;
- top-level and `path-item` property lists: parsed from the fetched 3.1 and 3.2
  schemas;
- data loss: two 3.1.1 documents and one 3.2.0 document merged through the built
  CLI (`dist/cli.js`), output inspected;
- dependency capability: `.d.ts` files of `@atlassian/atlassian-openapi@1.0.6`,
  `openapi-types@12.1.3` and `openapi3-ts@4.6.0` grepped for the specific
  constructs;
- available versions: `bun info @atlassian/atlassian-openapi versions`.

## 9. Sources

- [OpenAPI Specification v3.2.0](https://spec.openapis.org/oas/v3.2.0.html)
- [OpenAPI Specification index](https://spec.openapis.org/oas/latest.html)
- [Upgrading from 3.0 to 3.1](https://learn.openapis.org/upgrading/v3.0-to-v3.1.html)
- [Upgrading from 3.1 to 3.2](https://learn.openapis.org/upgrading/v3.1-to-v3.2.html)
- [Migrating from OpenAPI 3.0 to 3.1.0 — OpenAPI Initiative](https://www.openapis.org/blog/2021/02/16/migrating-from-openapi-3-0-to-3-1-0)
- [OpenAPI Specification repository](https://github.com/OAI/OpenAPI-Specification)
