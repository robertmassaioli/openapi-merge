import { merge } from '..';
import { Swagger } from '@atlassian/atlassian-openapi';
import { isErrorResult, MergeResult } from '../data';
import { OpenApiDocument } from '../oas31';

/**
 * Edge cases for the OpenAPI 3.2 constructs, derived from the specification.
 *
 * 3.2 is additive over 3.1, so most of it passes through a merge untouched. The
 * parts that interact with merge logic are the ones that add *operation slots*
 * (`query`, `additionalOperations`), because every place that reasons about "the
 * operations in a path item" has to know about them, and `$self`, because it is
 * the one field whose correct merge behaviour is to disappear.
 */

const ok = { '200': { description: 'ok' } };
const op = (operationId: string): Swagger.Operation => ({ operationId, responses: ok });
const tagged = (operationId: string, tags: string[]): Swagger.Operation => ({ operationId, responses: ok, tags });

/** See the note in spec-edge-cases-31: 3.1+ Schema Objects are JSON Schema 2020-12. */
function schema(shape: Record<string, unknown>): Swagger.Schema {
  return shape as unknown as Swagger.Schema;
}

function doc(partial: Partial<OpenApiDocument>): OpenApiDocument {
  return { openapi: '3.2.0', info: { title: 'Test', version: '1.0.0' }, ...partial } as OpenApiDocument;
}

function expectSuccess(result: MergeResult): OpenApiDocument {
  if (isErrorResult(result)) {
    throw new Error(`Expected success, got ${result.type}: ${result.message}`);
  }
  return result.output;
}

function expectError(result: MergeResult, type: string): void {
  if (!isErrorResult(result)) {
    throw new Error(`Expected ${type}, got success: ${JSON.stringify(result, null, 2)}`);
  }
  expect(result.type).toBe(type);
}

/** Read a deeply nested value by key path. */
function at(root: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], root);
}

const item = (o: OpenApiDocument, path: string): Record<string, unknown> =>
  (o.paths ?? {})[path] as unknown as Record<string, unknown>;

describe('3.2 edge: query as a ninth method', () => {
  it('keeps query alongside the eight classic methods on one path item', () => {
    const output = expectSuccess(merge([{ oas: doc({ paths: { '/a': {
      get: op('g'), put: op('pu'), post: op('po'), delete: op('d'),
      options: op('o'), head: op('h'), patch: op('pa'), trace: op('t'),
      query: op('q'),
    } } }) }]));

    expect(Object.keys(item(output, '/a')).sort()).toEqual([
      'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'query', 'trace',
    ]);
  });

  it('counts query when deciding whether a path item is empty', () => {
    // The regression guard for the measured bug: query-only path items scored
    // zero operations and the whole endpoint was deleted.
    const output = expectSuccess(merge([{ oas: doc({ paths: {
      '/queryOnly': { query: op('q') },
      '/reallyEmpty': {},
    } }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/queryOnly']);
  });

  it('allows a query operation to carry a requestBody', () => {
    // QUERY exists precisely so a read can have a body; the merge must not
    // strip it the way some tooling strips GET bodies.
    const output = expectSuccess(merge([{ oas: doc({ paths: { '/search': { query: {
      operationId: 'q',
      responses: ok,
      requestBody: { content: { 'application/json': { schema: schema({ type: 'object' }) } } },
    } } } }) }]));

    expect(at(item(output, '/search'), 'query', 'requestBody', 'content', 'application/json', 'schema'))
      .toEqual({ type: 'object' });
  });
});

describe('3.2 edge: additionalOperations', () => {
  it('keeps several custom verbs on one path item', () => {
    const output = expectSuccess(merge([{ oas: doc({ paths: { '/r': {
      additionalOperations: { PURGE: op('p'), LOCK: op('l'), UNLOCK: op('u') },
    } } }) }]));

    expect(Object.keys(at(item(output, '/r'), 'additionalOperations') as object).sort())
      .toEqual(['LOCK', 'PURGE', 'UNLOCK']);
  });

  it('treats custom verbs as case-sensitive distinct keys', () => {
    // additionalOperations keys are opaque strings to the merge; PURGE and purge
    // are two entries, not one.
    const output = expectSuccess(merge([{ oas: doc({ paths: { '/r': {
      additionalOperations: { PURGE: op('upper'), purge: op('lower') },
    } } }) }]));

    expect(Object.keys(at(item(output, '/r'), 'additionalOperations') as object).sort())
      .toEqual(['PURGE', 'purge']);
  });

  it('keeps a custom verb whose name shadows a standard method', () => {
    // A path item may legally hold both `get` and additionalOperations.GET; they
    // live in different places and must not be conflated.
    const output = expectSuccess(merge([{ oas: doc({ paths: { '/r': {
      get: op('standardGet'),
      additionalOperations: { GET: op('customGet') },
    } } }) }]));

    expect(at(item(output, '/r'), 'get', 'operationId')).toBe('standardGet');
    expect(at(item(output, '/r'), 'additionalOperations', 'GET', 'operationId')).toBe('customGet');
  });

  it('resolves an operationId clash between a standard method and a custom verb', () => {
    const output = expectSuccess(merge([{ oas: doc({ paths: { '/r': {
      get: op('same'),
      additionalOperations: { PURGE: op('same') },
    } } }) }]));

    const ids = [
      at(item(output, '/r'), 'get', 'operationId'),
      at(item(output, '/r'), 'additionalOperations', 'PURGE', 'operationId'),
    ].sort();
    expect(ids).toEqual(['same', 'same1']);
  });

  it('leaves an empty additionalOperations object alone without dropping the path', () => {
    const output = expectSuccess(merge([{ oas: doc({ paths: {
      '/r': { get: op('g'), additionalOperations: {} },
    } }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/r']);
  });

  it('drops a path item whose only additionalOperations entry is filtered out', () => {
    // After tag exclusion removes the sole custom verb, nothing is left. The
    // operation count runs before selection, so the entry survives as an empty
    // object -- pinned so the shape is known.
    const output = expectSuccess(merge([{
      oas: doc({ paths: { '/r': { additionalOperations: { PURGE: tagged('p', ['internal']) } } } }),
      operationSelection: { excludeTags: ['internal'] },
    }]));

    expect(Object.keys(output.paths ?? {})).toEqual([]);
  });
});

describe('3.2 edge: $self', () => {
  it('keeps $self for a single input', () => {
    const output = expectSuccess(merge([
      { oas: doc({ $self: 'https://example.com/a', paths: { '/a': { get: op('a') } } }) },
    ]));

    expect(output.$self).toBe('https://example.com/a');
  });

  it('drops $self when two inputs both declare one', () => {
    const output = expectSuccess(merge([
      { oas: doc({ $self: 'https://example.com/a', paths: { '/a': { get: op('a') } } }) },
      { oas: doc({ $self: 'https://example.com/b', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.$self).toBeUndefined();
  });

  it('drops $self even when only one of several inputs declares it', () => {
    // The merged document is still not that input, so inheriting its identity
    // would be wrong regardless of how many others stayed silent.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } } }) },
      { oas: doc({ $self: 'https://example.com/b', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.$self).toBeUndefined();
  });
});

describe('3.2 edge: tags', () => {
  it('carries summary, parent and kind on a single tag', () => {
    const output = expectSuccess(merge([{ oas: doc({
      tags: [{ name: 'admin', summary: 'Admin APIs', parent: 'root', kind: 'nav' }],
      paths: { '/a': { get: op('a') } },
    }) }]));

    expect(output.tags).toEqual([{ name: 'admin', summary: 'Admin APIs', parent: 'root', kind: 'nav' }]);
  });

  it('keeps the first definition when two inputs declare the same tag name differently', () => {
    // Tag names must be unique, so one definition has to win; the 3.2 fields do
    // not change that, and the second input's parent is discarded with it.
    const output = expectSuccess(merge([
      { oas: doc({ tags: [{ name: 'shared', kind: 'nav' }], paths: { '/a': { get: op('a') } } }) },
      { oas: doc({ tags: [{ name: 'shared', kind: 'badge', parent: 'other' }], paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.tags).toEqual([{ name: 'shared', kind: 'nav' }]);
  });

  it('KNOWN LIMITATION: a tag parent may be left dangling', () => {
    // Input 1's tag declares parent 'group', but only input 1 defined 'group'
    // and excludeTags removes it. Nothing validates that a parent still exists,
    // so the surviving tag points at a tag that is no longer present.
    const output = expectSuccess(merge([{
      oas: doc({
        tags: [{ name: 'group', kind: 'nav' }, { name: 'child', parent: 'group' }],
        paths: { '/a': { get: tagged('a', ['group']) } },
      }),
      operationSelection: { excludeTags: ['group'] },
    }]));

    const names = (output.tags ?? []).map(t => t.name);
    expect(names).not.toContain('group');
    expect((output.tags ?? []).find(t => t.name === 'child')?.parent).toBe('group');
  });
});

describe('3.2 edge: additive fields pass through', () => {
  it('carries discriminator defaultMapping', () => {
    const output = expectSuccess(merge([{ oas: doc({
      paths: { '/a': { get: op('a') } },
      components: { schemas: {
        Pet: schema({
          oneOf: [{ $ref: '#/components/schemas/Dog' }],
          discriminator: { propertyName: 'k', defaultMapping: '#/components/schemas/Dog' },
        }),
        Dog: schema({ type: 'object' }),
      } },
    }) }]));

    expect(at(output.components?.schemas?.Pet, 'discriminator', 'defaultMapping'))
      .toBe('#/components/schemas/Dog');
  });

  it('KNOWN GAP: discriminator defaultMapping is not rewritten on rename', () => {
    // Same class of gap as the `mapping` field (issues #99/#106): the oneOf
    // reference follows the rename, the discriminator pointer does not.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { Dog: schema({ type: 'string' }) } } }) },
      { oas: doc({
        paths: { '/b': { get: op('b') } },
        components: { schemas: {
          Dog: schema({ type: 'object' }),
          Pet: schema({
            oneOf: [{ $ref: '#/components/schemas/Dog' }],
            discriminator: { propertyName: 'k', defaultMapping: '#/components/schemas/Dog' },
          }),
        } },
      }) },
    ]));

    expect(at(output.components?.schemas?.Pet, 'oneOf', '0', '$ref')).toBe('#/components/schemas/Dog1');
    expect(at(output.components?.schemas?.Pet, 'discriminator', 'defaultMapping'))
      .toBe('#/components/schemas/Dog');
  });

  it('carries itemSchema for sequential media types', () => {
    const output = expectSuccess(merge([{ oas: doc({
      paths: { '/stream': { get: op('s') } },
      components: { schemas: { Stream: schema({ itemSchema: { type: 'string' } }) } },
    }) }]));

    expect(at(output.components?.schemas?.Stream, 'itemSchema')).toEqual({ type: 'string' });
  });

  it('carries an in: querystring parameter', () => {
    const output = expectSuccess(merge([{ oas: doc({ paths: { '/a': { get: {
      operationId: 'a',
      responses: ok,
      parameters: [{ name: 'f', in: 'querystring', schema: schema({ type: 'string' }) }],
    } } } } as Partial<OpenApiDocument>) }]));

    expect(at(item(output, '/a'), 'get', 'parameters', '0', 'in')).toBe('querystring');
  });

  it('carries a server name', () => {
    const output = expectSuccess(merge([{ oas: doc({
      servers: [{ url: 'https://api.example.com', name: 'production' }],
      paths: { '/a': { get: op('a') } },
    } as Partial<OpenApiDocument>) }]));

    expect(at(output.servers, '0', 'name')).toBe('production');
  });
});

describe('3.2 edge: version rules', () => {
  it('refuses a 3.1 input mixed with a 3.2 input', () => {
    expectError(merge([
      { oas: doc({ openapi: '3.1.1', paths: { '/a': { get: op('a') } } }) },
      { oas: doc({ openapi: '3.2.0', paths: { '/b': { get: op('b') } } }) },
    ]), 'mixed-openapi-versions');
  });

  it('refuses a 3.3 input, which does not exist yet', () => {
    expectError(merge([
      { oas: doc({ openapi: '3.3.0', paths: { '/a': { get: op('a') } } }) },
    ]), 'unsupported-openapi-version');
  });
});
