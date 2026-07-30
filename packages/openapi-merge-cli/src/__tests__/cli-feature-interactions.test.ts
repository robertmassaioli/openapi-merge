import http from 'http';
import path from 'path';
import fs from 'fs';
import { ExitCode } from '../index';
import { getPath, installCliHarness, oas } from './_helpers/cli-harness';

/**
 * Interactions between features developed on separate branches.
 *
 * This suite exists because #45 (positional inputs, no config file) and #61
 * (headers for inputURL) both restructured `main()` and conflicted on merge.
 * Each branch's own tests pass in isolation and would keep passing even if the
 * combination were broken, so the combination gets its own tests here.
 *
 * NOTE FOR MEGA REBUILDS: this file lives only on the mega branch, because it
 * asserts behaviour that exists only once several branches are combined.
 * Rebuilding a mega branch must cherry-pick the commit that adds it.
 */

const cli = installCliHarness();

describe('feature interactions: positional inputs (#45) and inputURL headers (#61)', () => {
  let server: http.Server;
  let baseUrl: string;
  let received: http.IncomingHttpHeaders = {};

  beforeEach(async () => {
    received = {};
    server = http.createServer((req, res) => {
      received = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(oas({ '/remote': getPath('getRemote') })));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
  });

  afterEach(async () => {
    delete process.env.TEST_TOKEN;
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('config mode still sends interpolated headers now that positional mode exists', async () => {
    process.env.TEST_TOKEN = 'tok';
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputURL: `${baseUrl}/spec.json`, headers: { Authorization: 'Bearer ${TEST_TOKEN}' } }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(received.authorization).toBe('Bearer tok');
  });

  it('a positional URL input is fetched, without headers', async () => {
    const out = path.join(cli.dir(), 'out.json');

    expect(await cli.run(`${baseUrl}/spec.json`, '-o', out)).toBe(ExitCode.Success);

    // A known limitation of the combination rather than a bug in either half:
    // positional inputs have no syntax for per-input headers, so a URL needing
    // auth still requires a configuration file. Pinned so that if a `--header`
    // flag is ever added, this test is what says the gap was closed.
    expect(received.authorization).toBeUndefined();
    expect(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8')).paths)).toEqual(['/remote']);
  });

  it('mixes a positional local file with a positional URL', async () => {
    const local = cli.writeJson('local.json', oas({ '/local': getPath('getLocal') }));
    const out = path.join(cli.dir(), 'out.json');

    expect(await cli.run(local, `${baseUrl}/spec.json`, '-o', out)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8')).paths).sort()).toEqual(['/local', '/remote']);
  });
});
