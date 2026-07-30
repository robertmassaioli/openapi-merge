import { merge } from '../index';
import { OpenApiDocument } from '../oas31';

import { toOAS } from './_helpers/oas-generation';
import { expectMergeResult, toMergeInputs } from './_helpers/test-utils';
import {
  at, doc30, doc31, doc32, expectSuccess, ok, op, pathItem, schema, tagged,
} from './_helpers/documents';

/**
 * Document-level metadata: everything outside `paths`, `webhooks` and
 * `components`.
 *
 * Almost all of it is first-wins -- the first input to declare `servers`,
 * `security`, `externalDocs` or `jsonSchemaDialect` supplies it -- with two
 * exceptions. `info.description` can be appended across inputs, and `$self`
 * (3.2) is deliberately DROPPED when merging more than one input, because a
 * merged document is not any of its inputs and `$self` participates in reference
 * resolution.
 *
 * `tags` are deduplicated by name, and top-level `x-` extensions are first-wins.
 */

describe('OAS Info', () => {
  it('should always take the first info block from the first definition', () => {
    const first = toOAS({});
    const second = toOAS({});

    first.info.title = 'first';
    second.info.title = 'second';

    const output = toOAS({});
    output.info.title = 'first';

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should only take the first description if no DescriptionMergeBehaviour is set', () => {
    const first = toOAS({});
    const second = toOAS({});
    const third = toOAS({});

    second.info.description = 'Second description';
    third.info.description = 'Third description';

    const output = toOAS({});

    expectMergeResult(merge(toMergeInputs([first, second, third])), {
      output
    });
  });

  it(`should only take the values with 'append' set to true if any DescriptionMergeBehaviour is set`, () => {
    const first = toOAS({});
    const second = toOAS({});
    const third = toOAS({});

    first.info.description = 'First description';
    second.info.description = 'Second description';
    third.info.description = 'Third description';

    const output = toOAS({});
    output.info.description = 'First description\n\nThird description';

    const mergeInputs = toMergeInputs([first, second, third]);

    mergeInputs[0].description = {
      append: true
    };

    mergeInputs[2].description = {
      append: true
    };

    expectMergeResult(merge(mergeInputs), { output });
  });

  it('should append the title specified in DescriptionMergeBehaviour with the right heading level', () => {
    const first = toOAS({});
    const second = toOAS({});
    const third = toOAS({});

    first.info.description = 'First description';
    second.info.description = 'Second description';
    third.info.description = 'Third description';

    const mergeInputs = toMergeInputs([first, second, third]);

    mergeInputs[0].description = {
      append: true,
      title: {
        value: 'First heading',
        headingLevel: 3
      }
    };

    mergeInputs[1].description = {
      append: true
    };

    mergeInputs[2].description = {
      append: true,
      title: {
        value: 'Third heading'
      }
    };

    const output = toOAS({});
    output.info.description = '### First heading\n\nFirst description\n\nSecond description\n\n# Third heading\n\nThird description';

    expectMergeResult(merge(mergeInputs), { output });
  });

  it('should skip descriptions even if they have headings', () => {
    const first = toOAS({});
    const second = toOAS({});
    const third = toOAS({});

    first.info.description = 'First description';
    third.info.description = 'Third description';

    const mergeInputs = toMergeInputs([first, second, third]);

    mergeInputs[0].description = {
      append: true,
      title: {
        value: 'First heading',
        headingLevel: 3
      }
    };

    mergeInputs[1].description = {
      append: true,
      title: {
        value: 'Second heading',
        headingLevel: 2
      }
    };

    mergeInputs[2].description = {
      append: true,
      title: {
        value: 'Third heading'
      }
    };

    const output = toOAS({});
    output.info.description = '### First heading\n\nFirst description\n\n# Third heading\n\nThird description';

    expectMergeResult(merge(mergeInputs), { output });
  });
});

describe('OAS Security', () => {
  /**
   * Top-level `security` is first-wins; `securitySchemes` is NOT.
   *
   * Changed by issue #33. This test previously asserted that a later input's
   * schemes were discarded along with its `security` array, which is the bug
   * that issue reported: an operation could require a scheme the merged
   * document did not define. The two are now decided separately -- the
   * document-level requirement still comes from the first input that states
   * one, while every input's schemes are merged into the lookup table.
   */
  it('takes top-level security from the first input, but merges all schemes', () => {
    const first = toOAS({}, {
      securitySchemes: {
        firstScheme: { type: 'apiKey', name: 'first scheme', in: 'query' }
      }
    });

    first.security = [{ "first scheme": [] }];

    const second = toOAS({}, {
      securitySchemes: {
        secondScheme: { type: 'apiKey', name: 'second scheme', in: 'query' }
      }
    });

    second.security = [{ "second scheme": [] }];

    const output = expectSuccess(merge(toMergeInputs([first, second])));

    expect(output.security).toEqual([{ "first scheme": [] }]);
    expect(Object.keys(output.components?.securitySchemes ?? {}).sort()).toEqual(['firstScheme', 'secondScheme']);
  });

  it('should take the first available security scheme definition', () => {
    const first = toOAS({});

    first.security = [{ "first scheme": [] }];

    const second = toOAS({}, {
      securitySchemes: {
        secondScheme: {
          type: 'apiKey',
          name: 'second scheme',
          in: 'query'
        }
      }
    });

    second.security = [{ "second scheme": [] }];

    const output = toOAS({}, {
      securitySchemes: {
        secondScheme: {
          type: 'apiKey',
          name: 'second scheme',
          in: 'query'
        }
      }
    });

    output.security = [{ "first scheme": [] }];

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('takes top-level security from a later input when the first declares none', () => {
    const first = toOAS({}, {
      securitySchemes: {
        firstScheme: { type: 'apiKey', name: 'first scheme', in: 'query' }
      }
    });

    const second = toOAS({}, {
      securitySchemes: {
        secondScheme: { type: 'apiKey', name: 'second scheme', in: 'query' }
      }
    });

    second.security = [{ "second scheme": [] }];

    const output = expectSuccess(merge(toMergeInputs([first, second])));

    expect(output.security).toEqual([{ "second scheme": [] }]);
    // Both schemes survive now (issue #33); before, only firstScheme did.
    expect(Object.keys(output.components?.securitySchemes ?? {}).sort()).toEqual(['firstScheme', 'secondScheme']);
  });

  it('should have no security definitions if none are defined', () => {
    const first = toOAS({});
    const second = toOAS({});
    const output = toOAS({});

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });
});

describe('OAS External Docs', () => {
  it('should always take the first docs definition', () => {
    const first = toOAS({});
    const second = toOAS({});

    first.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My first documentation'
    };
    second.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My second documentation'
    };

    const output = toOAS({});
    output.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My first documentation'
    };

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should take the first available docs definition', () => {
    const first = toOAS({});
    const second = toOAS({});

    second.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My second documentation'
    };

    const output = toOAS({});
    output.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My second documentation'
    };

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should return no docs definition if none could be found', () => {
    const first = toOAS({});
    const second = toOAS({});

    const output = toOAS({});

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });
});

describe('extensions', () => {
  it('should take the first extension definition at the top level', () => {
    const first = toOAS({});
    first["x-atlassian-narrative"] = {
      documents: [{
        anchor: 'first-intro',
        title: 'First Introduction',
        body: 'First intro section for reading'
      }]
    };

    const second = toOAS({});
    second["x-atlassian-narrative"] = {
      documents: [{
        anchor: 'second-intro',
        title: 'Second Introduction',
        body: 'Second intro section for reading'
      }]
    };

    const output = toOAS({});
    output["x-atlassian-narrative"] = {
      documents: [{
        anchor: 'first-intro',
        title: 'First Introduction',
        body: 'First intro section for reading'
      }]
    };

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });
});

describe('securitySchemes', () => {
  // Issue #33 changed this from first-wins to a merge. Differently-named
  // schemes from every input now coexist, which is what makes a later input's
  // operations resolvable in the merged document.
  it('merges differently-named schemes from every input', () => {
    const first = toOAS({}, { securitySchemes: { apiKey: { type: 'apiKey', name: 'key', in: 'header' } } });
    const second = toOAS({}, { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } });

    const result = expectSuccess(merge(toMergeInputs([first, second])));

    expect(Object.keys(result.components?.securitySchemes ?? {}).sort()).toEqual(['apiKey', 'basic']);
  });

  it('falls through to a later input when the first declares none', () => {
    const first = toOAS({}, { schemas: { A: { type: 'string' } } });
    const second = toOAS({}, { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } });

    const result = expectSuccess(merge(toMergeInputs([first, second])));

    expect(Object.keys(result.components?.securitySchemes ?? {})).toEqual(['basic']);
  });

  it('ignores an empty securitySchemes object', () => {
    const first = toOAS({}, { securitySchemes: {} });
    const second = toOAS({}, { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } });

    const result = expectSuccess(merge(toMergeInputs([first, second])));

    expect(Object.keys(result.components?.securitySchemes ?? {})).toEqual(['basic']);
  });
});

describe('3.1 - jsonSchemaDialect', () => {
  it('carries the dialect through', () => {
    const dialect = 'https://spec.openapis.org/oas/3.1/dialect/base';
    const output = expectSuccess(merge([{ oas: doc31({ jsonSchemaDialect: dialect, paths: {} }) }]));

    expect(output.jsonSchemaDialect).toBe(dialect);
  });

  it('takes the first dialect when inputs disagree', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ jsonSchemaDialect: 'https://example.com/first', paths: {} }) },
      { oas: doc31({ jsonSchemaDialect: 'https://example.com/second', paths: {} }) },
    ]));

    expect(output.jsonSchemaDialect).toBe('https://example.com/first');
  });

  it('omits the dialect when no input declares one', () => {
    const output = expectSuccess(merge([{ oas: doc31({ paths: {} }) }]));

    expect(output.jsonSchemaDialect).toBeUndefined();
  });
});

describe('3.2 - $self', () => {
  it('keeps $self when there is exactly one input', () => {
    const output = expectSuccess(merge([{ oas: doc32({
      $self: 'https://example.com/api',
      paths: { '/a': { get: op('getA') } },
    }) }]));

    expect(output.$self).toBe('https://example.com/api');
  });

  it('drops $self when merging more than one input', () => {
    // A merged document is not any of its inputs, and $self participates in
    // reference resolution, so carrying one forward would be actively wrong.
    const output = expectSuccess(merge([
      { oas: doc32({ $self: 'https://example.com/first', paths: { '/a': { get: op('getA') } } }) },
      { oas: doc32({ $self: 'https://example.com/second', paths: { '/b': { get: op('getB') } } }) },
    ]));

    expect(output.$self).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain('$self');
  });
});

describe('3.2 - additive fields pass through', () => {
  it('carries tag summary, parent and kind', () => {
    const output = expectSuccess(merge([{ oas: doc32({
      tags: [{ name: 'admin', summary: 'Admin', parent: 'root', kind: 'nav' }],
      paths: { '/a': { get: op('getA') } },
    }) }]));

    expect(output.tags?.[0]).toEqual({ name: 'admin', summary: 'Admin', parent: 'root', kind: 'nav' });
  });

  it('carries discriminator defaultMapping and itemSchema', () => {
    const output = expectSuccess(merge([{ oas: doc32({
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
    const output = expectSuccess(merge([{ oas: doc32({
      paths: { '/search': { query: {
        ...op('searchQ'),
        parameters: [{ name: 'filter', in: 'querystring', schema: { type: 'string' } }],
      } } },
    } as Partial<OpenApiDocument>) }]));

    const params = output.paths?.['/search'].query?.parameters as Array<Record<string, unknown>>;
    expect(params[0].in).toBe('querystring');
  });

  it('carries an OAuth2 device authorization flow', () => {
    const output = expectSuccess(merge([{ oas: doc32({
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

describe('3.0 edge: document-level fields are first-wins', () => {
  it('takes security, servers and externalDocs from the first input that declares each', () => {
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/a': { get: op('a') } }, servers: [{ url: 'https://first' }] }) },
      { oas: doc30({
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
      { oas: doc30({ paths: { '/a': { get: op('a') } }, tags: [{ name: 'shared', description: 'first' }] }) },
      { oas: doc30({ paths: { '/b': { get: op('b') } }, tags: [{ name: 'shared', description: 'second' }] }) },
    ]));

    expect(output.tags).toEqual([{ name: 'shared', description: 'first' }]);
  });
});

describe('3.1 edge: jsonSchemaDialect', () => {
  it('takes the first declared dialect and ignores later disagreement', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ jsonSchemaDialect: 'https://example.com/a', paths: { '/a': { get: op('a') } } }) },
      { oas: doc31({ jsonSchemaDialect: 'https://example.com/b', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.jsonSchemaDialect).toBe('https://example.com/a');
  });

  it('picks up a dialect declared only by a later input', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ paths: { '/a': { get: op('a') } } }) },
      { oas: doc31({ jsonSchemaDialect: 'https://example.com/b', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.jsonSchemaDialect).toBe('https://example.com/b');
  });
});

describe('3.2 edge: $self', () => {
  it('keeps $self for a single input', () => {
    const output = expectSuccess(merge([
      { oas: doc32({ $self: 'https://example.com/a', paths: { '/a': { get: op('a') } } }) },
    ]));

    expect(output.$self).toBe('https://example.com/a');
  });

  it('drops $self when two inputs both declare one', () => {
    const output = expectSuccess(merge([
      { oas: doc32({ $self: 'https://example.com/a', paths: { '/a': { get: op('a') } } }) },
      { oas: doc32({ $self: 'https://example.com/b', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.$self).toBeUndefined();
  });

  it('drops $self even when only one of several inputs declares it', () => {
    // The merged document is still not that input, so inheriting its identity
    // would be wrong regardless of how many others stayed silent.
    const output = expectSuccess(merge([
      { oas: doc32({ paths: { '/a': { get: op('a') } } }) },
      { oas: doc32({ $self: 'https://example.com/b', paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.$self).toBeUndefined();
  });
});

describe('3.2 edge: tags', () => {
  it('carries summary, parent and kind on a single tag', () => {
    const output = expectSuccess(merge([{ oas: doc32({
      tags: [{ name: 'admin', summary: 'Admin APIs', parent: 'root', kind: 'nav' }],
      paths: { '/a': { get: op('a') } },
    }) }]));

    expect(output.tags).toEqual([{ name: 'admin', summary: 'Admin APIs', parent: 'root', kind: 'nav' }]);
  });

  it('keeps the first definition when two inputs declare the same tag name differently', () => {
    // Tag names must be unique, so one definition has to win; the 3.2 fields do
    // not change that, and the second input's parent is discarded with it.
    const output = expectSuccess(merge([
      { oas: doc32({ tags: [{ name: 'shared', kind: 'nav' }], paths: { '/a': { get: op('a') } } }) },
      { oas: doc32({ tags: [{ name: 'shared', kind: 'badge', parent: 'other' }], paths: { '/b': { get: op('b') } } }) },
    ]));

    expect(output.tags).toEqual([{ name: 'shared', kind: 'nav' }]);
  });

  it('KNOWN LIMITATION: a tag parent may be left dangling', () => {
    // Input 1's tag declares parent 'group', but only input 1 defined 'group'
    // and excludeTags removes it. Nothing validates that a parent still exists,
    // so the surviving tag points at a tag that is no longer present.
    const output = expectSuccess(merge([{
      oas: doc32({
        tags: [{ name: 'group', kind: 'nav' }, { name: 'child', parent: 'group' }],
        paths: { '/a': { get: tagged('a', ['group']) } },
      }),
      operationSelection: { excludeTags: ['group'] },
    }]));

    const names = (output.tags ?? []).map(t => t.name);
    expect(names).not.toContain('group');
    expect((output.tags ?? []).find(t => t.name === 'child')?.parent).toBe('group');
  });
});

describe('3.2 edge: additive fields pass through', () => {
  it('carries discriminator defaultMapping', () => {
    const output = expectSuccess(merge([{ oas: doc32({
      paths: { '/a': { get: op('a') } },
      components: { schemas: {
        Pet: schema({
          oneOf: [{ $ref: '#/components/schemas/Dog' }],
          discriminator: { propertyName: 'k', defaultMapping: '#/components/schemas/Dog' },
        }),
        Dog: schema({ type: 'object' }),
      } },
    }) }]));

    expect(at(output.components?.schemas?.Pet, 'discriminator', 'defaultMapping'))
      .toBe('#/components/schemas/Dog');
  });

  it('KNOWN GAP: discriminator defaultMapping is not rewritten on rename', () => {
    // Same class of gap as the `mapping` field (issues #99/#106): the oneOf
    // reference follows the rename, the discriminator pointer does not.
    const output = expectSuccess(merge([
      { oas: doc32({ paths: { '/a': { get: op('a') } }, components: { schemas: { Dog: schema({ type: 'string' }) } } }) },
      { oas: doc32({
        paths: { '/b': { get: op('b') } },
        components: { schemas: {
          Dog: schema({ type: 'object' }),
          Pet: schema({
            oneOf: [{ $ref: '#/components/schemas/Dog' }],
            discriminator: { propertyName: 'k', defaultMapping: '#/components/schemas/Dog' },
          }),
        } },
      }) },
    ]));

    expect(at(output.components?.schemas?.Pet, 'oneOf', '0', '$ref')).toBe('#/components/schemas/Dog1');
    expect(at(output.components?.schemas?.Pet, 'discriminator', 'defaultMapping'))
      .toBe('#/components/schemas/Dog');
  });

  it('carries itemSchema for sequential media types', () => {
    const output = expectSuccess(merge([{ oas: doc32({
      paths: { '/stream': { get: op('s') } },
      components: { schemas: { Stream: schema({ itemSchema: { type: 'string' } }) } },
    }) }]));

    expect(at(output.components?.schemas?.Stream, 'itemSchema')).toEqual({ type: 'string' });
  });

  it('carries an in: querystring parameter', () => {
    const output = expectSuccess(merge([{ oas: doc32({ paths: { '/a': { get: {
      operationId: 'a',
      responses: ok,
      parameters: [{ name: 'f', in: 'querystring', schema: schema({ type: 'string' }) }],
    } } } } as Partial<OpenApiDocument>) }]));

    expect(at(pathItem(output, '/a'), 'get', 'parameters', '0', 'in')).toBe('querystring');
  });

  it('carries a server name', () => {
    const output = expectSuccess(merge([{ oas: doc32({
      servers: [{ url: 'https://api.example.com', name: 'production' }],
      paths: { '/a': { get: op('a') } },
    } as Partial<OpenApiDocument>) }]));

    expect(at(output.servers, '0', 'name')).toBe('production');
  });
});

/**
 * Issue #4: the top-level `servers` array is first-wins by default, but can be
 * concatenated across inputs.
 *
 * The default is not an accident to be corrected -- it is the API-gateway case
 * the tool was built for, where a backend's own URLs must not leak into the
 * published document. `'concat'` exists for the other audience: someone merging
 * microservice specs who wants every server documented.
 */
describe('servers strategy (issue #4)', () => {
  const twoInputsWithServers = () => [
    {
      oas: doc30({
        paths: { '/a': { get: op('a') } },
        servers: [{ url: 'https://first.example.com', description: 'first' }],
      }),
    },
    {
      oas: doc30({
        paths: { '/b': { get: op('b') } },
        servers: [{ url: 'https://second.example.com' }],
      }),
    },
  ];

  it('defaults to first-wins when no options are passed at all', () => {
    const output = expectSuccess(merge(twoInputsWithServers()));

    expect(output.servers).toEqual([{ url: 'https://first.example.com', description: 'first' }]);
  });

  it("defaults to first-wins when options are passed but serversStrategy is not", () => {
    const output = expectSuccess(merge(twoInputsWithServers(), {}));

    expect(output.servers).toEqual([{ url: 'https://first.example.com', description: 'first' }]);
  });

  it("concatenates every input's servers in input order under 'concat'", () => {
    const output = expectSuccess(merge(twoInputsWithServers(), { serversStrategy: 'concat' }));

    expect(output.servers?.map(s => s.url)).toEqual([
      'https://first.example.com',
      'https://second.example.com',
    ]);
  });

  it('deduplicates by url, keeping the first occurrence and its description', () => {
    const output = expectSuccess(
      merge(
        [
          { oas: doc30({ paths: { '/a': { get: op('a') } }, servers: [{ url: 'https://same', description: 'kept' }] }) },
          { oas: doc30({ paths: { '/b': { get: op('b') } }, servers: [{ url: 'https://same', description: 'dropped' }] }) },
        ],
        { serversStrategy: 'concat' },
      ),
    );

    expect(output.servers).toEqual([{ url: 'https://same', description: 'kept' }]);
  });

  it('skips inputs with no servers, and inputs with an empty array', () => {
    const output = expectSuccess(
      merge(
        [
          { oas: doc30({ paths: { '/a': { get: op('a') } } }) },
          { oas: doc30({ paths: { '/b': { get: op('b') } }, servers: [] }) },
          { oas: doc30({ paths: { '/c': { get: op('c') } }, servers: [{ url: 'https://only' }] }) },
        ],
        { serversStrategy: 'concat' },
      ),
    );

    expect(output.servers).toEqual([{ url: 'https://only' }]);
  });

  it('omits servers entirely when no input declares any, rather than emitting []', () => {
    const output = expectSuccess(
      merge([{ oas: doc30({ paths: { '/a': { get: op('a') } } }) }], { serversStrategy: 'concat' }),
    );

    expect(output.servers).toBeUndefined();
  });

  it('preserves 3.2 server fields such as `name` through concatenation', () => {
    const output = expectSuccess(
      merge(
        [
          { oas: doc32({ paths: { '/a': { get: op('a') } }, servers: [{ url: 'https://a', name: 'production' }] }) },
          { oas: doc32({ paths: { '/b': { get: op('b') } }, servers: [{ url: 'https://b', name: 'staging' }] }) },
        ],
        { serversStrategy: 'concat' },
      ),
    );

    expect(output.servers?.map(s => at(s, 'name'))).toEqual(['production', 'staging']);
  });

  it('does not mutate the inputs it concatenates', () => {
    const inputs = twoInputsWithServers();
    merge(inputs, { serversStrategy: 'concat' });

    expect(inputs[0].oas.servers).toEqual([{ url: 'https://first.example.com', description: 'first' }]);
    expect(inputs[1].oas.servers).toEqual([{ url: 'https://second.example.com' }]);
  });
});

/**
 * Issue #60: `x-tagGroups` concatenates across inputs.
 *
 * Every other `x-` extension stays first-wins because its semantics are opaque
 * -- concatenating a vendor extension this library does not understand could
 * corrupt it. `x-tagGroups` is the exception: its shape is fixed
 * (`{ name, tags }`), widely relied on by ReDoc, and concatenation loses
 * nothing.
 *
 * The inconsistency this fixes: tags from later inputs were already merged into
 * the top-level `tags` array while their groups were dropped, so a ReDoc
 * sidebar lost the structure for tags that were present in the document.
 */
describe('x-tagGroups (issue #60)', () => {
  const withGroups = (pathName: string, groups: unknown) => ({
    oas: {
      ...doc30({ paths: { [pathName]: { get: op(pathName.slice(1)) } } }),
      'x-tagGroups': groups,
    } as OpenApiDocument,
  });

  it('concatenates groups from every input', () => {
    const output = expectSuccess(
      merge([
        withGroups('/a', [{ name: 'User', tags: ['get-user'] }]),
        withGroups('/b', [{ name: 'Admin', tags: ['admin-only'] }]),
      ]),
    );

    expect(at(output, 'x-tagGroups')).toEqual([
      { name: 'User', tags: ['get-user'] },
      { name: 'Admin', tags: ['admin-only'] },
    ]);
  });

  it('combines the tags of groups that share a name', () => {
    const output = expectSuccess(
      merge([
        withGroups('/a', [{ name: 'User', tags: ['get-user', 'put-user'] }]),
        withGroups('/b', [{ name: 'User', tags: ['delete-user'] }]),
      ]),
    );

    expect(at(output, 'x-tagGroups')).toEqual([
      { name: 'User', tags: ['get-user', 'put-user', 'delete-user'] },
    ]);
  });

  it('deduplicates a tag listed by two inputs under the same group', () => {
    const output = expectSuccess(
      merge([
        withGroups('/a', [{ name: 'User', tags: ['shared', 'a-only'] }]),
        withGroups('/b', [{ name: 'User', tags: ['shared', 'b-only'] }]),
      ]),
    );

    expect(at(output, 'x-tagGroups')).toEqual([
      { name: 'User', tags: ['shared', 'a-only', 'b-only'] },
    ]);
  });

  it('keeps the order in which groups were first seen', () => {
    const output = expectSuccess(
      merge([
        withGroups('/a', [{ name: 'Second', tags: ['x'] }]),
        withGroups('/b', [{ name: 'First', tags: ['y'] }, { name: 'Second', tags: ['z'] }]),
      ]),
    );

    expect((at(output, 'x-tagGroups') as Array<{ name: string }>).map(g => g.name)).toEqual(['Second', 'First']);
  });

  it('drops a group that ends up with no tags', () => {
    const output = expectSuccess(merge([withGroups('/a', [{ name: 'Empty', tags: [] }])]));

    // An empty group renders as an empty heading in the ReDoc sidebar.
    expect(at(output, 'x-tagGroups')).toBeUndefined();
  });

  it('leaves other x- extensions first-wins', () => {
    const output = expectSuccess(
      merge([
        { oas: { ...doc30({ paths: { '/a': { get: op('a') } } }), 'x-vendor': { a: 1 } } as OpenApiDocument },
        { oas: { ...doc30({ paths: { '/b': { get: op('b') } } }), 'x-vendor': { b: 2 } } as OpenApiDocument },
      ]),
    );

    expect(at(output, 'x-vendor')).toEqual({ a: 1 });
  });

  it('does not touch x-tagGroups of an unrecognised shape', () => {
    const output = expectSuccess(
      merge([
        { oas: { ...doc30({ paths: { '/a': { get: op('a') } } }), 'x-tagGroups': 'not-an-array' } as OpenApiDocument },
        withGroups('/b', [{ name: 'User', tags: ['x'] }]),
      ]),
    );

    // First-wins on something we do not understand beats mangling it.
    expect(at(output, 'x-tagGroups')).toBe('not-an-array');
  });

  it('merges groups sharing a name within a single input', () => {
    const output = expectSuccess(
      merge([withGroups('/a', [{ name: 'User', tags: ['one'] }, { name: 'User', tags: ['two'] }])]),
    );

    expect(at(output, 'x-tagGroups')).toEqual([{ name: 'User', tags: ['one', 'two'] }]);
  });
});
