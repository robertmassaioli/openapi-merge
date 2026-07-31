import { merge } from '../index';
import { Swagger } from '@atlassian/atlassian-openapi';
import { doc30, doc31, doc32, expectMergeError, expectSuccess, op, pathKeys } from './_helpers/documents';
import { toOAS } from "./_helpers/oas-generation";
import { expectMergeResult, toMergeInputs, expectErrorType } from "./_helpers/test-utils";
import { SingleMergeInput } from "../data";
import { PathItem32 } from "../oas31";

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

/**
 * Issue #71: configurable duplicate-path handling.
 *
 * A duplicate path was an unconditional hard error, which blocks the
 * API-gateway case this tool targets -- two teams legitimately exposing the
 * same route, where one of them should simply win.
 *
 * Per input rather than global, because what people want to express is "this
 * one input wins and the rest are additive", which a single global setting
 * cannot say. The default is unchanged, so nothing that worked before behaves
 * differently.
 */
describe('duplicatePathHandling (issue #71)', () => {
  const inputWith = (pathName: string, operationId: string, handling?: 'error' | 'skip-later' | 'prefer-later') => ({
    oas: doc30({ paths: { [pathName]: { get: op(operationId) } } }),
    ...(handling === undefined ? {} : { duplicatePathHandling: handling }),
  });

  it('still errors by default, with the option absent entirely', () => {
    const result = merge([inputWith('/a', 'first'), inputWith('/a', 'second')]);

    expectMergeError(result, 'duplicate-paths');
  });

  it("still errors when 'error' is set explicitly", () => {
    const result = merge([inputWith('/a', 'first'), inputWith('/a', 'second', 'error')]);

    expectMergeError(result, 'duplicate-paths');
  });

  it("keeps the earlier definition under 'skip-later'", () => {
    const output = expectSuccess(merge([inputWith('/a', 'first'), inputWith('/a', 'second', 'skip-later')]));

    expect(output.paths?.['/a']?.get?.operationId).toBe('first');
  });

  it("takes the later definition under 'prefer-later'", () => {
    const output = expectSuccess(merge([inputWith('/a', 'first'), inputWith('/a', 'second', 'prefer-later')]));

    expect(output.paths?.['/a']?.get?.operationId).toBe('second');
  });

  it('leaves non-colliding paths from the skipped input alone', () => {
    const output = expectSuccess(
      merge([
        inputWith('/a', 'first'),
        {
          oas: doc30({ paths: { '/a': { get: op('second') }, '/b': { get: op('other') } } }),
          duplicatePathHandling: 'skip-later' as const,
        },
      ]),
    );

    // Only the colliding path is dropped; the input is not discarded wholesale.
    expect(pathKeys(output)).toEqual(['/a', '/b']);
    expect(output.paths?.['/a']?.get?.operationId).toBe('first');
    expect(output.paths?.['/b']?.get?.operationId).toBe('other');
  });

  it('does not consume operationIds from a skipped path', () => {
    // A discarded path must not push a later, unrelated operation onto a
    // numeric suffix by colliding with something that is not in the output.
    const output = expectSuccess(
      merge([
        inputWith('/a', 'shared'),
        { oas: doc30({ paths: { '/a': { get: op('ignored') } } }), duplicatePathHandling: 'skip-later' as const },
        { oas: doc30({ paths: { '/c': { get: op('ignored') } } }) },
      ]),
    );

    expect(output.paths?.['/c']?.get?.operationId).toBe('ignored');
  });

  it('releases the replaced operationId under prefer-later', () => {
    // Without releasing it, the winning operation would collide with the id of
    // the definition it just replaced and be renamed `shared1` -- leaving a
    // document where `shared` exists nowhere.
    const output = expectSuccess(
      merge([
        inputWith('/a', 'shared'),
        { oas: doc30({ paths: { '/a': { get: op('shared') } } }), duplicatePathHandling: 'prefer-later' as const },
      ]),
    );

    expect(output.paths?.['/a']?.get?.operationId).toBe('shared');
  });

  it('applies to a duplicate created by pathModification, not just to identical keys', () => {
    const output = expectSuccess(
      merge([
        { oas: doc30({ paths: { '/api/a': { get: op('first') } } }) },
        {
          oas: doc30({ paths: { '/a': { get: op('second') } } }),
          pathModification: { prepend: '/api' },
          duplicatePathHandling: 'skip-later',
        },
      ]),
    );

    expect(output.paths?.['/api/a']?.get?.operationId).toBe('first');
  });

  it('applies to webhooks, which collide by event name the same way', () => {
    const output = expectSuccess(
      merge([
        { oas: doc31({ paths: {}, webhooks: { ping: { post: op('firstPing') } } }) },
        {
          oas: doc31({ paths: {}, webhooks: { ping: { post: op('secondPing') } } }),
          duplicatePathHandling: 'prefer-later',
        },
      ]),
    );

    expect(output.webhooks?.ping?.post?.operationId).toBe('secondPing');
  });

  /**
   * Two inputs sharing a path but using DIFFERENT methods.
   *
   * `GET /thing` from one service and `POST /thing` from another could in
   * principle be combined into one path item holding both. This policy does
   * not do that: it chooses between whole Path Items, so whichever one loses
   * takes its operations with it. Both non-error policies therefore discard an
   * operation that does not collide with anything.
   *
   * `merge-operations` now combines them where the answer is unambiguous; the
   * two tests below pin what the OTHER policies still do, which is discard.
   *
   * Combining per method is a different decision from choosing between items --
   * choosing *between* path items versus merging *inside* one -- and it raises
   * questions this policy does not answer: a Path Item carries its own
   * `parameters`, which are inherited by every operation in it, plus
   * `summary`, `description` and `servers`, and it may be a `$ref`. Silently
   * unioning the operations while one input's path-level `parameters` win
   * would change the meaning of the other input's operations.
   *
   * These tests exist so the loss is visible and cannot drift unnoticed. If a
   * per-method policy is ever added, they are what says the gap was closed.
   */
  describe('paths that share a key but not a method', () => {
    const getOnly = { oas: doc30({ paths: { '/thing': { get: op('getThing') } } }) };
    const postOnly = (handling: 'skip-later' | 'prefer-later') => ({
      oas: doc30({ paths: { '/thing': { post: op('postThing') } } }),
      duplicatePathHandling: handling,
    });

    it('KNOWN LIMITATION: skip-later drops the later input\'s non-colliding method', () => {
      const output = expectSuccess(merge([getOnly, postOnly('skip-later')]));

      // POST /thing collided with nothing, and is gone anyway.
      expect(Object.keys(output.paths?.['/thing'] ?? {})).toEqual(['get']);
    });

    it('KNOWN LIMITATION: prefer-later drops the earlier input\'s non-colliding method', () => {
      const output = expectSuccess(merge([getOnly, postOnly('prefer-later')]));

      expect(Object.keys(output.paths?.['/thing'] ?? {})).toEqual(['post']);
    });

    it('still errors by default, which at least loses nothing silently', () => {
      // The default refuses rather than guessing, so a user who would be
      // surprised by either policy above is told instead.
      expectMergeError(merge([getOnly, { oas: doc30({ paths: { '/thing': { post: op('postThing') } } }) }]), 'duplicate-paths');
    });
  });

  /**
   * `merge-operations` (issue #71): combine two path items that share a key but
   * not a method.
   *
   * Only where the answer is unambiguous. Every refusal is a case where a
   * plausible union would silently change what one input's operations mean.
   */
  describe("duplicatePathHandling: 'merge-operations'", () => {
    const merged = (a: PathItem32, b: PathItem32, handling: 'merge-operations' = 'merge-operations') =>
      merge([
        { oas: doc32({ paths: { '/thing': a } }) },
        { oas: doc32({ paths: { '/thing': b } }), duplicatePathHandling: handling },
      ]);

    it('combines GET from one input with POST from another', () => {
      const output = expectSuccess(merged({ get: op('getThing') }, { post: op('postThing') }));

      expect(pathKeys(output)).toEqual(['/thing']);
      expect(Object.keys(output.paths?.['/thing'] ?? {}).sort()).toEqual(['get', 'post']);
      expect(output.paths?.['/thing']?.get?.operationId).toBe('getThing');
      expect(output.paths?.['/thing']?.post?.operationId).toBe('postThing');
    });

    it('leaves a non-colliding path from the same input alone', () => {
      const output = expectSuccess(
        merge([
          { oas: doc32({ paths: { '/thing': { get: op('getThing') } } }) },
          {
            oas: doc32({ paths: { '/thing': { post: op('postThing') }, '/other': { get: op('getOther') } } }),
            duplicatePathHandling: 'merge-operations',
          },
        ]),
      );

      expect(pathKeys(output)).toEqual(['/other', '/thing']);
    });

    it('disambiguates an operationId that collides with one already merged', () => {
      // The incoming operation joins a document that already holds the other,
      // so it is subject to the same uniqueness rule as any other operation.
      const output = expectSuccess(merged({ get: op('shared') }, { post: op('shared') }));

      expect(output.paths?.['/thing']?.get?.operationId).toBe('shared');
      expect(output.paths?.['/thing']?.post?.operationId).toBe('shared1');
    });

    it('applies a dispute prefix to the incoming operation', () => {
      const output = expectSuccess(
        merge([
          { oas: doc32({ paths: { '/thing': { get: op('thing') } } }) },
          {
            oas: doc32({ paths: { '/thing': { post: op('thing') } } }),
            duplicatePathHandling: 'merge-operations',
            dispute: { prefix: 'Svc' },
          },
        ]),
      );

      expect(output.paths?.['/thing']?.post?.operationId).toBe('Svcthing');
    });

    it('refuses when both define the same method', () => {
      const message = expectMergeError(merged({ get: op('a') }, { get: op('b') }), 'duplicate-paths');

      expect(message).toContain('GET');
      expect(message).toContain("'/thing'");
    });

    it('refuses when path-level parameters differ', () => {
      const message = expectMergeError(
        merged(
          { parameters: [{ name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } }], get: op('g') },
          { post: op('p') },
        ),
        'duplicate-paths',
      );

      expect(message).toContain("'parameters'");
    });

    it('refuses when either side is a $ref path item', () => {
      const message = expectMergeError(
        merged({ $ref: '#/components/pathItems/Shared' }, { post: op('p') }),
        'duplicate-paths',
      );

      expect(message).toContain('$ref');
    });

    it('combines across a pathModification-created duplicate', () => {
      const output = expectSuccess(
        merge([
          { oas: doc32({ paths: { '/api/thing': { get: op('getThing') } } }) },
          {
            oas: doc32({ paths: { '/thing': { post: op('postThing') } } }),
            pathModification: { prepend: '/api' },
            duplicatePathHandling: 'merge-operations',
          },
        ]),
      );

      expect(Object.keys(output.paths?.['/api/thing'] ?? {}).sort()).toEqual(['get', 'post']);
    });

    it('combines three inputs contributing three methods', () => {
      const output = expectSuccess(
        merge([
          { oas: doc32({ paths: { '/thing': { get: op('g') } } }) },
          { oas: doc32({ paths: { '/thing': { post: op('p') } } }), duplicatePathHandling: 'merge-operations' },
          { oas: doc32({ paths: { '/thing': { delete: op('d') } } }), duplicatePathHandling: 'merge-operations' },
        ]),
      );

      expect(Object.keys(output.paths?.['/thing'] ?? {}).sort()).toEqual(['delete', 'get', 'post']);
    });

    it('refuses on the third input if it collides with either earlier one', () => {
      const message = expectMergeError(
        merge([
          { oas: doc32({ paths: { '/thing': { get: op('g') } } }) },
          { oas: doc32({ paths: { '/thing': { post: op('p') } } }), duplicatePathHandling: 'merge-operations' },
          { oas: doc32({ paths: { '/thing': { get: op('g2') } } }), duplicatePathHandling: 'merge-operations' },
        ]),
        'duplicate-paths',
      );

      expect(message).toContain('GET');
    });

    it('is per input, so another input can still use error', () => {
      // The third input has no policy, so the default applies to it even though
      // the second merged successfully.
      expectMergeError(
        merge([
          { oas: doc32({ paths: { '/thing': { get: op('g') } } }) },
          { oas: doc32({ paths: { '/thing': { post: op('p') } } }), duplicatePathHandling: 'merge-operations' },
          { oas: doc32({ paths: { '/thing': { delete: op('d') } } }) },
        ]),
        'duplicate-paths',
      );
    });

    it('combines webhooks that share an event name but not a method', () => {
      const output = expectSuccess(
        merge([
          { oas: doc31({ paths: {}, webhooks: { ping: { post: op('onPing') } } }) },
          {
            oas: doc31({ paths: {}, webhooks: { ping: { get: op('checkPing') } } }),
            duplicatePathHandling: 'merge-operations',
          },
        ]),
      );

      expect(Object.keys(output.webhooks?.ping ?? {}).sort()).toEqual(['get', 'post']);
    });

    it('refuses an overlapping webhook method with duplicate-webhooks', () => {
      const message = expectMergeError(
        merge([
          { oas: doc31({ paths: {}, webhooks: { ping: { post: op('a') } } }) },
          {
            oas: doc31({ paths: {}, webhooks: { ping: { post: op('b') } } }),
            duplicatePathHandling: 'merge-operations',
          },
        ]),
        'duplicate-webhooks',
      );

      expect(message).toContain('POST');
    });
  });

  it('still errors on duplicate webhooks by default', () => {
    const result = merge([
      { oas: doc31({ paths: {}, webhooks: { ping: { post: op('a') } } }) },
      { oas: doc31({ paths: {}, webhooks: { ping: { post: op('b') } } }) },
    ]);

    expectMergeError(result, 'duplicate-webhooks');
  });
});
