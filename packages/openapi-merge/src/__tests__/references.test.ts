import { merge } from '../index';
import { Swagger } from '@atlassian/atlassian-openapi';
import { SingleMergeInput } from '../data';
import {
  walkAllReferences, walkCallbackReferences, walkComponentReferences, walkExampleReferences,
  walkHeaderReferences, walkLinkReferences, walkParameterReferences, walkPathReferences,
  walkRequestBodyReferences, walkResponseReferences, walkSchemaReferences,
} from '../reference-walker';
import { at, doc30, doc31, doc32, expectSuccess, ok, op, pathKeys, schema, schemaKeys } from './_helpers/documents';
import { Modify } from '../reference-walker';
import { OpenApiDocument } from '../oas31';

/**
 * Run a walker and collect every reference it reaches, without changing them.
 *
 * Asserting on the collected list proves the walker *visits* a construct;
 * `rename` below proves the mutation is written back.
 */
function collect(walk: (modify: Modify) => void): string[] {
  const seen: string[] = [];
  walk(ref => {
    seen.push(ref);
    return ref;
  });
  return seen;
}

const rename = (ref: string): string => `${ref}-renamed`;

/**
 * References, and keeping them correct when the thing they point at moves.
 *
 * Two halves. First, the walker itself: every construct that can hold a `$ref`
 * must be reached, or a reference survives into the output pointing at a name
 * that no longer exists. Second, the end-to-end guarantee -- when a component is
 * renamed to resolve a dispute, every reference to it follows, wherever it lives
 * (schemas, callbacks, webhooks, `query` operations, custom verbs).
 *
 * Also records the pointer forms the walker does NOT know about: discriminator
 * mappings and Link `operationRef`s. See ai-planning/spec-edge-case-findings.md.
 */

describe('walkSchemaReferences', () => {
  it('rewrites a top-level reference', () => {
    const schema: Swagger.Reference = { $ref: '#/components/schemas/A' };

    walkSchemaReferences(schema, rename);

    expect(schema.$ref).toBe('#/components/schemas/A-renamed');
  });

  it('walks into not', () => {
    const schema: Swagger.Schema = { not: { $ref: '#/n' } };

    expect(collect(m => walkSchemaReferences(schema, m))).toEqual(['#/n']);
  });

  it('walks into every allOf member', () => {
    const schema: Swagger.Schema = { allOf: [{ $ref: '#/a1' }, { $ref: '#/a2' }] };

    expect(collect(m => walkSchemaReferences(schema, m))).toEqual(['#/a1', '#/a2']);
  });

  it('walks into every oneOf member', () => {
    const schema: Swagger.Schema = { oneOf: [{ $ref: '#/o1' }, { $ref: '#/o2' }] };

    expect(collect(m => walkSchemaReferences(schema, m))).toEqual(['#/o1', '#/o2']);
  });

  it('walks into every anyOf member', () => {
    const schema: Swagger.Schema = { anyOf: [{ $ref: '#/y1' }, { $ref: '#/y2' }] };

    expect(collect(m => walkSchemaReferences(schema, m))).toEqual(['#/y1', '#/y2']);
  });

  it('walks into items', () => {
    const schema: Swagger.Schema = { type: 'array', items: { $ref: '#/i' } };

    expect(collect(m => walkSchemaReferences(schema, m))).toEqual(['#/i']);
  });

  it('walks into each property', () => {
    const schema: Swagger.Schema = {
      type: 'object',
      properties: { one: { $ref: '#/p1' }, two: { $ref: '#/p2' } },
    };

    expect(collect(m => walkSchemaReferences(schema, m))).toEqual(['#/p1', '#/p2']);
  });

  it('walks into a schema-valued additionalProperties', () => {
    const schema: Swagger.Schema = { type: 'object', additionalProperties: { $ref: '#/ap' } };

    expect(collect(m => walkSchemaReferences(schema, m))).toEqual(['#/ap']);
  });

  it('ignores a boolean additionalProperties', () => {
    const schema: Swagger.Schema = { type: 'object', additionalProperties: true };

    expect(collect(m => walkSchemaReferences(schema, m))).toEqual([]);
  });

  it('recurses through nested composition', () => {
    const schema: Swagger.Schema = {
      type: 'object',
      properties: {
        nested: { type: 'array', items: { allOf: [{ $ref: '#/deep' }] } },
      },
    };

    walkSchemaReferences(schema, rename);

    const items = (schema.properties?.nested as Swagger.Schema).items as Swagger.Schema;
    expect((items.allOf?.[0] as Swagger.Reference).$ref).toBe('#/deep-renamed');
  });

  it('does nothing to a schema with no references', () => {
    const schema: Swagger.Schema = { type: 'string' };

    expect(collect(m => walkSchemaReferences(schema, m))).toEqual([]);
  });
});

describe('walkExampleReferences', () => {
  it('rewrites a reference', () => {
    const example: Swagger.Reference = { $ref: '#/components/examples/E' };

    walkExampleReferences(example, rename);

    expect(example.$ref).toBe('#/components/examples/E-renamed');
  });

  it('leaves a literal example alone', () => {
    const example: Swagger.Example = { summary: 'no refs here' };

    expect(collect(m => walkExampleReferences(example, m))).toEqual([]);
  });
});

describe('walkParameterReferences', () => {
  it('rewrites a parameter that is itself a reference', () => {
    const parameter: Swagger.Reference = { $ref: '#/components/parameters/P' };

    walkParameterReferences(parameter, rename);

    expect(parameter.$ref).toBe('#/components/parameters/P-renamed');
  });

  it('walks the schema of a parameter with a schema', () => {
    const parameter: Swagger.Parameter = {
      name: 'id',
      in: 'query',
      schema: { $ref: '#/s' },
    };

    expect(collect(m => walkParameterReferences(parameter, m))).toEqual(['#/s']);
  });

  it('walks the examples of a parameter with a schema', () => {
    const parameter: Swagger.Parameter = {
      name: 'id',
      in: 'query',
      schema: { type: 'string' },
      examples: { one: { $ref: '#/e1' }, two: { $ref: '#/e2' } },
    };

    expect(collect(m => walkParameterReferences(parameter, m))).toEqual(['#/e1', '#/e2']);
  });

  it('walks the content of a parameter with content', () => {
    const parameter: Swagger.Parameter = {
      name: 'body',
      in: 'query',
      content: { 'application/json': { schema: { $ref: '#/c' } } },
    };

    expect(collect(m => walkParameterReferences(parameter, m))).toEqual(['#/c']);
  });

  it('walks the examples of a content media type', () => {
    const parameter: Swagger.Parameter = {
      name: 'body',
      in: 'query',
      content: {
        'application/json': {
          schema: { type: 'string' },
          examples: { sample: { $ref: '#/me' } },
        },
      },
    };

    // The media-type walker visits the schema twice when examples are present,
    // so assert on membership rather than on the exact call sequence.
    expect(collect(m => walkParameterReferences(parameter, m))).toContain('#/me');
  });
});

describe('walkRequestBodyReferences', () => {
  it('rewrites a request body that is a reference', () => {
    const body: Swagger.Reference = { $ref: '#/components/requestBodies/B' };

    walkRequestBodyReferences(body, rename);

    expect(body.$ref).toBe('#/components/requestBodies/B-renamed');
  });

  it('walks every content media type', () => {
    const body: Swagger.RequestBody = {
      content: {
        'application/json': { schema: { $ref: '#/json' } },
        'application/xml': { schema: { $ref: '#/xml' } },
      },
    };

    expect(collect(m => walkRequestBodyReferences(body, m))).toEqual(['#/json', '#/xml']);
  });
});

describe('walkHeaderReferences', () => {
  it('rewrites a header that is a reference', () => {
    const header: Swagger.Reference = { $ref: '#/components/headers/H' };

    walkHeaderReferences(header, rename);

    expect(header.$ref).toBe('#/components/headers/H-renamed');
  });

  it('walks the schema of a header with a schema', () => {
    const header: Swagger.Header = { schema: { $ref: '#/hs' } };

    expect(collect(m => walkHeaderReferences(header, m))).toEqual(['#/hs']);
  });

  it('walks the examples of a header with a schema', () => {
    const header: Swagger.Header = {
      schema: { type: 'string' },
      examples: { one: { $ref: '#/he' } },
    };

    expect(collect(m => walkHeaderReferences(header, m))).toEqual(['#/he']);
  });

  it('walks the content of a header with content', () => {
    const header: Swagger.Header = {
      content: { 'application/json': { schema: { $ref: '#/hc' } } },
    };

    expect(collect(m => walkHeaderReferences(header, m))).toEqual(['#/hc']);
  });
});

describe('walkLinkReferences', () => {
  it('rewrites a link that is a reference', () => {
    const link: Swagger.Reference = { $ref: '#/components/links/L' };

    walkLinkReferences(link, rename);

    expect(link.$ref).toBe('#/components/links/L-renamed');
  });

  it('leaves a literal link alone', () => {
    // Literal links have no reference-bearing fields today; this pins that
    // behaviour so the empty else-branch is deliberate rather than forgotten.
    const link: Swagger.Link = { operationId: 'getThing' };

    expect(collect(m => walkLinkReferences(link, m))).toEqual([]);
  });
});

describe('walkResponseReferences', () => {
  it('rewrites a response that is a reference', () => {
    const response: Swagger.Reference = { $ref: '#/components/responses/R' };

    walkResponseReferences(response, rename);

    expect(response.$ref).toBe('#/components/responses/R-renamed');
  });

  it('walks headers, content and links together', () => {
    const response: Swagger.Response = {
      description: 'ok',
      headers: { 'X-Rate': { $ref: '#/rh' } },
      content: { 'application/json': { schema: { $ref: '#/rc' } } },
      links: { next: { $ref: '#/rl' } },
    };

    expect(collect(m => walkResponseReferences(response, m))).toEqual(['#/rh', '#/rc', '#/rl']);
  });

  it('handles a response with none of the optional members', () => {
    const response: Swagger.Response = { description: 'empty' };

    expect(collect(m => walkResponseReferences(response, m))).toEqual([]);
  });
});

describe('walkCallbackReferences', () => {
  it('rewrites a callback that is a reference', () => {
    const callback: Swagger.Reference = { $ref: '#/components/callbacks/C' };

    walkCallbackReferences(callback, rename);

    expect(callback.$ref).toBe('#/components/callbacks/C-renamed');
  });

  it('recurses into the path items it contains', () => {
    // Exercises the mutual recursion between walkCallbackReferences and the
    // private walkPathItemReferences.
    const callback: Swagger.Callback = {
      '{$request.body#/url}': {
        post: {
          responses: { '200': { $ref: '#/cbr' } },
        },
      },
    };

    expect(collect(m => walkCallbackReferences(callback, m))).toEqual(['#/cbr']);
  });
});

describe('walkPathReferences', () => {
  it('rewrites a path item that is a reference', () => {
    const paths: Swagger.Paths = { '/thing': { $ref: '#/paths/other' } };

    walkPathReferences(paths, rename);

    expect((paths['/thing'] as { $ref: string }).$ref).toBe('#/paths/other-renamed');
  });

  it('walks every HTTP method on a path item', () => {
    const paths: Swagger.Paths = {
      '/thing': {
        get: { responses: { '200': { $ref: '#/get' } } },
        put: { responses: { '200': { $ref: '#/put' } } },
        post: { responses: { '200': { $ref: '#/post' } } },
        delete: { responses: { '200': { $ref: '#/delete' } } },
        options: { responses: { '200': { $ref: '#/options' } } },
        head: { responses: { '200': { $ref: '#/head' } } },
        patch: { responses: { '200': { $ref: '#/patch' } } },
        trace: { responses: { '200': { $ref: '#/trace' } } },
      },
    };

    expect(collect(m => walkPathReferences(paths, m))).toEqual([
      '#/get', '#/put', '#/post', '#/delete', '#/options', '#/head', '#/patch', '#/trace',
    ]);
  });

  it('walks path-level parameters', () => {
    const paths: Swagger.Paths = {
      '/thing': { parameters: [{ $ref: '#/pp1' }, { $ref: '#/pp2' }] },
    };

    expect(collect(m => walkPathReferences(paths, m))).toEqual(['#/pp1', '#/pp2']);
  });

  it('walks operation parameters, request bodies and callbacks', () => {
    const paths: Swagger.Paths = {
      '/thing': {
        post: {
          parameters: [{ $ref: '#/op' }],
          requestBody: { $ref: '#/orb' },
          responses: { '200': { description: 'ok' } },
          callbacks: { onEvent: { $ref: '#/ocb' } },
        },
      },
    };

    expect(collect(m => walkPathReferences(paths, m))).toEqual(['#/op', '#/orb', '#/ocb']);
  });
});

describe('walkComponentReferences', () => {
  it('walks all eight component maps', () => {
    const components: Swagger.Components = {
      schemas: { S: { $ref: '#/s' } },
      responses: { R: { $ref: '#/r' } },
      parameters: { P: { $ref: '#/p' } },
      examples: { E: { $ref: '#/e' } },
      requestBodies: { B: { $ref: '#/b' } },
      headers: { H: { $ref: '#/h' } },
      links: { L: { $ref: '#/l' } },
      callbacks: { C: { $ref: '#/c' } },
    };

    expect(collect(m => walkComponentReferences(components, m))).toEqual([
      '#/s', '#/r', '#/p', '#/e', '#/b', '#/h', '#/l', '#/c',
    ]);
  });

  it('handles a components object with nothing in it', () => {
    expect(collect(m => walkComponentReferences({}, m))).toEqual([]);
  });
});

describe('walkAllReferences', () => {
  it('walks both paths and components', () => {
    const oas: Swagger.SwaggerV3 = {
      openapi: '3.0.3',
      info: { title: 'test', version: '1' },
      paths: { '/thing': { get: { responses: { '200': { $ref: '#/pathRef' } } } } },
      components: { schemas: { S: { $ref: '#/componentRef' } } },
    };

    expect(collect(m => walkAllReferences(oas, m))).toEqual(['#/pathRef', '#/componentRef']);
  });

  it('walks paths when there are no components', () => {
    const oas: Swagger.SwaggerV3 = {
      openapi: '3.0.3',
      info: { title: 'test', version: '1' },
      paths: { '/thing': { get: { responses: { '200': { $ref: '#/only' } } } } },
    };

    expect(collect(m => walkAllReferences(oas, m))).toEqual(['#/only']);
  });
});

describe('3.0 edge: references', () => {
  it('rewrites a reference whose target is itself a reference', () => {
    // Alias -> Thing, where Thing is disputed and renamed. The alias must follow.
    const output = expectSuccess(merge([
      { oas: doc30({
        paths: { '/a': { get: op('a') } },
        components: { schemas: { Thing: { type: 'string' } } },
      }) },
      { oas: doc30({
        paths: { '/b': { get: op('b') } },
        components: { schemas: {
          Thing: { type: 'number' },
          Alias: { $ref: '#/components/schemas/Thing' },
        } },
      }) },
    ]));

    expect((output.components?.schemas?.Alias as { $ref: string }).$ref).toBe('#/components/schemas/Thing1');
  });

  it('rewrites a discriminator mapping on rename (issues #99/#106)', () => {
    // Was pinned here as a KNOWN GAP: the oneOf $ref followed the rename while
    // the mapping value pointing at the same schema did not, producing a
    // document that looked valid and resolved to nothing. Fixed by teaching the
    // reference walker that a Discriminator Object's mapping values are
    // pointers, even though they are plain strings rather than $ref members.
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/a': { get: op('a') } }, components: { schemas: { Dog: { type: 'string' } } } }) },
      { oas: doc30({
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
    expect((pet.discriminator.mapping as Record<string, string>).dog).toBe('#/components/schemas/Dog1');
  });

  it('deduplicates identical components rather than renaming them', () => {
    const identical = schema({ type: 'string', description: 'shared' });
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/a': { get: op('a') } }, components: { schemas: { S: { ...identical } } } }) },
      { oas: doc30({ paths: { '/b': { get: op('b') } }, components: { schemas: { S: { ...identical } } } }) },
    ]));

    expect(schemaKeys(output)).toEqual(['S']);
  });
});

describe('3.0 edge: callbacks and links', () => {
  it('rewrites a reference inside a callback', () => {
    const inputs: SingleMergeInput[] = [
      { oas: doc30({ paths: { '/a': { get: op('a') } }, components: { schemas: { Thing: { type: 'string' } } } }) },
      { oas: doc30({
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

  it('rewrites a link operationRef when the path it targets moves (issue #106)', () => {
    // A Link's operationRef is a URI pointing at an Operation. pathModification
    // used to move the path out from under it and leave the reference dangling
    // in a document that still looked valid. Was pinned here as a KNOWN GAP.
    const output = expectSuccess(merge([
      {
        oas: doc30({ paths: { '/thing': { get: op('getThing') }, '/other': { get: {
          operationId: 'other',
          responses: { '200': { description: 'ok', links: {
            next: { operationRef: '#/paths/~1thing/get' },
          } } },
        } } } }),
        pathModification: { prepend: '/api' },
      },
    ]));

    // Follows the path, with the `/` re-escaped as `~1` per JSON Pointer.
    expect(at(output.paths?.['/api/other'], 'get', 'responses', '200', 'links', 'next', 'operationRef'))
      .toBe('#/paths/~1api~1thing/get');
    expect(pathKeys(output)).toEqual(['/api/other', '/api/thing']);
  });
});

describe('3.1 - references inside webhooks', () => {
  it('rewrites a $ref inside a webhook when its component is renamed', () => {
    // The inverse of the orphaned-component failure recorded in
    // 24-proposal-openapi-3.2-support.md: the webhook was dropped, its $ref went
    // with it, and the schema it pointed at survived with nothing referencing
    // it. Both inputs define a different `Pet`, so the second is renamed and
    // the webhook's reference must follow.
    const first: SingleMergeInput = { oas: doc31({
      paths: { '/pets': { get: { operationId: 'listPets', responses: ok } } },
      components: { schemas: { Pet: { type: 'string' } } },
    }) };
    const second: SingleMergeInput = { oas: doc31({
      webhooks: { newPet: { post: {
        operationId: 'onNewPet',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
        responses: ok,
      } } },
      components: { schemas: { Pet: { type: 'number' } } },
    }) };

    const output = expectSuccess(merge([first, second]));

    const body = output.webhooks?.newPet.post?.requestBody;
    const ref = (body as { content: { [k: string]: { schema: { $ref: string } } } })
      .content['application/json'].schema.$ref;

    expect(Object.keys(output.components?.schemas ?? {}).sort()).toEqual(['Pet', 'Pet1']);
    expect(ref).toBe('#/components/schemas/Pet1');
  });
});

describe('3.2 - references inside the new slots', () => {
  it('rewrites a $ref inside a query operation when its component is renamed', () => {
    const output = expectSuccess(merge([
      { oas: doc32({
        paths: { '/a': { get: op('getA') } },
        components: { schemas: { Thing: { type: 'string' } } },
      }) },
      { oas: doc32({
        paths: { '/search': { query: {
          operationId: 'searchQ',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } },
          responses: ok,
        } } },
        components: { schemas: { Thing: { type: 'number' } } },
      }) },
    ]));

    const body = output.paths?.['/search'].query?.requestBody;
    const ref = (body as { content: { [k: string]: { schema: { $ref: string } } } })
      .content['application/json'].schema.$ref;

    expect(ref).toBe('#/components/schemas/Thing1');
  });

  it('rewrites a $ref inside an additionalOperations verb', () => {
    const output = expectSuccess(merge([
      { oas: doc32({
        paths: { '/a': { get: op('getA') } },
        components: { schemas: { Thing: { type: 'string' } } },
      }) },
      { oas: doc32({
        paths: { '/cache': { additionalOperations: { PURGE: {
          operationId: 'purge',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } },
          responses: ok,
        } } } },
        components: { schemas: { Thing: { type: 'number' } } },
      }) },
    ]));

    const body = output.paths?.['/cache'].additionalOperations?.PURGE.requestBody;
    const ref = (body as { content: { [k: string]: { schema: { $ref: string } } } })
      .content['application/json'].schema.$ref;

    expect(ref).toBe('#/components/schemas/Thing1');
  });
});

/**
 * Issue #99: discriminator mappings are pointers the walker has to know about.
 *
 * The values of a Discriminator Object's `mapping` point at schemas, but they
 * are plain strings in a plain object rather than `$ref` members, so nothing
 * rewrote them when deduplication renamed their target. The result resolved to
 * nothing while looking entirely valid.
 *
 * The specification permits two spellings and both occur in the wild: a full
 * reference, and a bare schema name that is defined as shorthand for exactly
 * that reference.
 */
describe('discriminator mapping rewriting (issue #99)', () => {
  const petWith = (mapping: Record<string, string>) => ({
    Dog: { type: 'object' as const },
    Pet: {
      oneOf: [{ $ref: '#/components/schemas/Dog' }],
      discriminator: { propertyName: 'kind', mapping },
    },
  });

  const twoInputs = (mapping: Record<string, string>) => [
    { oas: doc30({ paths: { '/a': { get: op('a') } }, components: { schemas: { Dog: { type: 'string' } } } }) },
    { oas: doc30({ paths: { '/b': { get: op('b') } }, components: { schemas: petWith(mapping) } }) },
  ];

  const mappingOf = (output: OpenApiDocument): Record<string, string> =>
    ((output.components?.schemas?.Pet as Record<string, Record<string, unknown>>).discriminator
      .mapping) as Record<string, string>;

  it('rewrites a full reference', () => {
    const output = expectSuccess(merge(twoInputs({ dog: '#/components/schemas/Dog' })));

    expect(mappingOf(output).dog).toBe('#/components/schemas/Dog1');
  });

  it('rewrites a bare schema name, keeping it bare', () => {
    const output = expectSuccess(merge(twoInputs({ dog: 'Dog' })));

    // The spec defines a bare name as shorthand for the full reference.
    // Expanding it here would produce a large, noisy diff in documents this
    // tool is only passing through.
    expect(mappingOf(output).dog).toBe('Dog1');
  });

  it('leaves a mapping alone when its target was not renamed', () => {
    const output = expectSuccess(
      merge([
        { oas: doc30({ paths: { '/a': { get: op('a') } } }) },
        { oas: doc30({ paths: { '/b': { get: op('b') } }, components: { schemas: petWith({ dog: 'Dog' }) } }) },
      ]),
    );

    expect(mappingOf(output).dog).toBe('Dog');
  });

  it('leaves an external URL mapping untouched', () => {
    const output = expectSuccess(merge(twoInputs({ dog: 'https://example.com/schemas.json#/Dog' })));

    // It does not point into this document's components.
    expect(mappingOf(output).dog).toBe('https://example.com/schemas.json#/Dog');
  });

  it('leaves a relative file mapping untouched', () => {
    const output = expectSuccess(merge(twoInputs({ dog: '../other.yaml#/components/schemas/Dog' })));

    expect(mappingOf(output).dog).toBe('../other.yaml#/components/schemas/Dog');
  });

  it('rewrites several mapping entries in one discriminator', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: { '/a': { get: op('a') } },
            components: { schemas: { Dog: { type: 'string' }, Cat: { type: 'string' } } },
          }),
        },
        {
          oas: doc30({
            paths: { '/b': { get: op('b') } },
            components: {
              schemas: {
                Dog: { type: 'object' },
                Cat: { type: 'object' },
                Pet: {
                  oneOf: [{ $ref: '#/components/schemas/Dog' }, { $ref: '#/components/schemas/Cat' }],
                  discriminator: { propertyName: 'kind', mapping: { dog: 'Dog', cat: '#/components/schemas/Cat' } },
                },
              },
            },
          }),
        },
      ]),
    );

    expect(mappingOf(output)).toEqual({ dog: 'Dog1', cat: '#/components/schemas/Cat1' });
  });

  it('rewrites a mapping under a dispute prefix', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/b': { get: op('b') } }, components: { schemas: petWith({ dog: 'Dog' }) } }),
          dispute: { prefix: 'Svc', alwaysApply: true },
        },
      ]),
    );

    const pet = (expectSuccess(merge([
      {
        oas: doc30({ paths: { '/b': { get: op('b') } }, components: { schemas: petWith({ dog: 'Dog' }) } }),
        dispute: { prefix: 'Svc', alwaysApply: true },
      },
    ])).components?.schemas?.SvcPet) as Record<string, Record<string, unknown>>;

    expect((pet.discriminator.mapping as Record<string, string>).dog).toBe('SvcDog');
    expect(output.components?.schemas?.SvcDog).toBeDefined();
  });
});

/**
 * Issue #106: the remaining pointers that are not spelled `$ref`.
 *
 * #99 taught the walker about `discriminator.mapping`. Two of the same shape
 * were left: 3.2's `discriminator.defaultMapping`, and a Link's
 * `operationRef`. Both point into the document, neither is a `$ref`, and both
 * were silently left stale.
 */
describe('defaultMapping and operationRef (issue #106)', () => {
  it('rewrites discriminator.defaultMapping on rename', () => {
    const output = expectSuccess(
      merge([
        { oas: doc32({ paths: { '/a': { get: op('a') } }, components: { schemas: { Dog: { type: 'string' } } } }) },
        {
          oas: doc32({
            paths: { '/b': { get: op('b') } },
            components: {
              schemas: {
                Dog: { type: 'object' },
                Pet: {
                  oneOf: [{ $ref: '#/components/schemas/Dog' }],
                  discriminator: { propertyName: 'kind', defaultMapping: '#/components/schemas/Dog' },
                },
              },
            },
          }),
        },
      ]),
    );

    const pet = output.components?.schemas?.Pet as Record<string, Record<string, unknown>>;
    expect(pet.discriminator.defaultMapping).toBe('#/components/schemas/Dog1');
  });

  it('rewrites a bare-name defaultMapping, keeping it bare', () => {
    const output = expectSuccess(
      merge([
        { oas: doc32({ paths: { '/a': { get: op('a') } }, components: { schemas: { Dog: { type: 'string' } } } }) },
        {
          oas: doc32({
            paths: { '/b': { get: op('b') } },
            components: {
              schemas: {
                Dog: { type: 'object' },
                Pet: { discriminator: { propertyName: 'kind', defaultMapping: 'Dog' } },
              },
            },
          }),
        },
      ]),
    );

    const pet = output.components?.schemas?.Pet as Record<string, Record<string, unknown>>;
    expect(pet.discriminator.defaultMapping).toBe('Dog1');
  });

  it('rewrites mapping and defaultMapping together', () => {
    const output = expectSuccess(
      merge([
        { oas: doc32({ paths: { '/a': { get: op('a') } }, components: { schemas: { Dog: { type: 'string' } } } }) },
        {
          oas: doc32({
            paths: { '/b': { get: op('b') } },
            components: {
              schemas: {
                Dog: { type: 'object' },
                Pet: {
                  discriminator: {
                    propertyName: 'kind',
                    mapping: { dog: 'Dog' },
                    defaultMapping: '#/components/schemas/Dog',
                  },
                },
              },
            },
          }),
        },
      ]),
    );

    const discriminator = (output.components?.schemas?.Pet as Record<string, Record<string, unknown>>).discriminator;
    expect(discriminator.mapping).toEqual({ dog: 'Dog1' });
    expect(discriminator.defaultMapping).toBe('#/components/schemas/Dog1');
  });

  it('leaves an operationRef alone when the path did not move', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/thing': { get: op('getThing') },
              '/other': {
                get: {
                  operationId: 'other',
                  responses: { '200': { description: 'ok', links: { next: { operationRef: '#/paths/~1thing/get' } } } },
                },
              },
            },
          }),
        },
      ]),
    );

    expect(at(output.paths?.['/other'], 'get', 'responses', '200', 'links', 'next', 'operationRef'))
      .toBe('#/paths/~1thing/get');
  });

  it('leaves an external operationRef untouched', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/other': {
                get: {
                  operationId: 'other',
                  responses: {
                    '200': {
                      description: 'ok',
                      links: { next: { operationRef: 'https://example.com/api.json#/paths/~1thing/get' } },
                    },
                  },
                },
              },
            },
          }),
          pathModification: { prepend: '/api' },
        },
      ]),
    );

    // Points into another document; moving our paths says nothing about it.
    expect(at(output.paths?.['/api/other'], 'get', 'responses', '200', 'links', 'next', 'operationRef'))
      .toBe('https://example.com/api.json#/paths/~1thing/get');
  });

  it('leaves an operationId link alone, since ids move with their operation', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/thing': { get: op('getThing') },
              '/other': {
                get: {
                  operationId: 'other',
                  responses: { '200': { description: 'ok', links: { next: { operationId: 'getThing' } } } },
                },
              },
            },
          }),
          pathModification: { prepend: '/api' },
        },
      ]),
    );

    expect(at(output.paths?.['/api/other'], 'get', 'responses', '200', 'links', 'next', 'operationId'))
      .toBe('getThing');
  });

  it('rewrites an operationRef under stripStart as well as prepend', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/v1/thing': { get: op('getThing') },
              '/v1/other': {
                get: {
                  operationId: 'other',
                  responses: { '200': { description: 'ok', links: { next: { operationRef: '#/paths/~1v1~1thing/get' } } } },
                },
              },
            },
          }),
          pathModification: { stripStart: '/v1' },
        },
      ]),
    );

    expect(at(output.paths?.['/other'], 'get', 'responses', '200', 'links', 'next', 'operationRef'))
      .toBe('#/paths/~1thing/get');
  });
});
