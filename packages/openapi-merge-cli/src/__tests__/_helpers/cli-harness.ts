import fs from 'fs';
import os from 'os';
import path from 'path';
import { ExitCode, main } from '../../index';

/**
 * Harness for driving the real `main()` end to end.
 *
 * Real temp directories, real file writes, real HTTP where a test needs it --
 * nothing is mocked at the module level. Two process globals have to be
 * borrowed to do that, and both are stubbed by plain assignment with
 * save-and-restore rather than a test-framework mock, so these suites stay
 * runnable under any Jest-compatible runner:
 *
 *  - `process.exit`, which must THROW. The real function never returns, and
 *    `main()` contains `process.exit(...); return;` pairs that would keep
 *    executing under a stub that merely recorded the code.
 *  - `console.log`/`console.error`, to keep the reporter readable and to let
 *    tests assert on what the user would have seen.
 *
 * Call {@link installCliHarness} at the top of a suite; it registers its own
 * beforeEach/afterEach and hands back accessors for the temp dir and stderr.
 */

class ExitError extends Error {
  public constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

export type CliHarness = {
  /** The per-test temp directory. */
  dir: () => string;
  /** Lines captured from console.error during the current test. */
  stderr: () => string[];
  /** Lines captured from console.log (LogWithMillisDiff) during the current test. */
  stdout: () => string[];
  /** Run `main()` with these argv entries; resolves to the exit code. */
  run: (...args: string[]) => Promise<number>;
  /** Write a file into the temp dir, returning its absolute path. */
  write: (fileName: string, contents: string) => string;
  /** Write JSON into the temp dir, returning its absolute path. */
  writeJson: (fileName: string, value: unknown) => string;
  /** Read a file the CLI produced. */
  read: (fileName?: string) => string;
  /** Whether a file exists in the temp dir. */
  exists: (fileName: string) => boolean;
};

export function installCliHarness(): CliHarness {
  let tmpDir = '';
  let capturedErr: string[] = [];
  let capturedOut: string[] = [];

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const realExit = process.exit;
  const realLog = console.log;
  const realError = console.error;
  const realArgv = process.argv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-merge-cli-'));
    capturedErr = [];
    capturedOut = [];
    (process as any).exit = (code?: number): never => {
      throw new ExitError(code ?? 0);
    };
    console.log = (...args: unknown[]): void => {
      capturedOut.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    console.error = (...args: unknown[]): void => {
      capturedErr.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
  });

  afterEach(() => {
    (process as any).exit = realExit;
    console.log = realLog;
    console.error = realError;
    process.argv = realArgv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    dir: () => tmpDir,
    stderr: () => capturedErr,
    stdout: () => capturedOut,
    run: async (...args: string[]): Promise<number> => {
      process.argv = ['node', 'openapi-merge-cli', ...args];
      try {
        await main();
        return ExitCode.Success;
      } catch (e) {
        if (e instanceof ExitError) {
          return e.code;
        }
        throw e;
      }
    },
    write: (fileName, contents) => {
      const filePath = path.join(tmpDir, fileName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents);
      return filePath;
    },
    writeJson: (fileName, value) => {
      const filePath = path.join(tmpDir, fileName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
      return filePath;
    },
    read: (fileName = 'output.json') => fs.readFileSync(path.join(tmpDir, fileName), 'utf-8'),
    exists: fileName => fs.existsSync(path.join(tmpDir, fileName)),
  };
}

/** A minimal valid OAS 3 document with the given paths. */
export function oas(paths: Record<string, unknown>, title = 'Test API'): unknown {
  return { openapi: '3.0.3', info: { title, version: '1.0.0' }, paths };
}

/** A path item with a single GET carrying an operationId. */
export function getPath(operationId: string): Record<string, unknown> {
  return { get: { operationId, responses: { '200': { description: 'ok' } } } };
}
