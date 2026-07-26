import { merge } from '../index';
import { Swagger } from '@atlassian/atlassian-openapi';
import { SingleMergeInput } from '../data';
import { toOAS } from './_helpers/oas-generation';
import { toMergeInputs } from './_helpers/test-utils';
import { doc30, doc32, expectSuccess, ok, op, pathKeys } from './_helpers/documents';

/**
 * operationId uniqueness.
 *
 * The spec requires an operationId to be "unique among all operations described
 * in the API". Merging independently-authored documents breaks that constantly,
 * so the merge disambiguates: it tries the input's dispute prefix or suffix
 * first, then falls back to a numeric suffix.
 *
 * The namespace spans everything: paths, webhooks, `query` operations and custom
 * verbs all draw from it.
 */

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

    expect((result.paths ?? {})['/other'].get?.operationId).toBe('secondgetThing');
  });

  it('falls back to a numeric suffix when there is no dispute', () => {
    const result = expectSuccess(merge(toMergeInputs([
      toOAS(pathWithOp('getThing')),
      toOAS({ '/other': { get: { operationId: 'getThing', responses: { '200': { description: 'ok' } } } } }),
    ])));

    expect((result.paths ?? {})['/other'].get?.operationId).toBe('getThing1');
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

    expect((result.paths ?? {})['/three'].get?.operationId).toBe('getThing1');
  });
});

describe('3.2 - operationId uniqueness covers the new slots', () => {
  it('disambiguates a clash between query operations', () => {
    const output = expectSuccess(merge([
      { oas: doc32({ paths: { '/a': { query: op('same') } } }) },
      { oas: doc32({ paths: { '/b': { query: op('same') } } }) },
    ]));

    expect(output.paths?.['/b'].query?.operationId).toBe('same1');
  });

  it('disambiguates a clash between a get and an additionalOperations verb', () => {
    const output = expectSuccess(merge([
      { oas: doc32({ paths: { '/a': { get: op('same') } } }) },
      { oas: doc32({ paths: { '/b': { additionalOperations: { PURGE: op('same') } } } }) },
    ]));

    expect(output.paths?.['/b'].additionalOperations?.PURGE.operationId).toBe('same1');
  });
});

describe('3.0 edge: operationId uniqueness', () => {
  it('disambiguates a clash between two methods on the same path', () => {
    // Spec, Operation Object: operationId "MUST be unique among all operations
    // described in the API" -- including within one Path Item.
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/a': { get: op('same'), post: op('same') } } }) },
    ]));

    const item = output.paths?.['/a'] as Record<string, { operationId: string }>;
    expect([item.get.operationId, item.post.operationId].sort()).toEqual(['same', 'same1']);
  });

  it('leaves operations without an operationId alone', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/a': { get: { responses: ok } } } }) },
      { oas: doc30({ paths: { '/b': { get: { responses: ok } } } }) },
    ]));

    expect(pathKeys(output)).toEqual(['/a', '/b']);
  });
});
