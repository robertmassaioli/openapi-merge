# Implementation Proposal: An `init` Command for the CLI

**Status:** ✅ Implemented — **written after the implementation, not before.**
See §0.
**Type:** CLI / developer experience
**Scope:** `packages/openapi-merge-cli`
**Date:** 2026-08-01
**Branch:** `feature/cli-init-command` (PR #141)

---

## 0. A note on the order this was written in

Every other document in this directory was written before its implementation.
This one was not: the command was built first and the proposal reconstructed
afterwards, at the maintainer's request.

That is worth flagging rather than hiding, because it changes what the document
is worth. The options below were genuinely considered while building — two of
them were half-built and abandoned — but a reader should know that the
recommendation and the outcome could not possibly disagree here, which is
exactly the tension that makes the other proposals in this directory useful.

Where the implementation contradicted an expectation, §6 says so.

## 1. The problem

`openapi-merge-cli` does nothing without an `openapi-merge.json`. A new user's
first interaction is therefore: run the tool, get told the file is missing, go
and read the documentation, learn a schema, and hand-write a file whose shape
they will mostly copy from an example.

The configuration is not complicated. `inputs` and `output` cover almost every
first use. The friction is entirely in discovering that.

## 2. What "good" looks like

- One command produces a working file.
- The file is **valid** — running the tool immediately afterwards must not fail
  on something the generator itself produced.
- It never destroys anything the user wrote by hand.
- It behaves the same way twice in the same directory.

## 3. Options considered

### Option A — a static template

Write a fixed `openapi-merge.json` with placeholder inputs.

**For:** trivial; no scanning to get wrong; behaves identically everywhere.
**Against:** the user still has to fill in every path by hand, which is most of
the work. Barely better than copying the example out of the README.

### Option B — scan by file extension

Take every `.json`, `.yaml` and `.yml` in the directory as an input.

**For:** one line of code; no parsing.
**Against:** wrong almost everywhere. A JavaScript project's directory contains
`package.json`, `tsconfig.json`, `.eslintrc.json`, CI YAML, `docker-compose.yml`.
A generated configuration listing `package.json` as an OpenAPI input is worse
than no generator, because it looks like it worked.

A denylist of known filenames was the obvious patch, and was rejected: it is
wrong the moment any tool invents a new config file, and it silently degrades
rather than failing.

### Option C — scan by content ✓ **chosen**

Open every `.json`/`.yaml`/`.yml` and keep only those parsing to an object with
a top-level `openapi` string of major version 3.

**For:** correct by construction rather than by enumeration. `package.json` is
excluded because it is not an OpenAPI document, not because it is on a list.
Needs no maintenance as the ecosystem changes.
**Against:** reads every candidate file. Irrelevant at the scale involved — a
directory holds tens of files, not thousands — and the alternative is being
wrong.

### Option D — interactive prompts

Ask which files to include, where to write output, whether to set a dispute
prefix.

**For:** the friendliest first run; can teach the options as it goes.
**Against:** needs a prompt dependency; does not work unattended, which is where
this tool mostly runs; and it is a much larger surface to test — every prompt
becomes a branch. The scanning approach gets most of the benefit with none of
that. Worth revisiting only if `init` proves popular and people ask for more
than inputs and output.

### Option E — recursive scan

Walk subdirectories, since specifications often live in `api/` or `specs/`.

**For:** finds more, and the monorepo layout in issue #100 is exactly this shape.
**Against:** requires deciding what to skip. `node_modules` is obvious;
`dist`, `build`, `vendor`, `.git`, `coverage` and `testdata` are all judgement
calls, and every list is wrong for somebody. The failure is silent and
unpleasant: quietly adding a vendored copy of a third party's API to your merge.

**Rejected for now, deliberately reversible.** A shallow scan the user corrects
by hand beats a deep one they have to audit. If people ask, `--recursive` with
an explicit exclusion list can be added without changing anything here.

## 4. Recommendation

**Option C**, with a hand-editable file as the output and no interactivity.

Also decided:

| Question | Answer | Why |
| --- | --- | --- |
| Overwrite an existing config? | Only with `--force` | Clobbering a hand-edited file is the one unrecoverable thing this command can do |
| Nothing found? | Write one placeholder input | `inputs` is `@minItems 1`; an empty array fails validation on the next run |
| Output extension | Follow the inputs | A merge of YAML inputs quietly producing JSON is a surprise |
| Ordering | Sorted by path | Directory iteration order is not stable; a generator must be |
| Swagger 2.0 files | Name them | People try to merge them (#110); silence looks like the scan missed them |

## 5. Shape

A pure `init-command.ts` — `classify`, `selectInputs`, `suggestedOutput`,
`buildConfiguration`, `isScannable` — with the file reading and writing in
`index.ts`. The same split as `synthesizeConfiguration` in the #45 work, and for
the same reason: the interesting decisions are then testable without a temp
directory per case.

## 6. What the implementation contradicted

Two things, both found by running it rather than by reasoning.

### 6.1 `init` must not be a commander subcommand

The obvious wiring is `program.command('init')`. Doing that changes how
commander treats a **bare** invocation: with a subcommand registered and no
default action, `openapi-merge-cli` with no arguments prints help instead of
merging.

That is the tool's primary use, and it would have broken every existing
pipeline — silently, in the sense that the exit code is 0 and the output looks
like documentation rather than an error.

`init` is now dispatched by hand before the program is built, so the merge path
receives exactly the argv it always has. `--help` still documents the command
via `addHelpText`. The first test in the new CLI suite exists solely to catch
this returning.

### 6.2 The generator produced a configuration the merge rejected

The first end-to-end run wrote a config listing a 3.0 file and a 3.1 file. The
merge then refused it — inputs must share a major.minor version.

This is the same failure §4 rules out for empty `inputs`, arrived at from a
different direction, and the proposal did not anticipate it. `init` now warns
when the files it found declare different minor versions, at generation time
while the user still has the file open.

Worth noting how it was found: not by inspection, but by running `init` and then
running the merge on its output. The round trip is now a test.

## 7. Verification

- 27 unit tests on the scanning and generation decisions, weighted towards what
  the scan **rejects** — that is where a content-based scanner earns its keep
  over an extension-based one.
- 12 CLI tests: the bare-invocation guard, reproducible ordering, unparseable
  files, the overwrite refusal leaving the existing file untouched, `-f` and
  `--force`, the placeholder, and the init-then-merge round trip.
- Gate green: lint, 504 tests, 48 artifact checks.

## 8. Not done

- `--recursive` (§3 Option E).
- Interactive prompts (§3 Option D).
- Generating anything beyond `inputs` and `output` — no `dispute`,
  `pathModification` or `operationSelection`. Those need to be understood before
  they are useful, and a generated file full of options the user did not ask for
  is harder to read than a short one.
