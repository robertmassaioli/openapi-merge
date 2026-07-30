import { ExitCode } from '../index';
import { getPath, installCliHarness, oas } from './_helpers/cli-harness';

/**
 * Driving the real CLI through a successful merge.
 *
 * Config in, merged document out: single input, multiple inputs, path
 * modification, dispute resolution, and YAML input parsing.
 */

const cli = installCliHarness();

describe('main - successful merges', () => {
  it('merges a single input and writes the output', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read());
    expect(Object.keys(output.paths)).toEqual(['/a']);
  });

  it('merges two inputs with disjoint paths', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    cli.writeJson('b.json', oas({ '/b': getPath('getB') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(cli.read()).paths).sort()).toEqual(['/a', '/b']);
  });

  it('applies pathModification.prepend', async () => {
    cli.writeJson('a.json', oas({ '/thing': getPath('getThing') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json', pathModification: { prepend: '/api' } }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(cli.read()).paths)).toEqual(['/api/thing']);
  });

  it('resolves an operationId conflict using dispute.prefix', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getThing') }));
    cli.writeJson('b.json', oas({ '/b': getPath('getThing') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json', dispute: { prefix: 'second' } }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(JSON.parse(cli.read()).paths['/b'].get.operationId).toBe('secondgetThing');
  });

  it('reads a YAML input file', async () => {
    cli.write('a.yaml', 'openapi: 3.0.3\ninfo:\n  title: Y\n  version: "1"\npaths:\n  /y:\n    get:\n      responses:\n        "200":\n          description: ok\n');
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.yaml' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(cli.read()).paths)).toEqual(['/y']);
  });
});

/**
 * Issue #4: `serversStrategy` reaching the library from a config file.
 *
 * The library-level behaviour is covered by the openapi-merge suite; what these
 * assert is the wiring -- that the field survives ajv validation against the
 * generated schema and is actually passed to `merge()`, which is the part that
 * would silently do nothing if the plumbing were wrong.
 */
describe('main - serversStrategy (issue #4)', () => {
  const withServers = (paths: Record<string, unknown>, url: string) => ({
    ...(oas(paths) as Record<string, unknown>),
    servers: [{ url }],
  });

  it('defaults to first-wins when serversStrategy is absent', async () => {
    cli.writeJson('a.json', withServers({ '/a': getPath('getA') }, 'https://first'));
    cli.writeJson('b.json', withServers({ '/b': getPath('getB') }, 'https://second'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(JSON.parse(cli.read()).servers).toEqual([{ url: 'https://first' }]);
  });

  it('concatenates servers when serversStrategy is "concat"', async () => {
    cli.writeJson('a.json', withServers({ '/a': getPath('getA') }, 'https://first'));
    cli.writeJson('b.json', withServers({ '/b': getPath('getB') }, 'https://second'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
      serversStrategy: 'concat',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(JSON.parse(cli.read()).servers.map((s: { url: string }) => s.url)).toEqual([
      'https://first',
      'https://second',
    ]);
  });

  it('rejects an unknown serversStrategy value against the generated schema', async () => {
    cli.writeJson('a.json', withServers({ '/a': getPath('getA') }, 'https://first'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      serversStrategy: 'combine-somehow',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });
});

/**
 * Issue #71: duplicate-path policy reaching the library from a config file.
 *
 * Library behaviour is covered by the openapi-merge suite; these assert the
 * wiring -- that the per-input field survives schema validation and is actually
 * passed through `convertInputs`, which is the part that would silently do
 * nothing if the plumbing were wrong.
 */
describe('main - duplicatePathHandling (issue #71)', () => {
  it('fails on a duplicate path by default', async () => {
    cli.writeJson('a.json', oas({ '/same': getPath('fromA') }));
    cli.writeJson('b.json', oas({ '/same': getPath('fromB') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorMerging);
  });

  it('keeps the first definition with skip-later', async () => {
    cli.writeJson('a.json', oas({ '/same': getPath('fromA') }));
    cli.writeJson('b.json', oas({ '/same': getPath('fromB') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json', duplicatePathHandling: 'skip-later' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(JSON.parse(cli.read()).paths['/same'].get.operationId).toBe('fromA');
  });

  it('takes the last definition with prefer-later', async () => {
    cli.writeJson('a.json', oas({ '/same': getPath('fromA') }));
    cli.writeJson('b.json', oas({ '/same': getPath('fromB') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json', duplicatePathHandling: 'prefer-later' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(JSON.parse(cli.read()).paths['/same'].get.operationId).toBe('fromB');
  });

  it('rejects an unknown policy value against the generated schema', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json', duplicatePathHandling: 'last-one-wins' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });
});

/**
 * Issue #76: pinning the emitted OpenAPI version from a config file.
 */
describe('main - openapiVersion (issue #76)', () => {
  it('negotiates from the inputs when unset', async () => {
    cli.writeJson('a.json', { openapi: '3.0.1', info: { title: 'A', version: '1' }, paths: { '/a': getPath('getA') } });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(JSON.parse(cli.read()).openapi).toBe('3.0.1');
  });

  it('emits the pinned version', async () => {
    cli.writeJson('a.json', { openapi: '3.0.1', info: { title: 'A', version: '1' }, paths: { '/a': getPath('getA') } });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      openapiVersion: '3.0.3',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(JSON.parse(cli.read()).openapi).toBe('3.0.3');
  });

  it('exits 9 when the pinned minor does not match the inputs', async () => {
    cli.writeJson('a.json', { openapi: '3.0.1', info: { title: 'A', version: '1' }, paths: { '/a': getPath('getA') } });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      openapiVersion: '3.1.0',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorOpenApiVersion);
  });

  it('rejects a malformed version against the generated schema', async () => {
    cli.writeJson('a.json', { openapi: '3.0.1', info: { title: 'A', version: '1' }, paths: { '/a': getPath('getA') } });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      openapiVersion: 'latest',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });
});
