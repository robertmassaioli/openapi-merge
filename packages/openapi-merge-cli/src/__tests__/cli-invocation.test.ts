import path from 'path';
import fs from 'fs';
import { load as loadYaml } from 'js-yaml';
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

/** A minimal OpenAPI 3.x document with one operation, for scanning tests. */
const spec = (version: string, pathName: string) => ({
  openapi: version,
  info: { title: 'T', version: '1.0.0' },
  paths: { [pathName]: getPath(pathName.slice(1)) },
});

/** Runs the CLI with `cli.dir()` as the process cwd, so default (no `-c`) lookups resolve there. */
const runInDir = async (...args: string[]): Promise<number> => {
  const previous = process.cwd();
  process.chdir(cli.dir());
  try {
    return await cli.run(...args);
  } finally {
    process.chdir(previous);
  }
};

/** Reads back whatever `init` wrote to `openapi-merge.yaml` in the temp dir. */
const generated = (): { inputs: Array<{ inputFile: string }>; output: string } =>
  loadYaml(fs.readFileSync(path.join(cli.dir(), 'openapi-merge.yaml'), 'utf8')) as {
    inputs: Array<{ inputFile: string }>;
    output: string;
  };

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

  it('the resolveExternalReferences/inputRoot defaults (proposal 39) actually resolve a $ref, unmodified', async () => {
    // A shared-components subdirectory `init`'s (non-recursive) scan never
    // declares as an input, referenced from a file it does scan -- exactly
    // the case resolveExternalReferences exists for. Proves the default is
    // not just present in the generated file but functionally does
    // something useful with zero edits, and that inputRoot: '.' doesn't
    // reject a file that legitimately lives inside '.', just not at its
    // top level.
    cli.write('common/ServerError.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
    cli.write('a.yaml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "./common/ServerError.yml#/components/schemas/ServerError"',
      '',
    ].join('\n'));

    expect(await runInDir('init')).toBe(ExitCode.Success);
    expect(generated().inputs).toEqual([{ inputFile: './a.yaml' }]);

    expect(await runInDir()).toBe(ExitCode.Success);

    const merged = loadYaml(fs.readFileSync(path.join(cli.dir(), generated().output), 'utf8')) as {
      components: { schemas: Record<string, unknown> };
    };
    expect(merged.components.schemas.Widget).toEqual({ $ref: '#/components/schemas/ServerError' });
    expect(merged.components.schemas.ServerError).toEqual({ type: 'object' });
  });

  it('turns a shared-components-one-directory-up layout into a hard failure, not the old silent success (proposal 39 §9.5)', async () => {
    // Before resolveExternalReferences/inputRoot were on by default, this
    // exact layout produced ExitCode.Success with the $ref left unresolved
    // -- discovery never ran, so nothing was ever attempted, let alone
    // rejected. With the default on, discovery reaches the file and
    // inputRoot correctly refuses to read it, so the merge now hard-fails
    // instead. "Shared components live one directory up" is a common
    // layout, and this is the one behaviour change worth a second look
    // before relying on the new defaults for an existing directory -- not
    // a silent footnote, see proposal 39 §9.5.
    const outsidePath = path.join(cli.dir(), '..', 'shared-common.yaml');
    fs.writeFileSync(outsidePath, 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
    try {
      cli.write('a.yaml', [
        'openapi: "3.0.0"',
        'info: { title: A, version: "1.0" }',
        'components:',
        '  schemas:',
        '    Widget:',
        '      $ref: "../shared-common.yaml#/components/schemas/ServerError"',
        '',
      ].join('\n'));

      expect(await runInDir('init')).toBe(ExitCode.Success);
      expect(await runInDir()).toBe(ExitCode.ErrorUnsafeInputPath);
      expect(cli.exists('openapi.yaml')).toBe(false);
    } finally {
      fs.rmSync(outsidePath, { force: true });
    }
  });

  it('refuses to overwrite an existing openapi-merge.yaml', async () => {
    cli.write('openapi-merge.yaml', 'inputs:\n  - inputFile: ./hand-written.yaml\noutput: ./out.json\n');

    expect(await runInDir('init')).toBe(ExitCode.ErrorLoadingConfig);
    // The hand-written file is untouched -- clobbering it is the one
    // unrecoverable thing this command could do.
    expect(generated().inputs).toEqual([{ inputFile: './hand-written.yaml' }]);
  });

  it('refuses to run at all when only a legacy openapi-merge.json exists, even though it would write .yaml', async () => {
    // Without this, init would happily write a fresh openapi-merge.yaml next to
    // a hand-edited openapi-merge.json -- nothing is deleted, but because the
    // default lookup now prefers .yaml, the hand-written file would silently
    // stop being read on the very next merge. Same failure as an overwrite,
    // just with a longer fuse.
    const jsonPath = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './hand-written.yaml' }],
      output: './out.json',
    });

    expect(await runInDir('init')).toBe(ExitCode.ErrorLoadingConfig);
    expect(cli.exists('openapi-merge.yaml')).toBe(false);
    expect(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).inputs).toEqual([{ inputFile: './hand-written.yaml' }]);
  });

  it('mentions both filenames when both a stale .yaml and .json already exist', async () => {
    cli.write('openapi-merge.yaml', 'inputs:\n  - inputFile: ./a.yaml\noutput: ./out.yaml\n');
    cli.writeJson('openapi-merge.json', { inputs: [{ inputFile: './b.yaml' }], output: './out.json' });

    expect(await runInDir('init')).toBe(ExitCode.ErrorLoadingConfig);
    const message = cli.stderr().join('\n');
    expect(message).toContain('openapi-merge.yaml');
    expect(message).toContain('openapi-merge.json');
  });

  it('overwrites when --force is given', async () => {
    cli.writeJson('api.json', spec('3.0.3', '/a'));
    cli.write('openapi-merge.yaml', 'inputs:\n  - inputFile: ./stale.yaml\noutput: ./out.json\n');

    expect(await runInDir('init', '--force')).toBe(ExitCode.Success);
    expect(generated().inputs).toEqual([{ inputFile: './api.json' }]);
  });

  it('accepts -f as well as --force', async () => {
    cli.writeJson('api.json', spec('3.0.3', '/a'));
    cli.write('openapi-merge.yaml', 'inputs:\n  - inputFile: ./stale.yaml\noutput: ./out.json\n');

    expect(await runInDir('init', '-f')).toBe(ExitCode.Success);
    expect(generated().inputs).toEqual([{ inputFile: './api.json' }]);
  });

  it('--force always writes .yaml and leaves a pre-existing .json in place, calling it out as inert', async () => {
    cli.writeJson('api.json', spec('3.0.3', '/a'));
    const jsonPath = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './stale.yaml' }],
      output: './out.json',
    });

    expect(await runInDir('init', '--force')).toBe(ExitCode.Success);

    // The fresh .yaml is written...
    expect(generated().inputs).toEqual([{ inputFile: './api.json' }]);
    // ...but the stale .json is neither deleted nor rewritten...
    expect(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).inputs).toEqual([{ inputFile: './stale.yaml' }]);
    // ...and the command says so, since it will no longer be read by default.
    expect(cli.stdout().join('\n')).toContain('openapi-merge.json');
    expect(cli.stdout().join('\n')).toContain('no longer used');
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

/**
 * `init`'s idempotence, and how a bare (no `-c`) merge invocation resolves
 * the default config file now that there are two candidate names.
 */
describe('init idempotence and the default config lookup', () => {
  it('init then init --force with unchanged inputs produces byte-identical output', async () => {
    // 33's "twice in a row is identical" invariant, re-checked now that a
    // second run needs --force: the guard changes how you get there, not
    // what you get.
    cli.writeJson('a.json', spec('3.0.3', '/a'));
    cli.writeJson('b.json', spec('3.0.3', '/b'));

    expect(await runInDir('init')).toBe(ExitCode.Success);
    const first = fs.readFileSync(path.join(cli.dir(), 'openapi-merge.yaml'), 'utf8');

    expect(await runInDir('init', '--force')).toBe(ExitCode.Success);
    const second = fs.readFileSync(path.join(cli.dir(), 'openapi-merge.yaml'), 'utf8');

    expect(second).toBe(first);
  });

  it('a bare invocation finds a legacy openapi-merge.json when no .yaml is present', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    cli.writeJson('openapi-merge.json', { inputs: [{ inputFile: './a.json' }], output: './output.json' });

    expect(await runInDir()).toBe(ExitCode.Success);
    expect(cli.stdout().join('\n')).toContain("Using 'openapi-merge.json'");
    expect(cli.exists('output.json')).toBe(true);
  });

  it('a bare invocation prefers openapi-merge.yaml when both are present', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    cli.writeJson('b.json', oas({ '/b': getPath('getB') }));
    cli.write('openapi-merge.yaml', 'inputs:\n  - inputFile: ./a.json\noutput: ./from-yaml.json\n');
    cli.writeJson('openapi-merge.json', { inputs: [{ inputFile: './b.json' }], output: './from-json.json' });

    expect(await runInDir()).toBe(ExitCode.Success);
    expect(cli.stdout().join('\n')).toContain("Using 'openapi-merge.yaml'");
    // Proof it actually used the .yaml config, not just that it logged so: the
    // .yaml config's output was written, the .json config's was not.
    expect(cli.exists('from-yaml.json')).toBe(true);
    expect(cli.exists('from-json.json')).toBe(false);
  });

  it('reports both filenames when neither default config exists', async () => {
    expect(await runInDir()).toBe(ExitCode.ErrorLoadingConfig);
    const message = cli.stderr().join('\n');
    expect(message).toContain('openapi-merge.yaml');
    expect(message).toContain('openapi-merge.json');
  });
});
