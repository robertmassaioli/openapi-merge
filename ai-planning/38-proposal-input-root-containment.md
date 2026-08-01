# Proposal 38: `inputRoot` — a read-side containment boundary for local files

**Status:** Proposal (not yet implemented)

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
 * Declared inputs outside `inputRoot` are a config error: the merge never
 * starts, and every offending input is reported at once (the same
 * report-everything-then-exit shape `ErrorLoadingInputs` already uses).
 * Discovered files outside `inputRoot` are treated the same way a discovery
 * load failure already is: a warning, the referencing `$ref` left
 * unresolved, the merge proceeds. The distinction matters because a
 * declared input is something the config author wrote and is responsible
 * for; a discovered file is named by a `$ref` inside a document the config
 * author may not have authored themselves.
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

**Declared inputs — eager, before any merge work starts.** Resolve every
`inputFile`'s full path up front (this already happens once per input) and
check containment before `loadOasForInput` reads anything. Collect *every*
violating input, not just the first — matching `ErrorLoadingInputs`'s
existing "all inputs are attempted before exiting" philosophy
(`exit-codes.ts:62-63`), so a config with three bad `inputFile` entries
doesn't require three separate fix-and-rerun cycles. On any violation, exit
before the merge is attempted at all.

**Discovered files — soft, per-file, during the breadth-first walk.** Inside
`discoverExternalDocuments`'s worklist loop (`external-reference-discovery.ts:171-194`),
check containment immediately before `loadDocument` for a `kind: 'file'`
reference. A violation becomes a `DiscoveryWarning` with a message that
names the file and the configured root — reusing the exact shape
already used for "file does not exist" and "file fails to parse" — and the
referencing `$ref` is left unresolved, exactly as it would be for a missing
file. This is a deliberate asymmetry from the declared-input case: one
adversarial or careless `$ref` inside a *discovered* document — which the
config author did not necessarily write — should not abort an otherwise
successful merge of everything else. The security property that matters is
that the file is never read, not that the whole run dies; both the warning
path and the hard-fail path satisfy that.

### 2.5 New exit code

Append `ErrorUnsafeInputPath = 10` (do not reuse `ErrorUnsafePath` — that
code's TSDoc is specifically about the *output* escaping its root, and CI
scripts branching on exit codes need the two directions to stay
distinguishable, same reasoning that kept the three `ErrorInputUrl*Status`
codes separate from each other). Fires only for the declared-input case
(§2.4); discovered-file violations exit `0` with a warning already printed,
same as any other discovery failure.

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
  set, a discovered file outside the root — merge succeeds, a warning names
  the file, the `$ref` is left unresolved (reusing the existing missing-file
  test's assertion shape).
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
