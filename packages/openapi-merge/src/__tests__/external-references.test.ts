import _ from 'lodash';
import { merge } from '../index';
import { at, doc30, expectMergeError, expectSuccess, op, ok, schema, schemaKeys } from './_helpers/documents';
import { OpenApiDocument } from '../oas31';

/**
 * Cross-document `$ref` resolution (issues #104 and #10).
 *
 * `merge()` never does file I/O -- everything here calls it directly with
 * hand-built `externalDocuments`, exactly as a caller (`openapi-merge-cli`)
 * would after resolving paths/URLs and loading files itself. No CLI, no disk,
 * no network: the subtle logic (dedup, disambiguation, recursion, cycles) all
 * lives here and is fully testable without any of that.
 */

describe('#104 -- refs into another declared input', () => {
  it('resolves a forward reference (input 0 refs input 2, not yet processed)', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'common#/components/schemas/ServerError' }) } } }) },
      { oas: doc30({ paths: { '/b': { get: op('getB') } } }) },
      { oas: doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } }), sourceIdentity: 'common' },
    ]));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: '#/components/schemas/ServerError' });
    expect(schemaKeys(output)).toEqual(['ServerError', 'Widget']);
  });

  it('resolves a backward reference (input 2 refs input 0, already processed)', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } }), sourceIdentity: 'common' },
      { oas: doc30({ paths: { '/b': { get: op('getB') } } }) },
      { oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'common#/components/schemas/ServerError' }) } } }) },
    ]));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: '#/components/schemas/ServerError' });
  });

  it('resolves a ref to a component that was renamed for a clash in the target input', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ components: { schemas: { ServerError: schema({ type: 'object', properties: { a: schema({ type: 'string' }) } }) } } }) },
      {
        oas: doc30({ components: { schemas: { ServerError: schema({ type: 'object', properties: { b: schema({ type: 'string' }) } }) } } }),
        sourceIdentity: 'common',
      },
      { oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'common#/components/schemas/ServerError' }) } } }) },
    ]));

    // input 1's ServerError clashed with input 0's (different content) and was
    // renamed ServerError1 -- the ref into it must follow the rename.
    expect(schemaKeys(output)).toEqual(['ServerError', 'ServerError1', 'Widget']);
    expect(output.components?.schemas?.Widget).toEqual({ $ref: '#/components/schemas/ServerError1' });
  });

  it('leaves a ref unresolved when its identity is claimed by more than one input', () => {
    // The config can legitimately list the same file twice; there is no
    // principled way to tell which copy a cross-document ref meant.
    const output = expectSuccess(merge([
      { oas: doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } }), sourceIdentity: 'common' },
      { oas: doc30({ components: { schemas: { OtherError: schema({ type: 'object' }) } } }), sourceIdentity: 'common' },
      { oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'common#/components/schemas/ServerError' }) } } }) },
    ]));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: 'common#/components/schemas/ServerError' });
  });
});

describe('#10 -- pulling components from externalDocuments', () => {
  it('pulls in a component the first time it is referenced', () => {
    const externalDoc = doc30({
      components: { schemas: { ServerError: schema({ type: 'object', properties: { message: schema({ type: 'string' }) } }) } },
    });

    const output = expectSuccess(merge(
      [{ oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'errors.yaml#/components/schemas/ServerError' }) } } }) }],
      { externalDocuments: { 'errors.yaml': externalDoc } },
    ));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: '#/components/schemas/ServerError' });
    expect(output.components?.schemas?.ServerError).toEqual({ type: 'object', properties: { message: { type: 'string' } } });
  });

  it('collapses a pulled-in component against an equivalent one already in the output', () => {
    const serverError = schema({ type: 'object', properties: { message: schema({ type: 'string' }) } });
    const externalDoc = doc30({ components: { schemas: { ServerError: _.cloneDeep(serverError) } } });

    const output = expectSuccess(merge(
      [
        { oas: doc30({ components: { schemas: { ServerError: serverError } } }) },
        { oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'errors.yaml#/components/schemas/ServerError' }) } } }) },
      ],
      { externalDocuments: { 'errors.yaml': externalDoc } },
    ));

    expect(schemaKeys(output)).toEqual(['ServerError', 'Widget']);
    expect(output.components?.schemas?.Widget).toEqual({ $ref: '#/components/schemas/ServerError' });
  });

  it('disambiguates with a numeric suffix when a pulled-in component clashes with a different one', () => {
    const externalDoc = doc30({
      components: { schemas: { ServerError: schema({ type: 'object', properties: { code: schema({ type: 'integer' }) } }) } },
    });

    const output = expectSuccess(merge(
      [
        { oas: doc30({ components: { schemas: { ServerError: schema({ type: 'object', properties: { message: schema({ type: 'string' }) } }) } } }) },
        { oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'errors.yaml#/components/schemas/ServerError' }) } } }) },
      ],
      { externalDocuments: { 'errors.yaml': externalDoc } },
    ));

    // No dispute config applies to a pulled-in component (it was never a
    // declared input); the fallback is the same numeric-suffix disambiguation
    // `processComponents` already uses when no dispute is configured.
    expect(schemaKeys(output)).toEqual(['ServerError', 'ServerError1', 'Widget']);
    expect(output.components?.schemas?.Widget).toEqual({ $ref: '#/components/schemas/ServerError1' });
  });

  it('recursively pulls in components across a chain of external documents', () => {
    const docC = doc30({ components: { schemas: { Inner: schema({ type: 'string' }) } } });
    const docB = doc30({ components: { schemas: { Wrapper: schema({ $ref: 'c.yaml#/components/schemas/Inner' }) } } });

    const output = expectSuccess(merge(
      [{ oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'b.yaml#/components/schemas/Wrapper' }) } } }) }],
      { externalDocuments: { 'b.yaml': docB, 'c.yaml': docC } },
    ));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: '#/components/schemas/Wrapper' });
    expect(output.components?.schemas?.Wrapper).toEqual({ $ref: '#/components/schemas/Inner' });
    expect(output.components?.schemas?.Inner).toEqual({ type: 'string' });
  });

  it('resolves a declared-input ref and an external-document ref from the same input', () => {
    const externalDoc = doc30({ components: { schemas: { FromExternal: schema({ type: 'string' }) } } });

    const output = expectSuccess(merge(
      [
        {
          oas: doc30({
            components: {
              schemas: {
                Widget: schema({
                  type: 'object',
                  properties: {
                    a: schema({ $ref: 'common#/components/schemas/FromInput' }),
                    b: schema({ $ref: 'external.yaml#/components/schemas/FromExternal' }),
                  },
                }),
              },
            },
          }),
        },
        { oas: doc30({ components: { schemas: { FromInput: schema({ type: 'number' }) } } }), sourceIdentity: 'common' },
      ],
      { externalDocuments: { 'external.yaml': externalDoc } },
    ));

    expect(at(output, 'components', 'schemas', 'Widget', 'properties', 'a')).toEqual({ $ref: '#/components/schemas/FromInput' });
    expect(at(output, 'components', 'schemas', 'Widget', 'properties', 'b')).toEqual({ $ref: '#/components/schemas/FromExternal' });
  });

  it('reports a clean error for a cyclic external reference instead of overflowing the stack', () => {
    const docX = doc30({
      components: {
        schemas: {
          A: schema({ $ref: '#/components/schemas/B' }),
          B: schema({ $ref: '#/components/schemas/A' }),
        },
      },
    });

    const message = expectMergeError(
      merge(
        [{ oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'x.yaml#/components/schemas/A' }) } } }) }],
        { externalDocuments: { 'x.yaml': docX } },
      ),
      'cyclic-external-reference',
    );

    expect(message).toContain('x.yaml');
  });

  it('leaves an unsupported fragment shape (a nested path) unresolved rather than guessing', () => {
    const externalDoc = doc30({
      components: { schemas: { ServerError: schema({ type: 'object', properties: { message: schema({ type: 'string' }) } }) } },
    });
    const nestedRef = 'errors.yaml#/components/schemas/ServerError/properties/message';

    const output = expectSuccess(merge(
      [{ oas: doc30({ components: { schemas: { Widget: schema({ $ref: nestedRef }) } } }) }],
      { externalDocuments: { 'errors.yaml': externalDoc } },
    ));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: nestedRef });
  });

  it('leaves a securitySchemes fragment unresolved -- addressed by name, never by $ref', () => {
    const externalDoc = {
      ...doc30({}),
      components: { securitySchemes: { apiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header' } } },
    } as unknown as OpenApiDocument;
    const securitySchemeRef = 'auth.yaml#/components/securitySchemes/apiKey';

    const output = expectSuccess(merge(
      [{ oas: doc30({ components: { schemas: { Widget: schema({ $ref: securitySchemeRef }) } } }) }],
      { externalDocuments: { 'auth.yaml': externalDoc } },
    ));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: securitySchemeRef });
  });

  it('leaves a whole-document ref (no fragment) untouched, even with a matching externalDocuments entry', () => {
    const externalDoc = doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } });
    const wholeDocRef = 'errors.yaml';

    const output = expectSuccess(merge(
      [{ oas: doc30({ components: { schemas: { Widget: schema({ $ref: wholeDocRef }) } } }) }],
      { externalDocuments: { 'errors.yaml': externalDoc } },
    ));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: wholeDocRef });
  });

  it('reuses the same pulled-in component (and identity+fragment cache) when referenced twice', () => {
    const externalDoc = doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } });

    const output = expectSuccess(merge(
      [{
        oas: doc30({
          components: {
            schemas: {
              WidgetA: schema({ $ref: 'errors.yaml#/components/schemas/ServerError' }),
              WidgetB: schema({ $ref: 'errors.yaml#/components/schemas/ServerError' }),
            },
          },
        }),
      }],
      { externalDocuments: { 'errors.yaml': externalDoc } },
    ));

    expect(schemaKeys(output)).toEqual(['ServerError', 'WidgetA', 'WidgetB']);
    expect(output.components?.schemas?.WidgetA).toEqual({ $ref: '#/components/schemas/ServerError' });
    expect(output.components?.schemas?.WidgetB).toEqual({ $ref: '#/components/schemas/ServerError' });
  });

  it('leaves a ref unresolved when the external document exists but the named component does not', () => {
    const externalDoc = doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } });
    const typoRef = 'errors.yaml#/components/schemas/ServerErro';

    const output = expectSuccess(merge(
      [{ oas: doc30({ components: { schemas: { Widget: schema({ $ref: typoRef }) } } }) }],
      { externalDocuments: { 'errors.yaml': externalDoc } },
    ));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: typoRef });
  });

  it('stops processing a pulled-in component\'s remaining refs once one of them errors', () => {
    // Two refs in the same component: the first is cyclic (errors), the
    // second is perfectly resolvable. The second must not also be resolved
    // and silently placed -- once a component has failed, nothing further
    // from it should be inserted.
    const docX = doc30({
      components: {
        schemas: {
          A: schema({ $ref: '#/components/schemas/B' }),
          B: schema({ $ref: '#/components/schemas/A' }),
          Combined: schema({
            type: 'object',
            properties: {
              cyclic: schema({ $ref: '#/components/schemas/A' }),
              fine: schema({ $ref: '#/components/schemas/Fine' }),
            },
          }),
          Fine: schema({ type: 'string' }),
        },
      },
    });

    const message = expectMergeError(
      merge(
        [{ oas: doc30({ components: { schemas: { Widget: schema({ $ref: 'x.yaml#/components/schemas/Combined' }) } } }) }],
        { externalDocuments: { 'x.yaml': docX } },
      ),
      'cyclic-external-reference',
    );

    expect(message).toContain('x.yaml');
  });

  it('leaves a cross-document ref untouched when externalDocuments is not provided at all', () => {
    // Regression guard: this option must be fully opt-in by omission, with no
    // behaviour change for a caller that never passes it (e.g. today's CLI
    // with `resolveExternalReferences` off).
    const untouchedRef = 'errors.yaml#/components/schemas/ServerError';

    const output = expectSuccess(merge([
      { oas: doc30({ components: { schemas: { Widget: schema({ $ref: untouchedRef }) } } }) },
    ]));

    expect(output.components?.schemas?.Widget).toEqual({ $ref: untouchedRef });
  });

  it('a pulled-in component survives pruneUnusedComponents, since it really is referenced', () => {
    const externalDoc = doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } });

    const output = expectSuccess(merge(
      [{
        oas: doc30({
          paths: {
            '/a': {
              get: {
                ...op('getA'),
                responses: {
                  ...ok,
                  default: {
                    description: 'error',
                    content: { 'application/json': { schema: schema({ $ref: 'errors.yaml#/components/schemas/ServerError' }) } },
                  },
                },
              },
            },
          },
        }),
      }],
      { externalDocuments: { 'errors.yaml': externalDoc }, pruneUnusedComponents: true },
    ));

    expect(schemaKeys(output)).toEqual(['ServerError']);
  });
});
