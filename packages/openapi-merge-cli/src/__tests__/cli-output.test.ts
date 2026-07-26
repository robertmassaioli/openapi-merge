import { ExitCode } from '../index';
import { getPath, installCliHarness, oas } from './_helpers/cli-harness';

/**
 * How the CLI writes the merged document.
 *
 * The output format follows the file extension -- `.yaml`/`.yml` produce YAML,
 * anything else JSON -- and the indentation follows `formatting.indent`.
 */

const cli = installCliHarness();

describe('main - output formatting', () => {
  it('writes YAML when the output extension is .yaml', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.yaml',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const contents = cli.read('output.yaml');
    expect(contents).toContain('openapi: 3.0.3');
    expect(contents.startsWith('{')).toBe(false);
  });

  it('writes YAML when the output extension is .yml', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.yml',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(cli.read('output.yml')).toContain('openapi: 3.0.3');
  });

  it('indents JSON output with the configured number of spaces', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      formatting: { indent: { style: 'spaces', width: 4 } },
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(cli.read().split('\n')[1].startsWith('    "')).toBe(true);
  });

  it('indents JSON output with tabs when configured', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      formatting: { indent: { style: 'tabs' } },
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(cli.read().split('\n')[1].startsWith('\t"')).toBe(true);
  });

  it('defaults to two-space JSON indentation', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(cli.read().split('\n')[1].startsWith('  "')).toBe(true);
  });
});
