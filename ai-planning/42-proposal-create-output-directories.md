# Implementation Proposal: Create Missing Output Directories

**Status:** Proposal
**Type:** CLI feature, improving on [PR #88](https://github.com/robertmassaioli/openapi-merge/pull/88)
**Scope:** `packages/openapi-merge-cli/src/index.ts`, `exit-codes.ts`, README
**Date:** 2026-08-02

---

## 0. TL;DR

[PR #88](https://github.com/robertmassaioli/openapi-merge/pull/88) adds four
lines to `writeOutput()`:

```typescript
const outputDir = path.dirname(outputFullPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
```

The idea is right — the CLI's own README example (`"output":
"./dist/service.output.swagger.json"`) already assumes a subdirectory the
tool does not create, and today's test suite proves the gap: `cli-output-
safety.test.ts`'s "succeeds when the output stays inside outputRoot" case has
to `fs.mkdirSync(path.join(cli.dir(), 'dist'))` itself before running the
CLI, because the CLI won't. The mechanism has three problems, all invisible
at the size of change in #88:

1. **`fs.mkdirSync(dir)` is not recursive.** It creates exactly one missing
   directory. `output: "./a/b/c/out.json"` where none of `a`, `b`, `c` exist
   throws `ENOENT: no such file or directory, mkdir '.../a'` — actually,
   worse: it throws trying to create `c` inside a non-existent `b` inside a
   non-existent `a`, i.e. it still fails for the exact multi-level case a
   user is most likely to hit (`./dist/output.json` when `dist/` itself
   sits inside a package that hasn't been scaffolded yet).
2. **The failure is uncaught.** Any `mkdirSync`/`writeFileSync` error —
   permission denied, a path component that's an existing *file* rather
   than a directory, a read-only filesystem — propagates out of `main()` as
   a raw exception with a Node stack trace, exits `4`
   (`ExitCode.ErrorUncaught`, "please report this as a bug in
   openapi-merge"), and tells the user nothing about what to fix. Every
   other failure mode this CLI has gets a specific exit code and a
   one-line, actionable message; this one wouldn't.
3. **No test coverage.** #88 ships with none, so the recursive case and the
   error path above are both unverified.

This proposal keeps the idea — auto-create the output directory, no new
config flag — and fixes all three: `{ recursive: true }`, a dedicated exit
code with a clear message, and the tests that would have caught 1 and 2.

## 1. Current Behaviour

`writeOutput()` (`packages/openapi-merge-cli/src/index.ts:361`) calls
`fs.writeFileSync(outputFullPath, fileContents)` directly. If any directory
in `outputFullPath`'s ancestry is missing, this throws `ENOENT`, which is not
caught anywhere in `main()` — it becomes `ExitCode.ErrorUncaught` via the
top-level handler in `cli.ts`.

The check that runs immediately before it, `assertOutputContained()`
(`path-resolution.ts:128`), already walks up from `outputFullPath` to find
the closest *existing* ancestor, specifically because it has to handle the
"user is writing to a new subdirectory" case for its own containment
check (§3.2 below leans on this same walk).

## 2. Design

### 2.1 Recursive creation, after the containment check

```typescript
function writeOutput(outputFullPath: string, outputSchema: OpenApiDocument, indent: Indent = DEFAULT_INDENT): void {
  const fileContents = isYamlExtension(outputFullPath)
    ? dumpAsYaml(outputSchema, indent)
    : JSON.stringify(outputSchema, null, indentToJsonStringifyArg(indent));

  fs.mkdirSync(path.dirname(outputFullPath), { recursive: true });
  fs.writeFileSync(outputFullPath, fileContents);
}
```

`{ recursive: true }` fixes problem 1 outright — it creates every missing
ancestor in one call — and is also a no-op (no throw) when the directory
already exists, so the `fs.existsSync` guard in #88 was never needed even
for the one-level case.

This must run **after** `assertOutputContained` in `main()`, which it already
does positionally (`writeOutput` is called at line 506, well after the
containment check at line 492-501). That ordering is load-bearing, not
incidental: `assertOutputContained` proves `outputFullPath` resolves inside
`outputRoot` *before* anything on disk changes. Every directory
`mkdirSync(..., { recursive: true })` would create is an ancestor of that
already-validated path and a descendant of the already-validated closest
existing ancestor — so it cannot land outside `outputRoot` by construction.
No new call to the containment check is needed for the directories
themselves.

(The same defense-in-depth caveat that already applies to `writeFileSync`
today applies here unchanged: this is a check against a less-trusted
*configuration*, not a defense against a concurrent attacker racing the
filesystem between the check and the write. Introducing `mkdirSync` in
between doesn't widen that gap — nothing it creates is attacker-influenced
that wasn't already covered by the realpath walk in `resolveContainment`.)

### 2.2 A dedicated exit code instead of falling through to `ErrorUncaught`

Every other failure category in this CLI — bad config, bad input, merge
conflict, unsafe path, bad OpenAPI version — gets its own `ExitCode` and a
clean one-line message (see `exit-codes.ts`). Directory creation failing
(permissions, a path component that's an existing file, a read-only
filesystem) is exactly that kind of user-actionable, non-bug failure, so it
should not masquerade as `ErrorUncaught`, which explicitly tells users
"please report it with the stack trace" — the wrong message for "you don't
have write permission to `/etc`".

New code, appended per the file's own numbering rule:

```typescript
/**
 * The output directory could not be created.
 *
 * Fires when a directory in the resolved output path's ancestry is missing
 * and creating it fails -- most commonly a permissions error, a read-only
 * filesystem, or a path component that already exists as a regular file
 * (e.g. `output: './build.json/nested/out.json'` where `build.json` is a
 * file). Distinguished from `ErrorUnsafePath`: that code means the path was
 * refused outright; this one means it was allowed and the filesystem then
 * refused to cooperate.
 */
ErrorCreatingOutputDirectory = 11,
```

`writeOutput`'s `mkdirSync` call is wrapped narrowly (not the
`writeFileSync` that follows it, which keeps its own uncaught-exception
behaviour — a write failure after the directory exists is a different,
rarer class of problem this proposal isn't trying to categorize):

```typescript
try {
  fs.mkdirSync(path.dirname(outputFullPath), { recursive: true });
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  throw new OutputDirectoryCreationError(path.dirname(outputFullPath), message);
}
```

with `main()` catching `OutputDirectoryCreationError` the same way it
already catches `OutputOutsideRootError`:

```typescript
} catch (e) {
  if (e instanceof OutputDirectoryCreationError) {
    console.error(e.message);
    process.exit(ExitCode.ErrorCreatingOutputDirectory);
    return;
  }
  throw e;
}
```

`OutputDirectoryCreationError` lives in `path-resolution.ts` alongside
`OutputOutsideRootError`/`InputOutsideRootError`, matching the file's
existing pattern of one typed error per failure class with a
pre-formatted, user-facing `.message`.

### 2.3 No new configuration flag

#88's framing — "many tools allow writing to non-existing directories" — is
right that this should be the default, not opt-in. There's no safety
argument for gating it behind a flag: §2.1 shows the directories created are
already bounded by `outputRoot`/`--restrict-output-to` when those are set,
and when neither is set the CLI already writes anywhere on the filesystem
the user points it at — auto-creating a directory in that same, already-
unrestricted case adds no new capability. Keeping this un-flagged also
means the fix is a patch release, not a config-schema change.

## 3. Testing Strategy

Extends `cli-output-safety.test.ts`, next to the existing outputRoot
coverage, plus one addition to `cli-output.test.ts` for the plain
happy-path case:

| Case | Asserts |
| --- | --- |
| `output: './dist/output.json'`, `dist/` does not exist | Exit `Success`; `dist/output.json` exists — replaces the manual `fs.mkdirSync` the current "succeeds when the output stays inside outputRoot" test does for itself |
| `output: './a/b/c/output.json'`, none of `a`/`b`/`c` exist | Exit `Success`; the full nested path is created — the case #88's non-recursive `mkdirSync` cannot handle |
| `output` directory already exists | Exit `Success`, unchanged — proves the recursive call is a safe no-op |
| A path component is an existing **file**, e.g. `output: './notadir/output.json'` where `notadir` is a file | Exit `ErrorCreatingOutputDirectory`; stderr names the offending path and the underlying reason |
| Nested output still honours `outputRoot` | `output: '../escaped/output.json'` with `outputRoot: '.'` still exits `ErrorUnsafePath`, proving directory creation doesn't run before or bypass the existing containment check |

The last row is the regression test for §2.1's ordering argument — it's the
one a reviewer should look for first, since silently reordering the
`mkdirSync` ahead of `assertOutputContained` is the most likely way this
proposal itself could be implemented wrong later.

## 4. Documentation

- `packages/openapi-merge-cli/README.md`: a one-line note near the `output`
  field description — missing directories in `output` are created
  automatically (mirroring how `outputRoot`/`--restrict-output-to` are
  documented immediately after it).
- `exit-codes.ts`'s doc comment table gets its new row; `AGENTS.md`'s exit
  code references, if any, updated to match (checked: none currently
  enumerate individual codes, so no change needed there beyond the new code
  existing).

## 5. Effort

| Task | Effort |
| --- | --- |
| `ErrorCreatingOutputDirectory` exit code + `OutputDirectoryCreationError` | 30 min |
| `writeOutput`/`main()` changes | 30 min |
| Tests (table in §3) | 1 hour |
| README | 15 min |
| **Total** | **~2.5 hours** |

## 6. Non-goals

- A config flag to opt out of auto-creation. Nobody has asked for that, and
  §2.3 argues it adds no safety value given the existing containment model.
- Creating the directory for the `outputRoot`/`--restrict-input-to` flags
  themselves if *those* don't exist — they're boundaries the user asserts
  already exist (or don't, in which case containment trivially holds/fails
  against their lexical path); auto-creating a jail the user named but
  never made would be a much larger behavioural change than "the output
  file's own directory."
- Retrying or otherwise handling transient filesystem errors. One attempt,
  clean failure, matching every other exit path in this CLI.
