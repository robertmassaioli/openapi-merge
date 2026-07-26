import { merge } from '..';
import { Swagger } from '@atlassian/atlassian-openapi';
import { isErrorResult, MergeResult, SingleMergeInput } from '../data';
import { OpenApiDocument } from '../oas31';

/**
 * Edge cases for the original (3.0) merge behaviour, derived from the normative
 * rules in the OpenAPI Specification rather than from the implementation.
 *
 * Spec references are to OAS 3.2.0 (https://spec.openapis.org/oas/v3.2.0.html),
 * whose rules for these constructs are unchanged from 3.0.
 *
 * Where the merge violates a spec rule, the test PINS the current behaviour and
 * says so. Those are findings, not endorsements -- a test that quietly asserted
 * correct behaviour would fail, and a test that silently asserted the bug would
 * hide it.
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

/**
 * Read a deeply nested value by key path.
 *
 * These documents nest a long way (a callback holds a path item holds an
 * operation holds a request body holds a media type holds a schema), and
 * spelling that out as nested Record casts is both unreadable and easy to get
 * one level wrong.
 */
function at(root: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], root);
}


function doc(partial: Partial<OpenApiDocument>): OpenApiDocument {
  return { openapi: '3.0.3', info: { title: 'Test', version: '1.0.0' }, ...partial } as OpenApiDocument;
}

function expectSuccess(result: MergeResult): OpenApiDocument {
  if (isErrorResult(result)) {
    throw new Error(`Expected success, got ${result.type}: ${result.message}`);
  }
  return result.output;
}

function expectError(result: MergeResult, type: string): string {
  if (!isErrorResult(result)) {
    throw new Error(`Expected ${type}, got success: ${JSON.stringify(result, null, 2)}`);
  }
  expect(result.type).toBe(type);
  return result.message;
}

const paths = (output: OpenApiDocument): string[] => Object.keys(output.paths ?? {}).sort();
const schemas = (output: OpenApiDocument): string[] => Object.keys(output.components?.schemas ?? {}).sort();

describe('3.0 edge: path templating equivalence', () => {
  it('KNOWN GAP: does not detect that /pets/{petId} and /pets/{name} are the same path', () => {
    // Spec, Paths Object: "Templated paths with the same hierarchy but different
    // templated names MUST NOT exist as they are identical." The spec names this
    // exact pair as "identical and invalid".
    //
    // The merge compares path strings, so it emits both and produces an invalid
    // document. Pinned rather than asserted-correct; fixing it means comparing
    // paths by their template shape.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/pets/{petId}': { get: op('byId') } } }) },
      { oas: doc({ paths: { '/pets/{name}': { get: op('byName') } } }) },
    ]));

    expect(paths(output)).toEqual(['/pets/{name}', '/pets/{petId}']);
  });

  it('detects a genuinely identical path string as a duplicate', () => {
    // The string-equality case the implementation does handle.
    expectError(merge([
      { oas: doc({ paths: { '/pets/{petId}': { get: op('a') } } }) },
      { oas: doc({ paths: { '/pets/{petId}': { get: op('b') } } }) },
    ]), 'duplicate-paths');
  });

  it('treats paths differing only in case as distinct', () => {
    // Paths are case-sensitive; /Pets and /pets are different resources.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/pets': { get: op('lower') } } }) },
      { oas: doc({ paths: { '/Pets': { get: op('upper') } } }) },
    ]));

    expect(paths(output)).toEqual(['/Pets', '/pets']);
  });

  it('treats a trailing slash as a distinct path', () => {
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/pets': { get: op('noSlash') } } }) },
      { oas: doc({ paths: { '/pets/': { get: op('slash') } } }) },
    ]));

    expect(paths(output)).toEqual(['/pets', '/pets/']);
  });

  it('passes through a path that repeats a template expression', () => {
    // Spec: "Each template expression MUST NOT appear more than once in a single
    // path template." The merge is not a validator and does not reject it.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a/{id}/b/{id}': { get: op('dup') } } }) },
    ]));

    expect(paths(output)).toEqual(['/a/{id}/b/{id}']);
  });
});

describe('3.0 edge: component naming rules', () => {
  it('KNOWN GAP: a dispute prefix can produce a component key the spec forbids', () => {
    // Spec, Components Object: keys "MUST use keys that match the regular
    // expression: ^[a-zA-Z0-9\\.\\-_]+$". A prefix containing a space produces
    // "My Service Thing", which does not match, so the output is invalid.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { Thing: { type: 'string' } } } }) },
      {
        oas: doc({ paths: { '/b': { get: op('b') } }, components: { schemas: { Thing: { type: 'number' } } } }),
        dispute: { prefix: 'My Service ' },
      },
    ]));

    const invalid = schemas(output).filter(k => !/^[a-zA-Z0-9.\-_]+$/.test(k));
    expect(invalid).toEqual(['My Service Thing']);
  });

  it('accepts the dot, dash and underscore the key regex allows', () => {
    const output = expectSuccess(merge([
      { oas: doc({
        paths: { '/a': { get: op('a') } },
        components: { schemas: { 'my.Thing-2_v1': { type: 'string' } } },
      }) },
    ]));

    expect(schemas(output)).toEqual(['my.Thing-2_v1']);
    expect(schemas(output).every(k => /^[a-zA-Z0-9.\-_]+$/.test(k))).toBe(true);
  });

  it('skips a numeric suffix that is already taken', () => {
    // Input 0 defines both Thing and Thing1, so the disputed Thing from input 1
    // cannot become Thing1 and must land on Thing2.
    const output = expectSuccess(merge([
      { oas: doc({
        paths: { '/a': { get: op('a') } },
        components: { schemas: { Thing: { type: 'string' }, Thing1: { type: 'boolean' } } },
      }) },
      { oas: doc({
        paths: { '/b': { get: op('b') } },
        components: { schemas: { Thing: { type: 'number' } } },
      }) },
    ]));

    expect(schemas(output)).toEqual(['Thing', 'Thing1', 'Thing2']);
    expect((output.components?.schemas?.Thing2 as { type: string }).type).toBe('number');
  });
});

describe('3.0 edge: empty and minimal documents', () => {
  it('merges a document that has only components', () => {
    // Spec, OpenAPI Object: "at least one of the components, paths, or webhooks
    // fields MUST be present" -- so components-only is a valid document.
    const output = expectSuccess(merge([
      { oas: doc({ components: { schemas: { Only: { type: 'string' } } } }) },
    ]));

    expect(schemas(output)).toEqual(['Only']);
  });

  it('KNOWN GAP: drops a deliberately empty Path Item', () => {
    // Spec, Path Item Object: "A Path Item MAY be empty, due to ACL
    // constraints" -- an empty path item is how you document that a path exists
    // but its operations are hidden from this viewer. The merge counts
    // operations and deletes any path item scoring zero, so that signal is lost.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/hidden': {}, '/visible': { get: op('v') } } }) },
    ]));

    expect(paths(output)).toEqual(['/visible']);
  });

  it('merges inputs whose paths objects are all empty', () => {
    const output = expectSuccess(merge([
      { oas: doc({ paths: {} }) },
      { oas: doc({ paths: {} }) },
    ]));

    expect(paths(output)).toEqual([]);
  });

  it('rejects an empty input list', () => {
    expectError(merge([]), 'no-inputs');
  });
});

describe('3.0 edge: references', () => {
  it('rewrites a reference whose target is itself a reference', () => {
    // Alias -> Thing, where Thing is disputed and renamed. The alias must follow.
    const output = expectSuccess(merge([
      { oas: doc({
        paths: { '/a': { get: op('a') } },
        components: { schemas: { Thing: { type: 'string' } } },
      }) },
      { oas: doc({
        paths: { '/b': { get: op('b') } },
        components: { schemas: {
          Thing: { type: 'number' },
          Alias: { $ref: '#/components/schemas/Thing' },
        } },
      }) },
    ]));

    expect((output.components?.schemas?.Alias as { $ref: string }).$ref).toBe('#/components/schemas/Thing1');
  });

  it('KNOWN GAP (issues #99/#106): a discriminator mapping is not rewritten on rename', () => {
    // The oneOf $ref follows the rename but the discriminator mapping value,
    // which points at the same schema, does not. Already tracked by
    // issues/proposal-99-discriminator-mapping-prefix.md and
    // issues/proposal-106-discriminator-mappings.md.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { Dog: { type: 'string' } } } }) },
      { oas: doc({
        paths: { '/b': { get: op('b') } },
        components: { schemas: {
          Dog: { type: 'object' },
          Pet: {
            oneOf: [{ $ref: '#/components/schemas/Dog' }],
            discriminator: { propertyName: 'kind', mapping: { dog: '#/components/schemas/Dog' } },
          },
        } },
      }) },
    ]));

    const pet = output.components?.schemas?.Pet as Record<string, Record<string, unknown>>;
    expect((pet.oneOf as unknown as Array<{ $ref: string }>)[0].$ref).toBe('#/components/schemas/Dog1');
    // Still pointing at the pre-rename name -- this is the bug.
    expect((pet.discriminator.mapping as Record<string, string>).dog).toBe('#/components/schemas/Dog');
  });

  it('deduplicates identical components rather than renaming them', () => {
    const identical = schema({ type: 'string', description: 'shared' });
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { S: { ...identical } } } }) },
      { oas: doc({ paths: { '/b': { get: op('b') } }, components: { schemas: { S: { ...identical } } } }) },
    ]));

    expect(schemas(output)).toEqual(['S']);
  });
});

describe('3.0 edge: pathModification', () => {
  it('produces an empty path key when stripStart consumes the whole path', () => {
    // Documents the actual result; an empty path key is not a valid path, so
    // this is a case worth knowing about when configuring stripStart.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/api': { get: op('a') } } }), pathModification: { stripStart: '/api' } },
    ]));

    expect(paths(output)).toEqual(['']);
  });

  it('applies stripStart before prepend', () => {
    const output = expectSuccess(merge([
      {
        oas: doc({ paths: { '/rest/thing': { get: op('a') } } }),
        pathModification: { stripStart: '/rest', prepend: '/v2' },
      },
    ]));

    expect(paths(output)).toEqual(['/v2/thing']);
  });

  it('detects a duplicate created by pathModification rather than present in the inputs', () => {
    // Neither input has a duplicate path; prepending creates one.
    expectError(merge([
      { oas: doc({ paths: { '/thing': { get: op('a') } } }) },
      { oas: doc({ paths: { '/api/thing': { get: op('b') } } }), pathModification: { stripStart: '/api' } },
    ]), 'duplicate-paths');
  });
});

describe('3.0 edge: operationId uniqueness', () => {
  it('disambiguates a clash between two methods on the same path', () => {
    // Spec, Operation Object: operationId "MUST be unique among all operations
    // described in the API" -- including within one Path Item.
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('same'), post: op('same') } } }) },
    ]));

    const item = output.paths?.['/a'] as Record<string, { operationId: string }>;
    expect([item.get.operationId, item.post.operationId].sort()).toEqual(['same', 'same1']);
  });

  it('leaves operations without an operationId alone', () => {
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: { responses: ok } } } }) },
      { oas: doc({ paths: { '/b': { get: { responses: ok } } } }) },
    ]));

    expect(paths(output)).toEqual(['/a', '/b']);
  });
});

describe('3.0 edge: document-level fields are first-wins', () => {
  it('takes security, servers and externalDocs from the first input that declares each', () => {
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, servers: [{ url: 'https://first' }] }) },
      { oas: doc({
        paths: { '/b': { get: op('b') } },
        servers: [{ url: 'https://second' }],
        security: [{ apiKey: [] }],
        externalDocs: { url: 'https://docs.second' },
      }) },
    ]));

    expect(output.servers).toEqual([{ url: 'https://first' }]);
    // Not declared by input 0 at all, so input 1 supplies them.
    expect(output.security).toEqual([{ apiKey: [] }]);
    expect(output.externalDocs).toEqual({ url: 'https://docs.second' });
  });

  it('deduplicates tags by name, keeping the first definition', () => {
    // Spec, Tag Object: "Each tag name in the list MUST be unique."
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('a') } }, tags: [{ name: 'shared', description: 'first' }] }) },
      { oas: doc({ paths: { '/b': { get: op('b') } }, tags: [{ name: 'shared', description: 'second' }] }) },
    ]));

    expect(output.tags).toEqual([{ name: 'shared', description: 'first' }]);
  });
});

describe('3.0 edge: callbacks and links', () => {
  it('rewrites a reference inside a callback', () => {
    const inputs: SingleMergeInput[] = [
      { oas: doc({ paths: { '/a': { get: op('a') } }, components: { schemas: { Thing: { type: 'string' } } } }) },
      { oas: doc({
        paths: { '/b': { post: {
          operationId: 'b',
          responses: ok,
          callbacks: { onEvent: { '{$request.body#/url}': { post: {
            responses: ok,
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } },
          } } } },
        } } },
        components: { schemas: { Thing: { type: 'number' } } },
      }) },
    ];

    const output = expectSuccess(merge(inputs));

    const ref = at(output.paths?.['/b'], 'post', 'callbacks', 'onEvent',
      '{$request.body#/url}', 'post', 'requestBody', 'content', 'application/json', 'schema', '$ref');
    expect(ref).toBe('#/components/schemas/Thing1');
  });

  it('KNOWN GAP: a link operationRef is not rewritten when the path it targets changes', () => {
    // A Link's operationRef is a URI pointing at an Operation. When
    // pathModification renames the path, the reference is left dangling.
    const output = expectSuccess(merge([
      {
        oas: doc({ paths: { '/thing': { get: op('getThing') }, '/other': { get: {
          operationId: 'other',
          responses: { '200': { description: 'ok', links: {
            next: { operationRef: '#/paths/~1thing/get' },
          } } },
        } } } }),
        pathModification: { prepend: '/api' },
      },
    ]));

    // Still points at the pre-prepend location.
    expect(at(output.paths?.['/api/other'], 'get', 'responses', '200', 'links', 'next', 'operationRef'))
      .toBe('#/paths/~1thing/get');
    expect(paths(output)).toEqual(['/api/other', '/api/thing']);
  });
});
