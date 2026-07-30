# Implementation Proposal: Mixed-Version Inputs and Automatic Upgrading

**Status:** 📝 Proposal — awaiting decision
**Type:** Feature / design
**Scope:** `packages/openapi-merge`, `packages/openapi-merge-cli`
**Date:** 2026-07-26
**Depends on:** [`24-proposal-openapi-3.2-support.md`](24-proposal-openapi-3.2-support.md) §4.1 and §4.2

---

## 0. TL;DR

Two questions, deliberately separated because they have very different answers:

1. **What should happen when inputs declare different OpenAPI versions?**
   Today: nothing. The version field is never read, every input is merged under
   3.0 assumptions, and the output is stamped `3.0.3` regardless. There is no
   policy because there is no detection.

2. **Could the library upgrade all inputs to the latest version automatically?**
   **Yes, and mostly by delegation** — `openapi-format` already does the
   conversion correctly for 4 of the 5 constructs tested, is idempotent, and
   exposes `openapiConvertVersion` as a library function. Writing a converter
   from scratch is not required.

But there is a **hard sequencing constraint**, measured rather than assumed:

> **Normalising the inputs does not fix the merge, and shipping it alone would
> make things worse.**

Converting a 3.0 and a 3.1 input to a common 3.1 and then merging them still
drops `webhooks` entirely, and still labels the output `3.0.3` — except now the
output contains 3.1 syntax in *every* schema that came from the 3.0 input,
because we upgraded it. Documents that were previously valid-but-mislabelled
become uniformly invalid.

**Auto-upgrade must land after the merge core understands 3.1, never before.**

---

## 1. Why "upgrade" and not "downgrade"

The direction is forced, and this is worth stating because "normalise to a common
version" sounds symmetric.

**Downgrading is impossible in general.** 3.1 constructs have no 3.0
equivalent — `webhooks`, `components.pathItems`, arbitrary JSON Schema 2020-12
keywords, `$ref` with siblings. A 3.1 document that uses any of them cannot be
expressed as 3.0 without discarding meaning, which is precisely the silent loss
this whole line of work exists to stop.

Worse, the tooling does not tell you. Asking `openapi-format` to convert a 3.1
document down to 3.0:

```
$ openapi-format out31.json --convertTo "3.0" -o down.json
✅  OpenAPI formatted successfully

$ cat down.json
  "openapi": "3.1.0"                                  <- unchanged
  "maybe": { "type": ["string", "null"] }             <- still 3.1 syntax
```

Exit 0, cheerful success message, **no conversion performed and no warning**.
A downgrade path built on this would be a silent-failure generator.

So: **the target version is always ≥ the highest input version.** Everything
below assumes that.

## 2. What the conversion tooling actually does

Measured against a 3.0 document containing every construct 3.1 changes.

| Construct | 3.0 input | `openapi-format` output | Correct? |
| --- | --- | --- | --- |
| version label | `3.0.3` | `3.1.0` | ✅ |
| `nullable` | `{type: string, nullable: true}` | `{type: ["string","null"]}` | ✅ |
| exclusive bounds | `{minimum: 7, exclusiveMinimum: true}` | `{exclusiveMinimum: 7}` | ✅ |
| schema `example` | `{example: "x"}` | `{examples: ["x"]}` | ✅ |
| **media-type `example`** | `{example: {...}}` | **unchanged** | ✅ **correctly left alone** |
| `format: binary` | `{type: string, format: binary}` | media type `{}` | ✅ the 3.1 idiom |
| `format: base64` | `{type: string, format: base64}` | **unchanged** | ❌ should be `contentEncoding: base64` |

Two results matter more than the rest:

- **It gets the `example` distinction right.** The Schema Object keyword is
  renamed to `examples`; the Media Type Object's `example` is left alone,
  because that field is unchanged in 3.1. A hand-rolled converter would very
  plausibly get this wrong and silently break working documents.
- **It is idempotent.** Converting an already-3.1 document to 3.1 produced a
  byte-identical file. That is what makes "normalise every input to the target"
  safe to run unconditionally, including on inputs that need nothing.

It also converts 3.0 → 3.2 in one step, and exposes `openapiConvertVersion` as a
library export, so this can be a function call rather than a subprocess.

**The one gap** — `format: base64` — is a small, well-defined patch we would
apply ourselves after conversion, or upstream.

## 3. The sequencing constraint (measured)

This is the finding that should drive the plan.

Two inputs, one 3.0 and one 3.1-with-webhooks. Both normalised to 3.1 first,
then merged with today's CLI:

```
merge exit = 0
  output openapi   : 3.0.3           <- still wrong, now wrong about everything
  webhooks present : False           <- still dropped
  paths            : ['/p', '/upload']
  3.1 syntax kept  : {'type': ['string', 'null']}
```

Normalisation changed nothing about the loss, because the loss is in the merge
core, not in the inputs. What it *did* change is the blast radius: the 3.0
input's schemas are now written in 3.1 syntax and stamped `3.0.3`, so the
output is invalid in more places than before.

**Conclusion:** auto-upgrade is not an alternative to teaching the merge about
3.1 — it is strictly downstream of it. Shipping §4 below before
`24-proposal-openapi-3.2-support.md` §4.2 would be a regression.

## 4. Proposed policy for mixed versions

Four options considered.

| Option | Behaviour | Verdict |
| --- | --- | --- |
| **A. Refuse** | Any version mismatch is an error | Safe, and the right *first* step — this is §4.1 of the 3.2 proposal |
| **B. Upgrade to the highest input version** | 3.0 + 3.1 → both to 3.1 | Good default; no user decision needed |
| **C. Upgrade to a configured target** | User names `3.1` or `3.2` | Needed for "I want 3.2 output even though all inputs are 3.0" |
| **D. Upgrade to the newest the library knows** | Always 3.2 | Surprising; silently changes output when the library is upgraded |

**Recommendation: A now, then B as the default with C available.** D is rejected
because a patch release of `openapi-merge` should never change the version of a
user's published spec.

Concretely, a config surface that composes with `proposal-76`'s `MergeOptions`:

```jsonc
{
  "openapi": {
    // "highest-input" (default) | "3.1" | "3.2" | "match-inputs"
    "target": "highest-input",
    // "upgrade" (default when target allows) | "error"
    "onVersionMismatch": "upgrade"
  }
}
```

`match-inputs` preserves today's single-version behaviour and errors on a
mismatch — the escape hatch for anyone who does not want documents rewritten.

**Upgrading must be opt-outable and must be reported.** Rewriting someone's
schema is a significant act; the CLI should log each input it converted and
from which version, at normal verbosity, not just in debug.

## 5. Where conversion should live

**In the CLI, not the library.** Reasons:

- `openapi-merge` currently has **3 runtime dependencies**
  (`@atlassian/atlassian-openapi`, `lodash`, `ts-is-present`). `openapi-format`
  brings 5 more and a 2.9 MB tree. That is a large tax on every library
  consumer, most of whom pass documents they already control.
- The library's contract is "merge these documents". Normalisation is an
  input-preparation concern, which is what the CLI already does (reading files,
  fetching URLs, parsing YAML).
- Keeping it out of the library means the library can simply **require** that
  all inputs are the same version and error otherwise — a much simpler contract
  than "accepts anything, silently rewrites".

So: the CLI converts each input to the target version immediately after loading
it in `convertInputs`, and passes uniform-version documents to `merge()`.

If a library-level API is wanted later, it should be a separate entry point
(`openapi-merge/upgrade`) so the dependency is opt-in.

## 6. What it would take

Phases, assuming `24-proposal-openapi-3.2-support.md` §4.1 and §4.2 have landed.

| Phase | Work | Effort |
| --- | --- | --- |
| **1** | Version detection and refusal (mismatch → clear error, new exit code) | ½ day — *this is 3.2-proposal §4.1, listed here for completeness* |
| **2** | Merge core understands 3.1/3.2 | 3–4 days — *3.2-proposal §4.2; hard prerequisite, see §3* |
| **3** | Add `openapi-format` to the CLI; normalise each input in `convertInputs`; patch the `format: base64` gap | 1 day |
| **4** | Config surface (§4), wired through `MergeOptions`; per-input conversion logging | 1 day |
| **5** | Tests: mixed-version fixtures, idempotence, opt-out, `base64` patch, and a golden test that a converted-then-merged document validates against the published 3.1 JSON Schema | 1–2 days |
| **6** | Docs: README config reference, AGENTS.md, changelog note that output version may now differ | ½ day |

**Total for the new work (phases 3–6): ~4 days.** The dependency on phase 2 is
what dominates the schedule, and it belongs to the other proposal.

Phase 5's schema-validation test is worth calling out: the repo already depends
on `ajv`, and the published 3.1/3.2 schemas are fetchable
(`https://spec.openapis.org/oas/3.1/schema/2022-10-07`,
`https://spec.openapis.org/oas/3.2/schema/2025-09-17`). Validating merged output
against the real spec schema would catch this entire class of bug — including
the mislabelling that started it — and is arguably worth doing *regardless* of
whether auto-upgrade ships.

## 7. What automatic upgrading cannot fix

Honest limits, so nobody expects more than it delivers.

- **Semantics the converter cannot know.** `format: binary` becoming an empty
  schema is correct per the spec but loses the human signal that this was a
  file. Converters cannot restore intent.
- **Deduplication across dialects.** Once inputs are normalised the problem
  mostly disappears — which is a genuine *argument for* normalisation — but a
  user who opts out and merges 3.0 with 3.1 will get duplicate components,
  because `{type: string, nullable: true}` and `{type: ["string","null"]}` are
  structurally unequal. Either normalise, or refuse; do not merge across
  dialects and hope.
- **Vendor extensions.** `x-*` fields are passed through untouched by the
  converter. If an extension encodes 3.0-specific assumptions, upgrading the
  document around it may leave it inconsistent, silently.
- **`$self` and `jsonSchemaDialect`.** Conversion does not invent them, and
  merging two documents that set them differently is an open question in the
  3.2 proposal, not something upgrading resolves.
- **Swagger 2.0 inputs.** Out of scope here. `swagger2openapi` (7.0.8) handles
  2.0 → 3.0 and could chain in front, but 2.0 → 3.0 is a far lossier conversion
  than 3.0 → 3.1 and deserves its own proposal if anyone asks for it.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Shipping normalisation before the merge understands 3.1 | §3 — hard-block phase 3 on phase 2; the measured evidence is in this document |
| Users surprised that their spec was rewritten | Opt-out via `"target": "match-inputs"`; log every conversion |
| `openapi-format` behaviour changes under us | Pin it; the phase 5 schema-validation test is the regression net |
| A new runtime dependency in the published CLI | It lands in the CLI, not the library (§5); the CLI already ships `ajv`, `js-yaml`, `commander` |
| The `format: base64` gap widens | Patch it ourselves and upstream it; covered by a test |

## 9. Open questions

1. **Should the default really be `highest-input`, or `match-inputs`?**
   `highest-input` is more useful; `match-inputs` is more conservative and
   cannot surprise anyone. Arguably `match-inputs` should be the default in a
   minor release and `highest-input` in the next major.
2. **Should the output version be reported in the CLI summary?** Given the
   output version may now differ from every input, printing it seems necessary
   rather than nice.
3. **Is `openapi-format` the right dependency, or should we vendor the ~200
   lines of conversion we actually need?** Vendoring avoids the dependency
   weight and the base64 gap, at the cost of owning the `example`/`examples`
   distinction that the library already gets right. Leaning towards the
   dependency, at least initially.
4. **Does normalisation interact with `pathModification`/`operationSelection`?**
   Both run after loading; conversion should run *before* them so that later
   stages see one dialect. Worth confirming in implementation.

## 10. Relationship to other proposals

- [`24-proposal-openapi-3.2-support.md`](24-proposal-openapi-3.2-support.md) — the
  prerequisite. Its §4.1 is phase 1 here; its §4.2 is phase 2 and a hard block
  on everything else. This document answers its open question 2 ("should
  mixed-version merges be allowed at all?"): yes, once §4.2 has landed, via
  normalisation — and no before that.
- [`issues/04-proposal-76-openapi-version.md`](issues/04-proposal-76-openapi-version.md) —
  owns the `MergeOptions` argument and the question of which version label to
  emit. The `openapi.target` option in §4 belongs there rather than being a
  second, parallel mechanism.

## 11. How the claims here were verified

- Conversion correctness: a 3.0 document containing `nullable`,
  boolean `exclusiveMinimum`, `format: binary`, `format: base64`, a schema-level
  `example` and a media-type `example`, run through `openapi-format@1.33.5`,
  output diffed field by field.
- Idempotence: converting the 3.1 output to 3.1 again, `diff` byte-identical.
- Downgrade behaviour: `--convertTo "3.0"` on a 3.1 document; output inspected
  and found unchanged with a success message.
- Sequencing: both inputs normalised to 3.1, merged through the built CLI
  (`dist/cli.js`), output inspected for `webhooks` and the version label.
- Dependency weight: `package.json` of `openapi-format` and `du -sh` of its
  installed tree.
- Available converters: `bun info <pkg> version` for each candidate.

## 12. Sources

- [Upgrading from OpenAPI 3.0 to 3.1](https://learn.openapis.org/upgrading/v3.0-to-v3.1.html)
- [Upgrading from OpenAPI 3.1 to 3.2](https://learn.openapis.org/upgrading/v3.1-to-v3.2.html)
- [openapi-format](https://www.npmjs.com/package/openapi-format) — 1.33.5, `--convertTo`, `openapiConvertVersion`
- [Scalar OpenAPI Upgrader](https://scalar.com/tools/openapi-upgrader/getting-started) — `@scalar/openapi-upgrader` 0.2.11, Swagger 2.0 → 3.1
- [api-spec-converter](https://www.npmjs.com/package/api-spec-converter) — 2.12.0, 2.0 → 3.0
- [Automatically Upgrade to OpenAPI v3.2](https://apisyouwonthate.com/blog/automaticly-upgrade-to-openapi-v3-2/)
