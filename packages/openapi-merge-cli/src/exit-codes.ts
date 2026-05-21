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
 */
export enum ExitCode {
  Success = 0,
  ErrorLoadingConfig = 1,
  ErrorLoadingInputs = 2,
  ErrorMerging = 3,
  ErrorUncaught = 4,
}
