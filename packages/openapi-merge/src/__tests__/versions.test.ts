import { merge } from '../index';
import { Swagger } from '@atlassian/atlassian-openapi';
import {
  parseOpenApiVersion, SUPPORTED_MINOR_VERSIONS, toMinorVersion, validateInputVersions,
} from '../openapi-version';
import { NarrowedMergeInput, SingleMergeInput, isErrorResult } from '../data';
import { OpenApiDocument } from '../oas31';
import { doc31, doc32, expectSuccess, expectMergeError, ok, op } from './_helpers/documents';

/**
 * OpenAPI version handling: parsing the `openapi` field, which versions are
 * supported, refusing unsupported and mixed inputs, and which version the
 * merged document declares.
 *
 * The supported set is a single constant, and this suite pins its contract so
 * that widening it is always a deliberate act with a failing test to update.
 */

/** A document declaring an arbitrary version, including invalid ones. */
function oasAtVersion(version: unknown): Swagger.SwaggerV3 {
  const d: Record<string, unknown> = {
    info: { title: 'Test', version: '1.0.0' },
    paths: { '/thing': { get: { responses: ok } } },
  };
  if (version !== undefined) {
    d.openapi = version;
  }
  return d as unknown as Swagger.SwaggerV3;
}

function inputsAt(...versions: unknown[]): NarrowedMergeInput {
  return versions.map(v => ({ oas: oasAtVersion(v) }));
}

describe('parseOpenApiVersion', () => {
  it('parses a full version', () => {
    expect(parseOpenApiVersion('3.0.3')).toEqual({ major: 3, minor: 0, patch: 3, raw: '3.0.3' });
  });

  it('parses versions this library does not yet support', () => {
    // Parsing and supporting are separate concerns; a 3.1 document must parse
    // so that the error message can name its version.
    expect(parseOpenApiVersion('3.1.1')).toEqual({ major: 3, minor: 1, patch: 1, raw: '3.1.1' });
    expect(parseOpenApiVersion('3.2.0')).toEqual({ major: 3, minor: 2, patch: 0, raw: '3.2.0' });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseOpenApiVersion('  3.0.0  ')?.raw).toBe('3.0.0');
  });

  it('handles multi-digit components', () => {
    expect(parseOpenApiVersion('3.10.12')).toEqual({ major: 3, minor: 10, patch: 12, raw: '3.10.12' });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 3],
    ['an object', {}],
    ['empty', ''],
    ['major only', '3'],
    ['major.minor only', '3.0'],
    ['a v prefix', 'v3.0.0'],
    ['non-numeric', 'three.oh.oh'],
    ['a range', '^3.0.0'],
    ['four components', '3.0.0.1'],
  ])('rejects %s', (_label, value) => {
    expect(parseOpenApiVersion(value)).toBeUndefined();
  });
});

describe('toMinorVersion', () => {
  it('drops the patch component', () => {
    expect(toMinorVersion({ major: 3, minor: 0, patch: 3, raw: '3.0.3' })).toBe('3.0');
  });
});

describe('SUPPORTED_MINOR_VERSIONS', () => {
  it('contains every published 3.x version after phase 3', () => {
    // Widened by each phase. This pins the contract so that adding a version is
    // a deliberate act with a failing test to update -- which is what happened
    // when phase 2 added '3.1' and phase 3 added '3.2'.
    expect([...SUPPORTED_MINOR_VERSIONS]).toEqual(['3.0', '3.1', '3.2']);
  });
});

describe('validateInputVersions', () => {
  it('accepts a single supported input', () => {
    expect(validateInputVersions(inputsAt('3.0.3'))).toBeUndefined();
  });

  it('accepts differing patch versions within one minor', () => {
    // 3.0.0 and 3.0.3 are the same feature set; this is not a mismatch.
    expect(validateInputVersions(inputsAt('3.0.0', '3.0.3', '3.0.1'))).toBeUndefined();
  });

  it('accepts no inputs at all', () => {
    expect(validateInputVersions([])).toBeUndefined();
  });
});

describe('merge - unsupported versions', () => {
  it('rejects a 3.3 input and names the index and version', () => {
    const message = expectMergeError(merge(inputsAt('3.3.0')), 'unsupported-openapi-version');

    expect(message).toContain('Input 0');
    expect(message).toContain('3.3.0');
    expect(message).toContain('3.2.x');
  });

  it('accepts 3.1 and 3.2 inputs now that phases 2 and 3 support them', () => {
    expect(isErrorResult(merge(inputsAt('3.1.1')))).toBe(false);
    expect(isErrorResult(merge(inputsAt('3.2.0')))).toBe(false);
  });

  it('names the offending input when it is not the first', () => {
    const message = expectMergeError(merge(inputsAt('3.0.3', '3.0.0', '3.3.0')), 'unsupported-openapi-version');

    expect(message).toContain('Input 2');
  });

  it('rejects a document with no openapi field', () => {
    const message = expectMergeError(merge(inputsAt(undefined)), 'unsupported-openapi-version');

    expect(message).toContain('no "openapi" field');
  });

  it('rejects a malformed version and quotes what it found', () => {
    const message = expectMergeError(merge(inputsAt('3.0')), 'unsupported-openapi-version');

    expect(message).toContain('"3.0"');
  });

  it('rejects a 2.0 (Swagger) input', () => {
    expect(expectMergeError(merge(inputsAt('2.0.0')), 'unsupported-openapi-version')).toContain('2.0.0');
  });
});

describe('merge - mixed versions', () => {
  it('rejects inputs that disagree on minor version', () => {
    // Reachable for the first time in phase 2: both 3.0 and 3.1 are supported
    // individually, so the mixed rule is what stops them being merged together.
    const message = expectMergeError(merge(inputsAt('3.0.3', '3.1.0')), 'mixed-openapi-versions');

    expect(message).toContain('3.0.x');
    expect(message).toContain('3.1.x');
  });

  it('reports a mixed-version error when both minors are supported', () => {
    // In phase 1 only '3.0' is supported, so a second minor is always caught as
    // unsupported before the mixed check can fire. Passing an explicit
    // supported list exercises the rule that phase 2 will make reachable, so
    // widening SUPPORTED_MINOR_VERSIONS cannot silently lose this behaviour.
    const result = validateInputVersions(inputsAt('3.0.3', '3.1.0'), ['3.0', '3.1']);

    if (result === undefined) {
      throw new Error('Expected a mixed-openapi-versions error');
    }
    expect(result.type).toBe('mixed-openapi-versions');
    expect(result.message).toContain('3.0.x');
    expect(result.message).toContain('3.1.x');
  });

  it('names every input that declared each version', () => {
    const result = validateInputVersions(inputsAt('3.0.3', '3.1.0', '3.0.0'), ['3.0', '3.1']);

    // inputs 0 and 2 are 3.0; input 1 is 3.1
    expect(result?.message).toContain('inputs 0, 2');
    expect(result?.message).toContain('input 1');
  });

  it('accepts agreeing inputs even with a wider supported list', () => {
    expect(validateInputVersions(inputsAt('3.1.0', '3.1.1'), ['3.0', '3.1'])).toBeUndefined();
  });
});

describe('merge - version checking runs first', () => {
  it('reports the version error rather than a merge conflict', () => {
    // These two inputs also have duplicate paths, which would normally be a
    // 'duplicate-paths' error. The version problem must win, because nothing
    // should be merged at all.
    const result = merge(inputsAt('3.3.0', '3.3.0'));

    expectMergeError(result, 'unsupported-openapi-version');
  });

  it('still merges valid 3.0 inputs normally', () => {
    const first: SingleMergeInput = { oas: oasAtVersion('3.0.3') };
    const second: SingleMergeInput = {
      oas: {
        ...oasAtVersion('3.0.0'),
        paths: { '/other': { get: { responses: { '200': { description: 'ok' } } } } },
      },
    };

    const result = merge([first, second]);

    if (isErrorResult(result)) {
      throw new Error(`Expected a successful merge, got: ${result.message}`);
    }
    expect(Object.keys(result.output.paths ?? {}).sort()).toEqual(['/other', '/thing']);
  });
});

describe('output version negotiation', () => {
  it('declares the highest patch among 3.1 inputs', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ openapi: '3.1.0', paths: {} }) },
      { oas: doc31({ openapi: '3.1.1', paths: {} }) },
    ]));

    expect(output.openapi).toBe('3.1.1');
  });

  it('declares the input version for 3.0 rather than a hard-coded 3.0.3', () => {
    const output = expectSuccess(merge([{ oas: doc31({ openapi: '3.0.0', paths: {} }) }]));

    expect(output.openapi).toBe('3.0.0');
  });

  it('declares the highest patch among 3.0 inputs', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ openapi: '3.0.0', paths: { '/a': { get: { responses: ok } } } }) },
      { oas: doc31({ openapi: '3.0.3', paths: { '/b': { get: { responses: ok } } } }) },
    ]));

    expect(output.openapi).toBe('3.0.3');
  });
});

describe('3.1 edge: version rules', () => {
  it('refuses a 3.0 input mixed with a 3.1 input', () => {
    expectMergeError(merge([
      { oas: doc31({ openapi: '3.0.3', paths: { '/a': { get: op('a') } } }) },
      { oas: doc31({ openapi: '3.1.1', paths: { '/b': { get: op('b') } } }) },
    ]), 'mixed-openapi-versions');
  });

  it('accepts differing 3.1 patch versions and reports the highest', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ openapi: '3.1.0', paths: { '/a': { get: op('a') } } }) },
      { oas: doc31({ openapi: '3.1.1', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.openapi).toBe('3.1.1');
  });
});

describe('3.2 edge: version rules', () => {
  it('refuses a 3.1 input mixed with a 3.2 input', () => {
    expectMergeError(merge([
      { oas: doc32({ openapi: '3.1.1', paths: { '/a': { get: op('a') } } }) },
      { oas: doc32({ openapi: '3.2.0', paths: { '/b': { get: op('b') } } }) },
    ]), 'mixed-openapi-versions');
  });

  it('refuses a 3.3 input, which does not exist yet', () => {
    expectMergeError(merge([
      { oas: doc32({ openapi: '3.3.0', paths: { '/a': { get: op('a') } } }) },
    ]), 'unsupported-openapi-version');
  });
});

describe('3.2 - version rules', () => {
  it('refuses a mix of 3.1 and 3.2 inputs', () => {
    const result = merge([
      { oas: doc32({ openapi: '3.1.1', paths: { '/a': { get: op('getA') } } }) },
      { oas: doc32({ openapi: '3.2.0', paths: { '/b': { get: op('getB') } } }) },
    ]);

    if (!isErrorResult(result)) {
      throw new Error('Expected a mixed-openapi-versions error');
    }
    expect(result.type).toBe('mixed-openapi-versions');
  });

  it('declares 3.2.0 on the output', () => {
    const output = expectSuccess(merge([{ oas: doc32({ paths: { '/a': { get: op('getA') } } }) }]));

    expect(output.openapi).toBe('3.2.0');
  });
});

/**
 * Issue #76: pinning the emitted `openapi` version.
 *
 * Phase 1 made the output version negotiated from the inputs rather than
 * hardcoded, which is the right default. What was still missing is the ability
 * to *choose* it -- typically to pin an exact patch level a downstream
 * generator insists on.
 *
 * The minor is not negotiable. 3.1 is not a compatible superset of 3.0
 * (`nullable` became a type union, `exclusiveMinimum` changed from boolean to
 * numeric), so relabelling would declare conformance to rules the document's
 * own contents break.
 */
describe('openapiVersion override (issue #76)', () => {
  const at = (version: string) => ({
    oas: { openapi: version, info: { title: 'T', version: '1' }, paths: {} } as OpenApiDocument,
  });

  it('negotiates from the inputs when no override is given', () => {
    const output = expectSuccess(merge([at('3.0.1'), at('3.0.3')]));

    expect(output.openapi).toBe('3.0.3');
  });

  it('emits an explicit patch version when pinned', () => {
    const output = expectSuccess(merge([at('3.0.3')], { openapiVersion: '3.0.0' }));

    // Deliberately lower than the input: pinning is for satisfying a
    // downstream tool, and within a minor the patch carries no features.
    expect(output.openapi).toBe('3.0.0');
  });

  it('accepts a pin equal to the negotiated version', () => {
    const output = expectSuccess(merge([at('3.1.1')], { openapiVersion: '3.1.1' }));

    expect(output.openapi).toBe('3.1.1');
  });

  it('refuses a pin whose minor differs from the inputs', () => {
    const message = expectMergeError(merge([at('3.0.3')], { openapiVersion: '3.1.0' }), 'mixed-openapi-versions');

    expect(message).toContain('3.1.0');
    expect(message).toContain('3.0');
  });

  it('refuses a pin this library cannot emit at all', () => {
    const message = expectMergeError(merge([at('3.0.3')], { openapiVersion: '4.0.0' }), 'unsupported-openapi-version');

    expect(message).toContain('4.0.0');
  });

  it('refuses a pin that is not a version string', () => {
    expectMergeError(merge([at('3.0.3')], { openapiVersion: 'latest' }), 'unsupported-openapi-version');
  });

  it('leaves the merged content untouched when pinning', () => {
    const output = expectSuccess(
      merge(
        [
          { oas: { openapi: '3.0.3', info: { title: 'A', version: '1' }, paths: { '/a': { get: { responses: { '200': { description: 'ok' } } } } } } as OpenApiDocument },
        ],
        { openapiVersion: '3.0.1' },
      ),
    );

    expect(output.openapi).toBe('3.0.1');
    expect(Object.keys(output.paths ?? {})).toEqual(['/a']);
  });
});
