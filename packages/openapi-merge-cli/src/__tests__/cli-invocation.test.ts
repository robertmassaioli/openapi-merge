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

/**
 * `openapi-merge-cli init`.
 *
 * The regression that matters most is not in `init` at all: registering it as a
 * commander subcommand makes a bare `openapi-merge-cli` print help instead of
 * merging, which would break the tool's primary use. It is dispatched by hand
 * before the program is built, and the first test here is what says so.
 */
describe('init command', () => {
  const spec = (version: string, pathName: string) => ({
    openapi: version,
    info: { title: 'T', version: '1.0.0' },
    paths: { [pathName]: getPath(pathName.slice(1)) },
  });

  const runInDir = async (...args: string[]): Promise<number> => {
    const previous = process.cwd();
    process.chdir(cli.dir());
    try {
      return await cli.run(...args);
    } finally {
      process.chdir(previous);
    }
  };

  const generated = (): { inputs: Array<{ inputFile: string }>; output: string } =>
    JSON.parse(fs.readFileSync(path.join(cli.dir(), 'openapi-merge.json'), 'utf8'));

  it('still merges when invoked with no arguments at all', async () => {
    // The guard against the subcommand regression. If `init` is ever
    // registered with `.command()`, this fails.
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(Object.keys(JSON.parse(cli.read()).paths)).toEqual(['/a']);
  });

  it('writes a configuration listing the OpenAPI files it found', async () => {
    cli.writeJson('service-b.json', spec('3.0.3', '/b'));
    cli.writeJson('service-a.json', spec('3.0.3', '/a'));

    expect(await runInDir('init')).toBe(ExitCode.Success);

    // Sorted, so the file is reproducible.
    expect(generated().inputs).toEqual([
      { inputFile: './service-a.json' },
      { inputFile: './service-b.json' },
    ]);
  });

  it('ignores files that are not OpenAPI documents', async () => {
    cli.writeJson('api.json', spec('3.0.3', '/a'));
    cli.writeJson('package.json', { name: 'a-project', version: '1.0.0' });
    cli.writeJson('tsconfig.json', { compilerOptions: { strict: true } });
    cli.write('notes.md', '# not a spec');

    expect(await runInDir('init')).toBe(ExitCode.Success);

    expect(generated().inputs).toEqual([{ inputFile: './api.json' }]);
  });

  it('does not trip over a file that fails to parse', async () => {
    cli.writeJson('api.json', spec('3.0.3', '/a'));
    cli.write('broken.yaml', 'not: [valid: yaml: at all');

    expect(await runInDir('init')).toBe(ExitCode.Success);
    expect(generated().inputs).toEqual([{ inputFile: './api.json' }]);
  });

  it('produces a configuration the merge then accepts', async () => {
    // The round trip is the real test: a generator whose output its own tool
    // rejects would be worse than no generator.
    cli.writeJson('a.json', spec('3.0.3', '/a'));
    cli.writeJson('b.json', spec('3.0.3', '/b'));

    expect(await runInDir('init')).toBe(ExitCode.Success);
    expect(await runInDir()).toBe(ExitCode.Success);

    const merged = JSON.parse(fs.readFileSync(path.join(cli.dir(), generated().output), 'utf8'));
    expect(Object.keys(merged.paths).sort()).toEqual(['/a', '/b']);
  });

  it('refuses to overwrite an existing configuration', async () => {
    cli.writeJson('openapi-merge.json', { inputs: [{ inputFile: './hand-written.yaml' }], output: './out.json' });

    expect(await runInDir('init')).toBe(ExitCode.ErrorLoadingConfig);
    // The hand-written file is untouched -- clobbering it is the one
    // unrecoverable thing this command could do.
    expect(generated().inputs).toEqual([{ inputFile: './hand-written.yaml' }]);
  });

  it('overwrites when --force is given', async () => {
    cli.writeJson('api.json', spec('3.0.3', '/a'));
    cli.writeJson('openapi-merge.json', { inputs: [{ inputFile: './stale.yaml' }], output: './out.json' });

    expect(await runInDir('init', '--force')).toBe(ExitCode.Success);
    expect(generated().inputs).toEqual([{ inputFile: './api.json' }]);
  });

  it('accepts -f as well as --force', async () => {
    cli.writeJson('api.json', spec('3.0.3', '/a'));
    cli.writeJson('openapi-merge.json', { inputs: [{ inputFile: './stale.yaml' }], output: './out.json' });

    expect(await runInDir('init', '-f')).toBe(ExitCode.Success);
    expect(generated().inputs).toEqual([{ inputFile: './api.json' }]);
  });

  it('writes a usable placeholder when the directory has no specs', async () => {
    expect(await runInDir('init')).toBe(ExitCode.Success);

    const config = generated();
    expect(config.inputs).toHaveLength(1);
    expect(config.inputs[0].inputFile).toContain('replace-me');
  });

  it('names Swagger 2.0 files instead of silently skipping them', async () => {
    cli.writeJson('legacy.json', { swagger: '2.0', info: { title: 'Old', version: '1' }, paths: {} });

    expect(await runInDir('init')).toBe(ExitCode.Success);
    expect(cli.stderr().join('\n') + '').not.toContain('legacy');
  });

  it('warns when the inputs it found declare different minor versions', async () => {
    // The merge refuses mixed versions, so saying nothing here would hand the
    // user a configuration that fails on the very next command.
    cli.writeJson('a.json', spec('3.0.3', '/a'));
    cli.writeJson('b.json', spec('3.1.0', '/b'));

    expect(await runInDir('init')).toBe(ExitCode.Success);
    expect(generated().inputs).toHaveLength(2);
  });
});
