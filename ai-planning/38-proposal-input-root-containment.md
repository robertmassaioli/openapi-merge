# Proposal 38: `inputRoot` — a read-side containment boundary for local files

**Status:** ✅ Implemented on branch `issue/input-root-containment`, at Robert's explicit direction, with the strictness of §2.4 revised before implementation began (see §6).

**Not tied to a filed GitHub issue.** This is the follow-up Robert asked for
directly, off the back of a gap [proposal 37](issues/37-proposal-10-external-ref-bundling.md)
§5 and §9.3 flagged but explicitly did not build: `resolveExternalReferences`
(issue #10, shipped in [PR #143](https://github.com/robertmassaioli/openapi-merge/pull/143))
follows `$ref`s to files nobody named in `inputs`, with nothing bounding how
far outside the config's own directory that following can reach. If this
should be tracked as its own GitHub issue before merging, that's a one-line
follow-up — flagging it here rather than assuming.

## 1. The asymmetry this closes

`outputRoot` ([issue #93](issues/03-proposal-93-absolute-paths.md), shipped)
is a defence-in-depth knob on the *write* side: when set, the CLI refuses to
write the merged output anywhere outside a configured directory, defeats
symlink-out-of-jail tricks by re-anchoring on the realpath of the nearest
existing ancestor, and exits with a dedicated code (`ExitCode.ErrorUnsafePath`,
5) rather than silently writing wherever the config says.

There has never been a *read*-side equivalent. Two independent code paths
read arbitrary local files today, and both grew directly out of this
conversation's own work:

- **Declared inputs.** `loadOasForInput` (`packages/openapi-merge-cli/src/index.ts:218-232`)
  resolves each `inputFile` against the config's directory
  (`resolveConfigPath`) and reads it with no containment check. This has
  been true since the CLI existed — `inputFile` was always as unrestricted
  as `output` was before #93.
- **Discovered files (new, issue #10).** `loadDocument`
  (`packages/openapi-merge-cli/src/external-reference-discovery.ts:104-113`)
  reads whatever file identity `resolveCrossDocumentIdentity` computes by
  resolving a `$ref`'s relative path against the *referencing document's own
  directory* — not the config's `basePath`. When `resolveExternalReferences:
  true`, this repeats breadth-first over every newly discovered document
  until the worklist is empty.

The second path is what makes this urgent rather than theoretical. Before
#10, the reachable file set was exactly what `inputs` listed — visible in the
config, one line per file. With `resolveExternalReferences: true`, the
reachable set becomes transitive: anything any input, or anything *that*
input pulls in, cares to `$ref`. A relative path shaped like
`../../../../../etc/passwd` inside a spec the config author did not author
themselves (a vendor-supplied spec pulled from a registry, say) is followed
exactly as readily as `../common/Errors.yml`. Proposal 37 §9.3 named this and
left it open on the grounds that the flag is opt-in and the README says so —
that is a documentation mitigation, not a technical one.

## 2. Proposed design

Mirror `outputRoot` as closely as the read/write asymmetry allows, rather
than inventing new vocabulary.

### 2.1 Configuration

```typescript
/**
 * Optional defence-in-depth restriction, the read-side counterpart to
 * `outputRoot`: when set, the CLI will refuse to read a local file —
 * whether a declared `inputFile` or a file discovered via
 * `resolveExternalReferences` — from anywhere outside this directory.
 *
 * Any local file load that would reach outside `inputRoot` is a hard
 * error: the merge does not proceed and no output is written, whether the
 * offending path came from a declared `inputFile` or was reached
 * transitively by following a `$ref` out of some other document. Every
 * violation found is reported together, not just the first (the same
 * report-everything-then-exit shape `ErrorLoadingInputs` already uses).
 *
 * Applies to local files only. `inputURL` and URLs discovered via
 * `resolveExternalReferences` are a different trust boundary (network
 * egress, not filesystem containment) and are not affected by this option
 * -- see §5 of proposal 38 for why that is out of scope here.
 *
 * Leave unset to keep the historical permissive default.
 *
 * @minLength 1
 */
inputRoot?: string;
```

### 2.2 CLI flag

`--restrict-input-to <dir>`, overriding `inputRoot` from the config file,
exactly mirroring `--restrict-output-to`'s relationship to `outputRoot`
(`packages/openapi-merge-cli/src/index.ts:36,51`).

### 2.3 The containment check itself

`assertOutputContained` (`packages/openapi-merge-cli/src/path-resolution.ts:66-100`)
is not input/output-specific in its logic — it takes a resolved path and a
root and does a realpath-based ancestor walk. Generalise it into a shared
`assertPathContained(resolved, root, kind, realpathSync?, exists?)` that
both `assertOutputContained` and a new `assertInputContained` call, each
throwing their own named error subclass (`OutputOutsideRootError` already
exists; add `InputOutsideRootError` alongside it) so call sites keep
distinguishable error types without duplicating the symlink-defeating walk.
This is a refactor of existing code, not new algorithmic work — same
"walk up to the nearest existing ancestor, realpath that, re-anchor,
compare" shape, unchanged.

### 2.4 Where the check runs

Both call sites are hard errors, and both are resolved *before* `merge()`
is ever invoked — the "Option 2, refined" architecture already puts all I/O
in the CLI ahead of the synchronous merge (proposal 37), so there is no
point after discovery has run where a violation could sneak past
undetected.

**Declared inputs — eager, before any merge work starts.** Resolve every
`inputFile`'s full path up front (this already happens once per input) and
check containment before `loadOasForInput` reads anything. Collect *every*
violating input, not just the first — matching `ErrorLoadingInputs`'s
existing "all inputs are attempted before exiting" philosophy
(`exit-codes.ts:62-63`), so a config with three bad `inputFile` entries
doesn't require three separate fix-and-rerun cycles.

**Discovered files — checked per-file during the breadth-first walk, but
still fatal.** Inside `discoverExternalDocuments`'s worklist loop
(`external-reference-discovery.ts:171-194`), check containment immediately
before `loadDocument` for a `kind: 'file'` reference. A violation is never
read — that is the property that actually matters — but instead of being
downgraded to a `DiscoveryWarning` (as a missing or unparseable file already
is), it is collected into a distinct `containmentViolations` list alongside
the existing `warnings`. The worklist continues draining (so every
reachable, non-violating branch still gets a chance to surface its own
violations or its own ordinary warnings in the same pass — one bad `$ref`
should not hide a second one three files over), but a violating identity's
*own* refs are never discovered, since the file was never read. Once the
worklist is empty, if `containmentViolations` is non-empty, `main()` skips
calling `merge()` entirely: no output is written, and every violation found
— declared and discovered together — is reported in one pass.

The result is symmetric with the declared-input case in outcome (hard
failure, nothing written, everything found is reported at once) even though
*where* the check runs differs (eagerly for declared inputs, which are
known up front; interleaved with discovery for transitive references,
which by definition are not known until something else has already been
read).

### 2.5 New exit code

Append `ErrorUnsafeInputPath = 10` (do not reuse `ErrorUnsafePath` — that
code's TSDoc is specifically about the *output* escaping its root, and CI
scripts branching on exit codes need the two directions to stay
distinguishable, same reasoning that kept the three `ErrorInputUrl*Status`
codes separate from each other). Fires for both cases in §2.4 — declared
input outside the root, or a reference discovered from inside an input
resolving outside the root — since from a caller's perspective both are the
same failure: "this config would have read something outside `inputRoot`."

### 2.6 Resolution semantics

Same as `outputRoot`: `inputRoot` (or `--restrict-input-to`) is resolved via
`resolveConfigPath(basePath, ...)` — relative values are anchored to the
config file's directory, absolute values pass through unchanged.

## 3. Non-goals

- **URL containment / SSRF.** `inputURL` and discovery-following of absolute
  URLs are untouched by this proposal. Bounding *those* is a genuinely
  different problem — allow-listing hosts or schemes, not directory
  containment — and deserves its own design rather than being bolted onto
  a filesystem-shaped mechanism. Worth its own proposal if
  `resolveExternalReferences` sees use against configs that also discover
  URLs from untrusted content.
- **Retroactively restricting `inputFile` by default.** `inputRoot` is
  opt-in, like `outputRoot`. Existing configs that read from anywhere keep
  doing so unless the user asks for the restriction.
- **Sandboxing the YAML/JSON parse itself.** `readYamlOrJSON` already uses
  js-yaml's `load` (not `loadAll`/unsafe constructors), so arbitrary-type
  instantiation is out of scope for both this proposal and the problem it
  addresses — this is purely about *which paths may be read*, not what
  happens to their contents once read.

## 4. Testing plan

Following the pattern already established for `outputRoot`
(`cli-output-safety.test.ts`) and for #10 discovery
(`cli-external-references.test.ts`):

- Unit tests for the generalised `assertPathContained` / `assertInputContained`,
  covering the same cases `path-resolution.test.ts` already covers for
  output: plain containment, escape via `..`, escape via an absolute path,
  symlink-out-of-jail via a planted symlink in an existing ancestor, and a
  root that does not yet exist.
- CLI end-to-end test: a declared `inputFile` outside `inputRoot` exits
  `ErrorUnsafeInputPath` and names the offending file, with a second bad
  input in the same config also reported (not just the first).
  `--restrict-input-to` overriding a config `inputRoot` (mirroring the
  existing `--restrict-output-to` precedence test).
- CLI end-to-end test: `resolveExternalReferences: true` with `inputRoot`
  set, a discovered file outside the root — merge does not run, no output
  file is written, exit code is `ErrorUnsafeInputPath`, and the error names
  the offending file and the referencing document.
- CLI end-to-end test: two separate containment violations in one run — one
  declared `inputFile` outside the root and one discovered file outside the
  root (reached via a *different*, in-bounds input) — both are named in the
  single error report, confirming the worklist keeps draining after the
  first violation instead of stopping short.
- CLI end-to-end test: a discovered file outside the root sits alongside an
  ordinary discovery failure (a genuinely missing file, reached via another
  ref) in the same run — the missing file still produces its existing
  non-fatal warning shape, while the containment violation still aborts the
  merge; the two failure modes don't get conflated.
- Regression guard: `inputRoot` unset behaves identically to today (every
  existing `cli-*.test.ts` file already exercises this by omission).

## 5. Relationship to prior work

- Directly closes the gap [proposal 37 §9.3](issues/37-proposal-10-external-ref-bundling.md#93-the-containmentallow-list-gap--still-open-flagged-rather-than-fixed)
  named and explicitly left open.
- Reuses, rather than reinvents, the containment mechanism [issue #93](issues/03-proposal-93-absolute-paths.md)
  built for `outputRoot` — same realpath/symlink defence, same
  resolve-relative-to-`basePath` semantics, same optional/backward-compatible
  posture.
- Sits entirely in the CLI package, consistent with proposal 36 §3's
  reasoning for why all file-path and network awareness stays out of the
  `openapi-merge` library itself: `inputRoot` is a CLI-only concept, and
  `merge()`'s signature does not change.

## 6. What was actually built

### 6.1 §2.4 was revised before implementation, not after

The original draft of §2.4 made discovered-file violations a soft warning
(ref left unresolved, merge proceeds), on the theory that a `$ref` inside a
*discovered* document is content the config author may not have written
themselves. Before any code was written, Robert was asked directly whether
that asymmetry was intended and said no: a containment violation should be
fatal whichever side it comes from. §2.1, §2.4, §2.5 and the §4 testing plan
above already reflect that decision — this section records the outcome, not
a second change. The distinction that survives is not *hard-fail vs. warn*
but *where the check runs*: eagerly, before any input is read, for declared
inputs; interleaved with the breadth-first discovery walk for transitive
references, since those identities are not known any earlier.

### 6.2 The design landed exactly as specified

- `assertPathContained`'s generalisation (§2.3) is real: `path-resolution.ts`
  now has one `resolveContainment` helper, and `assertOutputContained` /
  `assertInputContained` are both thin wrappers throwing their own error
  type. No behavioural change to the existing `outputRoot` check — same
  tests (`path-resolution.test.ts`'s `assertOutputContained` suite) still
  pass unmodified.
- `ErrorUnsafeInputPath = 10` (§2.5) is used for both the eager declared-input
  case and the interleaved discovered-file case, exactly as specified.
- The worklist-keeps-draining behaviour (§2.4) works as designed: two
  declared inputs, each pulling in a different out-of-root file via
  `resolveExternalReferences`, produce one exit with both files named on
  stderr, not two separate runs' worth of trial and error.

### 6.3 One thing the proposal did not fully anticipate: declared-input checks are all-or-nothing before discovery even starts

§2.4's "both are reported in one pass" language is only exactly true within
each of the two categories (declared vs. discovered), not *across* them.
`convertInputs` loads every declared input concurrently via `Promise.all`
and only proceeds to cross-document discovery once *all* of them succeed —
that was already the existing behaviour for ordinary load failures
(`ErrorLoadingInputs`), before this proposal touched anything. A declared
`inputFile` outside `inputRoot` therefore short-circuits before discovery
ever runs, so a containment violation on a declared input and a containment
violation on a file that same run *would have* discovered cannot both
appear in one error report — the discovered-file violation is simply never
reached. This is not a gap in the security property (nothing outside
`inputRoot` is ever read either way), just a correction to an implicit claim
in §2.4's phrasing. The §4 testing plan's "two separate containment
violations in one run" test was adjusted accordingly, to combine two
discovered-file violations reached via two different (individually valid)
declared inputs, which does hit the "both reported together" path.

### 6.4 Two gaps found in review, fixed before landing

An advisor review of the first implementation pass caught two real defects,
both fixed before this branch was considered done:

- **The leaf itself wasn't realpath'd.** §2.3's shared `resolveContainment`
  walks up to the nearest *existing ancestor* and realpaths that -- correct
  for `outputRoot`, where the output file usually doesn't exist yet, so only
  a symlinked ancestor *directory* is a real risk. For `inputRoot` the leaf
  is the thing being read and normally already exists, so a symlink planted
  as the file itself (`inputRoot/evil.yml -> /etc/passwd`) sailed through
  the original check untouched. The existing symlink unit test only covered
  a symlinked *directory* (copied case-for-case from the `outputRoot` suite),
  which is exactly why the leaf gap didn't show up sooner. Fixed in
  `assertInputContained` only (not the shared helper, and not
  `assertOutputContained`): when the resolved input exists, it is realpathed
  before being handed to `resolveContainment`, which then walks an
  already-canonical path -- a no-op for it, but closes the gap. Covered by a
  new real-filesystem test (a stub can't demonstrate this; it would just
  assert the mock was written correctly).
- **A fatal containment violation silently swallowed ordinary discovery
  warnings from the same run.** In `main()`, the `containmentViolations`
  check and `process.exit` originally sat *above* the `discovery.warnings`
  reporting loop, so a run with both a missing discovered file and an
  out-of-root one only ever showed the containment error -- exactly the
  fix-and-rerun cycle the "report everything, then exit" philosophy (§2.1,
  §2.4) exists to avoid, and a direct contradiction of the corresponding §4
  test's own name. The test passed anyway because it never asserted the
  warning was present. Fixed by moving the warnings loop above the
  containment check, and the test now asserts both the stdout warning and
  the stderr violation are present in the same run.

### 6.5 Verification

- `bun test`: 646 tests pass (up from 625 before this proposal), including
  5 new declared-input containment tests (`cli-input-safety.test.ts`), 5 new
  discovered-file containment tests (added to `cli-external-references.test.ts`),
  1 new `inputRoot`-does-not-affect-`inputURL` test (added to
  `cli-remote-inputs.test.ts`), and 9 new unit tests for `assertInputContained`
  (added to `path-resolution.test.ts`, mirroring the existing
  `assertOutputContained` suite case-for-case, plus the real-filesystem
  leaf-symlink test from §6.4).
- Lint and typecheck clean in both packages.
- Coverage: `path-resolution.ts` and `index.ts` both 100% functions/lines;
  `external-reference-discovery.ts` 100% functions / 97.98% lines, the one
  uncovered line (a URL-fetch-non-ok-status branch in `loadDocument`)
  pre-dating this proposal and unrelated to it.
- Manual end-to-end smoke tests against the real CLI binary (not the test
  harness) confirmed: a discovered file outside `inputRoot` exits `10` with
  no output written; widening `inputRoot` to cover it succeeds; a declared
  `inputFile` outside `inputRoot` exits `10` before the merge starts, also
  with no output written.
