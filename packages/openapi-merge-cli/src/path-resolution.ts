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
 * Error thrown when the (defence-in-depth) `inputRoot` safety knob is set
 * (proposal 38) and a local file the CLI would read -- a declared
 * `inputFile` or one discovered via `resolveExternalReferences` -- escapes
 * that root.
 *
 * Carries the `resolved` and `root` paths separately, mirroring
 * {@link OutputOutsideRootError}, so callers can render a helpful
 * diagnostic without having to parse `.message`.
 */
export class InputOutsideRootError extends Error {
  public readonly resolved: string;

  public readonly root: string;

  constructor(resolved: string, root: string) {
    super(
      `Refusing to read input from '${resolved}': it is outside the configured inputRoot '${root}'. ` +
      `Remove the 'inputRoot' option or move the input inside it.`
    );
    this.name = 'InputOutsideRootError';
    this.resolved = resolved;
    this.root = root;
  }
}

/**
 * The realpath-based containment algorithm shared by {@link assertOutputContained}
 * and {@link assertInputContained} (proposal 38 §2.3): given a resolved path
 * and a root, determine whether the path lies inside the root, defeating
 * symlink-out-of-jail tricks by re-anchoring on the realpath of the nearest
 * *existing* ancestor rather than trusting the lexical path.
 *
 * Neither the path nor the root need exist yet -- the walk climbs to
 * whatever part of the chain does exist before calling `realpathSync`, since
 * that is the only part an attacker could have planted a symlink in.
 */
function resolveContainment(
  resolvedPath: string,
  root: string,
  realpathSync: (p: string) => string,
  exists: (p: string) => boolean
): { realResolved: string; realRoot: string; escapes: boolean } {
  const rootAbsolute = path.resolve(root);
  const rootReal = exists(rootAbsolute) ? realpathSync(rootAbsolute) : rootAbsolute;

  const parent = path.dirname(resolvedPath);
  let existingAncestor = parent;
  while (!exists(existingAncestor) && existingAncestor !== path.dirname(existingAncestor)) {
    existingAncestor = path.dirname(existingAncestor);
  }
  const ancestorReal = exists(existingAncestor) ? realpathSync(existingAncestor) : existingAncestor;

  const suffix = path.relative(existingAncestor, resolvedPath);
  const realResolved = path.resolve(ancestorReal, suffix);

  const rel = path.relative(rootReal, realResolved);
  const escapes = rel.startsWith('..') || path.isAbsolute(rel);

  return { realResolved, realRoot: rootReal, escapes };
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

  const { realResolved, realRoot, escapes } = resolveContainment(resolvedOutput, outputRoot, realpathSync, exists);
  if (escapes) {
    throw new OutputOutsideRootError(realResolved, realRoot);
  }

  return resolvedOutput;
}

/**
 * Defence-in-depth check (proposal 38, the read-side counterpart to
 * {@link assertOutputContained}): when the user has set `inputRoot` (or the
 * `--restrict-input-to` CLI flag), reject any resolved local-file path the
 * CLI would read that lies outside that directory -- whether a declared
 * `inputFile` or a file discovered via `resolveExternalReferences`.
 *
 * Same realpath-based ancestor-walk as `assertOutputContained`, but with one
 * difference the read/write asymmetry actually requires: an output usually
 * does not exist yet, so `assertOutputContained` only needs to realpath its
 * *parent* to defeat a directory-level symlink. An input, by contrast, is
 * the thing about to be read and normally does exist -- so a symlink planted
 * as the leaf itself (`inputRoot/evil.yml -> /etc/passwd`) has to be
 * defeated too, not just a symlinked ancestor directory. When the resolved
 * input exists, it is realpathed *before* the ancestor walk runs; the walk
 * then operates on an already-canonical path, which is a no-op for it but
 * closes the leaf-symlink gap the output-side check doesn't need to close.
 *
 * If `inputRoot` is `undefined`, this function is a no-op. Existing users
 * see no change.
 *
 * Throws `InputOutsideRootError` on violation. Returns the resolved input
 * path unchanged on success.
 */
export function assertInputContained(
  resolvedInput: string,
  inputRoot: string | undefined,
  realpathSync: (p: string) => string = fs.realpathSync,
  exists: (p: string) => boolean = fs.existsSync
): string {
  if (inputRoot === undefined) {
    return resolvedInput;
  }

  const target = exists(resolvedInput) ? realpathSync(resolvedInput) : resolvedInput;
  const { realResolved, realRoot, escapes } = resolveContainment(target, inputRoot, realpathSync, exists);
  if (escapes) {
    throw new InputOutsideRootError(realResolved, realRoot);
  }

  return resolvedInput;
}
