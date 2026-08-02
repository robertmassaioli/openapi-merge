import { WILDCARD, patternToRegExp } from './wildcard-matching';

/**
 * Tag matching for `includeTags` and `excludeTags`, with `*` wildcards
 * (issue #111).
 *
 * Selection was exact-match, so a team with `service-a`, `service-b`, … had to
 * enumerate every tag and remember to update the configuration whenever one was
 * added. Forgetting silently includes or excludes the wrong operations, which
 * is the failure mode the tag mechanism exists to prevent.
 *
 * The wildcard syntax and its escaping/anchoring rules live in
 * `wildcard-matching.ts`, shared with `PathMatcher` (proposal 43).
 */

/**
 * A compiled matcher for a list of tag patterns.
 *
 * Patterns without a `*` are kept in a Set and matched by equality, so the
 * overwhelmingly common case costs no more than it did before this feature and
 * behaves identically -- including for a tag that happens to contain regex
 * syntax.
 */
export class TagMatcher {
  private readonly exact: Set<string>;
  private readonly patterns: RegExp[];

  public constructor(tagPatterns: ReadonlyArray<string>) {
    this.exact = new Set(tagPatterns.filter(pattern => !pattern.includes(WILDCARD)));
    this.patterns = tagPatterns.filter(pattern => pattern.includes(WILDCARD)).map(patternToRegExp);
  }

  public get isEmpty(): boolean {
    return this.exact.size === 0 && this.patterns.length === 0;
  }

  public matches(tag: string): boolean {
    return this.exact.has(tag) || this.patterns.some(pattern => pattern.test(tag));
  }

  public matchesAny(tags: ReadonlyArray<string> | undefined): boolean {
    return tags !== undefined && tags.some(tag => this.matches(tag));
  }
}
