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
 * Issue #45: merging without a configuration file.
 *
 * Inputs can be given as positional arguments instead. These cover the wiring
 * and the mode rules; the Configuration-building itself is unit-tested in
 * synthesize-configuration.test.ts, where the output defaulting can be asserted
 * without depending on the working directory.
 */
describe('positional inputs, no config file (issue #45)', () => {
  it('merges two positional files', async () => {
    const a = cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const b = cli.writeJson('b.json', oas({ '/b': getPath('getB') }));
    const out = path.join(cli.dir(), 'out.json');

    expect(await cli.run(a, b, '-o', out)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8')).paths).sort()).toEqual(['/a', '/b']);
  });

  it('merges a single positional file', async () => {
    const a = cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const out = path.join(cli.dir(), 'out.json');

    expect(await cli.run(a, '-o', out)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8')).paths)).toEqual(['/a']);
  });

  it('applies --prepend to every positional input', async () => {
    const a = cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const b = cli.writeJson('b.json', oas({ '/b': getPath('getB') }));
    const out = path.join(cli.dir(), 'out.json');

    expect(await cli.run(a, b, '-o', out, '--prepend', '/api')).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8')).paths).sort()).toEqual(['/api/a', '/api/b']);
  });

  it('applies --dispute-prefix to every positional input', async () => {
    // Both inputs define a different `Thing`, so without a dispute the second
    // would be renamed `Thing1`; with one it takes the prefix instead.
    const a = cli.writeJson('a.json', {
      ...(oas({ '/a': getPath('getA') }) as Record<string, unknown>),
      components: { schemas: { Thing: { type: 'string' } } },
    });
    const b = cli.writeJson('b.json', {
      ...(oas({ '/b': getPath('getB') }) as Record<string, unknown>),
      components: { schemas: { Thing: { type: 'number' } } },
    });
    const out = path.join(cli.dir(), 'out.json');

    expect(await cli.run(a, b, '-o', out, '--dispute-prefix', 'Svc')).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8')).components.schemas).sort()).toEqual([
      'SvcThing',
      'Thing',
    ]);
  });

  it('refuses --config together with positional inputs', async () => {
    const a = cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run(a, '-c', config)).toBe(ExitCode.ErrorLoadingConfig);
    expect(cli.stderr().join('\n')).toContain('Cannot use both --config and positional');
  });

  it('still uses the config file when no positional inputs are given', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(Object.keys(JSON.parse(cli.read()).paths)).toEqual(['/a']);
  });

  it('reports a missing positional input rather than merging nothing', async () => {
    const out = path.join(cli.dir(), 'out.json');

    expect(await cli.run(path.join(cli.dir(), 'nope.json'), '-o', out)).toBe(ExitCode.ErrorLoadingInputs);
  });
});
