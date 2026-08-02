import { CrossDocumentLookup, buildKnownDocuments } from '../cross-document-lookup';
import { doc30, schema } from './_helpers/documents';

/**
 * Unit tests against `CrossDocumentLookup` directly, rather than only through
 * `merge()` -- the class is the seam Option C (42-proposal-external-ref-equality-in-dedup.md)
 * adds, so it earns its own coverage independent of how `paths-and-components.ts`
 * and `external-references.ts` happen to wire it up today.
 */

describe('CrossDocumentLookup', () => {
  describe('local resolution (no knownDocuments needed)', () => {
    it('passes a non-reference value through unchanged', () => {
      const lookup = new CrossDocumentLookup(doc30({}));
      const value = schema({ type: 'string' });

      expect(lookup.getSchema(value)).toBe(value);
    });

    it('resolves a bare local $ref (using an accessor with no title-backfill quirk to keep this test focused)', () => {
      const local = doc30({ components: { responses: { NotFound: { description: 'not found' } } } });
      const lookup = new CrossDocumentLookup(local);

      expect(lookup.getResponse({ $ref: '#/components/responses/NotFound' })).toEqual({ description: 'not found' });
    });

    it('backfills a missing schema title from a 4-segment local ref, matching InternalLookup', () => {
      const local = doc30({ components: { schemas: { Foo: schema({ type: 'string' }) } } });
      const lookup = new CrossDocumentLookup(local);

      expect(lookup.getSchema({ $ref: '#/components/schemas/Foo' })).toEqual({ type: 'string', title: 'Foo' });
    });

    it('does not backfill a title that is already present', () => {
      const local = doc30({ components: { schemas: { Foo: schema({ type: 'string', title: 'Explicit' } as Record<string, unknown>) } } });
      const lookup = new CrossDocumentLookup(local);

      expect(lookup.getSchema({ $ref: '#/components/schemas/Foo' })).toEqual({ type: 'string', title: 'Explicit' });
    });

    it('returns undefined for a bare ref that does not resolve to anything', () => {
      const lookup = new CrossDocumentLookup(doc30({ components: { schemas: {} } }));

      expect(lookup.getSchema({ $ref: '#/components/schemas/Missing' })).toBeUndefined();
    });

    it('resolves a chain of purely local aliases (A -> B -> C)', () => {
      const local = doc30({
        components: {
          schemas: {
            A: schema({ $ref: '#/components/schemas/B' }),
            B: schema({ $ref: '#/components/schemas/C' }),
            C: schema({ type: 'number' }),
          },
        },
      });
      const lookup = new CrossDocumentLookup(local);

      // Title backfill is keyed off the ref *passed in* ('A'), not where the
      // chain bottoms out ('C') -- InternalLookup's own behaviour, delegated
      // to wholesale rather than reimplemented (see this class's docstring).
      expect(lookup.getSchema({ $ref: '#/components/schemas/A' })).toEqual({ type: 'number', title: 'A' });
    });

    it('returns undefined when the resolved value does not match the accessor\'s shape', () => {
      // A bare schema (no `content`) does not satisfy isRequestBody.
      const local = doc30({ components: { schemas: { NotABody: schema({ type: 'string' }) } } });
      const lookup = new CrossDocumentLookup(local);

      expect(lookup.getRequestBody({ $ref: '#/components/schemas/NotABody' })).toBeUndefined();
    });
  });

  describe('cross-document resolution', () => {
    it('resolves a $ref into a known document', () => {
      const external = doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } });
      const lookup = new CrossDocumentLookup(doc30({}), { 'errors.yaml': external });

      expect(lookup.getSchema({ $ref: 'errors.yaml#/components/schemas/ServerError' })).toEqual({ type: 'object', title: 'ServerError' });
    });

    it('returns undefined when the identity is not in knownDocuments', () => {
      const lookup = new CrossDocumentLookup(doc30({}), {});

      expect(lookup.getSchema({ $ref: 'unknown.yaml#/components/schemas/Foo' })).toBeUndefined();
    });

    it('returns undefined when the identity is known but the fragment is not found', () => {
      const external = doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } });
      const lookup = new CrossDocumentLookup(doc30({}), { 'errors.yaml': external });

      expect(lookup.getSchema({ $ref: 'errors.yaml#/components/schemas/Typo' })).toBeUndefined();
    });

    it('returns undefined for a whole-document reference (no fragment), even with a matching identity', () => {
      const external = doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } });
      const lookup = new CrossDocumentLookup(doc30({}), { 'errors.yaml': external });

      expect(lookup.getSchema({ $ref: 'errors.yaml' })).toBeUndefined();
    });

    it('resolves a two-hop cross-document chain (A -> B -> C, three different identities)', () => {
      const docC = doc30({ components: { schemas: { Inner: schema({ type: 'string' }) } } });
      const docB = doc30({ components: { schemas: { Middle: schema({ $ref: 'c.yaml#/components/schemas/Inner' }) } } });
      const lookup = new CrossDocumentLookup(doc30({}), { 'b.yaml': docB, 'c.yaml': docC });

      expect(lookup.getSchema({ $ref: 'b.yaml#/components/schemas/Middle' })).toEqual({ type: 'string', title: 'Inner' });
    });

    it('resolves a cross-document ref whose target is itself a local alias within that document', () => {
      const docB = doc30({
        components: {
          schemas: {
            Alias: schema({ $ref: '#/components/schemas/Real' }),
            Real: schema({ type: 'boolean' }),
          },
        },
      });
      const lookup = new CrossDocumentLookup(doc30({}), { 'b.yaml': docB });

      // Same backfill rule as the purely-local chain above: keyed off the ref
      // that was actually passed to the (child) InternalLookup ('Alias'), not
      // the alias's own target ('Real').
      expect(lookup.getSchema({ $ref: 'b.yaml#/components/schemas/Alias' })).toEqual({ type: 'boolean', title: 'Alias' });
    });

    it('resolves a *local* alias that itself bottoms out at a foreign document (the narrow InternalLookup gap)', () => {
      // Foo (local) -> Bar (local) -> external.yaml#/components/schemas/Baz.
      // InternalLookup alone gives up the moment it reaches the foreign ref,
      // returning undefined for the whole chain; CrossDocumentLookup must
      // pick up exactly where it gave up.
      const external = doc30({ components: { schemas: { Baz: schema({ type: 'integer' }) } } });
      const local = doc30({
        components: {
          schemas: {
            Foo: schema({ $ref: '#/components/schemas/Bar' }),
            Bar: schema({ $ref: 'external.yaml#/components/schemas/Baz' }),
          },
        },
      });
      const lookup = new CrossDocumentLookup(local, { 'external.yaml': external });

      expect(lookup.getSchema({ $ref: '#/components/schemas/Foo' })).toEqual({ type: 'integer', title: 'Baz' });
    });

    it('returns undefined, not a stack overflow, for a genuine cross-document cycle', () => {
      const docA = doc30({ components: { schemas: { A: schema({ $ref: 'b.yaml#/components/schemas/B' }) } } });
      const docB = doc30({ components: { schemas: { B: schema({ $ref: 'a.yaml#/components/schemas/A' }) } } });
      const lookup = new CrossDocumentLookup(doc30({}), { 'a.yaml': docA, 'b.yaml': docB });

      expect(() => lookup.getSchema({ $ref: 'a.yaml#/components/schemas/A' })).not.toThrow();
      expect(lookup.getSchema({ $ref: 'a.yaml#/components/schemas/A' })).toBeUndefined();
    });

    it('resolves two different refs into the same identity consistently (exercises the memoized child lookup)', () => {
      const external = doc30({
        components: { schemas: { One: schema({ type: 'string' }), Two: schema({ type: 'number' }) } },
      });
      const lookup = new CrossDocumentLookup(doc30({}), { 'shared.yaml': external });

      expect(lookup.getSchema({ $ref: 'shared.yaml#/components/schemas/One' })).toEqual({ type: 'string', title: 'One' });
      expect(lookup.getSchema({ $ref: 'shared.yaml#/components/schemas/Two' })).toEqual({ type: 'number', title: 'Two' });
    });
  });

  describe('every Lookup accessor, local and cross-document', () => {
    const external = doc30({
      components: {
        callbacks: { OnData: { '{$request.body#/callbackUrl}': {} } },
        examples: { Sample: { value: 'hello' } },
        headers: { RateLimit: { schema: schema({ type: 'integer' }) } },
        links: { Next: { operationId: 'getNext' } },
        parameters: { Limit: { name: 'limit', in: 'query', schema: schema({ type: 'integer' }) } },
        requestBodies: { Body: { content: {} } },
        responses: { NotFound: { description: 'not found' } },
        securitySchemes: { ApiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header' } },
      },
    });
    const local = doc30({
      components: {
        callbacks: { OnData: { '{$request.body#/callbackUrl}': {} } },
        examples: { Sample: { value: 'hello' } },
        headers: { RateLimit: { schema: schema({ type: 'integer' }) } },
        links: { Next: { operationId: 'getNext' } },
        parameters: { Limit: { name: 'limit', in: 'query', schema: schema({ type: 'integer' }) } },
        requestBodies: { Body: { content: {} } },
        responses: { NotFound: { description: 'not found' } },
        securitySchemes: { ApiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header' } },
      },
    });

    it('getCallback: local and cross-document', () => {
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': external });
      expect(lookup.getCallback({ $ref: '#/components/callbacks/OnData' })).toEqual({ '{$request.body#/callbackUrl}': {} });
      expect(lookup.getCallback({ $ref: 'x.yaml#/components/callbacks/OnData' })).toEqual({ '{$request.body#/callbackUrl}': {} });
    });

    it('getExample: local and cross-document', () => {
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': external });
      expect(lookup.getExample({ $ref: '#/components/examples/Sample' })).toEqual({ value: 'hello' });
      expect(lookup.getExample({ $ref: 'x.yaml#/components/examples/Sample' })).toEqual({ value: 'hello' });
    });

    it('getHeaders: local and cross-document', () => {
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': external });
      expect(lookup.getHeaders({ $ref: '#/components/headers/RateLimit' })).toEqual({ schema: { type: 'integer' } });
      expect(lookup.getHeaders({ $ref: 'x.yaml#/components/headers/RateLimit' })).toEqual({ schema: { type: 'integer' } });
    });

    it('getLink: local and cross-document', () => {
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': external });
      expect(lookup.getLink({ $ref: '#/components/links/Next' })).toEqual({ operationId: 'getNext' });
      expect(lookup.getLink({ $ref: 'x.yaml#/components/links/Next' })).toEqual({ operationId: 'getNext' });
    });

    it('getParam: local and cross-document', () => {
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': external });
      expect(lookup.getParam({ $ref: '#/components/parameters/Limit' })).toEqual({ name: 'limit', in: 'query', schema: { type: 'integer' } });
      expect(lookup.getParam({ $ref: 'x.yaml#/components/parameters/Limit' })).toEqual({ name: 'limit', in: 'query', schema: { type: 'integer' } });
    });

    it('getRequestBody: local and cross-document', () => {
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': external });
      expect(lookup.getRequestBody({ $ref: '#/components/requestBodies/Body' })).toEqual({ content: {} });
      expect(lookup.getRequestBody({ $ref: 'x.yaml#/components/requestBodies/Body' })).toEqual({ content: {} });
    });

    it('getResponse: local and cross-document', () => {
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': external });
      expect(lookup.getResponse({ $ref: '#/components/responses/NotFound' })).toEqual({ description: 'not found' });
      expect(lookup.getResponse({ $ref: 'x.yaml#/components/responses/NotFound' })).toEqual({ description: 'not found' });
    });

    it('getSecurityScheme: local and cross-document', () => {
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': external });
      expect(lookup.getSecurityScheme({ $ref: '#/components/securitySchemes/ApiKey' })).toEqual({ type: 'apiKey', name: 'X-Api-Key', in: 'header' });
      expect(lookup.getSecurityScheme({ $ref: 'x.yaml#/components/securitySchemes/ApiKey' })).toEqual({ type: 'apiKey', name: 'X-Api-Key', in: 'header' });
    });

    it('getSecuritySchemeByName: always local, never cross-document', () => {
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': external });
      expect(lookup.getSecuritySchemeByName('ApiKey')).toEqual({ type: 'apiKey', name: 'X-Api-Key', in: 'header' });
      expect(lookup.getSecuritySchemeByName('DoesNotExist')).toBeUndefined();
    });
  });
});

describe('buildKnownDocuments', () => {
  it('keys declared inputs by their sourceIdentity', () => {
    const inputOas = doc30({ components: { schemas: { A: schema({ type: 'string' }) } } });

    const known = buildKnownDocuments([{ oas: inputOas, sourceIdentity: 'common' }], new Set(), {});

    expect(known).toEqual({ common: inputOas });
  });

  it('includes externalDocuments', () => {
    const externalDoc = doc30({});

    const known = buildKnownDocuments([], new Set(), { 'errors.yaml': externalDoc });

    expect(known).toEqual({ 'errors.yaml': externalDoc });
  });

  it('omits an input whose sourceIdentity is ambiguous', () => {
    const inputOas = doc30({});

    const known = buildKnownDocuments([{ oas: inputOas, sourceIdentity: 'common' }], new Set(['common']), {});

    expect(known).toEqual({});
  });

  it('omits an input with no sourceIdentity at all', () => {
    const known = buildKnownDocuments([{ oas: doc30({}) }], new Set(), {});

    expect(known).toEqual({});
  });

  it('lets a declared input win over an externalDocuments entry with the same identity', () => {
    const inputOas = doc30({ components: { schemas: { FromInput: schema({ type: 'string' }) } } });
    const externalDoc = doc30({ components: { schemas: { FromExternal: schema({ type: 'number' }) } } });

    const known = buildKnownDocuments(
      [{ oas: inputOas, sourceIdentity: 'shared' }],
      new Set(),
      { shared: externalDoc },
    );

    expect(known).toEqual({ shared: inputOas });
  });
});
