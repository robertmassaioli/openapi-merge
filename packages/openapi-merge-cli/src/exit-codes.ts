/**
 * Centralised exit codes for the openapi-merge CLI.
 *
 * IMPORTANT: Exit codes are part of the CLI's public contract — CI
 * pipelines and scripts depend on them. Treat any change to an existing
 * value as a breaking change. New codes MUST be appended with the next
 * unused integer; never re-use a retired code.
 *
 * Every member is pinned by `src/__tests__/exit-codes.test.ts`, so renumbering
 * one fails the build rather than someone's pipeline.
 *
 * | Exit Code | Member                                 | Meaning                                  |
 * |-----------|----------------------------------------|------------------------------------------|
 * | 0         | ExitCode.Success                       | Merge succeeded, output written          |
 * | 1         | ExitCode.ErrorLoadingConfig            | Failed to load/parse configuration file  |
 * | 2         | ExitCode.ErrorLoadingInputs            | Failed to load one or more input files   |
 * | 3         | ExitCode.ErrorMerging                  | Merge logic failed (conflicts, etc.)     |
 * | 4         | ExitCode.ErrorUncaught                 | Uncaught exception during execution      |
 * | 5         | ExitCode.ErrorUnsafePath               | Configured output escaped `outputRoot`   |
 * | 6         | ExitCode.ErrorInputUrlClientStatus     | An `inputURL` returned 4xx               |
 * | 7         | ExitCode.ErrorInputUrlServerStatus     | An `inputURL` returned 5xx               |
 * | 8         | ExitCode.ErrorInputUrlUnexpectedStatus | `inputURL` non-2xx, neither 4xx nor 5xx  |
 * | 9         | ExitCode.ErrorOpenApiVersion           | Input version unsupported or inconsistent |
 * | 10        | ExitCode.ErrorUnsafeInputPath          | A local file read escaped `inputRoot`    |
 */
export enum ExitCode {
  /**
   * The merge completed and the output file was written.
   *
   * Zero is the only code that means "nothing went wrong", per the POSIX
   * convention that shells rely on for `&&` chaining. Note that a successful
   * merge can still be *surprising* -- inputs whose paths were renamed to
   * resolve conflicts, for instance -- so a script that cares about the shape
   * of the result should inspect the output file, not just the exit code.
   */
  Success = 0,

  /**
   * The configuration file could not be found, read, parsed, or validated.
   *
   * Covers the whole config-loading stage: a missing `openapi-merge.yaml` (or,
   * as a fallback, `openapi-merge.json`), a file that is neither valid JSON
   * nor valid YAML, a document that fails the generated JSON Schema, and the
   * cross-field semantic checks that the schema cannot express (currently: tab
   * indentation paired with a YAML output).
   *
   * Nothing has been read or written by the time this fires, so it is always
   * safe to retry after fixing the config.
   */
  ErrorLoadingConfig = 1,

  /**
   * An input could not be obtained or understood.
   *
   * This is the transport-and-parsing bucket: a missing `inputFile`, a DNS
   * failure or refused connection for an `inputURL`, or content that parses as
   * neither JSON nor YAML. The defining characteristic is that the CLI never
   * got a usable document.
   *
   * Contrast the `ErrorInputUrl*Status` codes below, which mean the server did
   * answer and refused. A network-level failure fetching a URL lands here, not
   * there.
   *
   * All inputs are attempted before exiting, so every failure is reported even
   * though only one code can be returned.
   */
  ErrorLoadingInputs = 2,

  /**
   * The inputs loaded, but they could not be combined into one document.
   *
   * Raised by the merge library rather than the CLI: duplicate paths across
   * inputs, an `operationId` conflict that no `dispute` setting could resolve,
   * a component that could not be deduplicated, or a cross-document `$ref`
   * chain that refers back to itself. The message names the offending
   * element and the input index it came from.
   *
   * These are authoring problems, not transient ones -- retrying without
   * changing the inputs or the `dispute` configuration produces the same
   * result.
   */
  ErrorMerging = 3,

  /**
   * An exception escaped the CLI's own error handling.
   *
   * The safety net, installed in `cli.ts` as both a `.catch` on `main()` and
   * `process.on('uncaughtException'/'unhandledRejection')` handlers. It exists
   * so that a crash cannot masquerade as success: without it, an exception
   * thrown outside the awaited promise chain would leave the process exiting 0
   * with no output written.
   *
   * Seeing this code means a bug in openapi-merge, not a problem with your
   * configuration -- please report it with the stack trace that was printed.
   */
  ErrorUncaught = 4,

  /**
   * The resolved output path lies outside the configured output root.
   *
   * Fires when `outputRoot` (config) or `--restrict-output-to` (flag, which
   * takes precedence) is set and the merged output would be written somewhere
   * outside it. Intended for contexts where the configuration file is less
   * trusted than the process running it.
   *
   * The check realpaths the closest existing ancestor of the output before
   * comparing, so a symlink pointing out of the jail does not defeat it. The
   * failure happens before any write: no partial or misplaced file is left
   * behind.
   */
  ErrorUnsafePath = 5,

  /**
   * An `inputURL` responded with a 4xx status.
   *
   * The request reached the server and the server rejected it: a `404` from a
   * URL that has moved, a `401`/`403` from a spec behind authentication, a
   * `410` from one that has been retired. The fault is on the request side, so
   * **retrying is pointless** -- the configuration or the credentials need to
   * change.
   *
   * Split from {@link ExitCode.ErrorInputUrlServerStatus} precisely so that CI
   * can act on that difference: this code should fail a pipeline permanently,
   * where a 5xx might justify a retry.
   */
  ErrorInputUrlClientStatus = 6,

  /**
   * An `inputURL` responded with a 5xx status.
   *
   * The request was well-formed but the server failed to honour it: a `500`
   * from a service that has fallen over, a `502`/`503` from a gateway while
   * the upstream restarts. The fault is on the server side, so this is the one
   * URL failure that is plausibly **transient and worth retrying**.
   *
   * A pipeline that merges specs published by other teams will see this during
   * their deployments; treating it as a retryable failure rather than a hard
   * one is usually correct.
   */
  ErrorInputUrlServerStatus = 7,

  /**
   * An `inputURL` responded with a non-2xx status that is neither 4xx nor 5xx.
   *
   * Rare, because ordinary redirects (301, 302, 303, 307, 308) are followed
   * automatically and never surface here. What does surface is a `304 Not
   * Modified` -- returned when a caching proxy sits in front of the spec and
   * the request carried validation headers -- and any other status outside the
   * 2xx range that the two buckets above do not claim.
   *
   * Treated as its own code rather than folded into the 4xx or 5xx cases
   * because neither "your request was wrong" nor "the server is unwell" is
   * accurate, and guessing would send CI down the wrong path. If you hit this,
   * the printed status is the thing worth reading.
   */
  ErrorInputUrlUnexpectedStatus = 8,

  /**
   * An input declared an OpenAPI version this tool cannot merge, declared none
   * at all, or the inputs did not agree on a single `major.minor` version.
   *
   * Separate from {@link ExitCode.ErrorMerging} because the remedy is entirely
   * different and lives outside this tool: `3` means the documents genuinely
   * conflict and the merge configuration needs to change, whereas `9` means the
   * documents were never eligible to be merged together and the *inputs* need
   * to change -- convert them to one version, or upgrade openapi-merge.
   *
   * Before this code existed the tool merged such inputs anyway, under 3.0
   * assumptions, silently dropping everything it did not recognise and exiting
   * 0. A loud failure here is the entire point.
   */
  ErrorOpenApiVersion = 9,

  /**
   * A local file the CLI would read lies outside the configured `inputRoot`.
   *
   * Fires when `inputRoot` (config) or `--restrict-input-to` (flag, which
   * takes precedence) is set and either a declared `inputFile` or a file
   * discovered via `resolveExternalReferences` resolves to somewhere outside
   * it. The read-side counterpart to {@link ExitCode.ErrorUnsafePath}: kept
   * as its own code rather than reused, since a script branching on exit
   * codes needs "output escaped its root" and "input escaped its root" to
   * stay distinguishable.
   *
   * Every violation found -- declared and discovered alike -- is reported
   * together before exiting, matching {@link ExitCode.ErrorLoadingInputs}'s
   * report-everything-then-exit shape. The offending file is never read: the
   * check runs before the attempt, not after a failed one.
   *
   * Same realpath-based symlink defence as `ErrorUnsafePath`: the check
   * re-anchors on the realpath of the closest existing ancestor before
   * comparing, so a symlink pointing out of the jail does not defeat it.
   */
  ErrorUnsafeInputPath = 10,
}
