/**
 * `*`-wildcard pattern matching, shared by every selector that uses it:
 * `includeTags`/`excludeTags` (issue #111) and `includePaths`/`excludePaths`
 * (proposal 43 / PR #67). Kept in one place so escaping and anchoring
 * behaviour cannot quietly drift between the two.
 */

/**
 * `*` matches any run of characters, including none. Nothing else is special.
 *
 * Only `*` is supported -- not `?`, not character classes, not full regular
 * expressions. A tag or a path is a short, literal identifier and `service-*`
 * is the whole of what was ever asked for; accepting regular expressions
 * would make every existing configuration's tags and paths into patterns
 * whose meaning depends on characters people did not know were significant.
 */
export const WILDCARD = '*';

/**
 * Compiles a `*`-wildcard pattern into an anchored `RegExp`.
 *
 * Escapes first, so a value containing regex metacharacters -- `v1.0`,
 * `a+b`, `(beta)`, a path like `/v1.2/status` -- is matched literally, then
 * reintroduces `*` as the one metacharacter. Anchored at both ends:
 * `service-*` must not match `my-service-a`, and `/admin/*` must not match
 * `/other/admin/users`.
 */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.split('\\*').join('.*')}$`);
}
