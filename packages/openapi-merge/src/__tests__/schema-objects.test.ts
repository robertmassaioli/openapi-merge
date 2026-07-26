import { merge } from '../index';
import { doc31, expectSuccess, op, schema, schemaKeys } from './_helpers/documents';

/**
 * Schema Objects, and what their contents mean for deduplication.
 *
 * 3.1 aligned the Schema Object with JSON Schema 2020-12. The merge treats
 * schema contents as opaque -- comparing them structurally and copying them
 * without interpretation -- which is why semantically equivalent schemas spelled
 * differently are NOT deduplicated. These tests pin that boundary.
 */

describe('3.1 edge: Schema Object under JSON Schema 2020-12', () => {
  it('KNOWN LIMITATION: type arrays that differ only in order are not deduplicated', () => {
    // ["string","null"] and ["null","string"] are the same JSON Schema type set,
    // but deduplication is structural, so the second is renamed. Semantic schema
    // comparison is out of scope; recorded so the behaviour is not a surprise.
    const output = expectSuccess(merge([
      { oas: doc31({ paths: { '/a': { get: op('a') } }, components: { schemas: { T: schema({ type: ['string', 'null'] }) } } }) },
      { oas: doc31({ paths: { '/b': { get: op('b') } }, components: { schemas: { T: schema({ type: ['null', 'string'] }) } } }) },
    ]));

    expect(schemaKeys(output)).toEqual(['T', 'T1']);
  });

  it('deduplicates identical type arrays', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ paths: { '/a': { get: op('a') } }, components: { schemas: { T: schema({ type: ['string', 'null'] }) } } }) },
      { oas: doc31({ paths: { '/b': { get: op('b') } }, components: { schemas: { T: schema({ type: ['string', 'null'] }) } } }) },
    ]));

    expect(schemaKeys(output)).toEqual(['T']);
  });

  it('treats 3.0 nullable and its 3.1 replacement as different schemas', () => {
    // schema({ type: 'string', nullable: true }) and { type: ['string','null'] } mean the
    // same thing across versions but are not structurally equal. Phase 1 forbids
    // mixing versions, which is precisely why this cannot bite in practice --
    // but within one document both spellings could appear.
    const output = expectSuccess(merge([
      { oas: doc31({ paths: { '/a': { get: op('a') } }, components: { schemas: { T: schema({ type: 'string', nullable: true }) } } }) },
      { oas: doc31({ paths: { '/b': { get: op('b') } }, components: { schemas: { T: schema({ type: ['string', 'null'] }) } } }) },
    ]));

    expect(schemaKeys(output)).toEqual(['T', 'T1']);
  });

  it('carries a numeric exclusiveMinimum through unchanged', () => {
    // 3.1 changed exclusiveMinimum from a boolean modifier to a number. The
    // merge treats schema contents as opaque, so the 3.1 spelling survives.
    const output = expectSuccess(merge([
      { oas: doc31({ paths: { '/a': { get: op('a') } }, components: { schemas: { N: schema({ type: 'integer', exclusiveMinimum: 7 }) } } }) },
    ]));

    expect((output.components?.schemas?.N as unknown as { exclusiveMinimum: number }).exclusiveMinimum).toBe(7);
  });

  it('preserves a per-schema $schema dialect declaration', () => {
    const dialect = 'https://json-schema.org/draft/2020-12/schema';
    const output = expectSuccess(merge([
      { oas: doc31({ paths: { '/a': { get: op('a') } }, components: { schemas: { S: schema({ $schema: dialect, type: 'string' }) } } }) },
    ]));

    expect((output.components?.schemas?.S as unknown as { $schema: string }).$schema).toBe(dialect);
  });

  it('rewrites a $ref that carries sibling keywords', () => {
    // 3.1 permits keywords alongside $ref. The reference must still be rewritten
    // and the siblings kept.
    const output = expectSuccess(merge([
      { oas: doc31({ paths: { '/a': { get: op('a') } }, components: { schemas: { Thing: { type: 'string' } } } }) },
      { oas: doc31({
        paths: { '/b': { get: op('b') } },
        components: { schemas: {
          Thing: { type: 'number' },
          WithSiblings: { $ref: '#/components/schemas/Thing', description: 'kept' },
        } },
      }) },
    ]));

    const withSiblings = output.components?.schemas?.WithSiblings as unknown as { $ref: string; description: string };
    expect(withSiblings.$ref).toBe('#/components/schemas/Thing1');
    expect(withSiblings.description).toBe('kept');
  });
});
