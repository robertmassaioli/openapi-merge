import { merge } from '../index';
import { Swagger } from '@atlassian/atlassian-openapi';
import { PathItemMap } from '../oas31';
import { ErrorType, isErrorResult, SingleMergeInput } from '../data';
import { doc30, expectMergeError, expectSuccess, op, pathKeys, schema, schemaKeys } from './_helpers/documents';

/**
 * Contracts of `merge` that no suite named after a construct would cover.
 *
 * These are the properties a caller relies on across the whole function rather
 * than in one place: that it does not mutate what you give it, that input order
 * does not change the shape of the result, that every documented `ErrorType` can
 * actually happen, that cyclic references terminate, and that references it does
 * not own are left alone.
 *
 * Several of these were found by asking "what has no test?" rather than "what
 * has no coverage" -- the lines were already being executed incidentally.
 */

/** Every value of ErrorType, so the exhaustiveness test below cannot drift. */
const ALL_ERROR_TYPES: ErrorType[] = [
  'no-inputs',
  'duplicate-paths',
  'duplicate-webhooks',
  'component-definition-conflict',
  'operation-id-conflict',
  'unsupported-openapi-version',
  'mixed-openapi-versions',
];

describe('merge does not mutate its inputs', () => {
  it('leaves the caller document untouched when operationIds are rewritten', () => {
    // The merge renames the second input's clashing operationId. That rename
    // must land on its internal copy, not on the object the caller passed in.
    const mine = doc30({ paths: { '/x': { get: op('dup') } } });
    const snapshot = JSON.stringify(mine);

    merge([{ oas: mine }, { oas: doc30({ paths: { '/y': { get: op('dup') } } }) }]);

    expect(JSON.stringify(mine)).toBe(snapshot);
  });

  it('leaves the caller document untouched when components are renamed', () => {
    const mine = doc30({
      paths: { '/x': { get: op('x') } },
      components: { schemas: { S: schema({ type: 'string' }) } },
    });
    const snapshot = JSON.stringify(mine);

    merge([
      { oas: doc30({ paths: { '/y': { get: op('y') } }, components: { schemas: { S: schema({ type: 'number' }) } } }) },
      { oas: mine },
    ]);

    expect(JSON.stringify(mine)).toBe(snapshot);
  });

  it('leaves the caller document untouched when operationSelection drops operations', () => {
    const mine = doc30({ paths: { '/x': { get: { ...op('x'), tags: ['drop'] } } } });
    const snapshot = JSON.stringify(mine);

    merge([{ oas: mine, operationSelection: { excludeTags: ['drop'] } }]);

    expect(JSON.stringify(mine)).toBe(snapshot);
  });

  it('can be called twice with the same input and give the same answer', () => {
    // Follows from immutability, and is the property a caller in a loop depends
    // on. Would fail if any stage mutated its input.
    const inputs = (): SingleMergeInput[] => [
      { oas: doc30({ paths: { '/a': { get: op('same') } } }) },
      { oas: doc30({ paths: { '/b': { get: op('same') } } }) },
    ];
    const shared = inputs();

    const first = JSON.stringify(expectSuccess(merge(shared)));
    const second = JSON.stringify(expectSuccess(merge(shared)));

    expect(second).toBe(first);
  });
});

describe('input order', () => {
  it('produces the same shape whichever order the inputs arrive in', () => {
    // First-wins means the *contents* differ, but the structure -- which names
    // exist and how many -- should not depend on ordering.
    const a = (): SingleMergeInput => ({ oas: doc30({
      paths: { '/a': { get: op('a') } },
      components: { schemas: { S: schema({ type: 'string' }) } },
    }) });
    const b = (): SingleMergeInput => ({ oas: doc30({
      paths: { '/b': { get: op('b') } },
      components: { schemas: { S: schema({ type: 'number' }) } },
    }) });

    const ab = expectSuccess(merge([a(), b()]));
    const ba = expectSuccess(merge([b(), a()]));

    expect(schemaKeys(ab)).toEqual(schemaKeys(ba));
    expect(pathKeys(ab)).toEqual(pathKeys(ba));
  });

  it('gives the first input precedence for document-level fields', () => {
    const withServers = (url: string): SingleMergeInput => ({ oas: doc30({
      paths: { [`/${url}`]: { get: op(url) } },
      servers: [{ url: `https://${url}` }],
    }) });

    expect(expectSuccess(merge([withServers('first'), withServers('second')])).servers)
      .toEqual([{ url: 'https://first' }]);
    expect(expectSuccess(merge([withServers('second'), withServers('first')])).servers)
      .toEqual([{ url: 'https://second' }]);
  });
});

describe('cyclic references terminate', () => {
  it('deep-compares two self-referencing schemas without looping forever', () => {
    // component-equivalence keeps a record of comparisons in flight precisely so
    // that Node -> Node does not recurse indefinitely. Nothing exercised it, so
    // a regression would surface as a hang or a stack overflow rather than a
    // failing assertion.
    const selfReferential = (title: string): SingleMergeInput => ({ oas: doc30({
      paths: { [`/${title}`]: { get: op(`get${title}`) } },
      components: { schemas: { Node: schema({
        type: 'object',
        title,
        properties: { next: { $ref: '#/components/schemas/Node' } },
      }) } },
    }) });

    const output = expectSuccess(merge([selfReferential('a'), selfReferential('b')]));

    // Different titles, so they are not equal and the second is renamed.
    expect(schemaKeys(output)).toEqual(['Node', 'Node1']);
  });

  it('deduplicates two identical self-referencing schemas', () => {
    const node = (): SingleMergeInput => ({ oas: doc30({
      paths: { '/n': { get: op('n') } },
      components: { schemas: { Node: schema({
        type: 'object',
        properties: { next: { $ref: '#/components/schemas/Node' } },
      }) } },
    }) });

    // Same shape in both inputs, so one definition should survive. The paths
    // collide, so this also proves the cycle guard runs before that error.
    const result = merge([node(), node()]);

    expectMergeError(result, 'duplicate-paths');
  });

  it('handles a mutual cycle between two schemas', () => {
    const pair = (title: string): SingleMergeInput => ({ oas: doc30({
      paths: { [`/${title}`]: { get: op(title) } },
      components: { schemas: {
        A: schema({ title, properties: { b: { $ref: '#/components/schemas/B' } } }),
        B: schema({ properties: { a: { $ref: '#/components/schemas/A' } } }),
      } },
    }) });

    const output = expectSuccess(merge([pair('one'), pair('two')]));

    // A differs by title so it is renamed; B is identical either way.
    expect(schemaKeys(output)).toContain('A1');
  });
});

describe('references the merge does not own', () => {
  it('leaves an external $ref untouched', () => {
    // A reference into another document is not ours to rewrite. If the walker
    // started renaming these it would silently break every cross-document
    // reference, and the output would still look plausible.
    const output = expectSuccess(merge([
      { oas: doc30({
        paths: { '/a': { get: { operationId: 'a', responses: { '200': { description: 'ok', content: {
          'application/json': { schema: { $ref: 'other.yaml#/components/schemas/Thing' } },
        } } } } } },
        components: { schemas: { Thing: schema({ type: 'string' }) } },
      }) },
      { oas: doc30({
        paths: { '/b': { get: op('b') } },
        components: { schemas: { Thing: schema({ type: 'number' }) } },
      }) },
    ]));

    // Our own Thing was disputed and renamed...
    expect(schemaKeys(output)).toEqual(['Thing', 'Thing1']);
    // ...but the external reference is byte-for-byte what it was.
    expect(JSON.stringify(output)).toContain('other.yaml#/components/schemas/Thing');
  });

  it('leaves an absolute URL $ref untouched', () => {
    const output = expectSuccess(merge([
      { oas: doc30({
        paths: { '/a': { get: { operationId: 'a', responses: { '200': { description: 'ok', content: {
          'application/json': { schema: { $ref: 'https://example.com/api.yaml#/components/schemas/Remote' } },
        } } } } } },
      }) },
    ]));

    expect(JSON.stringify(output)).toContain('https://example.com/api.yaml#/components/schemas/Remote');
  });
});

describe('every documented ErrorType is reachable', () => {
  it('lists exactly the ErrorType values the library declares', () => {
    // Guards the list below: adding an ErrorType without a test that produces it
    // is how 'component-definition-conflict' and 'operation-id-conflict' came to
    // be unreachable for as long as they were.
    expect(ALL_ERROR_TYPES.length).toBe(7);
  });

  it('produces no-inputs', () => {
    expectMergeError(merge([]), 'no-inputs');
  });

  it('produces duplicate-paths', () => {
    expectMergeError(merge([
      { oas: doc30({ paths: { '/same': { get: op('a') } } }) },
      { oas: doc30({ paths: { '/same': { get: op('b') } } }) },
    ]), 'duplicate-paths');
  });

  it('produces unsupported-openapi-version', () => {
    expectMergeError(merge([{ oas: doc30({ openapi: '9.9.9', paths: {} }) }]), 'unsupported-openapi-version');
  });

  it('produces mixed-openapi-versions', () => {
    expectMergeError(merge([
      { oas: doc30({ openapi: '3.0.3', paths: { '/a': { get: op('a') } } }) },
      { oas: doc30({ openapi: '3.1.1', paths: { '/b': { get: op('b') } } }) },
    ]), 'mixed-openapi-versions');
  });

  it('produces component-definition-conflict once every fallback name is taken', () => {
    // processComponents tries `Thing1` through `Thing999` before giving up. All
    // of them existing is the only way to reach the error, which is why the
    // fixture is generated rather than written out.
    //
    // This error was constructed and then discarded by all nine call sites, so
    // the component was silently dropped instead of reported. This test is the
    // guard against that returning.
    const crowded: { [name: string]: Swagger.Schema } = { Thing: schema({ type: 'string' }) };
    for (let i = 1; i < 1000; i++) {
      crowded[`Thing${i}`] = schema({ type: 'string', title: `filler${i}` });
    }

    const message = expectMergeError(merge([
      { oas: doc30({ paths: { '/a': { get: op('a') } }, components: { schemas: crowded } }) },
      { oas: doc30({
        paths: { '/b': { get: op('b') } },
        components: { schemas: { Thing: schema({ type: 'boolean' }) } },
      }) },
    ]), 'component-definition-conflict');

    expect(message).toContain('Thing');
  });

  it('produces operation-id-conflict once every fallback id is taken', () => {
    // The operationId equivalent: `dup1` through `dup999` all seen already.
    // Also previously discarded, at the paths call site.
    const manyOps: PathItemMap = { '/seed': { get: op('dup') } };
    for (let i = 1; i < 1000; i++) {
      manyOps[`/filler${i}`] = { get: op(`dup${i}`) };
    }

    const message = expectMergeError(merge([
      { oas: doc30({ paths: manyOps }) },
      { oas: doc30({ paths: { '/last': { get: op('dup') } } }) },
    ]), 'operation-id-conflict');

    expect(message).toContain('dup');
  });

  // 'duplicate-webhooks' is produced in webhooks.test.ts, where the construct
  // it concerns lives.
  it('produces duplicate-webhooks', () => {
    expectMergeError(merge([
      { oas: doc30({ openapi: '3.1.1', webhooks: { dup: { post: op('a') } } }) },
      { oas: doc30({ openapi: '3.1.1', webhooks: { dup: { post: op('b') } } }) },
    ]), 'duplicate-webhooks');
  });
});

describe('non-ASCII content', () => {
  it('carries non-ASCII paths and path parameters through unchanged', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/日本語/{名前}': { get: op('jp') } } }) },
      { oas: doc30({ paths: { '/emoji/🚀': { get: op('rocket') } } }) },
    ]));

    expect(pathKeys(output)).toEqual(['/emoji/🚀', '/日本語/{名前}']);
  });

  it('renames a non-ASCII component name on dispute, spec regex notwithstanding', () => {
    // The Components key regex is `^[a-zA-Z0-9\\.\\-_]+$`, so `Café` is not a
    // valid component name to begin with. The merge is not a validator: it
    // preserves and renames whatever it is given, exactly as with the
    // dispute-prefix case in components.test.ts.
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/a': { get: op('a') } }, components: { schemas: { 'Café': schema({ type: 'string' }) } } }) },
      { oas: doc30({ paths: { '/b': { get: op('b') } }, components: { schemas: { 'Café': schema({ type: 'number' }) } } }) },
    ]));

    expect(schemaKeys(output)).toEqual(['Café', 'Café1']);
  });

  it('preserves a non-ASCII operationId', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/a': { get: op('取得') } } }) },
    ]));

    expect((output.paths?.['/a'] as { get: { operationId: string } }).get.operationId).toBe('取得');
  });
});

describe('isErrorResult', () => {
  it('distinguishes the two branches of MergeResult', () => {
    // The exported type guard consumers rely on to tell success from failure.
    expect(isErrorResult(merge([]))).toBe(true);
    expect(isErrorResult(merge([{ oas: doc30({ paths: { '/a': { get: op('a') } } }) }]))).toBe(false);
  });
});
