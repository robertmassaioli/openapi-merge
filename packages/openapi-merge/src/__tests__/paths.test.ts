import { merge } from '../index';
import { Swagger } from '@atlassian/atlassian-openapi';
import { doc30, expectMergeError, expectSuccess, op, pathKeys } from './_helpers/documents';
import { toOAS } from "./_helpers/oas-generation";
import { expectMergeResult, toMergeInputs, expectErrorType } from "./_helpers/test-utils";
import { SingleMergeInput } from "../data";

describe('OAS Path Merge', () => {
  it('should merge paths where one paths is null', () => {
    const first = toOAS({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (first as any)['paths'] = null;

    const second = toOAS({
      '/path/b': {
        post: {
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/path/b': {
        post: {
          responses: {}
        }
      }
    });

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should merge paths from two files that do not overlap', () => {
    const first = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const second = toOAS({
      '/path/b': {
        post: {
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      },
      '/path/b': {
        post: {
          responses: {}
        }
      }
    });

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should ensure unique operationIds even if paths are different', () => {
    const first = toOAS({
      '/path/a': {
        get: {
          operationId: 'same',
          responses: {}
        }
      }
    });

    const second = toOAS({
      '/path/b': {
        post: {
          operationId: 'same',
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/path/a': {
        get: {
          operationId: 'same',
          responses: {}
        }
      },
      '/path/b': {
        post: {
          operationId: 'same1',
          responses: {}
        }
      }
    });

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should prefix paths correctly', () => {
    const first = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/service/path/a': {
        get: {
          responses: {}
        }
      }
    });

    expectMergeResult(merge([{ oas: first, pathModification: { prepend: '/service'}}]), {
      output
    });
  });

  it('should strip suffixed correctly', () => {
    const first = toOAS({
      '/rest/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    expectMergeResult(merge([{ oas: first, pathModification: { stripStart: '/rest'}}]), {
      output
    });
  });

  it('should strip first and then prefix paths', () => {
    const first = toOAS({
      '/rest/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/service/path/a': {
        get: {
          responses: {}
        }
      }
    });

    expectMergeResult(merge([{ oas: first, pathModification: { stripStart: '/rest', prepend: '/service' }}]), {
      output
    });
  });

  /**
   * TODO this is simpler logic to implement for now but, ideally, we would merge paths together if we could, if
   * the HTTP methods do not overlap. I can see a use case for two different services providing different methods
   * on the same path.
   */
  it('should return an error if there are duplicate paths (simple case)', () => {
    const first = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const second = toOAS({
      '/path/a': {
        post: {
          responses: {}
        }
      }
    });

    expectErrorType(merge(toMergeInputs([first, second])), 'duplicate-paths');
  });

  it('should return an error if modifying a path would result in a duplicate', () => {
    const first = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const second = toOAS({
      '/service/rest/path/a': {
        post: {
          responses: {}
        }
      }
    });

    const firstInput: SingleMergeInput = {
      oas: first,
      pathModification: {
        prepend: '/rest'
      }
    };

    const secondInput: SingleMergeInput = {
      oas: second,
      pathModification: {
        stripStart: '/service'
      }
    };

    expectErrorType(merge([firstInput, secondInput]), 'duplicate-paths');
  });

});

describe('3.0 edge: path templating equivalence', () => {
  it('KNOWN GAP: does not detect that /pets/{petId} and /pets/{name} are the same path', () => {
    // Spec, Paths Object: "Templated paths with the same hierarchy but different
    // templated names MUST NOT exist as they are identical." The spec names this
    // exact pair as "identical and invalid".
    //
    // The merge compares path strings, so it emits both and produces an invalid
    // document. Pinned rather than asserted-correct; fixing it means comparing
    // paths by their template shape.
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/pets/{petId}': { get: op('byId') } } }) },
      { oas: doc30({ paths: { '/pets/{name}': { get: op('byName') } } }) },
    ]));

    expect(pathKeys(output)).toEqual(['/pets/{name}', '/pets/{petId}']);
  });

  it('detects a genuinely identical path string as a duplicate', () => {
    // The string-equality case the implementation does handle.
    expectMergeError(merge([
      { oas: doc30({ paths: { '/pets/{petId}': { get: op('a') } } }) },
      { oas: doc30({ paths: { '/pets/{petId}': { get: op('b') } } }) },
    ]), 'duplicate-paths');
  });

  it('treats paths differing only in case as distinct', () => {
    // Paths are case-sensitive; /Pets and /pets are different resources.
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/pets': { get: op('lower') } } }) },
      { oas: doc30({ paths: { '/Pets': { get: op('upper') } } }) },
    ]));

    expect(pathKeys(output)).toEqual(['/Pets', '/pets']);
  });

  it('treats a trailing slash as a distinct path', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/pets': { get: op('noSlash') } } }) },
      { oas: doc30({ paths: { '/pets/': { get: op('slash') } } }) },
    ]));

    expect(pathKeys(output)).toEqual(['/pets', '/pets/']);
  });

  it('passes through a path that repeats a template expression', () => {
    // Spec: "Each template expression MUST NOT appear more than once in a single
    // path template." The merge is not a validator and does not reject it.
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/a/{id}/b/{id}': { get: op('dup') } } }) },
    ]));

    expect(pathKeys(output)).toEqual(['/a/{id}/b/{id}']);
  });
});

describe('3.0 edge: pathModification', () => {
  it('produces an empty path key when stripStart consumes the whole path', () => {
    // Documents the actual result; an empty path key is not a valid path, so
    // this is a case worth knowing about when configuring stripStart.
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/api': { get: op('a') } } }), pathModification: { stripStart: '/api' } },
    ]));

    expect(pathKeys(output)).toEqual(['']);
  });

  it('applies stripStart before prepend', () => {
    const output = expectSuccess(merge([
      {
        oas: doc30({ paths: { '/rest/thing': { get: op('a') } } }),
        pathModification: { stripStart: '/rest', prepend: '/v2' },
      },
    ]));

    expect(pathKeys(output)).toEqual(['/v2/thing']);
  });

  it('detects a duplicate created by pathModification rather than present in the inputs', () => {
    // Neither input has a duplicate path; prepending creates one.
    expectMergeError(merge([
      { oas: doc30({ paths: { '/thing': { get: op('a') } } }) },
      { oas: doc30({ paths: { '/api/thing': { get: op('b') } } }), pathModification: { stripStart: '/api' } },
    ]), 'duplicate-paths');
  });
});

describe('pathModification.stripStart', () => {
  const paths: Swagger.Paths = { '/api/thing': { get: { responses: { '200': { description: 'ok' } } } } };

  it('strips a prefix that is present', () => {
    const result = expectSuccess(merge([{ oas: toOAS(paths), pathModification: { stripStart: '/api' } }]));

    expect(Object.keys(result.paths ?? {})).toEqual(['/thing']);
  });

  it('leaves the path untouched when the prefix is absent', () => {
    const result = expectSuccess(merge([{ oas: toOAS(paths), pathModification: { stripStart: '/nope' } }]));

    expect(Object.keys(result.paths ?? {})).toEqual(['/api/thing']);
  });
});
