import { merge } from '..';
import { Swagger } from '@atlassian/atlassian-openapi';
import { isErrorResult, MergeResult, SingleMergeInput } from '../data';
import {
  parseOpenApiVersion,
  SUPPORTED_MINOR_VERSIONS,
  toMinorVersion,
  validateInputVersions,
} from '../openapi-version';

/** A minimal document declaring an arbitrary version, including invalid ones. */
function oasAtVersion(version: unknown): Swagger.SwaggerV3 {
  const doc: Record<string, unknown> = {
    info: { title: 'Test', version: '1.0.0' },
    paths: { '/thing': { get: { responses: { '200': { description: 'ok' } } } } },
  };
  if (version !== undefined) {
    doc.openapi = version;
  }
  return doc as unknown as Swagger.SwaggerV3;
}

function inputsAt(...versions: unknown[]): SingleMergeInput[] {
  return versions.map(v => ({ oas: oasAtVersion(v) }));
}

function expectError(result: MergeResult, type: string): string {
  if (!isErrorResult(result)) {
    throw new Error(`Expected an error, got a successful merge: ${JSON.stringify(result, null, 2)}`);
  }
  expect(result.type).toBe(type);
  return result.message;
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
  it('contains 3.0 and 3.1 after phase 2', () => {
    // Widened by each phase. This pins the contract so that adding a version is
    // a deliberate act with a failing test to update -- which is exactly what
    // happened when phase 2 added '3.1'.
    expect([...SUPPORTED_MINOR_VERSIONS]).toEqual(['3.0', '3.1']);
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
  it('rejects a 3.2 input and names the index and version', () => {
    const message = expectError(merge(inputsAt('3.2.0')), 'unsupported-openapi-version');

    expect(message).toContain('Input 0');
    expect(message).toContain('3.2.0');
    expect(message).toContain('3.1.x');
  });

  it('accepts a 3.1 input now that phase 2 supports it', () => {
    expect(isErrorResult(merge(inputsAt('3.1.1')))).toBe(false);
  });

  it('names the offending input when it is not the first', () => {
    const message = expectError(merge(inputsAt('3.0.3', '3.0.0', '3.2.0')), 'unsupported-openapi-version');

    expect(message).toContain('Input 2');
  });

  it('rejects a document with no openapi field', () => {
    const message = expectError(merge(inputsAt(undefined)), 'unsupported-openapi-version');

    expect(message).toContain('no "openapi" field');
  });

  it('rejects a malformed version and quotes what it found', () => {
    const message = expectError(merge(inputsAt('3.0')), 'unsupported-openapi-version');

    expect(message).toContain('"3.0"');
  });

  it('rejects a 2.0 (Swagger) input', () => {
    expect(expectError(merge(inputsAt('2.0.0')), 'unsupported-openapi-version')).toContain('2.0.0');
  });
});

describe('merge - mixed versions', () => {
  it('rejects inputs that disagree on minor version', () => {
    // Reachable for the first time in phase 2: both 3.0 and 3.1 are supported
    // individually, so the mixed rule is what stops them being merged together.
    const message = expectError(merge(inputsAt('3.0.3', '3.1.0')), 'mixed-openapi-versions');

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
    const result = merge(inputsAt('3.2.0', '3.2.0'));

    expectError(result, 'unsupported-openapi-version');
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
