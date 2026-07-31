import { merge } from '../index';
import { Swagger } from '@atlassian/atlassian-openapi';
import { SingleMergeInput } from '../data';
import { toOAS } from './_helpers/oas-generation';
import { toMergeInputs } from './_helpers/test-utils';
import { at, doc30, doc32, expectSuccess, ok, op, pathKeys } from './_helpers/documents';

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

/**
 * Issue #105: operationIds inside callbacks.
 *
 * The spec requires an operationId to be "unique among all operations described
 * in the API", and an operation inside a Callback Object is one of them -- a
 * Callback is a map of runtime expressions to Path Items, and those hold real
 * operations. They were skipped, so two inputs declaring the same callback
 * operationId produced a document with a duplicate: invalid, and silently so.
 *
 * References inside callbacks were already rewritten correctly, which made this
 * the one remaining callback-shaped gap.
 */
describe('callback operationIds (issue #105)', () => {
  const withCallback = (outerId: string, callbackId: string) => ({
    paths: {
      [`/${outerId}`]: {
        post: {
          operationId: outerId,
          responses: ok,
          callbacks: {
            onEvent: {
              '{$request.body#/callbackUrl}': {
                post: { operationId: callbackId, responses: ok },
              },
            },
          },
        },
      },
    },
  });

  const callbackOpId = (output: ReturnType<typeof expectSuccess>, path: string): unknown =>
    at(output.paths?.[path], 'post', 'callbacks', 'onEvent', '{$request.body#/callbackUrl}', 'post', 'operationId');

  it('disambiguates a callback operationId that collides across inputs', () => {
    const output = expectSuccess(
      merge([
        { oas: doc30(withCallback('first', 'onData')) },
        { oas: doc30(withCallback('second', 'onData')) },
      ]),
    );

    expect(callbackOpId(output, '/first')).toBe('onData');
    expect(callbackOpId(output, '/second')).toBe('onData1');
  });

  it('disambiguates a callback id colliding with a top-level operation id', () => {
    const output = expectSuccess(
      merge([
        { oas: doc30({ paths: { '/a': { get: op('onData') } } }) },
        { oas: doc30(withCallback('second', 'onData')) },
      ]),
    );

    // Same namespace: the spec does not have a separate one for callbacks.
    expect(callbackOpId(output, '/second')).toBe('onData1');
  });

  it('applies a dispute prefix to a callback operationId', () => {
    const output = expectSuccess(
      merge([
        { oas: doc30(withCallback('first', 'onData')) },
        { oas: doc30(withCallback('second', 'onData')), dispute: { prefix: 'Svc' } },
      ]),
    );

    expect(callbackOpId(output, '/second')).toBe('SvconData');
  });

  it('leaves a non-colliding callback operationId alone', () => {
    const output = expectSuccess(merge([{ oas: doc30(withCallback('first', 'onData')) }]));

    expect(callbackOpId(output, '/first')).toBe('onData');
  });

  it('handles several callbacks on one operation', () => {
    const twoCallbacks = {
      paths: {
        '/a': {
          post: {
            operationId: 'a',
            responses: ok,
            callbacks: {
              onOne: { '{$request.body#/u}': { post: { operationId: 'shared', responses: ok } } },
              onTwo: { '{$request.body#/v}': { post: { operationId: 'shared', responses: ok } } },
            },
          },
        },
      },
    };

    const output = expectSuccess(merge([{ oas: doc30(twoCallbacks) }]));

    // Both are in the same document, so the second must be disambiguated even
    // within a single input.
    expect(at(output.paths?.['/a'], 'post', 'callbacks', 'onOne', '{$request.body#/u}', 'post', 'operationId')).toBe('shared');
    expect(at(output.paths?.['/a'], 'post', 'callbacks', 'onTwo', '{$request.body#/v}', 'post', 'operationId')).toBe('shared1');
  });

  it('does not descend into a $ref callback', () => {
    // The operations live in the component it points at, and that component is
    // walked in its own right -- descending here would count them twice.
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: { '/a': { post: { operationId: 'a', responses: ok, callbacks: { onEvent: { $ref: '#/components/callbacks/Shared' } } } } },
            components: {
              callbacks: { Shared: { '{$request.body#/u}': { post: { operationId: 'onShared', responses: ok } } } },
            },
          }),
        },
      ]),
    );

    expect(at(output.paths?.['/a'], 'post', 'callbacks', 'onEvent', '$ref')).toBe('#/components/callbacks/Shared');
  });
});
