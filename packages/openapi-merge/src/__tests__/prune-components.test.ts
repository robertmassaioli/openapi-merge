import { merge } from '../index';
import { OpenApiDocument } from '../oas31';
import { doc30, doc31, expectSuccess, ok, schemaKeys } from './_helpers/documents';

/**
 * Issue #94: dropping components nothing refers to any more.
 *
 * `excludeTags` removes operations but left behind the schemas only those
 * operations used, so the output described endpoints it no longer contained.
 *
 * Opt-in. Pruning is destructive and this library has always preserved every
 * component it was given -- a document may carry definitions referenced only
 * from outside it, and deleting those silently would be a worse failure than
 * carrying a few unused ones.
 *
 * Computed by reachability over the finished document rather than by tracking
 * what each removed operation used, which is what makes the issue's own caveat
 * -- "unless it is also used by another endpoint" -- correct by construction.
 */
describe('pruneUnusedComponents (issue #94)', () => {
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

  const opUsing = (operationId: string, schemaName: string, tags?: string[]) => ({
    operationId,
    ...(tags === undefined ? {} : { tags }),
    responses: { '200': { description: 'ok', content: { 'application/json': { schema: ref(schemaName) } } } },
  });

  const taggedDoc = () =>
    doc30({
      paths: {
        '/kept': { get: opUsing('kept', 'Kept', ['public']) },
        '/dropped': { get: opUsing('dropped', 'Dropped', ['internal']) },
      },
      components: {
        schemas: {
          Kept: { type: 'object' },
          Dropped: { type: 'object' },
        },
      },
    });

  it('is off by default, so an excluded tag leaves its schema behind', () => {
    const output = expectSuccess(
      merge([{ oas: taggedDoc(), operationSelection: { excludeTags: ['internal'] } }]),
    );

    // The behaviour the issue reports. Unchanged unless asked.
    expect(schemaKeys(output)).toEqual(['Dropped', 'Kept']);
  });

  it('drops the schema of an excluded operation when enabled', () => {
    const output = expectSuccess(
      merge([{ oas: taggedDoc(), operationSelection: { excludeTags: ['internal'] } }], {
        pruneUnusedComponents: true,
      }),
    );

    expect(schemaKeys(output)).toEqual(['Kept']);
  });

  it('keeps a schema that another surviving endpoint also uses', () => {
    const output = expectSuccess(
      merge(
        [
          {
            oas: doc30({
              paths: {
                '/kept': { get: opUsing('kept', 'Shared', ['public']) },
                '/dropped': { get: opUsing('dropped', 'Shared', ['internal']) },
              },
              components: { schemas: { Shared: { type: 'object' } } },
            }),
            operationSelection: { excludeTags: ['internal'] },
          },
        ],
        { pruneUnusedComponents: true },
      ),
    );

    // The caveat from the issue, stated explicitly.
    expect(schemaKeys(output)).toEqual(['Shared']);
  });

  it('follows chains of references between components', () => {
    const output = expectSuccess(
      merge(
        [
          {
            oas: doc30({
              paths: { '/a': { get: opUsing('a', 'Outer', ['public']) } },
              components: {
                schemas: {
                  Outer: { type: 'object', properties: { inner: ref('Middle') } },
                  Middle: { type: 'object', properties: { deep: ref('Inner') } },
                  Inner: { type: 'string' },
                  Orphan: { type: 'boolean' },
                },
              },
            }),
          },
        ],
        { pruneUnusedComponents: true },
      ),
    );

    expect(schemaKeys(output)).toEqual(['Inner', 'Middle', 'Outer']);
  });

  it('keeps security schemes named by a requirement, which are not $refs', () => {
    const output = expectSuccess(
      merge(
        [
          {
            oas: doc30({
              paths: { '/a': { get: { operationId: 'a', responses: ok, security: [{ apiKey: [] }] } } },
              components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Key' } } },
            }),
          },
        ],
        { pruneUnusedComponents: true },
      ),
    );

    // A Security Requirement names its scheme as an object key, so the
    // reference walker cannot see it. Without special handling, pruning would
    // delete every security scheme in the document.
    expect(Object.keys(output.components?.securitySchemes ?? {})).toEqual(['apiKey']);
  });

  it('keeps a security scheme named only at document level', () => {
    const output = expectSuccess(
      merge(
        [
          {
            oas: doc30({
              paths: { '/a': { get: { operationId: 'a', responses: ok } } },
              security: [{ apiKey: [] }],
              components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Key' } } },
            }),
          },
        ],
        { pruneUnusedComponents: true },
      ),
    );

    expect(Object.keys(output.components?.securitySchemes ?? {})).toEqual(['apiKey']);
  });

  it('drops a security scheme nothing requires', () => {
    const output = expectSuccess(
      merge(
        [
          {
            oas: doc30({
              paths: { '/a': { get: { operationId: 'a', responses: ok } } },
              components: { securitySchemes: { unused: { type: 'apiKey', in: 'header', name: 'X-Key' } } },
            }),
          },
        ],
        { pruneUnusedComponents: true },
      ),
    );

    expect(output.components).toBeUndefined();
  });

  it('follows references out of webhooks as well as paths', () => {
    const output = expectSuccess(
      merge(
        [
          {
            oas: doc31({
              paths: {},
              webhooks: { ping: { post: opUsing('ping', 'Event') } },
              components: { schemas: { Event: { type: 'object' }, Orphan: { type: 'string' } } },
            }),
          },
        ],
        { pruneUnusedComponents: true },
      ),
    );

    expect(schemaKeys(output)).toEqual(['Event']);
  });

  it('leaves components alone when everything is reachable', () => {
    const output = expectSuccess(
      merge([{ oas: taggedDoc() }], { pruneUnusedComponents: true }),
    );

    expect(schemaKeys(output)).toEqual(['Dropped', 'Kept']);
  });

  it('removes the components object entirely when nothing survives', () => {
    const output = expectSuccess(
      merge(
        [
          {
            oas: doc30({
              paths: { '/a': { get: { operationId: 'a', responses: ok } } },
              components: { schemas: { Orphan: { type: 'string' } } },
            }),
          },
        ],
        { pruneUnusedComponents: true },
      ),
    );

    // Not `components: {}`, which is noise.
    expect(output.components).toBeUndefined();
  });

  it('does not remove a component merely because a reference is dangling', () => {
    const output = expectSuccess(
      merge(
        [
          {
            oas: {
              ...doc30({
                paths: { '/a': { get: opUsing('a', 'Missing') } },
                components: { schemas: { Present: { type: 'string' } } },
              }),
            } as OpenApiDocument,
          },
        ],
        { pruneUnusedComponents: true },
      ),
    );

    // `Missing` does not exist; `Present` is genuinely unreferenced and goes.
    // The point is that the dangling reference does not crash the walk.
    expect(schemaKeys(output)).toEqual([]);
  });
});
