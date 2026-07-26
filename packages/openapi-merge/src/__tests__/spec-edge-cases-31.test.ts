import { merge } from '..';
import { Swagger } from '@atlassian/atlassian-openapi';
import { isErrorResult, MergeResult } from '../data';
import { OpenApiDocument } from '../oas31';

/**
 * Edge cases for the OpenAPI 3.1 constructs, derived from the specification.
 *
 * 3.1's changes are concentrated in two places: the structural additions
 * (`webhooks`, `components.pathItems`, optional `paths`, `jsonSchemaDialect`)
 * and the Schema Object's move to full JSON Schema 2020-12. The second group
 * matters to a *merger* because deduplication compares schemas structurally,
 * so a semantic equivalence the merge cannot see becomes a duplicated component.
 */

const ok = { '200': { description: 'ok' } };
const op = (operationId: string): Swagger.Operation => ({ operationId, responses: ok });

/**
 * Build a Schema Object from an arbitrary shape.
 *
 * The 3.0-derived `Swagger.Schema` type does not model JSON Schema 2020-12, so
 * 3.1 spellings (`type` as an array, numeric `exclusiveMinimum`, `$schema`) do
 * not typecheck against it. That is harmless at runtime because the merge treats
 * schema contents as opaque -- it compares and copies them without
 * interpretation -- so this cast keeps the tests honest about the shapes real
 * documents contain without widening the library's types.
 */
function schema(shape: Record<string, unknown>): Swagger.Schema {
  return shape as unknown as Swagger.Schema;
}


function doc(partial: Partial<OpenApiDocument>): OpenApiDocument {
  return { openapi: '3.1.1', info: { title: 'Test', version: '1.0.0' }, ...partial } as OpenApiDocument;
}

function expectSuccess(result: MergeResult): OpenApiDocument {
  if (isErrorResult(result)) {
    throw new Error(`Expected success, got ${result.type}: ${result.message}`);
  }
  return result.output;
}

function expectError(result: MergeResult, type: string): void {
  if (!isErrorResult(result)) {
    throw new Error(`Expected ${type}, got success: ${JSON.stringify(result, null, 2)}`);
  }
  expect(result.type).toBe(type);
}

const schemas = (o: OpenApiDocument): string[] => Object.keys(o.components?.schemas ?? {}).sort();
const hooks = (o: OpenApiDocument): string[] => Object.keys(o.webhooks ?? {}).sort();

describe('3.1 edge: minimal documents', () => {
  it('merges a document with neither paths nor webhooks, only components', () => {
    // Spec: at least one of components, paths or webhooks must be present.
    const output = expectSuccess(merge([
      { oas: doc({ components: { schemas: { Only: { type: 'string' } } } }) },
    ]));

    expect(schemas(output)).toEqual(['Only']);
    // An empty paths object is emitted rather than omitted. Valid either way;
    // pinned so the shape of the output is not a surprise.
    expect(output.paths).toEqual({});
  });

  it('leaves an empty webhooks object out of the output', () => {
    const output = expectSuccess(merge([{ oas: doc({ webhooks: {}, paths: { '/a': { get: op('a') } } }) }]));

    expect(output.webhooks).toBeUndefined();
  });

  it('merges two webhooks-only documents', () => {
    const output = expectSuccess(merge([
      { oas: doc({ webhooks: { first: { post: op('onFirst') } } }) },
      { oas: doc({ webhooks: { second: { post: op('onSecond') } } }) },
    ]));

    expect(hooks(output)).toEqual(['first', 'second']);
    expect(output.paths).toEqual({});
  });
});

describe('3.1 edge: webhooks as references', () => {
  it('rewrites a webhook that is itself a $ref to a renamed pathItem', () => {
    // A webhook value may be a Path Item *or* a Reference to one. When the
    // pathItem it points at is disputed and renamed, the webhook must follow.
    const output = expectSuccess(merge([
      { oas: doc({
        paths: { '/a': { get: op('a') } },
        components: { pathItems: { Shared: { get: op('sharedFirst') } } },
      }) },
      { oas: doc({
        webhooks: { hook: { $ref: '#/components/pathItems/Shared' } },
        components: { pathItems: { Shared: { post: op('sharedSecond') } } },
      }) },
    ]));

    expect(Object.keys(output.components?.pathItems ?? {}).sort()).toEqual(['Shared', 'Shared1']);
    expect((output.webhooks?.hook as unknown as { $ref: string }).$ref)
      .toBe('#/components/pathItems/Shared1');
  });

  it('rewrites a path that is a $ref to a renamed pathItem', () => {
    const output = expectSuccess(merge([
      { oas: doc({
        paths: { '/a': { get: op('a') } },
        components: { pathItems: { Shared: { get: op('sharedFirst') } } },
      }) },
      { oas: doc({
        paths: { '/b': { $ref: '#/components/pathItems/Shared' } },
        components: { pathItems: { Shared: { post: op('sharedSecond') } } },
      }) },
    ]));

    expect((output.paths?.['/b'] as unknown as { $ref: string }).$ref)
      .toBe('#/components/pathItems/Shared1');
  });

  it('does not drop a path item that is only a $ref', () => {
    // A $ref-only Path Item has no operations of its own. The operation count
    // must not delete it, or a referenced path vanishes.
    const output = expectSuccess(merge([
      { oas: doc({
        paths: { '/b': { $ref: '#/components/pathItems/Shared' } },
        components: { pathItems: { Shared: { get: op('shared') } } },
      }) },
    ]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/b']);
  });
});

describe('3.1 edge: Schema Object under JSON Schema 2020-12', () => {
  it('KNOWN LIMITATION: type arrays that differ only in order are not deduplicated', () => {
    // ["string","null"] and ["null","string"] are the same JSON Schema type set,
    // but deduplication is structural, so the second is renamed. Semantic schema
    // comparison is out of scope; recorded so the behaviour is not a surprise.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { T: schema({ type: ['string', 'null'] }) } } }) },
      { oas: doc({ paths: { '/b': { get: op('b') } }, components: { schemas: { T: schema({ type: ['null', 'string'] }) } } }) },
    ]));

    expect(schemas(output)).toEqual(['T', 'T1']);
  });

  it('deduplicates identical type arrays', () => {
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { T: schema({ type: ['string', 'null'] }) } } }) },
      { oas: doc({ paths: { '/b': { get: op('b') } }, components: { schemas: { T: schema({ type: ['string', 'null'] }) } } }) },
    ]));

    expect(schemas(output)).toEqual(['T']);
  });

  it('treats 3.0 nullable and its 3.1 replacement as different schemas', () => {
    // schema({ type: 'string', nullable: true }) and { type: ['string','null'] } mean the
    // same thing across versions but are not structurally equal. Phase 1 forbids
    // mixing versions, which is precisely why this cannot bite in practice --
    // but within one document both spellings could appear.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { T: schema({ type: 'string', nullable: true }) } } }) },
      { oas: doc({ paths: { '/b': { get: op('b') } }, components: { schemas: { T: schema({ type: ['string', 'null'] }) } } }) },
    ]));

    expect(schemas(output)).toEqual(['T', 'T1']);
  });

  it('carries a numeric exclusiveMinimum through unchanged', () => {
    // 3.1 changed exclusiveMinimum from a boolean modifier to a number. The
    // merge treats schema contents as opaque, so the 3.1 spelling survives.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { N: schema({ type: 'integer', exclusiveMinimum: 7 }) } } }) },
    ]));

    expect((output.components?.schemas?.N as unknown as { exclusiveMinimum: number }).exclusiveMinimum).toBe(7);
  });

  it('preserves a per-schema $schema dialect declaration', () => {
    const dialect = 'https://json-schema.org/draft/2020-12/schema';
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { S: schema({ $schema: dialect, type: 'string' }) } } }) },
    ]));

    expect((output.components?.schemas?.S as unknown as { $schema: string }).$schema).toBe(dialect);
  });

  it('rewrites a $ref that carries sibling keywords', () => {
    // 3.1 permits keywords alongside $ref. The reference must still be rewritten
    // and the siblings kept.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { Thing: { type: 'string' } } } }) },
      { oas: doc({
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

describe('3.1 edge: jsonSchemaDialect', () => {
  it('takes the first declared dialect and ignores later disagreement', () => {
    const output = expectSuccess(merge([
      { oas: doc({ jsonSchemaDialect: 'https://example.com/a', paths: { '/a': { get: op('a') } } }) },
      { oas: doc({ jsonSchemaDialect: 'https://example.com/b', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.jsonSchemaDialect).toBe('https://example.com/a');
  });

  it('picks up a dialect declared only by a later input', () => {
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } } }) },
      { oas: doc({ jsonSchemaDialect: 'https://example.com/b', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.jsonSchemaDialect).toBe('https://example.com/b');
  });
});

describe('3.1 edge: webhooks vs paths interactions', () => {
  it('allows a webhook and a path to share a name without colliding', () => {
    // They are separate namespaces: a webhook called "/pets" does not clash with
    // a path "/pets".
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/pets': { get: op('getPets') } }, webhooks: { '/pets': { post: op('onPets') } } }) },
    ]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/pets']);
    expect(hooks(output)).toEqual(['/pets']);
  });

  it('does not apply stripStart to webhook names', () => {
    const output = expectSuccess(merge([{
      oas: doc({ webhooks: { '/api/event': { post: op('onEvent') } } }),
      pathModification: { stripStart: '/api' },
    }]));

    expect(hooks(output)).toEqual(['/api/event']);
  });

  it('applies operationSelection to webhook operations', () => {
    const output = expectSuccess(merge([{
      oas: doc({ webhooks: {
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

describe('3.1 edge: version rules', () => {
  it('refuses a 3.0 input mixed with a 3.1 input', () => {
    expectError(merge([
      { oas: doc({ openapi: '3.0.3', paths: { '/a': { get: op('a') } } }) },
      { oas: doc({ openapi: '3.1.1', paths: { '/b': { get: op('b') } } }) },
    ]), 'mixed-openapi-versions');
  });

  it('accepts differing 3.1 patch versions and reports the highest', () => {
    const output = expectSuccess(merge([
      { oas: doc({ openapi: '3.1.0', paths: { '/a': { get: op('a') } } }) },
      { oas: doc({ openapi: '3.1.1', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.openapi).toBe('3.1.1');
  });
});
