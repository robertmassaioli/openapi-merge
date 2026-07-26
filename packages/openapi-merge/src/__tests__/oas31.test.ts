import { merge } from '..';
import { isErrorResult, MergeResult, SingleMergeInput } from '../data';
import { OpenApiDocument } from '../oas31';

function doc(partial: Partial<OpenApiDocument>): OpenApiDocument {
  return {
    openapi: '3.1.1',
    info: { title: 'Test', version: '1.0.0' },
    ...partial,
  } as OpenApiDocument;
}

function expectSuccess(result: MergeResult): OpenApiDocument {
  if (isErrorResult(result)) {
    throw new Error(`Expected a successful merge, got: ${result.message} (${result.type})`);
  }
  return result.output;
}

function expectFailure(result: MergeResult, type: string): string {
  if (!isErrorResult(result)) {
    throw new Error(`Expected an error, got: ${JSON.stringify(result, null, 2)}`);
  }
  expect(result.type).toBe(type);
  return result.message;
}

const okResponse = { '200': { description: 'ok' } };

describe('3.1 - paths are optional', () => {
  it('merges a document that has only webhooks', () => {
    // Legal in 3.1 and impossible in 3.0. Before phase 2 this document merged
    // to a spec with no webhooks at all, and exit code 0.
    const output = expectSuccess(merge([{ oas: doc({
      webhooks: { newPet: { post: { operationId: 'onNewPet', responses: okResponse } } },
    }) }]));

    expect(Object.keys(output.webhooks ?? {})).toEqual(['newPet']);
  });

  it('leaves webhooks undefined when no input declared any', () => {
    // Matches how `components` already behaves: the key is present with an
    // undefined value rather than absent. What matters is that it never reaches
    // a written document, which JSON.stringify guarantees.
    const output = expectSuccess(merge([{ oas: doc({
      openapi: '3.0.3',
      paths: { '/a': { get: { responses: okResponse } } },
    }) }]));

    expect(output.webhooks).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain('webhooks');
  });

  it('merges a webhooks-only input with a paths-only input', () => {
    const output = expectSuccess(merge([
      { oas: doc({ webhooks: { newPet: { post: { operationId: 'onNewPet', responses: okResponse } } } }) },
      { oas: doc({ paths: { '/pets': { get: { operationId: 'listPets', responses: okResponse } } } }) },
    ]));

    expect(Object.keys(output.webhooks ?? {})).toEqual(['newPet']);
    expect(Object.keys(output.paths ?? {})).toEqual(['/pets']);
  });
});

describe('3.1 - webhooks merge like paths', () => {
  it('combines webhooks from two inputs', () => {
    const output = expectSuccess(merge([
      { oas: doc({ webhooks: { a: { post: { operationId: 'onA', responses: okResponse } } } }) },
      { oas: doc({ webhooks: { b: { post: { operationId: 'onB', responses: okResponse } } } }) },
    ]));

    expect(Object.keys(output.webhooks ?? {}).sort()).toEqual(['a', 'b']);
  });

  it('errors when two inputs declare the same webhook name', () => {
    const message = expectFailure(merge([
      { oas: doc({ webhooks: { dup: { post: { operationId: 'onA', responses: okResponse } } } }) },
      { oas: doc({ webhooks: { dup: { post: { operationId: 'onB', responses: okResponse } } } }) },
    ]), 'duplicate-webhooks');

    expect(message).toContain('dup');
    expect(message).toContain('Input 1');
  });

  it('makes operationIds unique across webhooks', () => {
    const output = expectSuccess(merge([
      { oas: doc({ webhooks: { a: { post: { operationId: 'same', responses: okResponse } } } }) },
      { oas: doc({ webhooks: { b: { post: { operationId: 'same', responses: okResponse } } } }) },
    ]));

    expect(output.webhooks?.b.post?.operationId).toBe('same1');
  });

  it('makes operationIds unique between a path and a webhook', () => {
    // Paths and webhooks share one operationId namespace; a clash across the
    // two must still be resolved.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: { operationId: 'same', responses: okResponse } } } }) },
      { oas: doc({ webhooks: { hook: { post: { operationId: 'same', responses: okResponse } } } }) },
    ]));

    expect(output.webhooks?.hook.post?.operationId).toBe('same1');
  });

  it('does not apply pathModification to webhook names', () => {
    // A webhook key is an event name, not a URL, so prepending a path prefix
    // to it would be meaningless.
    const output = expectSuccess(merge([{
      oas: doc({ webhooks: { newPet: { post: { operationId: 'onNewPet', responses: okResponse } } } }),
      pathModification: { prepend: '/api' },
    }]));

    expect(Object.keys(output.webhooks ?? {})).toEqual(['newPet']);
  });
});

describe('3.1 - references inside webhooks', () => {
  it('rewrites a $ref inside a webhook when its component is renamed', () => {
    // The inverse of the orphaned-component failure recorded in
    // proposal-openapi-3.2-support.md: the webhook was dropped, its $ref went
    // with it, and the schema it pointed at survived with nothing referencing
    // it. Both inputs define a different `Pet`, so the second is renamed and
    // the webhook's reference must follow.
    const first: SingleMergeInput = { oas: doc({
      paths: { '/pets': { get: { operationId: 'listPets', responses: okResponse } } },
      components: { schemas: { Pet: { type: 'string' } } },
    }) };
    const second: SingleMergeInput = { oas: doc({
      webhooks: { newPet: { post: {
        operationId: 'onNewPet',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
        responses: okResponse,
      } } },
      components: { schemas: { Pet: { type: 'number' } } },
    }) };

    const output = expectSuccess(merge([first, second]));

    const body = output.webhooks?.newPet.post?.requestBody;
    const ref = (body as { content: { [k: string]: { schema: { $ref: string } } } })
      .content['application/json'].schema.$ref;

    expect(Object.keys(output.components?.schemas ?? {}).sort()).toEqual(['Pet', 'Pet1']);
    expect(ref).toBe('#/components/schemas/Pet1');
  });
});

describe('3.1 - components.pathItems', () => {
  it('carries pathItems through a merge', () => {
    const output = expectSuccess(merge([{ oas: doc({
      components: { pathItems: { Shared: { get: { operationId: 'shared', responses: okResponse } } } },
    }) }]));

    expect(Object.keys(output.components?.pathItems ?? {})).toEqual(['Shared']);
  });

  it('deduplicates identical pathItems from two inputs', () => {
    const shared = { Shared: { get: { operationId: 'shared', responses: okResponse } } };
    const output = expectSuccess(merge([
      { oas: doc({ components: { pathItems: JSON.parse(JSON.stringify(shared)) } }) },
      { oas: doc({ components: { pathItems: JSON.parse(JSON.stringify(shared)) } }) },
    ]));

    expect(Object.keys(output.components?.pathItems ?? {})).toEqual(['Shared']);
  });

  it('renames a conflicting pathItem rather than dropping it', () => {
    const output = expectSuccess(merge([
      { oas: doc({ components: { pathItems: { Shared: { get: { operationId: 'a', responses: okResponse } } } } }) },
      { oas: doc({ components: { pathItems: { Shared: { get: { operationId: 'b', responses: okResponse } } } } }) },
    ]));

    expect(Object.keys(output.components?.pathItems ?? {}).sort()).toEqual(['Shared', 'Shared1']);
  });
});

describe('3.1 - jsonSchemaDialect', () => {
  it('carries the dialect through', () => {
    const dialect = 'https://spec.openapis.org/oas/3.1/dialect/base';
    const output = expectSuccess(merge([{ oas: doc({ jsonSchemaDialect: dialect, paths: {} }) }]));

    expect(output.jsonSchemaDialect).toBe(dialect);
  });

  it('takes the first dialect when inputs disagree', () => {
    const output = expectSuccess(merge([
      { oas: doc({ jsonSchemaDialect: 'https://example.com/first', paths: {} }) },
      { oas: doc({ jsonSchemaDialect: 'https://example.com/second', paths: {} }) },
    ]));

    expect(output.jsonSchemaDialect).toBe('https://example.com/first');
  });

  it('omits the dialect when no input declares one', () => {
    const output = expectSuccess(merge([{ oas: doc({ paths: {} }) }]));

    expect(output.jsonSchemaDialect).toBeUndefined();
  });
});

describe('output version negotiation', () => {
  it('declares the highest patch among 3.1 inputs', () => {
    const output = expectSuccess(merge([
      { oas: doc({ openapi: '3.1.0', paths: {} }) },
      { oas: doc({ openapi: '3.1.1', paths: {} }) },
    ]));

    expect(output.openapi).toBe('3.1.1');
  });

  it('declares the input version for 3.0 rather than a hard-coded 3.0.3', () => {
    const output = expectSuccess(merge([{ oas: doc({ openapi: '3.0.0', paths: {} }) }]));

    expect(output.openapi).toBe('3.0.0');
  });

  it('declares the highest patch among 3.0 inputs', () => {
    const output = expectSuccess(merge([
      { oas: doc({ openapi: '3.0.0', paths: { '/a': { get: { responses: okResponse } } } }) },
      { oas: doc({ openapi: '3.0.3', paths: { '/b': { get: { responses: okResponse } } } }) },
    ]));

    expect(output.openapi).toBe('3.0.3');
  });
});
