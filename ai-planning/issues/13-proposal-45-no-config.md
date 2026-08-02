# Implementation Proposal: Issue #45 — Allow CLI Use Without a Config File

**Status:** Proposal (revised 2026-08-02 — the original draft here predates `init` and
several CLI architecture changes; see §0)

**Issue:** [robertmassaioli/openapi-merge#45](https://github.com/robertmassaioli/openapi-merge/issues/45)

---

## 0. Revision note

The version of this proposal previously on file was written against an old
Commander API (`program.config`, `program.inputFiles` — properties directly on
the `Command` instance) that no longer exists; the current code reads options
via `program.opts<CliOptions>()` specifically because Commander stopped
exposing them as properties. More importantly, the original draft predates
`openapi-merge-cli init` entirely, which — since it landed — already solves a
large fraction of the friction #45 complains about, just not with the exact
interface #45 asked for. §1–§3 below are rewritten against the current
codebase; the recommendation in §7 is new.

## 1. Issue Summary

**User request** (verbatim from the issue): "I think it can be nice to use
without config files and relying on default sensible parameters,"
specifically:

```bash
npx openapi-merge-cli oas/my-app/file.yml
```

— i.e., merge OpenAPI files passed directly as CLI arguments, with the output
defaulted next to the source (e.g. `file-merged.yml`), and no config file
required at all.

## 2. Current Behaviour, Verified Against `main`

Confirmed still true today, by building `dist/cli.js` from this branch and
running it directly (not just reading the source). `buildProgram()` in
`packages/openapi-merge-cli/src/index.ts` registers only `-c/--config`,
`--restrict-output-to`, and `--restrict-input-to`; there is no
`program.argument(...)` call anywhere. Passing a file directly, as the issue
asks for, is a hard Commander-level rejection, not a graceful fallback:

```
$ openapi-merge-cli a.json
error: too many arguments. Expected 0 arguments but got 1: a.json.
```
(exit code 1)

And with no arguments and no config file in the directory, `main()`'s call to
`loadConfiguration()` — which falls back to `openapi-merge.yaml`/
`openapi-merge.json` (`STANDARD_CONFIG_FILE_CANDIDATES`) in the current
directory when `-c` isn't given — fails with:

```
Could not find or read 'openapi-merge.yaml' or 'openapi-merge.json' in the current directory: <cwd>
```
(exit code 1, verified — no mention of `init` anywhere in the message)

**What has changed since this issue was filed, though:** `openapi-merge-cli
init` now exists (`ai-planning/33-proposal-cli-init-command.md`). Run with no
arguments, it scans the current directory for files whose content starts
`openapi: 3.x`, classifies them (OpenAPI 3.x / Swagger 2.0 / not a spec), and
writes a filled-in `openapi-merge.yaml` — `resolveExternalReferences` and
`inputRoot` already turned on, every other optional field present as a
commented example. That is:

```bash
npx openapi-merge-cli init && npx openapi-merge-cli
```

— two commands, zero hand-written config, versus the one command #45 asks
for. `init` is a materially better starting point than what existed when this
issue was filed (there was no scaffolding at all), even though it is not the
literal interface requested.

**The one thing that hasn't improved:** the "no config found" error message
above says nothing about `init`. Someone hitting it today gets pointed at
nothing; they have to already know the command exists.

## 3. What a positional-argument mode would actually require today

Sketching this against the *current* architecture (not the stale one in the
prior draft) surfaces real integration cost the original 2-hour estimate
missed:

1. **Bypasses config validation.** `validateConfiguration()` in
   `load-configuration.ts` runs the generated `configuration.schema.json`
   through Ajv and then `validateConfigurationSemantics` (the tabs+YAML
   check). A synthesized `Configuration` object built directly in `index.ts`
   skips both — either duplicate that validation against the synthesized
   object, or accept that positional mode has a narrower, hand-checked set of
   constraints than config-file mode. Nothing in the old draft's sketch calls
   either.
2. **`inputRoot`/`outputRoot` have no positional-mode equivalent.**
   `--restrict-input-to`/`--restrict-output-to` are independent CLI flags and
   would keep working, but a synthesized config has no `inputRoot`/`outputRoot`
   fields to set from positional flags, so anyone wanting that containment in
   quick-merge mode has to fall back to `-c` anyway — worth being explicit
   about rather than silent.
3. **Commander's actual current shape.** Any new flags need to go through
   `program.opts<CliOptions>()` like the existing three, and `CliOptions`
   needs new members — mechanical, but the old sketch's `program.output`/
   `program.inputFiles` direct-property access simply won't compile against
   the current `buildProgram()`.
4. **Output-extension inference is the one genuinely fiddly part**, and the
   old proposal's version (extension of the *first* input) is a reasonable
   default but silently produces YAML output from a YAML-then-JSON input pair
   or vice versa — worth a one-line log statement saying which extension was
   picked and why, so it isn't a surprise.

None of this is hard, but it's easily 1.5–2x the original ~2-hour estimate
once schema validation and the two containment flags are accounted for
properly rather than left as an implicit gap.

## 4. Design (if built)

Keep the shape from the original draft — it was reasonable — with the above
gaps closed:

```
openapi-merge-cli [options] [<inputFile|inputURL>...]

  -o, --output <path>         Output path (default: ./merged.<ext>, extension from the first input)
  --dispute-prefix <prefix>   Dispute prefix applied uniformly to every positional input
```

- `-c`/positionals are mutually exclusive; supplying both is a config-loading
  error, same exit code as any other bad invocation (`ErrorLoadingConfig`).
- A synthesized `Configuration` is passed through
  `validateConfigurationSemantics` (not the Ajv schema — nothing here can
  violate the JSON Schema by construction, since it's built from typed
  fields, but the tabs+YAML cross-check still applies) before proceeding, so
  positional mode cannot silently produce an invalid tabs+YAML combination
  that config-file mode would have caught.
- `--restrict-input-to`/`--restrict-output-to` keep working exactly as today;
  documented explicitly as the only way to get containment in this mode.
- Per-input `operationSelection`, `description`, and `pathModification` stay
  out of scope, same as the original draft — that's what `-c` is for.

## 5. The cheap, decoupled fix: point the error at `init`

Independent of whether the full positional mode gets built, the "no config
found" message should say so:

```
Could not find or read 'openapi-merge.yaml' or 'openapi-merge.json' in the
current directory: <cwd>. Run 'openapi-merge-cli init' to generate one from
the OpenAPI files already here.
```

One string change in `load-configuration.ts`, one test asserting the message
contains `init`. This closes a meaningful fraction of the original
friction — "I don't want to write a config file by hand" — without any of
§3's integration cost, and is worth doing regardless of the decision on §4.

## 6. Effort

| Task | Effort |
| --- | --- |
| §5 alone (point the error at `init`) | 15 minutes |
| §4 in full (positional-argument mode) | ~4 hours, once schema-validation and containment-flag handling are done properly (not the original ~2h estimate) |

## 7. Opinion: is this worth building?

**§5: yes, trivially — do it regardless of the rest of this proposal.**

**§4 (the full positional-argument mode): not a priority right now, and I'd
push back on building it as originally scoped.** Two reasons:

1. **`init` already substantially answers the request.** The issue's actual
   complaint — "writing a config file is heavyweight friction for a one-off
   merge" — is largely addressed by `openapi-merge-cli init` existing at all,
   which it did not when this was filed. The gap left is "one command instead
   of two, and I don't want a config file on disk even temporarily," which is
   a real but much smaller convenience than the original issue implies.
2. **A second parsing/validation path is exactly the kind of ongoing cost
   this codebase has been actively paying down elsewhere** — see how much
   of `path-resolution.ts`, `inputRoot`/`outputRoot`, and the Ajv-schema
   validation exist specifically to give the config-file path a single,
   well-tested source of truth for correctness and safety. A positional mode
   either duplicates that trust boundary (more surface to keep in sync
   forever) or quietly has a narrower one (a foot-gun for whoever hits the
   gap first). Given the whole rest of this codebase's design leans toward
   "one validated path, everything goes through it," introducing a second,
   permanently-parallel entry point for a convenience feature is a real,
   recurring cost — not a one-time ~4 hours.

**Recommendation:** ship §5 now (trivial, unambiguous win); leave §4 closed
or deprioritized unless a maintainer decides the "no config file on disk at
all" case is worth the ongoing double-validation-path cost. If it does get
picked up later, treat this document's §3 as the actual scope, not the
original ~2 hour estimate.

## 8. Non-goals

- Per-input `operationSelection`/`description`/full `pathModification` in
  positional mode — same reasoning as the original draft, `-c` exists for
  this.
- Changing `init`'s behaviour. This proposal only points the *error message*
  at it; `init` itself is out of scope here.
