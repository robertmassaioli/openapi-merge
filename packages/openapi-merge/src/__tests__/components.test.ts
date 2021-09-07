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