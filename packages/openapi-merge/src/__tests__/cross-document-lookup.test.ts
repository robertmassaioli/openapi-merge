import { Swagger } from '@atlassian/atlassian-openapi';
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
      // chain bottoms out ('C') -- matches InternalLookup's own rule for this
      // fully-local case; see 43-proposal-local-reference-cycle-guard.md
      // §2.1.1 for how a chain that also crosses a document boundary anchors.
      expect(lookup.getSchema({ $ref: '#/components/schemas/A' })).toEqual({ type: 'number', title: 'A' });
    });

    it('returns undefined when the resolved value does not match the accessor\'s shape', () => {
      // A bare schema (no `content`) does not satisfy isRequestBody.
      const local = doc30({ components: { schemas: { NotABody: schema({ type: 'string' }) } } });
      const lookup = new CrossDocumentLookup(local);

      expect(lookup.getRequestBody({ $ref: '#/components/schemas/NotABody' })).toBeUndefined();
    });

    it('does not backfill a title for a nested (non-4-segment) fragment', () => {
      // Backfill is an exact `segments.length === 4` check (matching
      // InternalLookup's own rule); a nested property path is 6 segments and
      // must come back untouched.
      const local = doc30({
        components: { schemas: { Foo: schema({ type: 'object', properties: { name: schema({ type: 'string' }) } }) } },
      });
      const lookup = new CrossDocumentLookup(local);

      expect(lookup.getSchema({ $ref: '#/components/schemas/Foo/properties/name' })).toEqual({ type: 'string' });
    });

    it('returns undefined for a bare ref with no components section on the document at all', () => {
      const lookup = new CrossDocumentLookup(doc30({}));

      expect(lookup.getSchema({ $ref: '#/components/schemas/Foo' })).toBeUndefined();
    });

    it('returns undefined, rather than throwing, for a bare ref that is just "#" (no path at all)', () => {
      const local = doc30({ components: { schemas: { Foo: schema({ type: 'string' }) } } });
      const lookup = new CrossDocumentLookup(local);

      expect(() => lookup.getSchema({ $ref: '#' })).not.toThrow();
      expect(lookup.getSchema({ $ref: '#' })).toBeUndefined();
    });

    it('throws, rather than swallowing it, for a malformed pointer (missing the leading slash)', () => {
      // A `$ref` shaped `#foo` (no `/`) is invalid JSON Pointer syntax --
      // `jsonpointer.get` itself throws for it, exactly as it always has
      // (InternalLookup hits the same call today, for the same input, and
      // was never any more forgiving of this). Documented so a future reader
      // sees this is an inherited constraint of the pointer format, not
      // something this class introduces or is meant to guard against.
      const local = doc30({ components: { schemas: { Foo: schema({ type: 'string' }) } } });
      const lookup = new CrossDocumentLookup(local);

      expect(() => lookup.getSchema({ $ref: '#foo' })).toThrow('Invalid JSON pointer');
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

    it('returns undefined for an empty fragment ("identity#", hash present but nothing after it)', () => {
      // Distinct from the no-fragment case above: splitCrossDocumentRef
      // returns fragment: '#' here (not undefined), which then behaves like a
      // bare "#" against the target document -- resolves to the whole
      // document object, which fails every accessor's shape check.
      const external = doc30({ components: { schemas: { ServerError: schema({ type: 'object' }) } } });
      const lookup = new CrossDocumentLookup(doc30({}), { 'errors.yaml': external });

      expect(() => lookup.getSchema({ $ref: 'errors.yaml#' })).not.toThrow();
      expect(lookup.getSchema({ $ref: 'errors.yaml#' })).toBeUndefined();
    });

    it('does not backfill a title for a nested (non-4-segment) cross-document fragment', () => {
      const external = doc30({
        components: { schemas: { Foo: schema({ type: 'object', properties: { name: schema({ type: 'string' }) } }) } },
      });
      const lookup = new CrossDocumentLookup(doc30({}), { 'errors.yaml': external });

      expect(lookup.getSchema({ $ref: 'errors.yaml#/components/schemas/Foo/properties/name' })).toEqual({ type: 'string' });
    });

    it('does not overwrite an already-present title on a cross-document schema', () => {
      const external = doc30({
        components: { schemas: { Foo: schema({ type: 'string', title: 'Explicit' } as Record<string, unknown>) } },
      });
      const lookup = new CrossDocumentLookup(doc30({}), { 'errors.yaml': external });

      expect(lookup.getSchema({ $ref: 'errors.yaml#/components/schemas/Foo' })).toEqual({ type: 'string', title: 'Explicit' });
    });

    it('returns undefined when a cross-document ref resolves but does not match the accessor\'s shape', () => {
      const external = doc30({ components: { schemas: { NotABody: schema({ type: 'string' }) } } });
      const lookup = new CrossDocumentLookup(doc30({}), { 'errors.yaml': external });

      expect(lookup.getRequestBody({ $ref: 'errors.yaml#/components/schemas/NotABody' })).toBeUndefined();
    });

    it('defaults knownDocuments to empty when the constructor is called with just a local document', () => {
      const lookup = new CrossDocumentLookup(doc30({}));

      expect(() => lookup.getSchema({ $ref: 'errors.yaml#/components/schemas/Foo' })).not.toThrow();
      expect(lookup.getSchema({ $ref: 'errors.yaml#/components/schemas/Foo' })).toBeUndefined();
    });

    it('picks up a document added to knownDocuments after construction (no caching at all, let alone a stale miss)', () => {
      // knownDocuments is held by reference, not copied, and every lookup
      // re-reads it fresh (`resolveFrom` has no cache of its own) -- a lookup
      // that fails because an identity isn't there *yet* must not poison a
      // later, successful attempt once the caller's own map gains that entry.
      const knownDocuments: Record<string, ReturnType<typeof doc30>> = {};
      const lookup = new CrossDocumentLookup(doc30({}), knownDocuments);

      expect(lookup.getSchema({ $ref: 'later.yaml#/components/schemas/Foo' })).toBeUndefined();

      knownDocuments['later.yaml'] = doc30({ components: { schemas: { Foo: schema({ type: 'string' }) } } });

      expect(lookup.getSchema({ $ref: 'later.yaml#/components/schemas/Foo' })).toEqual({ type: 'string', title: 'Foo' });
    });

    it('resolves a two-hop cross-document chain (A -> B -> C, three different identities)', () => {
      const docC = doc30({ components: { schemas: { Inner: schema({ type: 'string' }) } } });
      const docB = doc30({ components: { schemas: { Middle: schema({ $ref: 'c.yaml#/components/schemas/Inner' }) } } });
      const lookup = new CrossDocumentLookup(doc30({}), { 'b.yaml': docB, 'c.yaml': docC });

      // Title anchors on the ref actually asked for ('Middle'), not wherever
      // the chain bottoms out ('Inner') -- see 43-proposal-local-reference
      // -cycle-guard.md §2.1.1 for why this is a deliberate rule, not the
      // "whichever hop was the last foreign-boundary crossing" behaviour an
      // earlier, delegate-based implementation happened to produce.
      expect(lookup.getSchema({ $ref: 'b.yaml#/components/schemas/Middle' })).toEqual({ type: 'string', title: 'Middle' });
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

      // Title anchors on the ref's own fragment ('Alias') -- the ref actually
      // asked for, per the same rule as the chain test above. Coincides with
      // the alias's own name here only because the ref asked for *is* the
      // alias; not the same thing as the alias's target ('Real').
      expect(lookup.getSchema({ $ref: 'b.yaml#/components/schemas/Alias' })).toEqual({ type: 'boolean', title: 'Alias' });
    });

    it('resolves a *local* alias that itself bottoms out at a foreign document', () => {
      // Foo (local) -> Bar (local) -> external.yaml#/components/schemas/Baz.
      // Confirms the unified walker keeps going once a bare ref hands off to
      // a cross-document one mid-chain, not just when the top-level ref is
      // cross-document from the start.
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

      // Title anchors on 'Foo' -- the ref actually asked for -- not 'Baz'
      // where the chain happens to end up. Same rule as both tests above.
      expect(lookup.getSchema({ $ref: '#/components/schemas/Foo' })).toEqual({ type: 'integer', title: 'Foo' });
    });

    it('returns undefined, not a stack overflow, for a genuine cross-document cycle', () => {
      const docA = doc30({ components: { schemas: { A: schema({ $ref: 'b.yaml#/components/schemas/B' }) } } });
      const docB = doc30({ components: { schemas: { B: schema({ $ref: 'a.yaml#/components/schemas/A' }) } } });
      const lookup = new CrossDocumentLookup(doc30({}), { 'a.yaml': docA, 'b.yaml': docB });

      expect(() => lookup.getSchema({ $ref: 'a.yaml#/components/schemas/A' })).not.toThrow();
      expect(lookup.getSchema({ $ref: 'a.yaml#/components/schemas/A' })).toBeUndefined();
    });

    it('returns undefined, not a stack overflow, for a cycle that alternates a local hop with a repeated cross-document identity', () => {
      // A trickier shape than the direct A<->B cycle above: the local
      // document's Foo names identity X; X's own component is a *local* alias
      // (bare ref) that in turn names X again. The cycle guard only records
      // cross-document (identity, fragment) pairs, so this checks that a
      // local hop in between doesn't let the same pair slip through twice.
      const local = doc30({ components: { schemas: { Foo: schema({ $ref: 'x.yaml#/components/schemas/A' }) } } });
      const docX = doc30({
        components: {
          schemas: {
            A: schema({ $ref: '#/components/schemas/B' }),
            B: schema({ $ref: 'x.yaml#/components/schemas/A' }),
          },
        },
      });
      const lookup = new CrossDocumentLookup(local, { 'x.yaml': docX });

      expect(() => lookup.getSchema({ $ref: 'x.yaml#/components/schemas/A' })).not.toThrow();
      expect(lookup.getSchema({ $ref: 'x.yaml#/components/schemas/A' })).toBeUndefined();
    });

    it('returns undefined, not a hang, for a purely local cycle (43-proposal-local-reference-cycle-guard.md)', () => {
      // Previously *not* safe to test here at all: delegating a bare ref to
      // the third-party `InternalLookup` meant this exact input hung
      // indefinitely on Bun (confirmed with a 5-second hard timeout, exit
      // 124, while investigating this suite) rather than throwing -- its own
      // `performLookup` recursion has no cycle guard, and this particular
      // recursive shape appears to be a genuine tail call, so the stack never
      // grows enough to trip a RangeError either. The single unified walker
      // (Option B) closes this as a side effect of not having local and
      // cross-document resolution as two separate mechanisms: every hop,
      // local or not, goes through the same `seen`-guarded fetch.
      const local = doc30({
        components: {
          schemas: {
            A: schema({ $ref: '#/components/schemas/B' }),
            B: schema({ $ref: '#/components/schemas/A' }),
          },
        },
      });
      const lookup = new CrossDocumentLookup(local);

      expect(() => lookup.getSchema({ $ref: '#/components/schemas/A' })).not.toThrow();
      expect(lookup.getSchema({ $ref: '#/components/schemas/A' })).toBeUndefined();
    });

    it('returns undefined, not a hang, for a local cycle three components long', () => {
      // Confirms the guard isn't a special case for a direct two-node cycle.
      const local = doc30({
        components: {
          schemas: {
            A: schema({ $ref: '#/components/schemas/B' }),
            B: schema({ $ref: '#/components/schemas/C' }),
            C: schema({ $ref: '#/components/schemas/A' }),
          },
        },
      });
      const lookup = new CrossDocumentLookup(local);

      expect(() => lookup.getSchema({ $ref: '#/components/schemas/A' })).not.toThrow();
      expect(lookup.getSchema({ $ref: '#/components/schemas/A' })).toBeUndefined();
    });

    it('resolves a long but genuinely acyclic local alias chain (no false-positive cycle detection)', () => {
      // The cycle guard must not mistake legitimate depth for a cycle -- it
      // answers "have I visited this exact (identity, ref) before", not "is
      // this chain suspiciously long".
      const names = Array.from({ length: 25 }, (_, i) => `Link${i}`);
      const schemas: Record<string, Swagger.Schema> = { [names[names.length - 1]]: schema({ type: 'string' }) };
      for (let i = 0; i < names.length - 1; i++) {
        schemas[names[i]] = schema({ $ref: `#/components/schemas/${names[i + 1]}` });
      }
      const local = doc30({ components: { schemas } });
      const lookup = new CrossDocumentLookup(local);

      expect(lookup.getSchema({ $ref: `#/components/schemas/${names[0]}` })).toEqual({ type: 'string', title: names[0] });
    });

    it('resolves two different refs into the same identity consistently', () => {
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

  it('excludes only the ambiguous identity when inputs are a mix of ambiguous and valid', () => {
    const goodOas = doc30({ components: { schemas: { Good: schema({ type: 'string' }) } } });
    const ambiguousOasA = doc30({ components: { schemas: { A: schema({ type: 'string' }) } } });
    const ambiguousOasB = doc30({ components: { schemas: { B: schema({ type: 'number' }) } } });

    const known = buildKnownDocuments(
      [
        { oas: ambiguousOasA, sourceIdentity: 'dupe' },
        { oas: goodOas, sourceIdentity: 'common' },
        { oas: ambiguousOasB, sourceIdentity: 'dupe' },
      ],
      new Set(['dupe']),
      {},
    );

    expect(known).toEqual({ common: goodOas });
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
