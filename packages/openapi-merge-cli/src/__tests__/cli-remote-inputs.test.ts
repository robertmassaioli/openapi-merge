import http from 'http';
import { ExitCode } from '../index';
import { getPath, installCliHarness, oas } from './_helpers/cli-harness';

/**
 * Inputs fetched over HTTP via `inputURL`.
 *
 * Exercised against a real in-process HTTP server on an ephemeral port rather
 * than a stubbed `fetch`, so the actual request path is covered. Includes status
 * handling: a 4xx, a 5xx and a non-2xx that is neither map to different exit
 * codes, because their remedies differ.
 */

const cli = installCliHarness();

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
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/spec.json` }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(cli.read()).paths)).toEqual(['/remote']);
  });

  // Regression tests for the silent-404 bug. Before the status check landed,
  // `loadOasForInput` did `fetch(url).then(rsp => rsp.text())` and never looked
  // at the status: a 404 body such as "not found" fails JSON.parse but is a
  // valid YAML string scalar, so it parsed cleanly, was cast to SwaggerV3, and
  // the merge produced a spec with no `info` block while exiting 0.
  it('exits ErrorInputUrlClientStatus when the URL 404s', async () => {
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/missing.json` }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorInputUrlClientStatus);
  });

  it('exits ErrorInputUrlClientStatus for any other 4xx', async () => {
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/teapot.json` }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorInputUrlClientStatus);
    expect(cli.stderr().join('\n')).toContain('418');
  });

  it('exits ErrorInputUrlUnexpectedStatus for a non-2xx that is neither 4xx nor 5xx', async () => {
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/notmodified.json` }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorInputUrlUnexpectedStatus);
    expect(cli.stderr().join('\n')).toContain('304');
  });

  it('writes no output at all when an input 404s', async () => {
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/missing.json` }],
      output: './output.json',
    });

    await cli.run('-c', config);

    expect(cli.exists('output.json')).toBe(false);
  });

  it('reports the status and the URL on stderr', async () => {
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/missing.json` }],
      output: './output.json',
    });

    await cli.run('-c', config);

    const output = cli.stderr().join('\n');
    expect(output).toContain('404');
    expect(output).toContain('/missing.json');
  });

  it('exits ErrorInputUrlServerStatus for a 500', async () => {
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/boom.json` }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorInputUrlServerStatus);
    expect(cli.stderr().join('\n')).toContain('500');
  });

  it('exits ErrorInputUrlServerStatus for a 503', async () => {
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/unavailable.json` }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorInputUrlServerStatus);
  });

  it('gives 4xx and 5xx different exit codes', async () => {
    // The point of the split: a caller can branch on retryability.
    const clientConfig = cli.writeJson('client.json', {
      inputs: [{ inputURL: `${baseUrl}/missing.json` }], output: './output.json',
    });
    const serverConfig = cli.writeJson('server.json', {
      inputs: [{ inputURL: `${baseUrl}/boom.json` }], output: './output.json',
    });

    const clientCode = await cli.run('-c', clientConfig);
    const serverCode = await cli.run('-c', serverConfig);

    expect(clientCode).not.toBe(serverCode);
  });

  it('still exits ErrorLoadingInputs when the URL cannot be reached at all', async () => {
    // A transport-level failure is not a status failure: the server never
    // answered, so this must stay on the generic code.
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: 'http://127.0.0.1:1/unreachable.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingInputs);
  });

  it('reports the first failing input when inputs fail for different reasons', async () => {
    // Input 0 is a missing file (ErrorLoadingInputs), input 1 is a 404
    // (ErrorInputUrlStatus). The first failure decides the exit code.
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './missing.json' }, { inputURL: `${baseUrl}/missing.json` }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingInputs);
    // ...but both failures are still reported to the user.
    expect(cli.stderr().join('\n')).toContain('Input 0');
    expect(cli.stderr().join('\n')).toContain('Input 1');
  });
});
