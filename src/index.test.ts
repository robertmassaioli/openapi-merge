import 'jest';
import { merge } from '.';
import { MergeResult, isErrorResult, ErrorType, MergeInput, SingleMergeInput } from './data';
import { Swagger } from 'atlassian-openapi';

function toOAS(paths: Swagger.Paths, components?: Swagger.Components): Swagger.SwaggerV3 {
  return {
    openapi: '3.0.2',
    info: {
      title: 'Generated Swagger Template',
      version: '1.2.3'
    },
    paths,
    components
  }
}

describe('merge', () => {
  function expectErrorType(result: MergeResult, type: ErrorType): void {
    if (isErrorResult(result)) {
      expect(result.type).toEqual(type);
    } else {
      fail(`Expected an error, but instead got: ${JSON.stringify(result, null, 2)}`);
    }
  }

  function expectMergeResult(actual: MergeResult, expected: MergeResult): void {
    if(isErrorResult(actual)) {
      fail(`We expected to have a successful merge and instead got: ${JSON.stringify(actual, null, 2)}`);
    }

    expect(actual).toEqual(expected);
  }

  function toMergeInputs(oass: Swagger.SwaggerV3[]): MergeInput {
    return oass.map<SingleMergeInput>(oas => ({ oas }));
  }

  describe('simple cases', () => {
    it('should return an error if no inputs are provided', () => {
      expectErrorType(merge([]), 'no-inputs');
    });

    it('should result in a no-op on a simple swagger file', () => {
      expectMergeResult(merge(toMergeInputs([toOAS({})])), { output: toOAS({}) });
    });
  });

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
  });

  describe('OAS Security', () => {
    // TODO
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

  describe('OAS Component conflict', () => {
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

    /**
     * Ideally we would harmonise the same component with the same name and the exact same structure over multiple
     * files. However, there are some rules we would need to apply, the objects would need to be deep equals of
     * eachother, including all of their references. This may be difficult to guarantee 100%. It is far safer and faster
     * to just treat them as objects that can't be merged together.
     */
    it('does not (yet) harmonise the same component with the same name over multiple files', () => {
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
            },
            Example1: {
              type: 'number'
            }
          }
        })
      });
    });
  });
});