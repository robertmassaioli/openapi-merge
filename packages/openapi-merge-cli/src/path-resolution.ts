import fs from 'fs';
import path from 'path';

/**
 * Resolve a user-supplied path (from the configuration or a CLI flag) against
 * the directory the configuration file lives in.
 *
 * Behaviour:
 *   - Absolute `userPath`s are returned unchanged (after normalisation).
 *   - Relative `userPath`s are resolved relative to `basePath`.
 *   - The returned value is always an absolute path.
 *
 * `path.resolve()` is used (NOT `path.join()`) because `path.join('/a', '/b')`
 * incorrectly produces `'/a/b'` instead of `'/b'` — that is the original bug
 * behind issue #93.
 *
 * The implementation is intentionally trivial; the value of this helper is
 * that there is now ONE call site to test, and the rest of the CLI delegates
 * to it. See the matching Jest suite in `__tests__/path-resolution.test.ts`.
 */
export function resolveConfigPath(basePath: string, userPath: string): string {
  return path.resolve(basePath, userPath);
}

/**
 * Error thrown when the (defence-in-depth) `outputRoot` safety knob is set
 * and the resolved output path escapes that root.
 *
 * Carries the `resolved` and `root` paths separately so callers can render a
 * helpful diagnostic without having to parse `.message`.
 */
export class OutputOutsideRootError extends Error {
  public readonly resolved: string;

  public readonly root: string;

  constructor(resolved: string, root: string) {
    super(
      `Refusing to write output to '${resolved}': it is outside the configured outputRoot '${root}'. ` +
      `Remove the 'outputRoot' option or move the output inside it.`
    );
    this.name = 'OutputOutsideRootError';
    this.resolved = resolved;
    this.root = root;
  }
}

/**
 * Defence-in-depth check (issue #93 Security Considerations): when the user
 * has set `outputRoot` (or the `--restrict-output-to` CLI flag), reject any
 * resolved output path that lies outside that directory.
 *
 * To defeat symlink-out-of-jail, the containment check is performed against
 * the *realpath* of the existing parent directory of the resolved output, not
 * against the lexical path. If the parent directory does not exist yet (the
 * user is writing to a new sub-directory), we walk up to the closest existing
 * ancestor before calling `realpathSync` — only that part of the chain can
 * contain a symlink an attacker might have planted.
 *
 * If `outputRoot` is `undefined`, this function is a no-op. Existing users
 * see no change.
 *
 * Throws `OutputOutsideRootError` on violation. Returns the resolved output
 * path unchanged on success.
 */
export function assertOutputContained(
  resolvedOutput: string,
  outputRoot: string | undefined,
  realpathSync: (p: string) => string = fs.realpathSync,
  exists: (p: string) => boolean = fs.existsSync
): string {
  if (outputRoot === undefined) {
    return resolvedOutput;
  }

  const rootAbsolute = path.resolve(outputRoot);
  const rootReal = exists(rootAbsolute) ? realpathSync(rootAbsolute) : rootAbsolute;

  // Walk up from the output's parent to the first existing ancestor; that is
  // the deepest path the attacker can have influenced via a symlink.
  const outputParent = path.dirname(resolvedOutput);
  let existingAncestor = outputParent;
  while (!exists(existingAncestor) && existingAncestor !== path.dirname(existingAncestor)) {
    existingAncestor = path.dirname(existingAncestor);
  }
  const ancestorReal = exists(existingAncestor) ? realpathSync(existingAncestor) : existingAncestor;

  // Re-anchor the resolved output onto the realpath'd ancestor.
  const suffix = path.relative(existingAncestor, resolvedOutput);
  const realResolved = path.resolve(ancestorReal, suffix);

  // Containment: realResolved must equal rootReal or live underneath it.
  const rel = path.relative(rootReal, realResolved);
  const escapes = rel.startsWith('..') || path.isAbsolute(rel);
  if (escapes) {
    throw new OutputOutsideRootError(realResolved, rootReal);
  }

  return resolvedOutput;
}
