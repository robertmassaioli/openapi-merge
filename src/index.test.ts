import 'jest';
import { merge } from '.';
import { MergeResult, isErrorResult, ErrorType } from './data';
import { Swagger } from 'atlassian-openapi';

describe('merge', () => {
  function expectErrorType(result: MergeResult, type: ErrorType): void {
    if (isErrorResult(result)) {
      expect(result.type).toEqual(type);
    } else {
      fail(`Expected an error, but instead got: ${JSON.stringify(result, null, 2)}`);
    }
  }

  describe('simple cases', () => {
    it('should return an error if no inputs are provided', () => {
      expectErrorType(merge([]), 'no-inputs');
    });

    it('should result in a no-op on a simple swagger file', () => {

    });
  });

  describe('OAS Info', () => {

  });

  describe('OAS Security', () => {

  });

  describe('OAS External Docs', () => {

  });

  describe('component conflict', () => {
    function toOAS(paths: Swagger.Paths, components: Swagger.Components | undefined): Swagger.SwaggerV3 {
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

      const result = merge([{ oas: first }, { oas: second }]);

      if(isErrorResult(result)) {
        fail(`We expected to have a successful merge and instead got: ${JSON.stringify(result, null, 2)}`);
      }

      expect(result).toEqual({
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

    it('should harmonise the same component with the same name over multiple files', () => {

    });
  });
});