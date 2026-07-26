import { merge } from '..';
import { Swagger } from '@atlassian/atlassian-openapi';
import { toOAS } from './oas-generation';
import { expectMergeResult, toMergeInputs } from './test-utils';
import { isErrorResult, MergeResult, SingleMergeInput, SuccessfulMergeResult } from '../data';

// Deliberately a fresh object per input: merge mutates its inputs, so sharing
// one reference between both inputs would not prove deduplication.
function clone<A>(value: A): A {
  return JSON.parse(JSON.stringify(value));
}

/** Narrows a MergeResult to its successful branch, failing the test otherwise. */
function expectSuccess(result: MergeResult): SuccessfulMergeResult {
  if (isErrorResult(result)) {
    throw new Error(`Expected a successful merge, got: ${JSON.stringify(result, null, 2)}`);
  }
  return result;
}

/**
 * `paths-and-components.ts` deduplicates each of the eight component maps
 * through the same `processComponents` helper, but via eight separate call
 * sites. Only `schemas` was exercised by the existing suites, so a rename bug
 * in any of the other seven would have gone unnoticed. Each test here forces a
 * name collision so the second input's component has to be renamed, which also
 * proves the reference-modification callback for that component type fires.
 */
function expectRenamedTo1<A>(
  first: Swagger.Components,
  second: Swagger.Components,
  pick: (c: Swagger.Components) => { [key: string]: A } | undefined,
): void {
  const result = expectSuccess(merge(toMergeInputs([toOAS({}, first), toOAS({}, second)])));

  const merged = pick(result.output.components ?? {});
  expect(Object.keys(merged ?? {}).sort()).toEqual(['Thing', 'Thing1']);
}

describe('component deduplication by component type', () => {
  it('deduplicates responses', () => {
    expectRenamedTo1<Swagger.Response | Swagger.Reference>(
      { responses: { Thing: { description: 'first' } } },
      { responses: { Thing: { description: 'second' } } },
      c => c.responses,
    );
  });

  it('deduplicates parameters', () => {
    expectRenamedTo1<Swagger.Parameter | Swagger.Reference>(
      { parameters: { Thing: { name: 'a', in: 'query', schema: { type: 'string' } } } },
      { parameters: { Thing: { name: 'b', in: 'query', schema: { type: 'number' } } } },
      c => c.parameters,
    );
  });

  it('deduplicates examples', () => {
    expectRenamedTo1<Swagger.Example | Swagger.Reference>(
      { examples: { Thing: { summary: 'first' } } },
      { examples: { Thing: { summary: 'second' } } },
      c => c.examples,
    );
  });

  it('deduplicates requestBodies', () => {
    expectRenamedTo1<Swagger.RequestBody | Swagger.Reference>(
      { requestBodies: { Thing: { content: { 'application/json': { schema: { type: 'string' } } } } } },
      { requestBodies: { Thing: { content: { 'application/json': { schema: { type: 'number' } } } } } },
      c => c.requestBodies,
    );
  });

  it('deduplicates headers', () => {
    expectRenamedTo1<Swagger.Header | Swagger.Reference>(
      { headers: { Thing: { schema: { type: 'string' } } } },
      { headers: { Thing: { schema: { type: 'number' } } } },
      c => c.headers,
    );
  });

  it('deduplicates links', () => {
    expectRenamedTo1<Swagger.Link | Swagger.Reference>(
      { links: { Thing: { operationId: 'first' } } },
      { links: { Thing: { operationId: 'second' } } },
      c => c.links,
    );
  });

  it('deduplicates callbacks', () => {
    expectRenamedTo1<Swagger.Callback | Swagger.Reference>(
      { callbacks: { Thing: { '/first': { get: { responses: { '200': { description: 'ok' } } } } } } },
      { callbacks: { Thing: { '/second': { get: { responses: { '200': { description: 'ok' } } } } } } },
      c => c.callbacks,
    );
  });

  it('keeps identical components from two inputs as a single definition', () => {
    const shared: Swagger.Components = { headers: { Thing: { schema: { type: 'string' } } } };

    const result = merge(toMergeInputs([toOAS({}, shared), toOAS({}, clone(shared))]));

    expectMergeResult(result, { output: toOAS({}, shared) });
  });
});

describe('securitySchemes', () => {
  it('takes the security schemes from the first input that declares any', () => {
    const first = toOAS({}, { securitySchemes: { apiKey: { type: 'apiKey', name: 'key', in: 'header' } } });
    const second = toOAS({}, { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } });

    const result = expectSuccess(merge(toMergeInputs([first, second])));

    expect(Object.keys(result.output.components?.securitySchemes ?? {})).toEqual(['apiKey']);
  });

  it('falls through to a later input when the first declares none', () => {
    const first = toOAS({}, { schemas: { A: { type: 'string' } } });
    const second = toOAS({}, { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } });

    const result = expectSuccess(merge(toMergeInputs([first, second])));

    expect(Object.keys(result.output.components?.securitySchemes ?? {})).toEqual(['basic']);
  });

  it('ignores an empty securitySchemes object', () => {
    const first = toOAS({}, { securitySchemes: {} });
    const second = toOAS({}, { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } });

    const result = expectSuccess(merge(toMergeInputs([first, second])));

    expect(Object.keys(result.output.components?.securitySchemes ?? {})).toEqual(['basic']);
  });
});

describe('operationId conflict resolution', () => {
  const pathWithOp = (operationId: string): Swagger.Paths => ({
    '/thing': { get: { operationId, responses: { '200': { description: 'ok' } } } },
  });

  it('uses the dispute prefix when the plain operationId is taken', () => {
    const inputs: SingleMergeInput[] = [
      { oas: toOAS(pathWithOp('getThing')) },
      {
        oas: toOAS({ '/other': { get: { operationId: 'getThing', responses: { '200': { description: 'ok' } } } } }),
        dispute: { prefix: 'second' },
      },
    ];

    const result = expectSuccess(merge(inputs));

    expect((result.output.paths ?? {})['/other'].get?.operationId).toBe('secondgetThing');
  });

  it('falls back to a numeric suffix when there is no dispute', () => {
    const result = expectSuccess(merge(toMergeInputs([
      toOAS(pathWithOp('getThing')),
      toOAS({ '/other': { get: { operationId: 'getThing', responses: { '200': { description: 'ok' } } } } }),
    ])));

    expect((result.output.paths ?? {})['/other'].get?.operationId).toBe('getThing1');
  });

  it('falls back to a numeric suffix when the disputed id is also taken', () => {
    const inputs: SingleMergeInput[] = [
      { oas: toOAS(pathWithOp('getThing')) },
      { oas: toOAS({ '/two': { get: { operationId: 'secondgetThing', responses: { '200': { description: 'ok' } } } } }) },
      {
        oas: toOAS({ '/three': { get: { operationId: 'getThing', responses: { '200': { description: 'ok' } } } } }),
        dispute: { prefix: 'second' },
      },
    ];

    const result = expectSuccess(merge(inputs));

    expect((result.output.paths ?? {})['/three'].get?.operationId).toBe('getThing1');
  });
});

describe('pathModification.stripStart', () => {
  const paths: Swagger.Paths = { '/api/thing': { get: { responses: { '200': { description: 'ok' } } } } };

  it('strips a prefix that is present', () => {
    const result = expectSuccess(merge([{ oas: toOAS(paths), pathModification: { stripStart: '/api' } }]));

    expect(Object.keys(result.output.paths ?? {})).toEqual(['/thing']);
  });

  it('leaves the path untouched when the prefix is absent', () => {
    const result = expectSuccess(merge([{ oas: toOAS(paths), pathModification: { stripStart: '/nope' } }]));

    expect(Object.keys(result.output.paths ?? {})).toEqual(['/api/thing']);
  });
});
