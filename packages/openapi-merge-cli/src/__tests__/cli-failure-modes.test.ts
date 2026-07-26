import path from 'path';
import { ExitCode } from '../index';
import { getPath, installCliHarness, oas } from './_helpers/cli-harness';

/**
 * What the CLI does when something is wrong, and which exit code it reports.
 *
 * Each failure mode gets a distinct code so a pipeline can branch on it. The
 * assertion that matters as much as the code is that no output file is written:
 * a failure that still produces a document is worse than one that does not.
 */

const cli = installCliHarness();

describe('main - exit codes', () => {
  it('exits ErrorLoadingConfig when the config file is missing', async () => {
    expect(await cli.run('-c', path.join(cli.dir(), 'nope.json'))).toBe(ExitCode.ErrorLoadingConfig);
    expect(cli.stderr().join('\n')).toContain('Could not find or read');
  });

  it('exits ErrorLoadingConfig when the config fails schema validation', async () => {
    const config = cli.writeJson('openapi-merge.json', { output: './output.json' });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });

  it('exits ErrorLoadingConfig for tabs into YAML output', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.yaml',
      formatting: { indent: { style: 'tabs' } },
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
    expect(cli.stderr().join('\n')).toContain('Tab indentation is not supported');
  });

  it('exits ErrorLoadingInputs when an input file is missing', async () => {
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './does-not-exist.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingInputs);
  });

  it('exits ErrorMerging when two inputs declare the same path', async () => {
    cli.writeJson('a.json', oas({ '/same': getPath('getA') }));
    cli.writeJson('b.json', oas({ '/same': getPath('getB') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorMerging);
    expect(cli.stderr().join('\n')).toContain('Error merging files');
  });

  it('returns Success (0) on a clean merge', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
  });
});
describe('main - OpenAPI version checking', () => {
  it('exits ErrorOpenApiVersion for a 3.3 input', async () => {
    cli.writeJson('a.json', { ...(oas({ '/a': getPath('getA') }) as object), openapi: '3.3.0' });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorOpenApiVersion);
  });

  it('names the offending input and its version on stderr', async () => {
    cli.writeJson('a.json', { ...(oas({ '/a': getPath('getA') }) as object), openapi: '3.3.0' });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    await cli.run('-c', config);

    const output = cli.stderr().join('\n');
    expect(output).toContain('Input 0');
    expect(output).toContain('3.3.0');
  });

  it('writes no output file when a version is unsupported', async () => {
    // The assertion that proves the failure is real rather than cosmetic.
    cli.writeJson('a.json', { ...(oas({ '/a': getPath('getA') }) as object), openapi: '3.3.0' });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    await cli.run('-c', config);

    expect(cli.exists('output.json')).toBe(false);
  });

  it('exits ErrorOpenApiVersion when an input has no openapi field', async () => {
    const doc = oas({ '/a': getPath('getA') }) as Record<string, unknown>;
    delete doc.openapi;
    cli.writeJson('a.json', doc);
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorOpenApiVersion);
  });

  it('still exits ErrorMerging for a genuine merge conflict', async () => {
    // Guards against the new code swallowing the existing one.
    cli.writeJson('a.json', oas({ '/same': getPath('getA') }));
    cli.writeJson('b.json', oas({ '/same': getPath('getB') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorMerging);
  });

  it('merges 3.0 inputs with differing patch versions', async () => {
    cli.writeJson('a.json', { ...(oas({ '/a': getPath('getA') }) as object), openapi: '3.0.0' });
    cli.writeJson('b.json', { ...(oas({ '/b': getPath('getB') }) as object), openapi: '3.0.3' });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
  });
});
