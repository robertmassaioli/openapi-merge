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

  it('applies operationSelection.excludePaths from the config, wildcard included (proposal 43 / PR #67)', async () => {
    cli.writeJson('a.json', oas({
      '/admin/users': getPath('adminUsers'),
      '/admin/roles': getPath('adminRoles'),
      '/public/status': getPath('status'),
    }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json', operationSelection: { excludePaths: [{ path: '/admin/*' }] } }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(cli.read()).paths)).toEqual(['/public/status']);
  });
});

/**
 * Proposal 47: `extensionMergeStrategies` reaching the library from a config
 * file (issue #60, generalised).
 *
 * The strategy-tree algorithm itself is covered exhaustively by
 * `extension-merge-strategies.test.ts` in the library package; what these
 * assert is the wiring -- that the recursive tree survives ajv validation
 * against the generated schema (including its self-referencing `item`/`fields`)
 * and is actually passed to `merge()`.
 */
describe('main - extensionMergeStrategies (issue #60, proposal 47)', () => {
  const withTagGroups = (pathName: string, opId: string, tagGroups: unknown) => ({
    openapi: '3.0.3',
    info: { title: 'T', version: '1.0.0' },
    paths: { [pathName]: { get: { operationId: opId, responses: { '200': { description: 'ok' } } } } },
    'x-tagGroups': tagGroups,
  });

  it('combines x-tagGroups via a union-by-key + merge tree', async () => {
    cli.writeJson('a.json', withTagGroups('/a', 'getA', [{ name: 'User', tags: ['get-user'] }]));
    cli.writeJson('b.json', withTagGroups('/b', 'getB', [{ name: 'User', tags: ['get-user', 'delete-user'] }, { name: 'Admin', tags: ['admin-only'] }]));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
      extensionMergeStrategies: {
        'x-tagGroups': {
          kind: 'array',
          strategy: 'union-by-key',
          key: 'name',
          item: { kind: 'object', strategy: 'merge', fields: { tags: { kind: 'array', strategy: 'concat-unique' } } },
        },
      },
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    expect(JSON.parse(cli.read())['x-tagGroups']).toEqual([
      { name: 'User', tags: ['get-user', 'delete-user'] },
      { name: 'Admin', tags: ['admin-only'] },
    ]);
  });

  it('leaves an unconfigured extension first-wins even while another extension is configured', async () => {
    cli.writeJson('a.json', { ...withTagGroups('/a', 'getA', [{ name: 'User', tags: ['a'] }]), 'x-vendor': { from: 'a' } });
    cli.writeJson('b.json', { ...withTagGroups('/b', 'getB', [{ name: 'User', tags: ['b'] }]), 'x-vendor': { from: 'b' } });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
      extensionMergeStrategies: {
        'x-tagGroups': {
          kind: 'array',
          strategy: 'union-by-key',
          key: 'name',
          item: { kind: 'object', strategy: 'merge', fields: { tags: { kind: 'array', strategy: 'concat-unique' } } },
        },
      },
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read());
    expect(output['x-tagGroups']).toEqual([{ name: 'User', tags: ['a', 'b'] }]);
    expect(output['x-vendor']).toEqual({ from: 'a' });
  });

  it("exits with an error when a scalar extension configured 'error' finds disagreement", async () => {
    cli.writeJson('a.json', { openapi: '3.0.3', info: { title: 'T', version: '1.0.0' }, paths: { '/a': getPath('getA') }, 'x-owner': 'team-a' });
    cli.writeJson('b.json', { openapi: '3.0.3', info: { title: 'T', version: '1.0.0' }, paths: { '/b': getPath('getB') }, 'x-owner': 'team-b' });
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
      extensionMergeStrategies: { 'x-owner': { kind: 'scalar', strategy: 'error' } },
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorMerging);
    expect(cli.stderr().join('\n')).toContain('x-owner');
  });

  it('rejects an unknown strategy value against the generated schema', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      extensionMergeStrategies: { 'x-owner': { kind: 'scalar', strategy: 'combine-somehow' } },
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });

  it('rejects a union-by-key node with no `item` against the generated schema', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      extensionMergeStrategies: { 'x-tagGroups': { kind: 'array', strategy: 'union-by-key', key: 'name' } },
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
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
 * Issue #94: component pruning reaching the library from a config file.
 */
describe('main - pruneUnusedComponents (issue #94)', () => {
  const withSchemas = (paths: Record<string, unknown>) => ({
    openapi: '3.0.3',
    info: { title: 'A', version: '1.0.0' },
    paths,
    components: { schemas: { Used: { type: 'object' }, Unused: { type: 'object' } } },
  });

  const usesUsed = {
    get: {
      operationId: 'getA',
      responses: {
        '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Used' } } } },
      },
    },
  };

  it('keeps unused components by default', async () => {
    cli.writeJson('a.json', withSchemas({ '/a': usesUsed }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(Object.keys(JSON.parse(cli.read()).components.schemas).sort()).toEqual(['Unused', 'Used']);
  });

  it('drops unused components when enabled', async () => {
    cli.writeJson('a.json', withSchemas({ '/a': usesUsed }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      pruneUnusedComponents: true,
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(Object.keys(JSON.parse(cli.read()).components.schemas)).toEqual(['Used']);
  });

  it('rejects a non-boolean value against the generated schema', async () => {
    cli.writeJson('a.json', withSchemas({ '/a': usesUsed }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
      pruneUnusedComponents: 'yes',
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

/**
 * Issue #33: securitySchemesStrategy reaching the library from a config file.
 */
describe('main - securitySchemesStrategy (issue #33)', () => {
  const withScheme = (pathName: string, opId: string, headerName: string) => ({
    openapi: '3.0.3',
    info: { title: 'T', version: '1.0.0' },
    paths: { [pathName]: { get: { operationId: opId, responses: { '200': { description: 'ok' } }, security: [{ auth: [] }] } } },
    components: { securitySchemes: { auth: { type: 'apiKey', in: 'header', name: headerName } } },
  });

  const twoInputs = (strategy?: string) => {
    cli.writeJson('a.json', withScheme('/a', 'getA', 'X-First'));
    cli.writeJson('b.json', withScheme('/b', 'getB', 'X-Second'));
    return cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json' }],
      output: './output.json',
      ...(strategy === undefined ? {} : { securitySchemesStrategy: strategy }),
    });
  };

  it('merges by default', async () => {
    expect(await cli.run('-c', twoInputs())).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read());
    expect(Object.keys(output.components.securitySchemes).sort()).toEqual(['auth', 'auth1']);
    expect(output.paths['/b'].get.security).toEqual([{ auth1: [] }]);
  });

  it("keeps only the first input's schemes with 'first'", async () => {
    expect(await cli.run('-c', twoInputs('first'))).toBe(ExitCode.Success);

    expect(Object.keys(JSON.parse(cli.read()).components.securitySchemes)).toEqual(['auth']);
  });

  it("exits 3 with 'error' when two inputs disagree about a scheme", async () => {
    expect(await cli.run('-c', twoInputs('error'))).toBe(ExitCode.ErrorMerging);
    expect(cli.stderr().join('\n')).toContain('auth');
  });

  it('rejects an unknown strategy against the generated schema', async () => {
    expect(await cli.run('-c', twoInputs('combine-somehow'))).toBe(ExitCode.ErrorLoadingConfig);
  });
});

/**
 * Issue #71 `merge-operations` reaching the library from a config file.
 */
describe('main - duplicatePathHandling: merge-operations (issue #71)', () => {
  it('combines GET and POST on the same path', async () => {
    cli.writeJson('a.json', oas({ '/thing': { get: { operationId: 'getThing', responses: { '200': { description: 'ok' } } } } }));
    cli.writeJson('b.json', oas({ '/thing': { post: { operationId: 'postThing', responses: { '200': { description: 'ok' } } } } }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json', duplicatePathHandling: 'merge-operations' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(Object.keys(JSON.parse(cli.read()).paths['/thing']).sort()).toEqual(['get', 'post']);
  });

  it('exits 3 with an explanation when the methods overlap', async () => {
    cli.writeJson('a.json', oas({ '/thing': getPath('a') }));
    cli.writeJson('b.json', oas({ '/thing': getPath('b') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }, { inputFile: './b.json', duplicatePathHandling: 'merge-operations' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorMerging);
    // The message has to say WHY, or the user cannot tell this from a plain
    // duplicate-path failure.
    expect(cli.stderr().join('\n')).toContain('GET');
  });

  it('accepts merge-operations as a schema value', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json', duplicatePathHandling: 'merge-operations' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
  });
});
