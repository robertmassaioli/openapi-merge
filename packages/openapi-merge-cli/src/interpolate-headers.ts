/**
 * Environment-variable interpolation for `inputURL` request headers (issue #61).
 *
 * A credential must not be written into a configuration file that gets
 * committed, so header values may reference the environment as `${VAR}` and are
 * resolved at load time.
 */

const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export class MissingEnvironmentVariableError extends Error {
  public constructor(public readonly variableNames: string[]) {
    super(
      `The following environment variable${variableNames.length === 1 ? ' is' : 's are'} referenced by input headers but not set: ` +
        `${variableNames.join(', ')}. Set ${variableNames.length === 1 ? 'it' : 'them'} before running the merge.`,
    );
  }
}

/**
 * Resolves every `${VAR}` in a header map against `env`.
 *
 * Throws when a referenced variable is unset, rather than substituting an empty
 * string. An empty `Authorization: Bearer ` header produces a 401 that looks
 * like a credentials problem on the server's side; failing here names the
 * actual cause, which is a variable the caller forgot to export.
 *
 * Every missing variable is reported at once, so a caller with three unset
 * tokens learns all three on the first run instead of one per attempt.
 */
export function interpolateHeaders(
  headers: Record<string, string>,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const missing = new Set<string>();

  const resolved = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      value.replace(ENV_REFERENCE, (_match, variableName: string) => {
        const replacement = env[variableName];
        if (replacement === undefined) {
          missing.add(variableName);
          return '';
        }
        return replacement;
      }),
    ]),
  );

  if (missing.size > 0) {
    throw new MissingEnvironmentVariableError([...missing]);
  }

  return resolved;
}
