import path from 'path';
import fs from 'fs';
import { ExitCode } from '../index';
import { getPath, installCliHarness, oas } from './_helpers/cli-harness';

/**
 * Command-line parsing and invocation isolation.
 *
 * `main()` is exported and callable more than once. Commander retains parsed
 * values on a Command instance and does not clear options absent from a later
 * parse, so the program is rebuilt per invocation -- these tests are the
 * regression guard for that.
 */

const cli = installCliHarness();

describe('main - option isolation between invocations', () => {
  // Regression test for the commander singleton: options are stored on the
  // Command instance and are NOT cleared by a later parse that omits them, so
  // building the program once at module scope leaked --restrict-output-to and
  // -c across calls to main().
  it('does not leak --restrict-output-to into a later invocation', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    fs.mkdirSync(path.join(cli.dir(), 'allowed'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config, '--restrict-output-to', './allowed')).toBe(ExitCode.ErrorUnsafePath);
    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
  });

  it('does not leak -c into a later invocation that omits it', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    // With no -c, the CLI looks for ./openapi-merge.json relative to the test
    // process's cwd, which has no such file -- so this must fail to load a
    // config rather than silently reusing the previous one.
    expect(await cli.run()).toBe(ExitCode.ErrorLoadingConfig);
    expect(cli.stderr().join('\n')).toContain('Could not find or read');
  });
});
