import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  assertOutputContained,
  OutputOutsideRootError,
  resolveConfigPath,
} from '../path-resolution';

describe('resolveConfigPath', () => {
  it('joins a relative user path onto the base directory', () => {
    const result = resolveConfigPath('/base/dir', 'output.json');
    expect(result).toBe(path.resolve('/base/dir', 'output.json'));
  });

  it('returns absolute user paths unchanged (the original #93 bug)', () => {
    // Cross-platform: build an absolute path the same way Node would.
    const abs = path.resolve('/tmp/result.json');
    const result = resolveConfigPath('/base/dir', abs);
    expect(result).toBe(abs);
  });

  it('normalises relative segments', () => {
    const result = resolveConfigPath('/base/dir', '../sibling/out.json');
    expect(result).toBe(path.resolve('/base/sibling/out.json'));
  });

  it('handles a "." base path (the default when --config is omitted)', () => {
    const result = resolveConfigPath('.', 'result.json');
    expect(result).toBe(path.resolve('.', 'result.json'));
  });
});

describe('assertOutputContained', () => {
  it('is a no-op when outputRoot is undefined', () => {
    const out = path.resolve('/anywhere/at/all.json');
    expect(assertOutputContained(out, undefined)).toBe(out);
  });

  it('accepts an output exactly at the root', () => {
    const root = path.resolve('/root');
    const out = path.resolve('/root');
    // Stubbed fs callbacks: pretend the root and parent both exist and are not symlinks.
    const realpath = (p: string): string => p;
    const exists = (): boolean => true;
    expect(assertOutputContained(out, root, realpath, exists)).toBe(out);
  });

  it('accepts an output beneath the root', () => {
    const root = path.resolve('/root');
    const out = path.resolve('/root/sub/dir/file.json');
    const realpath = (p: string): string => p;
    const exists = (): boolean => true;
    expect(assertOutputContained(out, root, realpath, exists)).toBe(out);
  });

  it('rejects an output above the root with OutputOutsideRootError', () => {
    const root = path.resolve('/root/inner');
    const out = path.resolve('/root/escape.json');
    const realpath = (p: string): string => p;
    const exists = (): boolean => true;
    expect(() => assertOutputContained(out, root, realpath, exists))
      .toThrow(OutputOutsideRootError);
  });

  it('rejects an output on a completely different branch', () => {
    const root = path.resolve('/root');
    const out = path.resolve('/etc/passwd');
    const realpath = (p: string): string => p;
    const exists = (): boolean => true;
    expect(() => assertOutputContained(out, root, realpath, exists))
      .toThrow(OutputOutsideRootError);
  });

  it('defeats a symlink-out-of-jail by realpath-ing the existing ancestor', () => {
    // Setup: the parent of the resolved output is a symlink that points
    // outside the root. The lexical path is inside the root, but the real
    // path is not.
    const root = path.resolve('/safe');
    const out = path.resolve('/safe/link/file.json');

    // Stubbed realpath: `/safe/link` is a symlink to `/elsewhere`.
    const realpath = (p: string): string => {
      if (p === path.resolve('/safe/link')) return path.resolve('/elsewhere');
      return p;
    };
    const exists = (): boolean => true;

    expect(() => assertOutputContained(out, root, realpath, exists))
      .toThrow(OutputOutsideRootError);
  });

  it('walks up to the closest existing ancestor when the output dir does not exist yet', () => {
    // Real fs: create a temp dir, ask to write into a subdir that does not
    // exist yet. This exercises the directory-walk-up logic.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-merge-93-'));
    try {
      const out = path.join(tmpRoot, 'not', 'yet', 'created', 'file.json');
      // Pass the real fs callbacks (default args). Should succeed.
      expect(assertOutputContained(out, tmpRoot)).toBe(out);
    } finally {
      fs.rmdirSync(tmpRoot);
    }
  });

  it('includes both paths in the thrown error message', () => {
    const root = path.resolve('/root');
    const out = path.resolve('/etc/passwd');
    const realpath = (p: string): string => p;
    const exists = (): boolean => true;
    try {
      assertOutputContained(out, root, realpath, exists);
      fail('expected OutputOutsideRootError');
    } catch (e) {
      expect(e).toBeInstanceOf(OutputOutsideRootError);
      expect((e as OutputOutsideRootError).message).toContain(path.resolve('/etc/passwd'));
      expect((e as OutputOutsideRootError).message).toContain(path.resolve('/root'));
      expect((e as OutputOutsideRootError).resolved).toBe(path.resolve('/etc/passwd'));
      expect((e as OutputOutsideRootError).root).toBe(path.resolve('/root'));
    }
  });
});
