/**
 * Centralised exit codes for the openapi-merge CLI.
 *
 * IMPORTANT: Exit codes are part of the CLI's public contract — CI
 * pipelines and scripts depend on them. Treat any change to an existing
 * value as a breaking change. New codes MUST be appended with the next
 * unused integer; never re-use a retired code.
 *
 * | Exit Code | Member                        | Meaning                                  |
 * |-----------|-------------------------------|------------------------------------------|
 * | 0         | ExitCode.Success              | Merge succeeded, output written          |
 * | 1         | ExitCode.ErrorLoadingConfig   | Failed to load/parse configuration file  |
 * | 2         | ExitCode.ErrorLoadingInputs   | Failed to load one or more input files   |
 * | 3         | ExitCode.ErrorMerging         | Merge logic failed (conflicts, etc.)     |
 * | 4         | ExitCode.ErrorUncaught        | Uncaught exception during execution      |
 * | 5         | ExitCode.ErrorUnsafePath      | Configured output escaped `outputRoot`   |
 * | 6         | ExitCode.ErrorInputUrlStatus  | An `inputURL` returned a non-2xx status  |
 */
export enum ExitCode {
  Success = 0,
  ErrorLoadingConfig = 1,
  ErrorLoadingInputs = 2,
  ErrorMerging = 3,
  ErrorUncaught = 4,
  ErrorUnsafePath = 5,
  /**
   * An `inputURL` was reachable but the server answered with a non-2xx status.
   *
   * Deliberately distinct from {@link ExitCode.ErrorLoadingInputs}: that code
   * covers an input that could not be obtained at all (missing file, DNS
   * failure, connection refused, unparseable content). This one means the
   * request completed and the server said no -- typically a 404 from a stale
   * URL or a 5xx from a service that is down. The distinction matters in CI,
   * where a 404 usually means "fix the config" and a 5xx means "retry".
   *
   * Named for the status rather than for URLs in general, because a transport
   * level failure fetching the same URL still exits with ErrorLoadingInputs.
   */
  ErrorInputUrlStatus = 6,
}
