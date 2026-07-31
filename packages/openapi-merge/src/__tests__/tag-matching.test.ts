import { TagMatcher } from '../tag-matching';

/**
 * Wildcard tag matching (issue #111).
 *
 * Unit tests for the matcher itself; operation-selection.test.ts covers it
 * driving a merge. The cases that matter most here are the ones about *not*
 * matching: an anchored pattern, and a tag containing regex syntax.
 */
describe('TagMatcher (issue #111)', () => {
  it('matches an exact tag', () => {
    expect(new TagMatcher(['service-a']).matches('service-a')).toBe(true);
    expect(new TagMatcher(['service-a']).matches('service-b')).toBe(false);
  });

  it('matches a trailing wildcard', () => {
    const matcher = new TagMatcher(['service-*']);

    expect(matcher.matches('service-a')).toBe(true);
    expect(matcher.matches('service-')).toBe(true);
    expect(matcher.matches('other')).toBe(false);
  });

  it('matches a leading wildcard', () => {
    const matcher = new TagMatcher(['*-internal']);

    expect(matcher.matches('billing-internal')).toBe(true);
    expect(matcher.matches('internal-billing')).toBe(false);
  });

  it('matches a wildcard in the middle', () => {
    const matcher = new TagMatcher(['svc-*-v2']);

    expect(matcher.matches('svc-billing-v2')).toBe(true);
    // The `*` may match nothing, but the literal hyphens on both sides of it
    // still have to be there: `svc-*-v2` accepts `svc--v2`, not `svc-v2`.
    expect(matcher.matches('svc--v2')).toBe(true);
    expect(matcher.matches('svc-v2')).toBe(false);
    expect(matcher.matches('svc-billing-v3')).toBe(false);
  });

  it('is anchored at both ends', () => {
    // `service-*` must not match `my-service-a`, or excluding one team's tags
    // would quietly take another team's with it.
    expect(new TagMatcher(['service-*']).matches('my-service-a')).toBe(false);
    expect(new TagMatcher(['*-internal']).matches('billing-internal-v2')).toBe(false);
  });

  it('treats a lone * as matching everything', () => {
    const matcher = new TagMatcher(['*']);

    expect(matcher.matches('anything')).toBe(true);
    expect(matcher.matches('')).toBe(true);
  });

  it('matches a tag containing regex syntax literally', () => {
    // Without escaping, `v1.0` would also match `v1x0`, and `(beta)` would
    // match nothing at all.
    expect(new TagMatcher(['v1.0']).matches('v1.0')).toBe(true);
    expect(new TagMatcher(['v1.0']).matches('v1x0')).toBe(false);
    expect(new TagMatcher(['(beta)']).matches('(beta)')).toBe(true);
    expect(new TagMatcher(['a+b']).matches('a+b')).toBe(true);
    expect(new TagMatcher(['a+b']).matches('aab')).toBe(false);
  });

  it('combines a wildcard pattern with regex syntax', () => {
    const matcher = new TagMatcher(['v1.*']);

    expect(matcher.matches('v1.0')).toBe(true);
    expect(matcher.matches('v1.10')).toBe(true);
    expect(matcher.matches('v1x0')).toBe(false);
  });

  it('matches when any pattern in the list matches', () => {
    const matcher = new TagMatcher(['exact', 'wild-*']);

    expect(matcher.matches('exact')).toBe(true);
    expect(matcher.matches('wild-thing')).toBe(true);
    expect(matcher.matches('neither')).toBe(false);
  });

  it('reports an empty pattern list as empty', () => {
    expect(new TagMatcher([]).isEmpty).toBe(true);
    expect(new TagMatcher(['a']).isEmpty).toBe(false);
    expect(new TagMatcher(['*']).isEmpty).toBe(false);
  });

  it('matchesAny handles an operation with no tags', () => {
    expect(new TagMatcher(['a']).matchesAny(undefined)).toBe(false);
    expect(new TagMatcher(['a']).matchesAny([])).toBe(false);
    expect(new TagMatcher(['a']).matchesAny(['b', 'a'])).toBe(true);
  });
});
