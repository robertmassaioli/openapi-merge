import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { ExitCode, main } from '../index';

/**
 * Integration tests that drive the real `main()` end to end: real temp
 * directories, real file writes, a real in-process HTTP server for `inputURL`.
 * Nothing is mocked at the module level.
 *
 * Two process globals have to be borrowed to do this, and both are stubbed by
 * plain assignment with save-and-restore rather than by a test-framework mock,
 * so these tests stay runnable under any Jest-compatible runner:
 *
 *  - `process.exit`, which must THROW. The real function never returns, and
 *    `main()` contains `process.exit(...); return;` pairs that would keep
 *    executing under a stub that simply records the code.
 *  - `console.log`/`console.error`, to keep the reporter readable and to let
 *    tests assert on what the user would have seen.
 */
class ExitError extends Error {
  public constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

let tmpDir: string;
let stderr: string[];

/* eslint-disable @typescript-eslint/no-explicit-any */
const realExit = process.exit;
const realLog = console.log;
const realError = console.error;
const realArgv = process.argv;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-merge-cli-main-'));
  stderr = [];
  (process as any).exit = (code?: number): never => {
    throw new ExitError(code ?? 0);
  };
  console.log = (): void => undefined;
  console.error = (...args: unknown[]): void => {
    stderr.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
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

/** Runs `main()` with the given CLI arguments and returns the resulting exit code. */
async function runMain(...args: string[]): Promise<number> {
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
}

function write(fileName: string, contents: string): string {
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function writeJson(fileName: string, value: unknown): string {
  return write(fileName, JSON.stringify(value, null, 2));
}

/** A minimal valid OAS 3 document with the given paths. */
function oas(paths: Record<string, unknown>, title = 'Test API'): unknown {
  return { openapi: '3.0.3', info: { title, version: '1.0.0' }, paths };
}

function getPath(operationId: string): Record<string, unknown> {
  return { get: { operationId, responses: { '200': { description: 'ok' } } } };
}

/** Reads the merged output the CLI wrote. */
function readOutput(fileName = 'output.json'): string {
  return fs.readFileSync(path.join(tmpDir, fileName), 'utf-8');
}

describe('main - successful merges', () => {
  it('merges a single input and writes the output', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(readOutput());
    expect(Object.keys(output.paths)).toEqual(['/a']);
  });

  it('merges two inputs with disjoint paths', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    writeJson('b.json', oas({ '/b': getPath('getB') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(readOutput()).paths).sort()).toEqual(['/a', '/b']);
  });

  it('applies pathModification.prepend', async () => {
    writeJson('a.json', oas({ '/thing': getPath('getThing') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json', pathModification: { prepend: '/api' } }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(readOutput()).paths)).toEqual(['/api/thing']);
  });

  it('resolves an operationId conflict using dispute.prefix', async () => {
    writeJson('a.json', oas({ '/a': getPath('getThing') }));
    writeJson('b.json', oas({ '/b': getPath('getThing') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json', dispute: { prefix: 'second' } }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    expect(JSON.parse(readOutput()).paths['/b'].get.operationId).toBe('secondgetThing');
  });

  it('reads a YAML input file', async () => {
    write('a.yaml', 'openapi: 3.0.3\ninfo:\n  title: Y\n  version: "1"\npaths:\n  /y:\n    get:\n      responses:\n        "200":\n          description: ok\n');
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.yaml' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(readOutput()).paths)).toEqual(['/y']);
  });
});

describe('main - output formatting', () => {
  it('writes YAML when the output extension is .yaml', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.yaml',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    const contents = readOutput('output.yaml');
    expect(contents).toContain('openapi: 3.0.3');
    expect(contents.startsWith('{')).toBe(false);
  });

  it('writes YAML when the output extension is .yml', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.yml',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    expect(readOutput('output.yml')).toContain('openapi: 3.0.3');
  });

  it('indents JSON output with the configured number of spaces', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      formatting: { indent: { style: 'spaces', width: 4 } },
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    expect(readOutput().split('\n')[1].startsWith('    "')).toBe(true);
  });

  it('indents JSON output with tabs when configured', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      formatting: { indent: { style: 'tabs' } },
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    expect(readOutput().split('\n')[1].startsWith('\t"')).toBe(true);
  });

  it('defaults to two-space JSON indentation', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    expect(readOutput().split('\n')[1].startsWith('  "')).toBe(true);
  });
});

describe('main - inputURL', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/spec.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(oas({ '/remote': getPath('getRemote') })));
      } else if (req.url === '/boom.json') {
        res.writeHead(500);
        res.end('internal server error');
      } else if (req.url === '/unavailable.json') {
        res.writeHead(503);
        res.end('service unavailable');
      } else if (req.url === '/teapot.json') {
        res.writeHead(418);
        res.end('short and stout');
      } else if (req.url === '/notmodified.json') {
        // 3xx redirects are followed by fetch and never surface, but 304 is not
        // a redirect -- it comes back as a non-ok response, which is the only
        // realistic way to reach ErrorInputUrlUnexpectedStatus.
        res.writeHead(304);
        res.end();
      } else {
        // A body that is not JSON but IS a valid YAML string scalar -- the
        // shape that used to slip through as a spec.
        res.writeHead(404);
        res.end('not found');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('loads an input over HTTP', async () => {
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/spec.json` }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(readOutput()).paths)).toEqual(['/remote']);
  });

  // Regression tests for the silent-404 bug. Before the status check landed,
  // `loadOasForInput` did `fetch(url).then(rsp => rsp.text())` and never looked
  // at the status: a 404 body such as "not found" fails JSON.parse but is a
  // valid YAML string scalar, so it parsed cleanly, was cast to SwaggerV3, and
  // the merge produced a spec with no `info` block while exiting 0.
  it('exits ErrorInputUrlClientStatus when the URL 404s', async () => {
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/missing.json` }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorInputUrlClientStatus);
  });

  it('exits ErrorInputUrlClientStatus for any other 4xx', async () => {
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/teapot.json` }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorInputUrlClientStatus);
    expect(stderr.join('\n')).toContain('418');
  });

  it('exits ErrorInputUrlUnexpectedStatus for a non-2xx that is neither 4xx nor 5xx', async () => {
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/notmodified.json` }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorInputUrlUnexpectedStatus);
    expect(stderr.join('\n')).toContain('304');
  });

  it('writes no output at all when an input 404s', async () => {
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/missing.json` }],
      output: './output.json',
    });

    await runMain('-c', config);

    expect(fs.existsSync(path.join(tmpDir, 'output.json'))).toBe(false);
  });

  it('reports the status and the URL on stderr', async () => {
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/missing.json` }],
      output: './output.json',
    });

    await runMain('-c', config);

    const output = stderr.join('\n');
    expect(output).toContain('404');
    expect(output).toContain('/missing.json');
  });

  it('exits ErrorInputUrlServerStatus for a 500', async () => {
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/boom.json` }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorInputUrlServerStatus);
    expect(stderr.join('\n')).toContain('500');
  });

  it('exits ErrorInputUrlServerStatus for a 503', async () => {
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/unavailable.json` }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorInputUrlServerStatus);
  });

  it('gives 4xx and 5xx different exit codes', async () => {
    // The point of the split: a caller can branch on retryability.
    const clientConfig = writeJson('client.json', {
      inputs: [{ inputURL: `${baseUrl}/missing.json` }], output: './output.json',
    });
    const serverConfig = writeJson('server.json', {
      inputs: [{ inputURL: `${baseUrl}/boom.json` }], output: './output.json',
    });

    const clientCode = await runMain('-c', clientConfig);
    const serverCode = await runMain('-c', serverConfig);

    expect(clientCode).not.toBe(serverCode);
  });

  it('still exits ErrorLoadingInputs when the URL cannot be reached at all', async () => {
    // A transport-level failure is not a status failure: the server never
    // answered, so this must stay on the generic code.
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputURL: 'http://127.0.0.1:1/unreachable.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorLoadingInputs);
  });

  it('reports the first failing input when inputs fail for different reasons', async () => {
    // Input 0 is a missing file (ErrorLoadingInputs), input 1 is a 404
    // (ErrorInputUrlStatus). The first failure decides the exit code.
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './missing.json' }, { inputURL: `${baseUrl}/missing.json` }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorLoadingInputs);
    // ...but both failures are still reported to the user.
    expect(stderr.join('\n')).toContain('Input 0');
    expect(stderr.join('\n')).toContain('Input 1');
  });
});

describe('main - exit codes', () => {
  it('exits ErrorLoadingConfig when the config file is missing', async () => {
    expect(await runMain('-c', path.join(tmpDir, 'nope.json'))).toBe(ExitCode.ErrorLoadingConfig);
    expect(stderr.join('\n')).toContain('Could not find or read');
  });

  it('exits ErrorLoadingConfig when the config fails schema validation', async () => {
    const config = writeJson('openapi-merge.json', { output: './output.json' });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });

  it('exits ErrorLoadingConfig for tabs into YAML output', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.yaml',
      formatting: { indent: { style: 'tabs' } },
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
    expect(stderr.join('\n')).toContain('Tab indentation is not supported');
  });

  it('exits ErrorLoadingInputs when an input file is missing', async () => {
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './does-not-exist.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorLoadingInputs);
  });

  it('exits ErrorMerging when two inputs declare the same path', async () => {
    writeJson('a.json', oas({ '/same': getPath('getA') }));
    writeJson('b.json', oas({ '/same': getPath('getB') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorMerging);
    expect(stderr.join('\n')).toContain('Error merging files');
  });

  it('returns Success (0) on a clean merge', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);
  });
});

describe('main - OpenAPI version checking', () => {
  it('exits ErrorOpenApiVersion for a 3.2 input', async () => {
    writeJson('a.json', { ...(oas({ '/a': getPath('getA') }) as object), openapi: '3.2.0' });
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorOpenApiVersion);
  });

  it('names the offending input and its version on stderr', async () => {
    writeJson('a.json', { ...(oas({ '/a': getPath('getA') }) as object), openapi: '3.2.0' });
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    await runMain('-c', config);

    const output = stderr.join('\n');
    expect(output).toContain('Input 0');
    expect(output).toContain('3.2.0');
  });

  it('writes no output file when a version is unsupported', async () => {
    // The assertion that proves the failure is real rather than cosmetic.
    writeJson('a.json', { ...(oas({ '/a': getPath('getA') }) as object), openapi: '3.2.0' });
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    await runMain('-c', config);

    expect(fs.existsSync(path.join(tmpDir, 'output.json'))).toBe(false);
  });

  it('exits ErrorOpenApiVersion when an input has no openapi field', async () => {
    const doc = oas({ '/a': getPath('getA') }) as Record<string, unknown>;
    delete doc.openapi;
    writeJson('a.json', doc);
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorOpenApiVersion);
  });

  it('still exits ErrorMerging for a genuine merge conflict', async () => {
    // Guards against the new code swallowing the existing one.
    writeJson('a.json', oas({ '/same': getPath('getA') }));
    writeJson('b.json', oas({ '/same': getPath('getB') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorMerging);
  });

  it('merges 3.0 inputs with differing patch versions', async () => {
    writeJson('a.json', { ...(oas({ '/a': getPath('getA') }) as object), openapi: '3.0.0' });
    writeJson('b.json', { ...(oas({ '/b': getPath('getB') }) as object), openapi: '3.0.3' });
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);
  });
});

describe('main - output path safety', () => {
  it('exits ErrorUnsafePath when the output escapes outputRoot', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: '../escaped.json',
      outputRoot: '.',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.ErrorUnsafePath);
  });

  it('succeeds when the output stays inside outputRoot', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    fs.mkdirSync(path.join(tmpDir, 'dist'));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './dist/output.json',
      outputRoot: '.',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);
    expect(fs.existsSync(path.join(tmpDir, 'dist', 'output.json'))).toBe(true);
  });

  it('lets --restrict-output-to reject an output the config would have allowed', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    fs.mkdirSync(path.join(tmpDir, 'allowed'));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config, '--restrict-output-to', './allowed')).toBe(ExitCode.ErrorUnsafePath);
  });

  it('lets --restrict-output-to allow an output inside the named directory', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    fs.mkdirSync(path.join(tmpDir, 'allowed'));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './allowed/output.json',
    });

    expect(await runMain('-c', config, '--restrict-output-to', './allowed')).toBe(ExitCode.Success);
  });
});

describe('main - option isolation between invocations', () => {
  // Regression test for the commander singleton: options are stored on the
  // Command instance and are NOT cleared by a later parse that omits them, so
  // building the program once at module scope leaked --restrict-output-to and
  // -c across calls to main().
  it('does not leak --restrict-output-to into a later invocation', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    fs.mkdirSync(path.join(tmpDir, 'allowed'));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config, '--restrict-output-to', './allowed')).toBe(ExitCode.ErrorUnsafePath);
    expect(await runMain('-c', config)).toBe(ExitCode.Success);
  });

  it('does not leak -c into a later invocation that omits it', async () => {
    writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await runMain('-c', config)).toBe(ExitCode.Success);

    // With no -c, the CLI looks for ./openapi-merge.json relative to the test
    // process's cwd, which has no such file -- so this must fail to load a
    // config rather than silently reusing the previous one.
    expect(await runMain()).toBe(ExitCode.ErrorLoadingConfig);
    expect(stderr.join('\n')).toContain('Could not find or read');
  });
});
