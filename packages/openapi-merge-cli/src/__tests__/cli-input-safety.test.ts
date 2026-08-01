import path from 'path';
import fs from 'fs';
import { ExitCode } from '../index';
import { getPath, installCliHarness, oas } from './_helpers/cli-harness';

/**
 * Restricting where the CLI is allowed to read local files from (proposal
 * 38, the read-side counterpart to `cli-output-safety.test.ts`).
 *
 * `inputRoot` in the config and `--restrict-input-to` on the command line
 * both confine declared `inputFile`s; the flag wins. Discovered-file
 * containment (`resolveExternalReferences`) is covered separately in
 * `cli-external-references.test.ts`, since it needs the discovery machinery
 * set up.
 */

const cli = installCliHarness();

describe('main - input path safety', () => {
  it('exits ErrorUnsafeInputPath when a declared inputFile escapes inputRoot', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    fs.mkdirSync(path.join(cli.dir(), 'allowed'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: '../a.json' }],
      output: './allowed/output.json',
      inputRoot: './allowed',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorUnsafeInputPath);
    expect(cli.exists('allowed/output.json')).toBe(false);
  });

  it('succeeds when the declared input stays inside inputRoot', async () => {
    fs.mkdirSync(path.join(cli.dir(), 'allowed'));
    cli.writeJson('allowed/a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './allowed/a.json' }],
      output: './output.json',
      inputRoot: './allowed',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(cli.exists('output.json')).toBe(true);
  });

  it('reports every offending declared input, not just the first', async () => {
    fs.mkdirSync(path.join(cli.dir(), 'allowed'));
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    cli.writeJson('b.json', oas({ '/b': getPath('getB') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: '../a.json' }, { inputFile: '../b.json' }],
      output: './allowed/output.json',
      inputRoot: './allowed',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorUnsafeInputPath);
    const stderr = cli.stderr().join('\n');
    expect(stderr).toContain('a.json');
    expect(stderr).toContain('b.json');
  });

  it('lets --restrict-input-to reject an input the config would have allowed', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    fs.mkdirSync(path.join(cli.dir(), 'allowed'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './allowed/output.json',
    });

    expect(await cli.run('-c', config, '--restrict-input-to', './allowed')).toBe(ExitCode.ErrorUnsafeInputPath);
  });

  it('lets --restrict-input-to allow an input inside the named directory', async () => {
    fs.mkdirSync(path.join(cli.dir(), 'allowed'));
    cli.writeJson('allowed/a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './allowed/a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config, '--restrict-input-to', './allowed')).toBe(ExitCode.Success);
  });
});
