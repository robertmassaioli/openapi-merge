import path from 'path';
import fs from 'fs';
import { ExitCode } from '../index';
import { getPath, installCliHarness, oas } from './_helpers/cli-harness';

/**
 * Restricting where the CLI is allowed to write.
 *
 * `outputRoot` in the config and `--restrict-output-to` on the command line both
 * confine the output; the flag wins. Intended for contexts where the
 * configuration file is less trusted than the process running it.
 */

const cli = installCliHarness();

describe('main - output path safety', () => {
  it('exits ErrorUnsafePath when the output escapes outputRoot', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: '../escaped.json',
      outputRoot: '.',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorUnsafePath);
  });

  it('succeeds when the output stays inside outputRoot, creating the missing directory', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './dist/output.json',
      outputRoot: '.',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(cli.exists('dist/output.json')).toBe(true);
  });

  it('lets --restrict-output-to reject an output the config would have allowed', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    fs.mkdirSync(path.join(cli.dir(), 'allowed'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config, '--restrict-output-to', './allowed')).toBe(ExitCode.ErrorUnsafePath);
  });

  it('lets --restrict-output-to allow an output inside the named directory', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    fs.mkdirSync(path.join(cli.dir(), 'allowed'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './allowed/output.json',
    });

    expect(await cli.run('-c', config, '--restrict-output-to', './allowed')).toBe(ExitCode.Success);
  });

  it('creates every missing directory in a multi-level output path (proposal 42)', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './a/b/c/output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(cli.exists('a/b/c/output.json')).toBe(true);
  });

  it('does not create any directory when the output escapes outputRoot (proposal 42)', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: '../escaped/nested/output.json',
      outputRoot: '.',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorUnsafePath);
    expect(fs.existsSync(path.join(cli.dir(), '..', 'escaped'))).toBe(false);
  });

  it('exits ErrorCreatingOutputDirectory when a path component is an existing file (proposal 42)', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    cli.write('notadir', 'this is a file, not a directory');
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './notadir/nested/output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorCreatingOutputDirectory);
    expect(cli.stderr().some(line => line.includes('notadir'))).toBe(true);
  });
});
