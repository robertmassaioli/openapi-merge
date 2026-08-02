import { merge } from '../index';
import { doc30, expectMergeError, expectSuccess, op } from './_helpers/documents';
import { OpenApiDocument } from '../oas31';

/**
 * `typeof null === 'object'` in JavaScript, so any code checking "is this a
 * real object" without also excluding `null` treats an empty YAML value
 * (`schemas: { Widget: }`) as a valid object and crashes on the next
 * operation -- see ai-planning/40-proposal-null-safe-document-walking.md.
 *
 * Every test here builds a document with a `null` in a slot the specification
 * requires to be an object (or a string), the way a YAML author produces one
 * by accident: a key with nothing written after it. Before the fix, `merge()`
 * does not catch these at all -- they throw an uncaught `TypeError` out of
 * `merge()` itself. After the fix, `merge()` returns a `malformed-document`
 * error naming what was expected and (where the pointer is known) where.
 *
 * §2.4 of the proposal: `null` legally appears elsewhere in OpenAPI (`example:
 * null`, an `enum` containing `null`) and none of that is affected here --
 * those are exercised by `component-equivalence.test.ts` instead.
 */
describe('null in a structural slot (issue #92 / proposal 40)', () => {
  // Casts throughout: every document here is deliberately not well-typed --
  // that is the point being tested -- so `as unknown as X` stands in for
  // what a real YAML parser hands back for an empty value.
  const nullOAS = (partial: Record<string, unknown>): OpenApiDocument =>
    ({ ...doc30({}), ...partial } as unknown as OpenApiDocument);

  it('a whole component left empty (schemas.Widget:)', () => {
    const result = merge([{ oas: nullOAS({ components: { schemas: { Widget: null } } }) }]);
    expectMergeError(result, 'malformed-document');
  });

  it('an empty operation (paths./a.get:)', () => {
    const result = merge([{ oas: nullOAS({ paths: { '/a': { get: null } } }) }]);
    expectMergeError(result, 'malformed-document');
  });

  it('a whole path item left empty (paths./a:)', () => {
    const result = merge([{ oas: nullOAS({ paths: { '/a': null } }) }]);
    expectMergeError(result, 'malformed-document');
  });

  it('components present but empty (components:)', () => {
    const result = merge([{ oas: nullOAS({ components: null }) }]);
    expectMergeError(result, 'malformed-document');
  });

  it('a security requirement list item left empty (security: [ ])', () => {
    const result = merge([{ oas: nullOAS({ security: [null] }) }]);
    expectMergeError(result, 'malformed-document');
  });

  it('the whole security array left empty (security:)', () => {
    const result = merge([{ oas: nullOAS({ security: null }) }]);
    expectMergeError(result, 'malformed-document');
  });

  it('a per-operation security requirement left empty', () => {
    const result = merge([
      { oas: nullOAS({ paths: { '/a': { get: { ...op('getA'), security: [null] } } } }) },
    ]);
    expectMergeError(result, 'malformed-document');
  });

  it('a per-operation security array left empty (security:)', () => {
    const result = merge([
      { oas: nullOAS({ paths: { '/a': { get: { ...op('getA'), security: null } } } }) },
    ]);
    expectMergeError(result, 'malformed-document');
  });

  it('securitySchemes present but empty', () => {
    const result = merge([{ oas: nullOAS({ components: { securitySchemes: null } }) }]);
    expectMergeError(result, 'malformed-document');
  });

  it('a components.pathItems entry left empty', () => {
    const result = merge([{ oas: nullOAS({ components: { pathItems: { P: null } } }) }]);
    expectMergeError(result, 'malformed-document');
  });

  it('a callback expression left empty', () => {
    const result = merge([
      {
        oas: nullOAS({
          paths: {
            '/a': {
              get: {
                ...op('getA'),
                callbacks: { onEvent: { '{$request.body#/callbackUrl}': null } },
              },
            },
          },
        }),
      },
    ]);
    expectMergeError(result, 'malformed-document');
  });

  it('additionalProperties left empty', () => {
    const result = merge([
      { oas: nullOAS({ components: { schemas: { Widget: { type: 'object', additionalProperties: null } } } }) },
    ]);
    expectMergeError(result, 'malformed-document');
  });

  it('a media type left empty (content: { application/json: })', () => {
    const result = merge([
      {
        oas: nullOAS({
          paths: {
            '/a': {
              get: {
                ...op('getA'),
                responses: { '200': { description: 'ok', content: { 'application/json': null } } },
              },
            },
          },
        }),
      },
    ]);
    expectMergeError(result, 'malformed-document');
  });

  it('a discriminator defaultMapping left empty', () => {
    const result = merge([
      {
        oas: nullOAS({
          components: {
            schemas: {
              Pet: {
                oneOf: [{ $ref: '#/components/schemas/Dog' }],
                discriminator: { propertyName: 'type', defaultMapping: null },
              },
              Dog: { type: 'object' },
            },
          },
        }),
      },
    ]);
    expectMergeError(result, 'malformed-document');
  });

  it('a discriminator mapping target left empty', () => {
    const result = merge([
      {
        oas: nullOAS({
          components: {
            schemas: {
              Pet: {
                oneOf: [{ $ref: '#/components/schemas/Dog' }],
                discriminator: { propertyName: 'type', mapping: { dog: null } },
              },
              Dog: { type: 'object' },
            },
          },
        }),
      },
    ]);
    expectMergeError(result, 'malformed-document');
  });

  it('pruneUnusedComponents does not turn a null security requirement into a crash instead of the same clean error', () => {
    const result = merge(
      [{ oas: nullOAS({ security: [null], components: { schemas: {} } }) }],
      { pruneUnusedComponents: true },
    );
    expectMergeError(result, 'malformed-document');
  });

  // Proposal §4.1a: a component pulled in from `externalDocuments` that is
  // present but empty is treated the same as one that is missing entirely --
  // `unresolved`, not an error -- because the external document was never
  // declared as an input the config author is responsible for (contrast every
  // other case above, all in a *declared* input's own content).
  it('a null pulled-in external component is left unresolved, not an error', () => {
    const common = nullOAS({ components: { schemas: { Errors: null } } });
    const output = expectSuccess(
      merge(
        [{ oas: nullOAS({ components: { schemas: { Widget: { $ref: 'common#/components/schemas/Errors' } } } }) }],
        { externalDocuments: { common } },
      ),
    );
    expect(output.components?.schemas?.Widget).toEqual({ $ref: 'common#/components/schemas/Errors' });
  });

  it('names what was expected in the error message, not a raw TypeError', () => {
    const result = merge([{ oas: nullOAS({ components: { schemas: { Widget: null } } }) }]);
    const message = expectMergeError(result, 'malformed-document');
    expect(message).not.toContain('Cannot use');
    expect(message).not.toContain('is not an Object');
    expect(message.toLowerCase()).toContain('null');
  });
});
