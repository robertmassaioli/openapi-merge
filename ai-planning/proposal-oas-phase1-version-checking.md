# Implementation Proposal: OpenAPI Support, Phase 1 — Version Checking

**Status:** 📝 Proposal — implementation follows in this branch
**Type:** Correctness / breaking change
**Scope:** `packages/openapi-merge`, `packages/openapi-merge-cli`
**Date:** 2026-07-26
**Branch:** `feat/openapi-version-checking`
**Phase:** 1 of 3 — see §7 for the sequence

---

## 0. TL;DR

The library never reads the `openapi` field of any input. It cannot tell a 3.1
document from a 3.0 one, merges everything under 3.0 assumptions, and stamps the
result `3.0.3` — losing `webhooks`, `components.pathItems` and whole path items
silently, with exit code 0. The evidence is in
[`proposal-openapi-3.2-support.md`](proposal-openapi-3.2-support.md) §0.

**Phase 1 makes the library honest about what it supports, and nothing else.**

Read every input's version. Refuse anything that is not 3.0.x. Refuse inputs
that disagree with each other. Say clearly which input was at fault and what
version it declared.

This is the option-A policy: *users are expected to bring inputs of a single
OpenAPI version.* It is deliberately the smallest possible change that converts
a silent data-loss bug into a loud error, and it ships value on its own even if
phases 2 and 3 never happen.

## 1. Goals

1. Every input's `openapi` field is parsed and validated before any merging.
2. An unsupported version is a **clear error**, naming the input index and the
   version found.
3. Inputs declaring different `major.minor` versions are refused.
4. A distinct CLI exit code, so CI can distinguish "your spec is the wrong
   version" from "the merge itself failed".
5. The supported-version set is **one constant**, so phases 2 and 3 widen it
   rather than restructuring anything.

## 2. Non-goals

- Changing the emitted output version. Today it is `3.0.3` unconditionally, and
  within 3.0.x that relabelling is safe (see
  [`issues/proposal-76-openapi-version.md`](issues/proposal-76-openapi-version.md)).
  Phase 2 has to revisit it; phase 1 does not.
- Supporting 3.1 or 3.2. That is phases 2 and 3.
- Converting between versions. See
  [`proposal-mixed-version-inputs.md`](proposal-mixed-version-inputs.md) — and
  note it is blocked on phase 2, not on this.
- Validating documents against the OpenAPI JSON Schema. Worth doing, separately.

## 3. Design

### 3.1 A new module: `openapi-version.ts`

Version handling lives in one file so later phases have one place to touch.

```ts
export type OpenApiVersion = { major: number; minor: number; patch: number; raw: string };

/** The minor versions this library can merge. Phase 2 adds '3.1'; phase 3 adds '3.2'. */
export const SUPPORTED_MINOR_VERSIONS: ReadonlyArray<string> = ['3.0'];

export function parseOpenApiVersion(raw: unknown): OpenApiVersion | undefined;
export function validateInputVersions(inputs: MergeInput): ErrorMergeResult | undefined;
```

`SUPPORTED_MINOR_VERSIONS` is the single lever. Phase 2 appends `'3.1'` to it
and then makes that true; phase 3 appends `'3.2'`.

### 3.2 Rules

Applied in `merge()` before any other work, so nothing is half-merged:

1. **Missing or malformed `openapi`** → `unsupported-openapi-version`. A document
   without a version is not an OpenAPI document we can reason about, and
   guessing is what got us here.
2. **Version outside `SUPPORTED_MINOR_VERSIONS`** → `unsupported-openapi-version`,
   naming the input index, the version found, and what is supported.
3. **Inputs disagreeing on `major.minor`** → `mixed-openapi-versions`, listing
   every distinct version and which inputs declared it.

Patch differences within a minor (3.0.0 vs 3.0.3) are **fine** and not a
mismatch — they are the same feature set by construction (proposal-76 §1).

### 3.3 Two new error types

```ts
export type ErrorType =
  | 'no-inputs' | 'duplicate-paths'
  | 'component-definition-conflict' | 'operation-id-conflict'
  | 'unsupported-openapi-version'      // new
  | 'mixed-openapi-versions';          // new
```

Two rather than three: a missing version, a malformed version and a 3.1 document
all mean "I cannot work with this input's version", and all have the same remedy
shape. The *message* distinguishes them; the type does not need to.

### 3.4 CLI exit code

`ExitCode.ErrorOpenApiVersion = 9` — the next unused integer, per the rule in
`exit-codes.ts`. The CLI maps the two new error types to it and everything else
to `ErrorMerging` as before, so a pipeline can tell "wrong version, fix your
spec" from "genuine merge conflict".

## 4. This is a breaking change

Documents that merge today would start failing:

- any input with a missing or malformed `openapi` field;
- any input declaring 3.1 or 3.2 — which today merges "successfully" while
  losing data.

That is the entire point, but it warrants a **minor version bump** and a
changelog entry, and it is the reason phase 1 is worth shipping separately
rather than folded into a larger release.

## 5. Test plan

Library:

- parses `3.0.0` / `3.0.3` / `3.1.0` / `3.2.0` correctly;
- rejects missing, empty, non-string, `"3"`, `"abc"`, `"3.0"`, `"v3.0.0"`;
- accepts a mix of 3.0 patch versions across inputs (not a mismatch);
- rejects a 3.1 input with a message naming the index and version;
- rejects mixed 3.0 + 3.1 with a message listing both;
- error is returned *before* any merging — nothing partially merged.

CLI:

- a 3.1 input exits **9**, not 3 and not 0;
- stderr names the offending input and version;
- **no output file is written** — the assertion that proves the failure is real;
- a genuine merge conflict still exits 3, so the new code did not swallow it.

## 6. Natural stopping point

After this phase the tool is *correct about its own limits*: it merges 3.0
documents and refuses everything else loudly. Nothing is silently lost. Someone
whose inputs are all 3.0 sees no change; someone on 3.1 gets told so instead of
getting a corrupt file.

That is a shippable state, and a reasonable place to stop indefinitely if
phases 2 and 3 are never funded.

## 7. The three-phase sequence

| Phase | Proposal | Delivers |
| --- | --- | --- |
| **1** | this document | detect and refuse; nothing silent |
| **2** | `proposal-oas-phase2-31-support.md` | merge 3.1 — webhooks, `pathItems`, `jsonSchemaDialect`, optional `paths` |
| **3** | `proposal-oas-phase3-32-support.md` | merge 3.2 — `query`, `additionalOperations`, `$self`, tag `kind`/`parent`/`summary` |

Each phase widens `SUPPORTED_MINOR_VERSIONS` by exactly one entry, and each ends
in a state that is shippable on its own.
