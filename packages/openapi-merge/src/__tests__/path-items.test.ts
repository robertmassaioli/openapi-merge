import { merge } from '../index';
import { getPathItemOperations, HTTP_METHODS, PathItem32 } from '../oas31';
import {
  at, doc30, doc31, doc32, expectMergeError, expectSuccess, ok, op, pathItem, pathKeys, schema, schemaKeys, tagged,
} from './_helpers/documents';

/**
 * Path Items: what one may contain, and when the merge considers one empty.
 *
 * The operation slots are the nine HTTP methods (`query` joined the eight
 * classics in 3.2) plus any custom verb under `additionalOperations`. Every
 * place that reasons about "the operations in a path item" goes through one
 * helper, because four independent copies of that list is what allowed a
 * query-only path item to be scored as empty and deleted.
 *
 * Emptiness matters because empty path items are dropped -- and a Path Item that
 * is only a `$ref` has no operations of its own but must survive.
 */

describe('HTTP_METHODS', () => {
  it('includes query, the 3.2 addition', () => {
    expect([...HTTP_METHODS]).toEqual([
      'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query',
    ]);
  });
});

describe('getPathItemOperations', () => {
  it('finds standard methods and additionalOperations together', () => {
    const pathItem: PathItem32 = {
      get: op('getThing'),
      query: op('queryThing'),
      additionalOperations: { PURGE: op('purgeThing'), LOCK: op('lockThing') },
    };

    const found = getPathItemOperations(pathItem);

    expect(found.map(f => f.method).sort()).toEqual(['LOCK', 'PURGE', 'get', 'query']);
    expect(found.filter(f => f.isAdditional).map(f => f.method).sort()).toEqual(['LOCK', 'PURGE']);
  });

  it('returns nothing for a path item with no operations', () => {
    expect(getPathItemOperations({ parameters: [] })).toEqual([]);
  });
});

describe('3.2 - query and additionalOperations survive', () => {
  it('keeps a path whose only operation is query', () => {
    // The regression test for the measured bug: countOperationsInPathItem
    // scored this 0 and dropPathItemsWithNoOperations deleted the endpoint.
    const output = expectSuccess(merge([{ oas: doc32({
      paths: { '/search': { query: op('searchQ') } },
    }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/search']);
    expect(output.paths?.['/search'].query?.operationId).toBe('searchQ');
  });

  it('keeps a path whose only operations are additionalOperations', () => {
    const output = expectSuccess(merge([{ oas: doc32({
      paths: { '/cache': { additionalOperations: { PURGE: op('purge') } } },
    }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/cache']);
    expect(output.paths?.['/cache'].additionalOperations?.PURGE.operationId).toBe('purge');
  });

  it('still drops a path item that genuinely has no operations', () => {
    // The behaviour the counting exists for must not regress.
    const output = expectSuccess(merge([{ oas: doc32({
      paths: { '/empty': { parameters: [] }, '/real': { get: op('getReal') } },
    }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/real']);
  });
});

describe('3.2 edge: query as a ninth method', () => {
  it('keeps query alongside the eight classic methods on one path item', () => {
    const output = expectSuccess(merge([{ oas: doc32({ paths: { '/a': {
      get: op('g'), put: op('pu'), post: op('po'), delete: op('d'),
      options: op('o'), head: op('h'), patch: op('pa'), trace: op('t'),
      query: op('q'),
    } } }) }]));

    expect(Object.keys(pathItem(output, '/a')).sort()).toEqual([
      'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'query', 'trace',
    ]);
  });

  it('counts query when deciding whether a path item is empty', () => {
    // The regression guard for the measured bug: query-only path items scored
    // zero operations and the whole endpoint was deleted.
    const output = expectSuccess(merge([{ oas: doc32({ paths: {
      '/queryOnly': { query: op('q') },
      '/reallyEmpty': {},
    } }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/queryOnly']);
  });

  it('allows a query operation to carry a requestBody', () => {
    // QUERY exists precisely so a read can have a body; the merge must not
    // strip it the way some tooling strips GET bodies.
    const output = expectSuccess(merge([{ oas: doc32({ paths: { '/search': { query: {
      operationId: 'q',
      responses: ok,
      requestBody: { content: { 'application/json': { schema: schema({ type: 'object' }) } } },
    } } } }) }]));

    expect(at(pathItem(output, '/search'), 'query', 'requestBody', 'content', 'application/json', 'schema'))
      .toEqual({ type: 'object' });
  });
});

describe('3.2 edge: additionalOperations', () => {
  it('keeps several custom verbs on one path item', () => {
    const output = expectSuccess(merge([{ oas: doc32({ paths: { '/r': {
      additionalOperations: { PURGE: op('p'), LOCK: op('l'), UNLOCK: op('u') },
    } } }) }]));

    expect(Object.keys(at(pathItem(output, '/r'), 'additionalOperations') as object).sort())
      .toEqual(['LOCK', 'PURGE', 'UNLOCK']);
  });

  it('treats custom verbs as case-sensitive distinct keys', () => {
    // additionalOperations keys are opaque strings to the merge; PURGE and purge
    // are two entries, not one.
    const output = expectSuccess(merge([{ oas: doc32({ paths: { '/r': {
      additionalOperations: { PURGE: op('upper'), purge: op('lower') },
    } } }) }]));

    expect(Object.keys(at(pathItem(output, '/r'), 'additionalOperations') as object).sort())
      .toEqual(['PURGE', 'purge']);
  });

  it('keeps a custom verb whose name shadows a standard method', () => {
    // A path item may legally hold both `get` and additionalOperations.GET; they
    // live in different places and must not be conflated.
    const output = expectSuccess(merge([{ oas: doc32({ paths: { '/r': {
      get: op('standardGet'),
      additionalOperations: { GET: op('customGet') },
    } } }) }]));

    expect(at(pathItem(output, '/r'), 'get', 'operationId')).toBe('standardGet');
    expect(at(pathItem(output, '/r'), 'additionalOperations', 'GET', 'operationId')).toBe('customGet');
  });

  it('resolves an operationId clash between a standard method and a custom verb', () => {
    const output = expectSuccess(merge([{ oas: doc32({ paths: { '/r': {
      get: op('same'),
      additionalOperations: { PURGE: op('same') },
    } } }) }]));

    const ids = [
      at(pathItem(output, '/r'), 'get', 'operationId'),
      at(pathItem(output, '/r'), 'additionalOperations', 'PURGE', 'operationId'),
    ].sort();
    expect(ids).toEqual(['same', 'same1']);
  });

  it('leaves an empty additionalOperations object alone without dropping the path', () => {
    const output = expectSuccess(merge([{ oas: doc32({ paths: {
      '/r': { get: op('g'), additionalOperations: {} },
    } }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/r']);
  });

  it('drops a path item whose only additionalOperations entry is filtered out', () => {
    // After tag exclusion removes the sole custom verb, nothing is left. The
    // operation count runs before selection, so the entry survives as an empty
    // object -- pinned so the shape is known.
    const output = expectSuccess(merge([{
      oas: doc32({ paths: { '/r': { additionalOperations: { PURGE: tagged('p', ['internal']) } } } }),
      operationSelection: { excludeTags: ['internal'] },
    }]));

    expect(Object.keys(output.paths ?? {})).toEqual([]);
  });
});

describe('3.0 edge: empty and minimal documents', () => {
  it('merges a document that has only components', () => {
    // Spec, OpenAPI Object: "at least one of the components, paths, or webhooks
    // fields MUST be present" -- so components-only is a valid document.
    const output = expectSuccess(merge([
      { oas: doc30({ components: { schemas: { Only: { type: 'string' } } } }) },
    ]));

    expect(schemaKeys(output)).toEqual(['Only']);
  });

  it('KNOWN GAP: drops a deliberately empty Path Item', () => {
    // Spec, Path Item Object: "A Path Item MAY be empty, due to ACL
    // constraints" -- an empty path item is how you document that a path exists
    // but its operations are hidden from this viewer. The merge counts
    // operations and deletes any path item scoring zero, so that signal is lost.
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/hidden': {}, '/visible': { get: op('v') } } }) },
    ]));

    expect(pathKeys(output)).toEqual(['/visible']);
  });

  it('merges inputs whose paths objects are all empty', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ paths: {} }) },
      { oas: doc30({ paths: {} }) },
    ]));

    expect(pathKeys(output)).toEqual([]);
  });

  it('rejects an empty input list', () => {
    expectMergeError(merge([]), 'no-inputs');
  });
});

describe('3.1 edge: webhooks as references', () => {
  it('rewrites a webhook that is itself a $ref to a renamed pathItem', () => {
    // A webhook value may be a Path Item *or* a Reference to one. When the
    // pathItem it points at is disputed and renamed, the webhook must follow.
    const output = expectSuccess(merge([
      { oas: doc31({
        paths: { '/a': { get: op('a') } },
        components: { pathItems: { Shared: { get: op('sharedFirst') } } },
      }) },
      { oas: doc31({
        webhooks: { hook: { $ref: '#/components/pathItems/Shared' } },
        components: { pathItems: { Shared: { post: op('sharedSecond') } } },
      }) },
    ]));

    expect(Object.keys(output.components?.pathItems ?? {}).sort()).toEqual(['Shared', 'Shared1']);
    expect((output.webhooks?.hook as unknown as { $ref: string }).$ref)
      .toBe('#/components/pathItems/Shared1');
  });

  it('rewrites a path that is a $ref to a renamed pathItem', () => {
    const output = expectSuccess(merge([
      { oas: doc31({
        paths: { '/a': { get: op('a') } },
        components: { pathItems: { Shared: { get: op('sharedFirst') } } },
      }) },
      { oas: doc31({
        paths: { '/b': { $ref: '#/components/pathItems/Shared' } },
        components: { pathItems: { Shared: { post: op('sharedSecond') } } },
      }) },
    ]));

    expect((output.paths?.['/b'] as unknown as { $ref: string }).$ref)
      .toBe('#/components/pathItems/Shared1');
  });

  it('does not drop a path item that is only a $ref', () => {
    // A $ref-only Path Item has no operations of its own. The operation count
    // must not delete it, or a referenced path vanishes.
    const output = expectSuccess(merge([
      { oas: doc31({
        paths: { '/b': { $ref: '#/components/pathItems/Shared' } },
        components: { pathItems: { Shared: { get: op('shared') } } },
      }) },
    ]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/b']);
  });
});
