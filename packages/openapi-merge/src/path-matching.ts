import { patternToRegExp } from './wildcard-matching';

/**
 * One `includePaths`/`excludePaths` entry (proposal 43 / PR #67).
 *
 * `path` supports the same `*` wildcard as `includeTags`/`excludeTags`
 * (issue #111, `wildcard-matching.ts`) -- an author who already knows one
 * already knows the other. `method` omitted means "every method on this
 * path"; given as a plain string (not restricted to the nine standard verbs)
 * so a 3.2 `additionalOperations` custom verb (`PURGE`, `LOCK`, ...) can be
 * selected too, matched case-sensitively to agree with how custom verbs are
 * already treated everywhere else in this codebase (`merge-path-items.ts`).
 * A standard method's own key is always lowercase (`get`, not `GET`), since
 * that is what an OpenAPI document itself declares.
 */
export type PathSelector = {
  path: string;
  method?: string | ReadonlyArray<string>;
};

/**
 * A compiled matcher for a list of `PathSelector`s.
 *
 * Unlike `TagMatcher`, there is no exact/wildcard split with a fast-path
 * `Set`: each selector optionally carries its own method constraint, so the
 * lookup is never a flat set of comparable strings the way tags are.
 */
export class PathMatcher {
  private readonly selectors: ReadonlyArray<{ pattern: RegExp; methods: ReadonlySet<string> | undefined }>;

  public constructor(selectors: ReadonlyArray<PathSelector>) {
    this.selectors = selectors.map(selector => ({
      pattern: patternToRegExp(selector.path),
      methods: selector.method === undefined
        ? undefined
        : new Set(Array.isArray(selector.method) ? selector.method : [selector.method]),
    }));
  }

  public get isEmpty(): boolean {
    return this.selectors.length === 0;
  }

  public matches(path: string, method: string): boolean {
    return this.selectors.some(({ pattern, methods }) => pattern.test(path) && (methods === undefined || methods.has(method)));
  }
}
