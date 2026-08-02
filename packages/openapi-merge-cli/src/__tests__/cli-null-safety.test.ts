import { ExitCode } from '../index';
import { getPath, installCliHarness, oas } from './_helpers/cli-harness';

/**
 * The three confirmed repros from ai-planning/40-proposal-null-safe-document-walking.md
 * §2.2, driven through the real CLI end to end.
 *
 * `merge()`'s own catch (exercised directly in openapi-merge's test suite) is
 * not the only place a `null` in a structural slot can surface: every declared
 * input's own references are walked once, unconditionally, by
 * `normalizeCrossDocumentRefs` (issue #104) *before* `merge()` is ever called
 * -- so a malformed declared input is typically caught there first. These
 * tests are what proves that path produces a clean exit code and message too,
 * not a raw stack trace.
 */

const cli = installCliHarness();

describe('null in a structural slot, end to end (issue #92 / proposal 40)', () => {
  it('a whole component left empty exits ErrorMerging with a clear message, not a stack trace', async () => {
    cli.write('a.yaml', [
      'openapi: "3.0.3"',
      'info: { title: A, version: "1.0" }',
      'paths: {}',
      'components:',
      '  schemas:',
      '    Widget:',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.yaml' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorMerging);
    const message = cli.stderr().join('\n');
    expect(message).toContain('malformed-document');
    expect(message).not.toContain('is not an Object');
    expect(message).not.toContain("Cannot use 'in' operator");
    expect(cli.exists('output.json')).toBe(false);
  });

  it('an empty operation exits ErrorMerging, the single most likely YAML slip', async () => {
    cli.write('a.yaml', [
      'openapi: "3.0.3"',
      'info: { title: A, version: "1.0" }',
      'paths:',
      '  /a:',
      '    get:',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.yaml' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.ErrorMerging);
    expect(cli.stderr().join('\n')).toContain('malformed-document');
    expect(cli.exists('output.json')).toBe(false);
  });

  it('a malformed discovered document degrades to one clean warning, not a warning followed by a crash', async () => {
    // `common.yaml` is never declared as an input -- only reachable via the
    // `$ref` below, and only loaded because resolveExternalReferences is on.
    cli.write('common.yaml', [
      'openapi: "3.0.3"',
      'info: { title: Common, version: "1.0" }',
      'paths: {}',
      'components:',
      '  schemas:',
      '    Errors:',
      '',
    ].join('\n'));
    cli.write('a.yaml', [
      'openapi: "3.0.3"',
      'info: { title: A, version: "1.0" }',
      'paths: {}',
      'components:',
      '  schemas:',
      '    Widget:',
      '      $ref: "./common.yaml#/components/schemas/Errors"',
      '',
    ].join('\n'));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.yaml' }],
      output: './output.json',
      resolveExternalReferences: true,
    });

    // Before the fix this produced a WARNING (discovery's try/catch masking
    // the crash) immediately followed by an uncaught TypeError a few lines
    // later, in `pullInComponent` -- one malformed file, two different,
    // neither-clear outcomes. Now: one warning, a successful merge with the
    // ref left exactly as written (never resolved), exit 0.
    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
    expect(cli.stdout().join('\n')).toContain('could not load');
    expect(cli.exists('output.json')).toBe(true);
    const output = JSON.parse(cli.read('output.json'));
    // Left unresolved -- normalised to the discovered file's absolute
    // identity (issue #104), but never rewritten to a local `#/...` pointer,
    // since the component it would have named was never actually loaded.
    expect(output.components.schemas.Widget.$ref).toContain('common.yaml#/components/schemas/Errors');
  });

  it('a clean merge still succeeds unaffected', async () => {
    cli.writeJson('a.json', oas({ '/a': getPath('getA') }));
    const config = cli.writeJson('openapi-merge.json', {
      inputs: [{ inputFile: './a.json' }],
      output: './output.json',
    });

    expect(await cli.run('-c', config)).toBe(ExitCode.Success);
  });
});
