import { merge } from '../index';
import { Swagger } from '@atlassian/atlassian-openapi';
import { SingleMergeInput } from '../data';
import { toOAS } from './_helpers/oas-generation';
import { expectMergeResult, toMergeInputs } from './_helpers/test-utils';
import { doc30, doc31, expectSuccess, ok, op, schemaKeys } from './_helpers/documents';

/**
 * Components: deduplication, disputes, and renaming.
 *
 * When two inputs define a component under the same name the merge must decide
 * whether they are the same thing. Identical definitions collapse into one;
 * different ones are renamed, preferring the input's configured dispute prefix
 * or suffix and falling back to a numeric suffix.
 *
 * Every component type goes through the same machinery, including `pathItems`
 * which 3.1 added -- a rename bug in any one of them would otherwise go
 * unnoticed.
 */

/** A fresh copy per input: merge mutates its inputs, so sharing one would not prove deduplication. */
function clone<A>(value: A): A {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Assert that a component present under the same name in both inputs, with
 * different definitions, is renamed rather than dropped or overwritten.
 */
function expectRenamedTo1<A>(
  first: Swagger.Components,
  second: Swagger.Components,
  pick: (c: Swagger.Components) => { [key: string]: A } | undefined,
): void {
  const output = expectSuccess(merge(toMergeInputs([toOAS({}, first), toOAS({}, second)])));

  const merged = pick(output.components ?? {});
  expect(Object.keys(merged ?? {}).sort()).toEqual(['Thing', 'Thing1']);
}

describe('OAS Component conflict', () => {
  describe('deduplication of non-reference examples', () => {
    it('should deduplicate different components with the same name over multiple files', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          Example: {
            type: 'number'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          Example: {
            type: 'string'
          }
        }
      });

      const result = merge(toMergeInputs([first, second]));
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            Example: {
              type: 'number'
            },
            Example1: {
              type: 'string'
            }
          }
        })
      });
    });

    it('should deduplicate different components with the same name over multiple files', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          Example: {
            type: 'number'
          },
          Example1: {
            type: 'string'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          Example: {
            type: 'boolean'
          }
        }
      });

      const result = merge(toMergeInputs([first, second]));
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            Example: {
              type: 'number'
            },
            Example1: {
              type: 'string'
            },
            Example2: {
              type: 'boolean'
            }
          }
        })
      });
    });

    it('does not harmonise the same component with the same name over multiple files', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          Example: {
            type: 'number'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          Example: {
            type: 'number'
          }
        }
      });

      const result = merge(toMergeInputs([first, second]));
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            Example: {
              type: 'number'
            }
          }
        })
      });
    });
  });

  describe('reference updating', () => {
    it('should update references to a component that was moved', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          Example: {
            type: 'number'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const result = merge(toMergeInputs([first, second]));
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            Example: {
              type: 'number'
            },
            A: {
              $ref: '#/components/schemas/Example1'
            },
            Example1: {
              type: 'string'
            }
          }
        })
      });
    });

    it('should update multiple nested references that moved', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const result = merge(toMergeInputs([first, second]));
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            A: {
              $ref: '#/components/schemas/Example'
            },
            Example: {
              type: 'string'
            }
          }
        })
      });
    });

    it('should update multiple nested references that moved with different root types', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'number'
          }
        }
      });

      const result = merge(toMergeInputs([first, second]));
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            A: {
              $ref: '#/components/schemas/Example'
            },
            A1: {
              $ref: '#/components/schemas/Example1'
            },
            Example: {
              type: 'string'
            },
            Example1: {
              type: 'number'
            }
          }
        })
      });
    });

    it('should update multiple nested references that moved (with prefix)', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'number'
          }
        }
      });

      const firstInput: SingleMergeInput = {
        oas: first,
        disputePrefix: 'First'
      };

      const secondInput: SingleMergeInput = {
        oas: second,
        disputePrefix: 'Second'
      };

      const result = merge([firstInput, secondInput]);
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            A: {
              $ref: '#/components/schemas/Example'
            },
            SecondA: {
              $ref: '#/components/schemas/SecondExample'
            },
            Example: {
              type: 'string'
            },
            SecondExample: {
              type: 'number'
            }
          }
        })
      });
    });

    it('should support a dispute suffix', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'number'
          }
        }
      });

      const firstInput: SingleMergeInput = {
        oas: first,
        dispute: {
          suffix: 'First'
        }
      };

      const secondInput: SingleMergeInput = {
        oas: second,
        dispute: {
          suffix: 'Second'
        }
      };

      const result = merge([firstInput, secondInput]);
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            A: {
              $ref: '#/components/schemas/Example'
            },
            ASecond: {
              $ref: '#/components/schemas/ExampleSecond'
            },
            Example: {
              type: 'string'
            },
            ExampleSecond: {
              type: 'number'
            }
          }
        })
      });
    });

    it('if first disputePrefix is always required then the second should miss', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'number'
          }
        }
      });

      const firstInput: SingleMergeInput = {
        oas: first,
        dispute: {
          prefix: 'First',
          alwaysApply: true
        }
      };

      const secondInput: SingleMergeInput = {
        oas: second,
        disputePrefix: 'Second'
      };

      const result = merge([firstInput, secondInput]);
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            FirstA: {
              $ref: '#/components/schemas/FirstExample'
            },
            A: {
              $ref: '#/components/schemas/Example'
            },
            FirstExample: {
              type: 'string'
            },
            Example: {
              type: 'number'
            }
          }
        })
      });
    });

    it('should support suffixes and prefixes on different elements', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'number'
          }
        }
      });

      const firstInput: SingleMergeInput = {
        oas: first,
        dispute: {
          prefix: 'First',
          alwaysApply: true
        }
      };

      const secondInput: SingleMergeInput = {
        oas: second,
        dispute: {
          suffix: 'Second',
          alwaysApply: true
        }
      };

      const result = merge([firstInput, secondInput]);
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            FirstA: {
              $ref: '#/components/schemas/FirstExample'
            },
            ASecond: {
              $ref: '#/components/schemas/ExampleSecond'
            },
            FirstExample: {
              type: 'string'
            },
            ExampleSecond: {
              type: 'number'
            }
          }
        })
      });
    });

    it('alwaysApply should break deduplication on identical elements', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            $ref: '#/components/schemas/Example'
          },
          Example: {
            type: 'string'
          }
        }
      });

      const firstInput: SingleMergeInput = {
        oas: first,
        dispute: {
          prefix: 'First',
          alwaysApply: true
        }
      };

      const secondInput: SingleMergeInput = {
        oas: second,
        dispute: {
          prefix: 'Second'
        }
      };

      const result = merge([firstInput, secondInput]);
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            FirstA: {
              $ref: '#/components/schemas/FirstExample'
            },
            A: {
              $ref: '#/components/schemas/Example'
            },
            FirstExample: {
              type: 'string'
            },
            Example: {
              type: 'string'
            }
          }
        })
      });
    });

    it('should keep objects separate that are separate and reuse where possible', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            properties: {
              "x": {
                $ref: "#/components/schemas/X"
              },
              "y": {
                $ref: "#/components/schemas/Y"
              }
            }
          },
          X: {
            type: 'string'
          },
          Y: {
            type: 'number'
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            properties: {
              "x": {
                $ref: "#/components/schemas/X"
              },
              "y": {
                $ref: "#/components/schemas/Y"
              }
            }
          },
          X: {
            type: 'string'
          },
          Y: {
            type: 'boolean'
          }
        }
      });

      const result = merge(toMergeInputs([first, second]));
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            A: {
              properties: {
                "x": {
                  $ref: "#/components/schemas/X"
                },
                "y": {
                  $ref: "#/components/schemas/Y"
                }
              }
            },
            A1: {
              properties: {
                "x": {
                  $ref: "#/components/schemas/X"
                },
                "y": {
                  $ref: "#/components/schemas/Y1"
                }
              }
            },
            X: {
              type: 'string'
            },
            Y: {
              type: 'number'
            },
            Y1: {
              type: 'boolean'
            }
          }
        })
      });
    });

    it('should spot cycles in the chain but merge if they are still equivalent', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            properties: {
              "x": {
                $ref: "#/components/schemas/X"
              },
              "y": {
                $ref: "#/components/schemas/Y"
              }
            }
          },
          X: {
            type: 'string'
          },
          Y: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/A'
            }
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            properties: {
              "x": {
                $ref: "#/components/schemas/X"
              },
              "y": {
                $ref: "#/components/schemas/Y"
              }
            }
          },
          X: {
            type: 'string'
          },
          Y: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/A'
            }
          }
        }
      });

      const result = merge(toMergeInputs([first, second]));
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            A: {
              properties: {
                "x": {
                  $ref: "#/components/schemas/X"
                },
                "y": {
                  $ref: "#/components/schemas/Y"
                }
              }
            },
            X: {
              type: 'string'
            },
            Y: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/A'
              }
            }
          }
        })
      });
    });

    it('should spot cycles in the chain but not merge if they are not still equivalent', () => {
      const first: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            properties: {
              "x": {
                $ref: "#/components/schemas/X"
              },
              "y": {
                $ref: "#/components/schemas/Y"
              }
            }
          },
          X: {
            type: 'string'
          },
          Y: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/A'
            }
          }
        }
      });

      const second: Swagger.SwaggerV3 = toOAS({}, {
        schemas: {
          A: {
            properties: {
              "x": {
                $ref: "#/components/schemas/X"
              },
              "y": {
                $ref: "#/components/schemas/Y"
              }
            }
          },
          X: {
            type: 'string'
          },
          Y: {
            items: {
              $ref: '#/components/schemas/A'
            }
          }
        }
      });

      const result = merge(toMergeInputs([first, second]));
      expectMergeResult(result, {
        output: toOAS({}, {
          schemas: {
            A: {
              properties: {
                "x": {
                  $ref: "#/components/schemas/X"
                },
                "y": {
                  $ref: "#/components/schemas/Y"
                }
              }
            },
            A1: {
              properties: {
                "x": {
                  $ref: "#/components/schemas/X"
                },
                "y": {
                  $ref: "#/components/schemas/Y1"
                }
              }
            },
            X: {
              type: 'string'
            },
            Y: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/A'
              }
            },
            Y1: {
              items: {
                $ref: '#/components/schemas/A1'
              }
            }
          }
        })
      });
    });
  });
});

describe('component deduplication by component type', () => {
  it('deduplicates responses', () => {
    expectRenamedTo1<Swagger.Response | Swagger.Reference>(
      { responses: { Thing: { description: 'first' } } },
      { responses: { Thing: { description: 'second' } } },
      c => c.responses,
    );
  });

  it('deduplicates parameters', () => {
    expectRenamedTo1<Swagger.Parameter | Swagger.Reference>(
      { parameters: { Thing: { name: 'a', in: 'query', schema: { type: 'string' } } } },
      { parameters: { Thing: { name: 'b', in: 'query', schema: { type: 'number' } } } },
      c => c.parameters,
    );
  });

  it('deduplicates examples', () => {
    expectRenamedTo1<Swagger.Example | Swagger.Reference>(
      { examples: { Thing: { summary: 'first' } } },
      { examples: { Thing: { summary: 'second' } } },
      c => c.examples,
    );
  });

  it('deduplicates requestBodies', () => {
    expectRenamedTo1<Swagger.RequestBody | Swagger.Reference>(
      { requestBodies: { Thing: { content: { 'application/json': { schema: { type: 'string' } } } } } },
      { requestBodies: { Thing: { content: { 'application/json': { schema: { type: 'number' } } } } } },
      c => c.requestBodies,
    );
  });

  it('deduplicates headers', () => {
    expectRenamedTo1<Swagger.Header | Swagger.Reference>(
      { headers: { Thing: { schema: { type: 'string' } } } },
      { headers: { Thing: { schema: { type: 'number' } } } },
      c => c.headers,
    );
  });

  it('deduplicates links', () => {
    expectRenamedTo1<Swagger.Link | Swagger.Reference>(
      { links: { Thing: { operationId: 'first' } } },
      { links: { Thing: { operationId: 'second' } } },
      c => c.links,
    );
  });

  it('deduplicates callbacks', () => {
    expectRenamedTo1<Swagger.Callback | Swagger.Reference>(
      { callbacks: { Thing: { '/first': { get: { responses: { '200': { description: 'ok' } } } } } } },
      { callbacks: { Thing: { '/second': { get: { responses: { '200': { description: 'ok' } } } } } } },
      c => c.callbacks,
    );
  });

  it('keeps identical components from two inputs as a single definition', () => {
    const shared: Swagger.Components = { headers: { Thing: { schema: { type: 'string' } } } };

    const result = merge(toMergeInputs([toOAS({}, shared), toOAS({}, clone(shared))]));

    expectMergeResult(result, { output: toOAS({}, shared) });
  });
});

describe('3.1 - components.pathItems', () => {
  it('carries pathItems through a merge', () => {
    const output = expectSuccess(merge([{ oas: doc31({
      components: { pathItems: { Shared: { get: { operationId: 'shared', responses: ok } } } },
    }) }]));

    expect(Object.keys(output.components?.pathItems ?? {})).toEqual(['Shared']);
  });

  it('deduplicates identical pathItems from two inputs', () => {
    const shared = { Shared: { get: { operationId: 'shared', responses: ok } } };
    const output = expectSuccess(merge([
      { oas: doc31({ components: { pathItems: JSON.parse(JSON.stringify(shared)) } }) },
      { oas: doc31({ components: { pathItems: JSON.parse(JSON.stringify(shared)) } }) },
    ]));

    expect(Object.keys(output.components?.pathItems ?? {})).toEqual(['Shared']);
  });

  it('renames a conflicting pathItem rather than dropping it', () => {
    const output = expectSuccess(merge([
      { oas: doc31({ components: { pathItems: { Shared: { get: { operationId: 'a', responses: ok } } } } }) },
      { oas: doc31({ components: { pathItems: { Shared: { get: { operationId: 'b', responses: ok } } } } }) },
    ]));

    expect(Object.keys(output.components?.pathItems ?? {}).sort()).toEqual(['Shared', 'Shared1']);
  });
});

describe('3.0 edge: component naming rules', () => {
  it('KNOWN GAP: a dispute prefix can produce a component key the spec forbids', () => {
    // Spec, Components Object: keys "MUST use keys that match the regular
    // expression: ^[a-zA-Z0-9\\.\\-_]+$". A prefix containing a space produces
    // "My Service Thing", which does not match, so the output is invalid.
    const output = expectSuccess(merge([
      { oas: doc30({ paths: { '/a': { get: op('a') } }, components: { schemas: { Thing: { type: 'string' } } } }) },
      {
        oas: doc30({ paths: { '/b': { get: op('b') } }, components: { schemas: { Thing: { type: 'number' } } } }),
        dispute: { prefix: 'My Service ' },
      },
    ]));

    const invalid = schemaKeys(output).filter(k => !/^[a-zA-Z0-9.\-_]+$/.test(k));
    expect(invalid).toEqual(['My Service Thing']);
  });

  it('accepts the dot, dash and underscore the key regex allows', () => {
    const output = expectSuccess(merge([
      { oas: doc30({
        paths: { '/a': { get: op('a') } },
        components: { schemas: { 'my.Thing-2_v1': { type: 'string' } } },
      }) },
    ]));

    expect(schemaKeys(output)).toEqual(['my.Thing-2_v1']);
    expect(schemaKeys(output).every(k => /^[a-zA-Z0-9.\-_]+$/.test(k))).toBe(true);
  });

  it('skips a numeric suffix that is already taken', () => {
    // Input 0 defines both Thing and Thing1, so the disputed Thing from input 1
    // cannot become Thing1 and must land on Thing2.
    const output = expectSuccess(merge([
      { oas: doc30({
        paths: { '/a': { get: op('a') } },
        components: { schemas: { Thing: { type: 'string' }, Thing1: { type: 'boolean' } } },
      }) },
      { oas: doc30({
        paths: { '/b': { get: op('b') } },
        components: { schemas: { Thing: { type: 'number' } } },
      }) },
    ]));

    expect(schemaKeys(output)).toEqual(['Thing', 'Thing1', 'Thing2']);
    expect((output.components?.schemas?.Thing2 as { type: string }).type).toBe('number');
  });
});
