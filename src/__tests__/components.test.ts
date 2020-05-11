import { merge } from "..";
import { Swagger } from "atlassian-openapi";
import { toOAS } from "./oas-generation";
import { toMergeInputs, expectMergeResult } from "./test-utils";
import { SingleMergeInput } from "../data";

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
            A1: {
              $ref: '#/components/schemas/Example'
            },
            Example: {
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
  });
});