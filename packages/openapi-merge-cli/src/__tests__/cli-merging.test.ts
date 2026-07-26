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
