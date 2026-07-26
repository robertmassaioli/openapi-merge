import { merge } from '..';
import { isErrorResult, MergeResult } from '../data';
import { getPathItemOperations, HTTP_METHODS, OpenApiDocument, PathItem32 } from '../oas31';

function doc(partial: Partial<OpenApiDocument>): OpenApiDocument {
  return { openapi: '3.2.0', info: { title: 'Test', version: '1.0.0' }, ...partial } as OpenApiDocument;
}

function expectSuccess(result: MergeResult): OpenApiDocument {
  if (isErrorResult(result)) {
    throw new Error(`Expected a successful merge, got: ${result.message} (${result.type})`);
  }
  return result.output;
}

const okResponse = { '200': { description: 'ok' } };
const op = (operationId: string): { operationId: string; responses: typeof okResponse } =>
  ({ operationId, responses: okResponse });

describe('HTTP_METHODS', () => {
  it('includes query, the 3.2 addition', () => {
    expect([...HTTP_METHODS]).toEqual([
      'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query',
    ]);
  });
});

describe('getPathItemOperations', () => {
  it('finds standard methods and additionalOperations together', () => {
    const pathItem: PathItem32 = {
      get: op('getThing'),
      query: op('queryThing'),
      additionalOperations: { PURGE: op('purgeThing'), LOCK: op('lockThing') },
    };

    const found = getPathItemOperations(pathItem);

    expect(found.map(f => f.method).sort()).toEqual(['LOCK', 'PURGE', 'get', 'query']);
    expect(found.filter(f => f.isAdditional).map(f => f.method).sort()).toEqual(['LOCK', 'PURGE']);
  });

  it('returns nothing for a path item with no operations', () => {
    expect(getPathItemOperations({ parameters: [] })).toEqual([]);
  });
});

describe('3.2 - query and additionalOperations survive', () => {
  it('keeps a path whose only operation is query', () => {
    // The regression test for the measured bug: countOperationsInPathItem
    // scored this 0 and dropPathItemsWithNoOperations deleted the endpoint.
    const output = expectSuccess(merge([{ oas: doc({
      paths: { '/search': { query: op('searchQ') } },
    }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/search']);
    expect(output.paths?.['/search'].query?.operationId).toBe('searchQ');
  });

  it('keeps a path whose only operations are additionalOperations', () => {
    const output = expectSuccess(merge([{ oas: doc({
      paths: { '/cache': { additionalOperations: { PURGE: op('purge') } } },
    }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/cache']);
    expect(output.paths?.['/cache'].additionalOperations?.PURGE.operationId).toBe('purge');
  });

  it('still drops a path item that genuinely has no operations', () => {
    // The behaviour the counting exists for must not regress.
    const output = expectSuccess(merge([{ oas: doc({
      paths: { '/empty': { parameters: [] }, '/real': { get: op('getReal') } },
    }) }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/real']);
  });
});

describe('3.2 - operationId uniqueness covers the new slots', () => {
  it('disambiguates a clash between query operations', () => {
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { query: op('same') } } }) },
      { oas: doc({ paths: { '/b': { query: op('same') } } }) },
    ]));

    expect(output.paths?.['/b'].query?.operationId).toBe('same1');
  });

  it('disambiguates a clash between a get and an additionalOperations verb', () => {
    const output = expectSuccess(merge([
      { oas: doc({ paths: { '/a': { get: op('same') } } }) },
      { oas: doc({ paths: { '/b': { additionalOperations: { PURGE: op('same') } } } }) },
    ]));

    expect(output.paths?.['/b'].additionalOperations?.PURGE.operationId).toBe('same1');
  });
});

describe('3.2 - references inside the new slots', () => {
  it('rewrites a $ref inside a query operation when its component is renamed', () => {
    const output = expectSuccess(merge([
      { oas: doc({
        paths: { '/a': { get: op('getA') } },
        components: { schemas: { Thing: { type: 'string' } } },
      }) },
      { oas: doc({
        paths: { '/search': { query: {
          operationId: 'searchQ',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } },
          responses: okResponse,
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
      { oas: doc({
        paths: { '/a': { get: op('getA') } },
        components: { schemas: { Thing: { type: 'string' } } },
      }) },
      { oas: doc({
        paths: { '/cache': { additionalOperations: { PURGE: {
          operationId: 'purge',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } },
          responses: okResponse,
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

describe('3.2 - tag selection covers the new slots', () => {
  it('excludes a query operation by tag', () => {
    const output = expectSuccess(merge([{
      oas: doc({ paths: { '/search': {
        query: { ...op('searchQ'), tags: ['internal'] },
        get: { ...op('getSearch'), tags: ['public'] },
      } } }),
      operationSelection: { excludeTags: ['internal'] },
    }]));

    expect(output.paths?.['/search'].query).toBeUndefined();
    expect(output.paths?.['/search'].get).toBeDefined();
  });

  it('excludes an additionalOperations verb by tag', () => {
    const output = expectSuccess(merge([{
      oas: doc({ paths: { '/cache': {
        get: { ...op('getCache'), tags: ['public'] },
        additionalOperations: { PURGE: { ...op('purge'), tags: ['internal'] } },
      } } }),
      operationSelection: { excludeTags: ['internal'] },
    }]));

    expect(output.paths?.['/cache'].additionalOperations?.PURGE).toBeUndefined();
    expect(output.paths?.['/cache'].get).toBeDefined();
  });

  it('includes only tagged query operations', () => {
    const output = expectSuccess(merge([{
      oas: doc({ paths: { '/search': {
        query: { ...op('searchQ'), tags: ['wanted'] },
        get: { ...op('getSearch'), tags: ['unwanted'] },
      } } }),
      operationSelection: { includeTags: ['wanted'] },
    }]));

    expect(output.paths?.['/search'].query).toBeDefined();
    expect(output.paths?.['/search'].get).toBeUndefined();
  });
});

describe('3.2 - $self', () => {
  it('keeps $self when there is exactly one input', () => {
    const output = expectSuccess(merge([{ oas: doc({
      $self: 'https://example.com/api',
      paths: { '/a': { get: op('getA') } },
    }) }]));

    expect(output.$self).toBe('https://example.com/api');
  });

  it('drops $self when merging more than one input', () => {
    // A merged document is not any of its inputs, and $self participates in
    // reference resolution, so carrying one forward would be actively wrong.
    const output = expectSuccess(merge([
      { oas: doc({ $self: 'https://example.com/first', paths: { '/a': { get: op('getA') } } }) },
      { oas: doc({ $self: 'https://example.com/second', paths: { '/b': { get: op('getB') } } }) },
    ]));

    expect(output.$self).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain('$self');
  });
});

describe('3.2 - additive fields pass through', () => {
  it('carries tag summary, parent and kind', () => {
    const output = expectSuccess(merge([{ oas: doc({
      tags: [{ name: 'admin', summary: 'Admin', parent: 'root', kind: 'nav' }],
      paths: { '/a': { get: op('getA') } },
    }) }]));

    expect(output.tags?.[0]).toEqual({ name: 'admin', summary: 'Admin', parent: 'root', kind: 'nav' });
  });

  it('carries discriminator defaultMapping and itemSchema', () => {
    const output = expectSuccess(merge([{ oas: doc({
      paths: { '/a': { get: op('getA') } },
      components: { schemas: { Pet: {
        oneOf: [{ $ref: '#/components/schemas/Dog' }],
        discriminator: { propertyName: 'kind', defaultMapping: '#/components/schemas/Dog' },
        itemSchema: { type: 'string' },
      }, Dog: { type: 'object' } } },
    } as Partial<OpenApiDocument>) }]));

    const pet = output.components?.schemas?.Pet as Record<string, unknown>;
    expect((pet.discriminator as Record<string, unknown>).defaultMapping).toBe('#/components/schemas/Dog');
    expect(pet.itemSchema).toEqual({ type: 'string' });
  });

  it('carries an in: querystring parameter alongside a query operation', () => {
    // Unrelated namespaces that happen to share a word; both must survive.
    const output = expectSuccess(merge([{ oas: doc({
      paths: { '/search': { query: {
        ...op('searchQ'),
        parameters: [{ name: 'filter', in: 'querystring', schema: { type: 'string' } }],
      } } },
    } as Partial<OpenApiDocument>) }]));

    const params = output.paths?.['/search'].query?.parameters as Array<Record<string, unknown>>;
    expect(params[0].in).toBe('querystring');
  });

  it('carries an OAuth2 device authorization flow', () => {
    const output = expectSuccess(merge([{ oas: doc({
      paths: { '/a': { get: op('getA') } },
      components: { securitySchemes: { oauth: { type: 'oauth2', oauth2MetadataUrl: 'https://example.com/.well-known', flows: {
        deviceAuthorization: { deviceAuthorizationUrl: 'https://example.com/device', tokenUrl: 'https://example.com/token', scopes: {} },
      } } } },
    } as Partial<OpenApiDocument>) }]));

    const scheme = output.components?.securitySchemes?.oauth as Record<string, unknown>;
    expect(scheme.oauth2MetadataUrl).toBe('https://example.com/.well-known');
    expect((scheme.flows as Record<string, unknown>).deviceAuthorization).toBeDefined();
  });
});

describe('3.2 - version rules', () => {
  it('refuses a mix of 3.1 and 3.2 inputs', () => {
    const result = merge([
      { oas: doc({ openapi: '3.1.1', paths: { '/a': { get: op('getA') } } }) },
      { oas: doc({ openapi: '3.2.0', paths: { '/b': { get: op('getB') } } }) },
    ]);

    if (!isErrorResult(result)) {
      throw new Error('Expected a mixed-openapi-versions error');
    }
    expect(result.type).toBe('mixed-openapi-versions');
  });

  it('declares 3.2.0 on the output', () => {
    const output = expectSuccess(merge([{ oas: doc({ paths: { '/a': { get: op('getA') } } }) }]));

    expect(output.openapi).toBe('3.2.0');
  });
});
