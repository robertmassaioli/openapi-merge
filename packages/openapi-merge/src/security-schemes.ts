/**
 * How `components.securitySchemes` is combined across inputs (issue #33).
 *
 * Unlike the other component buckets, this one has a defensible argument on
 * both sides, which is why it is configurable rather than simply fixed:
 *
 * - Merging is what the other nine buckets do, and it is what makes a later
 *   input's operations resolvable — an operation requiring `oauth2` in a
 *   document that does not define `oauth2` is invalid.
 * - Taking only the first input's schemes is what an API gateway wants: the
 *   gateway owns authentication, and a backend's own scheme definitions are an
 *   implementation detail that must not leak into the published document. That
 *   is the same reasoning that makes `serversStrategy` default to `'first'`.
 */
export type SecuritySchemesStrategy =
  /**
   * Take the schemes from the first input that declares any, and drop the rest.
   *
   * The behaviour before issue #33. Correct for the API-gateway case, and
   * wrong for anyone merging peer services: a later input's operations survive
   * while the schemes they require do not, producing a document that references
   * a scheme it never defines.
   */
  | 'first'
  /**
   * Combine them, exactly as every other component bucket is combined:
   * identical definitions collapse, differing ones are renamed using the
   * input's dispute prefix or a numeric suffix, and every security requirement
   * naming a renamed scheme is rewritten to match.
   */
  | 'merge'
  /**
   * Combine them, but refuse when two inputs define the same scheme name
   * differently.
   *
   * For people who would rather be told than have `oauth2` and `oauth21`
   * silently appear in their output. Identical definitions still collapse
   * quietly — that is not a conflict, it is agreement.
   */
  | 'error';

/**
 * `'merge'`.
 *
 * Deliberately not `'first'`, which would preserve the old behaviour: that
 * behaviour produces **invalid documents**, and issue #33 is filed as a bug
 * rather than a preference. A default that keeps emitting a document whose
 * operations reference undefined schemes would leave the bug unfixed for
 * everyone who does not read the changelog.
 *
 * `'first'` remains one word away for anyone who wants it, and the
 * API-gateway case that wants it is real.
 */
export const DEFAULT_SECURITY_SCHEMES_STRATEGY: SecuritySchemesStrategy = 'merge';
