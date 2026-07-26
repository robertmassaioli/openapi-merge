import { merge } from '../index';
import { doc31, expectMergeError, expectSuccess, ok, op, schemaKeys, webhookKeys } from './_helpers/documents';

/**
 * Webhooks, introduced in OpenAPI 3.1.
 *
 * A webhook is a Path Item keyed by an event name, so it merges with the same
 * machinery as `paths` -- same duplicate rule, same operationId namespace, same
 * reference rewriting -- with one deliberate exception: `pathModification` does
 * not apply, because a webhook key is an event name rather than a URL.
 *
 * Also covers the consequence of 3.1 making `paths` optional: a document may
 * describe only webhooks.
 */

describe('3.1 - paths are optional', () => {
  it('merges a document that has only webhooks', () => {
    // Legal in 3.1 and impossible in 3.0. Before phase 2 this document merged
    // to a spec with no webhooks at all, and exit code 0.
    const output = expectSuccess(merge([{ oas: doc31({
      webhooks: { newPet: { post: { operationId: 'onNewPet', responses: ok } } },
    }) }]));

    expect(Object.keys(output.webhooks ?? {})).toEqual(['newPet']);
  });

  it('leaves webhooks undefined when no input declared any', () => {
    // Matches how `components` already behaves: the key is present with an
    // undefined value rather than absent. What matters is that it never reaches
    // a written document, which JSON.stringify guarantees.
    const output = expectSuccess(merge([{ oas: doc31({
      openapi: '3.0.3',
      paths: { '/a': { get: { responses: ok } } },
    }) }]));

    expect(output.webhooks).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain('webhooks');
  });

  it('merges a webhooks-only input with a paths-only input', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ webhooks: { newPet: { post: { operationId: 'onNewPet', responses: ok } } } }) },
      { oas: doc31({ paths: { '/pets': { get: { operationId: 'listPets', responses: ok } } } }) },
    ]));

    expect(Object.keys(output.webhooks ?? {})).toEqual(['newPet']);
    expect(Object.keys(output.paths ?? {})).toEqual(['/pets']);
  });
});

describe('3.1 - webhooks merge like paths', () => {
  it('combines webhooks from two inputs', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ webhooks: { a: { post: { operationId: 'onA', responses: ok } } } }) },
      { oas: doc31({ webhooks: { b: { post: { operationId: 'onB', responses: ok } } } }) },
    ]));

    expect(Object.keys(output.webhooks ?? {}).sort()).toEqual(['a', 'b']);
  });

  it('errors when two inputs declare the same webhook name', () => {
    const message = expectMergeError(merge([
      { oas: doc31({ webhooks: { dup: { post: { operationId: 'onA', responses: ok } } } }) },
      { oas: doc31({ webhooks: { dup: { post: { operationId: 'onB', responses: ok } } } }) },
    ]), 'duplicate-webhooks');

    expect(message).toContain('dup');
    expect(message).toContain('Input 1');
  });

  it('makes operationIds unique across webhooks', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ webhooks: { a: { post: { operationId: 'same', responses: ok } } } }) },
      { oas: doc31({ webhooks: { b: { post: { operationId: 'same', responses: ok } } } }) },
    ]));

    expect(output.webhooks?.b.post?.operationId).toBe('same1');
  });

  it('makes operationIds unique between a path and a webhook', () => {
    // Paths and webhooks share one operationId namespace; a clash across the
    // two must still be resolved.
    const output = expectSuccess(merge([
      { oas: doc31({ paths: { '/a': { get: { operationId: 'same', responses: ok } } } }) },
      { oas: doc31({ webhooks: { hook: { post: { operationId: 'same', responses: ok } } } }) },
    ]));

    expect(output.webhooks?.hook.post?.operationId).toBe('same1');
  });

  it('does not apply pathModification to webhook names', () => {
    // A webhook key is an event name, not a URL, so prepending a path prefix
    // to it would be meaningless.
    const output = expectSuccess(merge([{
      oas: doc31({ webhooks: { newPet: { post: { operationId: 'onNewPet', responses: ok } } } }),
      pathModification: { prepend: '/api' },
    }]));

    expect(Object.keys(output.webhooks ?? {})).toEqual(['newPet']);
  });
});

describe('3.1 edge: minimal documents', () => {
  it('merges a document with neither paths nor webhooks, only components', () => {
    // Spec: at least one of components, paths or webhooks must be present.
    const output = expectSuccess(merge([
      { oas: doc31({ components: { schemas: { Only: { type: 'string' } } } }) },
    ]));

    expect(schemaKeys(output)).toEqual(['Only']);
    // An empty paths object is emitted rather than omitted. Valid either way;
    // pinned so the shape of the output is not a surprise.
    expect(output.paths).toEqual({});
  });

  it('leaves an empty webhooks object out of the output', () => {
    const output = expectSuccess(merge([{ oas: doc31({ webhooks: {}, paths: { '/a': { get: op('a') } } }) }]));

    expect(output.webhooks).toBeUndefined();
  });

  it('merges two webhooks-only documents', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ webhooks: { first: { post: op('onFirst') } } }) },
      { oas: doc31({ webhooks: { second: { post: op('onSecond') } } }) },
    ]));

    expect(webhookKeys(output)).toEqual(['first', 'second']);
    expect(output.paths).toEqual({});
  });
});

describe('3.1 edge: webhooks vs paths interactions', () => {
  it('allows a webhook and a path to share a name without colliding', () => {
    // They are separate namespaces: a webhook called "/pets" does not clash with
    // a path "/pets".
    const output = expectSuccess(merge([
      { oas: doc31({ paths: { '/pets': { get: op('getPets') } }, webhooks: { '/pets': { post: op('onPets') } } }) },
    ]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/pets']);
    expect(webhookKeys(output)).toEqual(['/pets']);
  });

  it('does not apply stripStart to webhook names', () => {
    const output = expectSuccess(merge([{
      oas: doc31({ webhooks: { '/api/event': { post: op('onEvent') } } }),
      pathModification: { stripStart: '/api' },
    }]));

    expect(webhookKeys(output)).toEqual(['/api/event']);
  });

  it('applies operationSelection to webhook operations', () => {
    const output = expectSuccess(merge([{
      oas: doc31({ webhooks: {
        kept: { post: { ...op('keep'), tags: ['public'] } },
        dropped: { post: { ...op('drop'), tags: ['internal'] } },
      } }),
      operationSelection: { excludeTags: ['internal'] },
    }]));

    // The operation is removed; whether the now-empty webhook entry remains is
    // the behaviour being pinned here.
    expect((output.webhooks?.dropped as Record<string, unknown> | undefined)?.post).toBeUndefined();
    expect((output.webhooks?.kept as Record<string, unknown>).post).toBeDefined();
  });
});
