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
 * Issue #102: the info override reaching the library from a config file.
 */
describe('main - info override (issue #102)', () => {
  const named = (title: string, path: string, opId: string) => ({
    openapi: '3.0.3',
    info: { title, version: '1.0.0' },
    paths: { [path]: getPath(opId) },
  });

  it('titles the output after the first input by default', async () => {
    cli.writeJson('a.json', named('Service A', '/a', 'getA'));
    cli.writeJson('b.json', named('Service B', '/b', 'getB'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(JSON.parse(cli.read()).info.title).toBe('Service A');
  });

  it('applies a title override, keeping the version', async () => {
    cli.writeJson('a.json', named('Service A', '/a', 'getA'));
    cli.writeJson('b.json', named('Service B', '/b', 'getB'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
      info: { title: 'Combined API' },
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    const info = JSON.parse(cli.read()).info;
    expect(info.title).toBe('Combined API');
    expect(info.version).toBe('1.0.0');
  });

  it('rejects an unknown info field against the generated schema', async () => {
    cli.writeJson('a.json', named('Service A', '/a', 'getA'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      info: { titel: 'typo' },
    });

    // --noExtraProps is what makes a typo an error rather than a silent no-op.
    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });
});

/**
 * Issue #112: per-input tag injection reaching the library from a config file.
 */
describe('main - tag injection (issue #112)', () => {
  it('tags every operation from the configured input', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    cli.writeJson('b.json', oas({ '/b': getPath('getB') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [
        { inputFile: './a.json', tag: { name: 'service-a', description: 'Service A.' } },
        { inputFile: './b.json' },
      ],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read());
    expect(output.paths['/a'].get.tags).toEqual(['service-a']);
    expect(output.paths['/b'].get.tags).toBeUndefined();
    expect(output.tags).toEqual([{ name: 'service-a', description: 'Service A.' }]);
  });

  it('rejects a tag injection with no name against the generated schema', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json', tag: { description: 'no name' } }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });

  it('rejects an empty tag name', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json', tag: { name: '' } }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });
});
