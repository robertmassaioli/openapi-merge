import http from 'http';
import { ExitCode } from '../index';
import { installCliHarness } from './_helpers/cli-harness';

/**
 * Cross-document `$ref` resolution driven through the real CLI end to end
 * (issues #104 and #10).
 *
 * Two behaviours, deliberately tested apart:
 * - Resolving a `$ref` into another *declared* input (#104) is unconditional
 *   -- no config flag needed, and it must keep working even with
 *   `resolveExternalReferences` absent.
 * - Discovering and loading a `$ref` into a file/URL nobody declared as an
 *   input (#10) only happens when `resolveExternalReferences: true` is set.
 */

const cli = installCliHarness();

describe('#104 -- refs into another declared input (unconditional)', () => {
  it('resolves the reported repro with resolveExternalReferences absent from the config', async () => {
    cli.write('specs/common/ServerError.yml', [
      'openapi: "3.0.0"',
      'components:',
      '  schemas:',
      '    ServerError:',
      '      type: object',
      '',
    ].join('\n'));
    cli.write('specs/a/Api.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'paths:',
      '  /a:',
      '    get:',
      '      operationId: getA',
      '      responses:',
      '        "200": { description: ok }',
      '        default:',
      '          description: server error',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "../common/ServerError.yml#/components/schemas/ServerError"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/common/ServerError.yml' }, { inputFile: './specs/a/Api.yml' }],
      output: './bundle.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read('bundle.json'));
    expect(output.paths['/a'].get.responses.default.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ServerError',
    });
    expect(output.components.schemas.ServerError).toEqual({ type: 'object' });
  });

  it('leaves a ref to a file that is NOT a declared input normalised but unresolved, with the flag absent', async () => {
    // Normalising to an absolute identity happens unconditionally (it's how
    // #104 matching works at all) -- but with no matching declared input and
    // discovery off, nothing further happens: the component is not pulled in.
    cli.write('specs/common/ServerError.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
    cli.write('specs/a/Api.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "../common/ServerError.yml#/components/schemas/ServerError"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a/Api.yml' }],
      output: './bundle.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read('bundle.json'));
    expect(output.components.schemas.Widget.$ref).not.toBe('#/components/schemas/ServerError');
    expect(output.components.schemas.Widget.$ref).toContain('ServerError.yml#/components/schemas/ServerError');
    expect(output.components.schemas.ServerError).toBeUndefined();
  });
});

describe('#10 -- discovering files nobody declared as an input (resolveExternalReferences: true)', () => {
  it('pulls in a component from a file that is not a declared input', async () => {
    cli.write('specs/common/ServerError.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
    cli.write('specs/a/Api.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "../common/ServerError.yml#/components/schemas/ServerError"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a/Api.yml' }],
      output: './bundle.json',
      resolveExternalReferences: true,
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read('bundle.json'));
    expect(output.components.schemas.Widget).toEqual({ $ref: '#/components/schemas/ServerError' });
    expect(output.components.schemas.ServerError).toEqual({ type: 'object' });
  });

  it('follows a chain of discovery across more than one undeclared file', async () => {
    cli.write('specs/c.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    Inner:\n      type: string\n');
    cli.write('specs/b.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    Wrapper:\n      $ref: "./c.yml#/components/schemas/Inner"\n');
    cli.write('specs/a.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "./b.yml#/components/schemas/Wrapper"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a.yml' }],
      output: './bundle.json',
      resolveExternalReferences: true,
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read('bundle.json'));
    expect(output.components.schemas.Widget).toEqual({ $ref: '#/components/schemas/Wrapper' });
    expect(output.components.schemas.Wrapper).toEqual({ $ref: '#/components/schemas/Inner' });
    expect(output.components.schemas.Inner).toEqual({ type: 'string' });
  });

  it('does not hang when two discovered files reference each other (file-level, not component-level, cycle)', async () => {
    // b.yml and a.yml refer to each other's *different* components -- normal
    // in a shared-components layout, and not the same thing as a component
    // transitively referencing itself.
    cli.write('specs/b.yml', [
      'openapi: "3.0.0"',
      'components:',
      '  schemas:',
      '    FromB:',
      '      type: string',
      '    BackToA:',
      '      $ref: "./a.yml#/components/schemas/FromA"',
      '',
    ].join('\n'));
    cli.write('specs/a.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    FromA:',
      '      type: string',
      '    Widget:',
      '      $ref: "./b.yml#/components/schemas/FromB"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a.yml' }],
      output: './bundle.json',
      resolveExternalReferences: true,
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read('bundle.json'));
    expect(output.components.schemas.Widget).toEqual({ $ref: '#/components/schemas/FromB' });
  });

  it('reports a merge error (not a hang or crash) for a genuinely cyclic component reference', async () => {
    cli.write('specs/x.yml', [
      'openapi: "3.0.0"',
      'components:',
      '  schemas:',
      '    A:',
      '      $ref: "#/components/schemas/B"',
      '    B:',
      '      $ref: "#/components/schemas/A"',
      '',
    ].join('\n'));
    cli.write('specs/a.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "./x.yml#/components/schemas/A"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a.yml' }],
      output: './bundle.json',
      resolveExternalReferences: true,
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorMerging);
    expect(cli.stderr().join('\n')).toContain('cyclic-external-reference');
  });

  it('warns and leaves the ref unresolved when a discovered file cannot be loaded, without failing the merge', async () => {
    cli.write('specs/a.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "./does-not-exist.yml#/components/schemas/ServerError"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a.yml' }],
      output: './bundle.json',
      resolveExternalReferences: true,
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);

    const output = JSON.parse(cli.read('bundle.json'));
    expect(output.components.schemas.Widget.$ref).toContain('does-not-exist.yml#/components/schemas/ServerError');
    expect(cli.stdout().join('\n')).toContain('WARNING');
    expect(cli.stdout().join('\n')).toContain('does-not-exist.yml');
  });

  it('discovers and loads a component from a URL referenced by a file input', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/errors.yaml') {
        res.writeHead(200, { 'Content-Type': 'application/yaml' });
        res.end('openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;

      cli.write('specs/a.yml', [
        'openapi: "3.0.0"',
        'info: { title: A, version: "1.0" }',
        'components:',
        '  schemas:',
        '    Widget:',
        `      $ref: "http://127.0.0.1:${port}/errors.yaml#/components/schemas/ServerError"`,
        '',
      ].join('\n'));
      const config = cli.writeJson('openapi-merge.json', {
        inputs: [{ inputFile: './specs/a.yml' }],
        output: './bundle.json',
        resolveExternalReferences: true,
      });

      expect(await cli.run('-c', config)).toBe(ExitCode.Success);

      const output = JSON.parse(cli.read('bundle.json'));
      expect(output.components.schemas.Widget).toEqual({ $ref: '#/components/schemas/ServerError' });
      expect(output.components.schemas.ServerError).toEqual({ type: 'object' });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe('inputRoot -- containing discovered files (proposal 38)', () => {
  it('aborts the merge when a discovered file resolves outside inputRoot', async () => {
    // '../common/ServerError.yml' escapes 'specs/a', the directory inputRoot
    // is set to -- discovery must never read it.
    cli.write('specs/common/ServerError.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
    cli.write('specs/a/Api.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "../common/ServerError.yml#/components/schemas/ServerError"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a/Api.yml' }],
      output: './bundle.json',
      resolveExternalReferences: true,
      inputRoot: './specs/a',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorUnsafeInputPath);
    expect(cli.exists('bundle.json')).toBe(false);
    const stderr = cli.stderr().join('\n');
    expect(stderr).toContain('ServerError.yml');
    expect(stderr).toContain('inputRoot');
  });

  it('succeeds when the discovered file stays inside inputRoot', async () => {
    cli.write('specs/a/common/ServerError.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
    cli.write('specs/a/Api.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "./common/ServerError.yml#/components/schemas/ServerError"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a/Api.yml' }],
      output: './bundle.json',
      resolveExternalReferences: true,
      inputRoot: './specs/a',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    const output = JSON.parse(cli.read('bundle.json'));
    expect(output.components.schemas.ServerError).toEqual({ type: 'object' });
  });

  it('reports every discovered-file violation in a run, not just the first', async () => {
    // Both declared inputs load fine (containment for those is checked
    // eagerly, before discovery ever starts), but each pulls in a different
    // out-of-root file -- the worklist must keep draining past the first
    // violation so both surface together.
    cli.write('specs/common/ServerError.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
    cli.write('specs/common/NotFound.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    NotFound:\n      type: object\n');
    cli.write('specs/a/Api.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "../common/ServerError.yml#/components/schemas/ServerError"',
      '',
    ].join('\n'));
    cli.write('specs/a/Api2.yml', [
      'openapi: "3.0.0"',
      'components:',
      '  schemas:',
      '    Gadget:',
      '      $ref: "../common/NotFound.yml#/components/schemas/NotFound"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a/Api.yml' }, { inputFile: './specs/a/Api2.yml' }],
      output: './bundle.json',
      resolveExternalReferences: true,
      inputRoot: './specs/a',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorUnsafeInputPath);
    const stderr = cli.stderr().join('\n');
    expect(stderr).toContain('ServerError.yml');
    expect(stderr).toContain('NotFound.yml');
  });

  it('keeps an ordinary discovery warning and a containment violation distinct in the same run', async () => {
    // A missing file, reached via one ref, and an out-of-root file, reached
    // via another -- the two failure modes must not get conflated: a
    // containment violation is fatal, a missing file is not.
    cli.write('specs/common/ServerError.yml', 'openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
    cli.write('specs/a/Api.yml', [
      'openapi: "3.0.0"',
      'info: { title: A, version: "1.0" }',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "./does-not-exist.yml#/components/schemas/ServerError"',
      '    Gadget:',
      '      $ref: "../common/ServerError.yml#/components/schemas/ServerError"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './specs/a/Api.yml' }],
      output: './bundle.json',
      resolveExternalReferences: true,
      inputRoot: './specs/a',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorUnsafeInputPath);
    expect(cli.exists('bundle.json')).toBe(false);
    // The missing-file warning must still be reported, not hidden behind the
    // fatal containment violation -- otherwise fixing inputRoot and re-running
    // would be the only way to learn about it.
    expect(cli.stdout().join('\n')).toContain('does-not-exist.yml');
    expect(cli.stderr().join('\n')).toContain('ServerError.yml');
  });

  it('does not restrict a discovered URL, only discovered local files', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/errors.yaml') {
        res.writeHead(200, { 'Content-Type': 'application/yaml' });
        res.end('openapi: "3.0.0"\ncomponents:\n  schemas:\n    ServerError:\n      type: object\n');
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;

      cli.write('specs/a/Api.yml', [
        'openapi: "3.0.0"',
        'info: { title: A, version: "1.0" }',
        'components:',
        '  schemas:',
        '    Widget:',
        `      $ref: "http://127.0.0.1:${port}/errors.yaml#/components/schemas/ServerError"`,
        '',
      ].join('\n'));
      const config = cli.writeJson('openapi-merge.json', {
        inputs: [{ inputFile: './specs/a/Api.yml' }],
        output: './bundle.json',
        resolveExternalReferences: true,
        inputRoot: './specs/a',
      });

      expect(await cli.run('-c', config)).toBe(ExitCode.Success);
      const output = JSON.parse(cli.read('bundle.json'));
      expect(output.components.schemas.ServerError).toEqual({ type: 'object' });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe('resolveExternalReferences schema validation', () => {
  it('rejects a non-boolean value', async () => {
    cli.write('a.json', JSON.stringify({ openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: {} }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './out.json',
      resolveExternalReferences: 'yes',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorLoadingConfig);
  });
});
