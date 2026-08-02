import { merge } from '../index';
import { at, doc30, expectSuccess, schema, schemaKeys } from './_helpers/documents';

/**
 * End-to-end coverage for Option C of 42-proposal-external-ref-equality-in-dedup.md
 * (`CrossDocumentLookup`): component dedup comparing two values that contain a
 * cross-document `$ref` no longer crashes, and -- the part a naive "trust
 * identical ref strings" fix (the PR #87 diff itself) would not get right --
 * compares the actual resolved content, not the `$ref` text.
 *
 * `component-equivalence.test.ts` and `external-references.test.ts` cover the
 * unit-level and existing cross-document behaviour respectively; this file is
 * specifically the dedup-meets-external-refs intersection PR #87 reported.
 */

describe('dedup across inputs sharing a cross-document $ref (PR #87)', () => {
  it('regression: two inputs declaring the same-named component with an identical external $ref no longer crash', () => {
    // This exact shape (two inputs, same schema name, both containing an
    // external $ref) threw "Could not resolve reference" before Option C --
    // reproduced directly against `deepEquality` in the proposal that led here.
    const externalRef = 'common.yaml#/components/schemas/Money';

    expect(() => merge(
      [
        { oas: doc30({ components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: externalRef }) } }) } } }) },
        { oas: doc30({ components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: externalRef }) } }) } } }) },
      ],
      { externalDocuments: { 'common.yaml': doc30({ components: { schemas: { Money: schema({ type: 'number' }) } } }) } },
    )).not.toThrow();
  });

  it('dedupes two same-named components as equal when their external refs resolve to the same content', () => {
    const externalRef = 'common.yaml#/components/schemas/Money';
    const external = doc30({ components: { schemas: { Money: schema({ type: 'number' }) } } });

    const output = expectSuccess(merge(
      [
        { oas: doc30({ components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: externalRef }) } }) } } }) },
        { oas: doc30({ components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: externalRef }) } }) } } }) },
      ],
      { externalDocuments: { 'common.yaml': external } },
    ));

    // Collapsed into one Price -- no Price1. Money is pulled in once (issue
    // #10's existing behaviour), unaffected by this change.
    expect(schemaKeys(output)).toEqual(['Money', 'Price']);
  });

  it('does NOT dedupe when the external refs resolve to genuinely different content (proves real comparison, not a string-identity guess)', () => {
    // Both inputs' Price.amount points at a *different* external identity;
    // a naive "same $ref text -> equal" heuristic (PR #87's original diff)
    // could never even reach this case, since the ref strings differ. This
    // is exactly the case that heuristic could get wrong the other way too
    // (different text, same content) -- covered by the next test.
    const output = expectSuccess(merge(
      [
        {
          oas: doc30({
            components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: 'a.yaml#/components/schemas/Money' }) } }) } },
          }),
        },
        {
          oas: doc30({
            components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: 'b.yaml#/components/schemas/Money' }) } }) } },
          }),
        },
      ],
      {
        externalDocuments: {
          'a.yaml': doc30({ components: { schemas: { Money: schema({ type: 'number' }) } } }),
          'b.yaml': doc30({ components: { schemas: { Money: schema({ type: 'string' }) } } }), // different!
        },
      },
    ));

    // Genuinely different -- disambiguated, not silently collapsed. Both
    // Money and Money1 get pulled in too, since both Prices survive and each
    // still names its own external Money (issue #10's existing behaviour).
    expect(schemaKeys(output)).toEqual(['Money', 'Money1', 'Price', 'Price1']);
    expect(output.components?.schemas?.Price1).toEqual(
      { type: 'object', properties: { amount: { $ref: '#/components/schemas/Money1' } } },
    );
  });

  it('DOES dedupe when two different external identities happen to resolve to equal content', () => {
    // The inverse of the previous test, and the case a naive string-identity
    // heuristic would get wrong: different $ref text, same resolved content.
    // Real content comparison must still collapse these.
    const output = expectSuccess(merge(
      [
        {
          oas: doc30({
            components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: 'a.yaml#/components/schemas/Money' }) } }) } },
          }),
        },
        {
          oas: doc30({
            components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: 'b.yaml#/components/schemas/Money' }) } }) } },
          }),
        },
      ],
      {
        externalDocuments: {
          'a.yaml': doc30({ components: { schemas: { Money: schema({ type: 'number' }) } } }),
          'b.yaml': doc30({ components: { schemas: { Money: schema({ type: 'number' }) } } }), // identical content, different file
        },
      },
    ));

    // Price collapses to one during the *per-input* dedup pass (before either
    // external document is ever pulled in) because CrossDocumentLookup
    // resolves 'a.yaml#/...' and 'b.yaml#/...' to the same {type:'number'}
    // content there. Only the surviving Price's ref (a.yaml's) is walked in
    // the later cross-document pass, so b.yaml's Money is never even pulled
    // in -- this is a stronger result than "collapsed the pulled-in Money
    // components after the fact" would be.
    expect(schemaKeys(output)).toEqual(['Money', 'Price']);
  });

  it('dedupes using a ref into another declared input (sourceIdentity), not just externalDocuments', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ components: { schemas: { Money: schema({ type: 'number' }) } } }), sourceIdentity: 'common' },
      {
        oas: doc30({
          components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: 'common#/components/schemas/Money' }) } }) } },
        }),
      },
      {
        oas: doc30({
          components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: 'common#/components/schemas/Money' }) } }) } },
        }),
      },
    ]));

    expect(schemaKeys(output)).toEqual(['Money', 'Price']);
  });

  it('does not dedupe a declared-input ref against a differently-typed same-named component', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ components: { schemas: { Money: schema({ type: 'number' }) } } }), sourceIdentity: 'common' },
      {
        oas: doc30({
          components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: 'common#/components/schemas/Money' }) } }) } },
        }),
      },
      // No cross-document ref at all this time -- a plain, different Price.
      { oas: doc30({ components: { schemas: { Price: schema({ type: 'string' }) } } }) },
    ]));

    expect(schemaKeys(output)).toEqual(['Money', 'Price', 'Price1']);
  });

  it('resolves a nested-path external $ref (left un-rewritten by design) during a pulled-in component\'s own dedup', () => {
    // A nested-path fragment (`.../Foo/properties/name`) is never rewritten by
    // the cross-document pass -- parseComponentFragment only tracks whole
    // -component renames (see external-references.test.ts's own test for
    // this) -- so it can still be a *raw* external $ref by the time
    // pullInComponent's internal dedup (external-references.ts, not
    // paths-and-components.ts) compares two components. This is the one
    // scenario that exercises Option C's wiring there specifically.
    const nestedRef = 'other.yaml#/components/schemas/Foo/properties/name';
    const other = doc30({
      components: { schemas: { Foo: schema({ type: 'object', properties: { name: schema({ type: 'string' }) } }) } },
    });
    const errors = doc30({
      components: {
        schemas: { ServerError: schema({ type: 'object', properties: { detail: schema({ $ref: nestedRef }) } }) },
      },
    });

    const output = expectSuccess(merge(
      [{
        oas: doc30({
          components: {
            schemas: {
              // Same name, same shape (including the identical nested-path
              // external ref) as errors.yaml's own ServerError.
              ServerError: schema({ type: 'object', properties: { detail: schema({ $ref: nestedRef }) } }),
              Widget: schema({ $ref: 'errors.yaml#/components/schemas/ServerError' }),
            },
          },
        }),
      }],
      { externalDocuments: { 'errors.yaml': errors, 'other.yaml': other } },
    ));

    // Collapsed into one ServerError -- proves the comparison actually
    // resolved and compared the nested ref's content rather than either
    // crashing or refusing to match two textually-identical raw refs.
    expect(schemaKeys(output)).toEqual(['ServerError', 'Widget']);
    expect(output.components?.schemas?.Widget).toEqual({ $ref: '#/components/schemas/ServerError' });
    expect(at(output, 'components', 'schemas', 'ServerError', 'properties', 'detail')).toEqual({ $ref: nestedRef });
  });

  it('does not dedupe a pulled-in component against a declared one whose nested external ref resolves differently', () => {
    const nestedRefA = 'other.yaml#/components/schemas/Foo/properties/name';
    const nestedRefB = 'other.yaml#/components/schemas/Foo/properties/count';
    const other = doc30({
      components: {
        schemas: {
          Foo: schema({
            type: 'object',
            properties: { name: schema({ type: 'string' }), count: schema({ type: 'integer' }) },
          }),
        },
      },
    });
    const errors = doc30({
      components: {
        schemas: { ServerError: schema({ type: 'object', properties: { detail: schema({ $ref: nestedRefB }) } }) },
      },
    });

    const output = expectSuccess(merge(
      [{
        oas: doc30({
          components: {
            schemas: {
              ServerError: schema({ type: 'object', properties: { detail: schema({ $ref: nestedRefA }) } }),
              Widget: schema({ $ref: 'errors.yaml#/components/schemas/ServerError' }),
            },
          },
        }),
      }],
      { externalDocuments: { 'errors.yaml': errors, 'other.yaml': other } },
    ));

    expect(schemaKeys(output)).toEqual(['ServerError', 'ServerError1', 'Widget']);
    expect(output.components?.schemas?.Widget).toEqual({ $ref: '#/components/schemas/ServerError1' });
  });

  it('dedupes across a non-schema component bucket (responses) with a shared external ref too', () => {
    const externalRef = 'common.yaml#/components/schemas/ErrorBody';
    const external = doc30({ components: { schemas: { ErrorBody: schema({ type: 'object' }) } } });

    const output = expectSuccess(merge(
      [
        {
          oas: doc30({
            components: {
              responses: {
                NotFound: {
                  description: 'not found',
                  content: { 'application/json': { schema: schema({ $ref: externalRef }) } },
                },
              },
            },
          }),
        },
        {
          oas: doc30({
            components: {
              responses: {
                NotFound: {
                  description: 'not found',
                  content: { 'application/json': { schema: schema({ $ref: externalRef }) } },
                },
              },
            },
          }),
        },
      ],
      { externalDocuments: { 'common.yaml': external } },
    ));

    expect(Object.keys(output.components?.responses ?? {})).toEqual(['NotFound']);
  });

  it('documents the residual gap: a ref to a document truly outside the merge\'s knowledge still surfaces as an error', () => {
    // No sourceIdentity and no externalDocuments entry names 'unknown.yaml' --
    // CrossDocumentLookup correctly returns undefined for it (§3.3 of the
    // proposal), same as InternalLookup already does for any unresolvable
    // ref, and deepEquality's own `isSchemaOrThrowError` still throws on that
    // undefined. This is the one case Option C does not (and structurally
    // cannot) close on its own -- documented here rather than silently left
    // for someone to rediscover as a mystery crash.
    const externalRef = 'unknown.yaml#/components/schemas/Money';

    expect(() => merge([
      { oas: doc30({ components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: externalRef }) } }) } } }) },
      { oas: doc30({ components: { schemas: { Price: schema({ type: 'object', properties: { amount: schema({ $ref: externalRef }) } }) } } }) },
    ])).toThrow(/Could not resolve reference/);
  });
});
