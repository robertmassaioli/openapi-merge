import { PathMatcher } from '../path-matching';

/**
 * Wildcard path matching (proposal 43 / PR #67).
 *
 * Unit tests for the matcher itself; operation-selection.test.ts covers it
 * driving a merge. Mirrors tag-matching.test.ts's coverage, since both share
 * the same wildcard-matching.ts primitive -- the cases that matter most here
 * are the ones about *not* matching: an anchored pattern, and a path
 * containing regex syntax.
 */
describe('PathMatcher (proposal 43 / PR #67)', () => {
  it('matches an exact path with no method constraint', () => {
    const matcher = new PathMatcher([{ path: '/users' }]);

    expect(matcher.matches('/users', 'get')).toBe(true);
    expect(matcher.matches('/users', 'post')).toBe(true);
    expect(matcher.matches('/other', 'get')).toBe(false);
  });

  it('matches a trailing wildcard', () => {
    const matcher = new PathMatcher([{ path: '/admin/*' }]);

    expect(matcher.matches('/admin/users', 'get')).toBe(true);
    expect(matcher.matches('/admin/', 'get')).toBe(true);
    expect(matcher.matches('/other', 'get')).toBe(false);
  });

  it('matches a leading wildcard', () => {
    const matcher = new PathMatcher([{ path: '*/internal' }]);

    expect(matcher.matches('/billing/internal', 'get')).toBe(true);
    expect(matcher.matches('/internal/billing', 'get')).toBe(false);
  });

  it('is anchored at both ends', () => {
    // `/admin/*` must not match `/other/admin/users`, or excluding one
    // service's admin paths would quietly take an unrelated path with it.
    const matcher = new PathMatcher([{ path: '/admin/*' }]);

    expect(matcher.matches('/other/admin/users', 'get')).toBe(false);
  });

  it('matches a path containing regex syntax literally', () => {
    // Without escaping, `/v1.2/status` would also match `/v1x2/status`.
    const matcher = new PathMatcher([{ path: '/v1.2/status' }]);

    expect(matcher.matches('/v1.2/status', 'get')).toBe(true);
    expect(matcher.matches('/v1x2/status', 'get')).toBe(false);
  });

  it('constrains to a single method when one is given', () => {
    const matcher = new PathMatcher([{ path: '/admin/users', method: 'get' }]);

    expect(matcher.matches('/admin/users', 'get')).toBe(true);
    expect(matcher.matches('/admin/users', 'delete')).toBe(false);
    expect(matcher.matches('/other', 'get')).toBe(false);
  });

  it('constrains to any of several methods when given a list', () => {
    const matcher = new PathMatcher([{ path: '/admin/users', method: ['get', 'post'] }]);

    expect(matcher.matches('/admin/users', 'get')).toBe(true);
    expect(matcher.matches('/admin/users', 'post')).toBe(true);
    expect(matcher.matches('/admin/users', 'delete')).toBe(false);
  });

  it('matches a 3.2 additionalOperations custom verb by name, case-sensitively', () => {
    const matcher = new PathMatcher([{ path: '/cache', method: 'PURGE' }]);

    expect(matcher.matches('/cache', 'PURGE')).toBe(true);
    expect(matcher.matches('/cache', 'purge')).toBe(false);
  });

  it('matches when any selector in the list matches', () => {
    const matcher = new PathMatcher([{ path: '/exact' }, { path: '/wild/*' }]);

    expect(matcher.matches('/exact', 'get')).toBe(true);
    expect(matcher.matches('/wild/thing', 'get')).toBe(true);
    expect(matcher.matches('/neither', 'get')).toBe(false);
  });

  it('reports an empty selector list as empty', () => {
    expect(new PathMatcher([]).isEmpty).toBe(true);
    expect(new PathMatcher([{ path: '/a' }]).isEmpty).toBe(false);
  });
});
