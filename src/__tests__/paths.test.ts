import { merge } from "..";
import { toOAS } from "./oas-generation";
import { expectMergeResult, toMergeInputs, expectErrorType } from "./test-utils";
import { SingleMergeInput } from "../data";

describe('OAS Path Merge', () => {
  it('should merge paths from two files that do not overlap', () => {
    const first = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const second = toOAS({
      '/path/b': {
        post: {
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      },
      '/path/b': {
        post: {
          responses: {}
        }
      }
    });

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should prefix paths correctly', () => {
    const first = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/service/path/a': {
        get: {
          responses: {}
        }
      }
    });

    expectMergeResult(merge([{ oas: first, pathModification: { prepend: '/service'}}]), {
      output
    });
  });

  it('should strip suffixed correctly', () => {
    const first = toOAS({
      '/rest/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    expectMergeResult(merge([{ oas: first, pathModification: { stripStart: '/rest'}}]), {
      output
    });
  });

  it('should strip first and then prefix paths', () => {
    const first = toOAS({
      '/rest/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const output = toOAS({
      '/service/path/a': {
        get: {
          responses: {}
        }
      }
    });

    expectMergeResult(merge([{ oas: first, pathModification: { stripStart: '/rest', prepend: '/service' }}]), {
      output
    });
  });

  /**
   * TODO this is simpler logic to implement for now but, ideally, we would merge paths together if we could, if
   * the HTTP methods do not overlap. I can see a use case for two different services providing different methods
   * on the same path.
   */
  it('should return an error if there are duplicate paths (simple case)', () => {
    const first = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const second = toOAS({
      '/path/a': {
        post: {
          responses: {}
        }
      }
    });

    expectErrorType(merge(toMergeInputs([first, second])), 'duplicate-paths');
  });

  it('should return an error if modifying a path would result in a duplicate', () => {
    const first = toOAS({
      '/path/a': {
        get: {
          responses: {}
        }
      }
    });

    const second = toOAS({
      '/service/rest/path/a': {
        post: {
          responses: {}
        }
      }
    });

    const firstInput: SingleMergeInput = {
      oas: first,
      pathModification: {
        prepend: '/rest'
      }
    };

    const secondInput: SingleMergeInput = {
      oas: second,
      pathModification: {
        stripStart: '/service'
      }
    };

    expectErrorType(merge([firstInput, secondInput]), 'duplicate-paths');
  });

  describe('Tag Exclusion', () => {
    it('should strip out Path Items with no operations', () => {
      const first = toOAS({
        '/path/a': {
          get: {
            responses: {}
          }
        },
        '/path/b': {
          servers: []
        },
        '/path/emptyTags': {
          delete: {
            tags: [],
            responses: {}
          }
        },
        '/path/noTags': {
          head: {
            responses: {}
          }
        }
      });

      const second = toOAS({
        '/path/b': {
          get: {
            responses: {}
          }
        }
      });

      const output = toOAS({
        '/path/a': {
          get: {
            responses: {}
          }
        },
        '/path/b': {
          get: {
            responses: {}
          }
        },
        '/path/emptyTags': {
          delete: {
            tags: [],
            responses: {}
          }
        },
        '/path/noTags': {
          head: {
            responses: {}
          }
        }
      });

      expectMergeResult(merge([{ oas: first }, { oas: second }]), {
        output
      });
    });

    it('should remove operations that have been excluded', () => {
      const first = toOAS({
        '/path/a': {
          get: {
            tags: ['included'],
            responses: {}
          }
        },
        '/path/b': {
          servers: []
        },
        '/path/c': {
          get: {
            tags: ['excluded'],
            responses: {}
          }
        },
        '/path/d': {
          get: {
            tags: ['included', 'excluded'],
            responses: {}
          }
        },
        '/path/emptyTags': {
          delete: {
            tags: [],
            responses: {}
          }
        },
        '/path/noTags': {
          head: {
            responses: {}
          }
        }
      });

      const second = toOAS({
        '/path/b': {
          get: {
            responses: {}
          }
        }
      });

      const output = toOAS({
        '/path/a': {
          get: {
            tags: ['included'],
            responses: {}
          }
        },
        '/path/b': {
          get: {
            responses: {}
          }
        },
        '/path/emptyTags': {
          delete: {
            tags: [],
            responses: {}
          }
        },
        '/path/noTags': {
          head: {
            responses: {}
          }
        }
      });

      expectMergeResult(merge([{ oas: first, operationSelection: { excludeTags: ['excluded'] }}, { oas: second }]), {
        output
      });
    });

    it('should include operations that have been included', () => {
      const first = toOAS({
        '/path/a': {
          get: {
            tags: ['included'],
            responses: {}
          }
        },
        '/path/b': {
          servers: []
        },
        '/path/c': {
          get: {
            tags: ['excluded'],
            responses: {}
          }
        },
        '/path/d': {
          get: {
            tags: ['included', 'excluded'],
            responses: {}
          }
        },
        '/path/emptyTags': {
          delete: {
            tags: [],
            responses: {}
          }
        },
        '/path/noTags': {
          head: {
            responses: {}
          }
        }
      });

      const second = toOAS({
        '/path/b': {
          get: {
            responses: {}
          }
        }
      });

      const output = toOAS({
        '/path/a': {
          get: {
            tags: ['included'],
            responses: {}
          }
        },
        '/path/b': {
          get: {
            responses: {}
          }
        },
        '/path/d': {
          get: {
            tags: ['included', 'excluded'],
            responses: {}
          }
        }
      });

      expectMergeResult(merge([{ oas: first, operationSelection: { includeTags: ['included'] }}, { oas: second }]), {
        output
      });
    });

    it('should follow exclusion precidence to inclusion', () => {
      const first = toOAS({
        '/path/a': {
          get: {
            tags: ['included'],
            responses: {}
          }
        },
        '/path/b': {
          servers: []
        },
        '/path/c': {
          get: {
            tags: ['excluded'],
            responses: {}
          }
        },
        '/path/d': {
          get: {
            tags: ['included', 'excluded'],
            responses: {}
          }
        },
        '/path/emptyTags': {
          delete: {
            tags: [],
            responses: {}
          }
        },
        '/path/noTags': {
          head: {
            responses: {}
          }
        }
      });

      const second = toOAS({
        '/path/b': {
          get: {
            responses: {}
          }
        }
      });

      const output = toOAS({
        '/path/a': {
          get: {
            tags: ['included'],
            responses: {}
          }
        },
        '/path/b': {
          get: {
            responses: {}
          }
        }
      });

      expectMergeResult(merge([{ oas: first, operationSelection: { includeTags: ['included'], excludeTags: ['excluded'] }}, { oas: second }]), {
        output
      });
    });

    it('should filter top level tags definitions', () => {
      const first = toOAS({
        '/path/a': {
          get: {
            tags: ['included'],
            responses: {}
          }
        },
        '/path/b': {
          servers: []
        },
        '/path/c': {
          get: {
            tags: ['excluded'],
            responses: {}
          }
        },
        '/path/d': {
          get: {
            tags: ['included', 'excluded'],
            responses: {}
          }
        }
      });

      first.tags = [{
        name: 'included',
        description: 'This tag is included'
      }, {
        name: 'excluded',
        description: 'This tag is excluded'
      }, {
        name: 'unused',
        description: 'This tag is not used'
      }];

      const second = toOAS({
        '/path/b': {
          get: {
            responses: {}
          }
        }
      });

      const output = toOAS({
        '/path/a': {
          get: {
            tags: ['included'],
            responses: {}
          }
        },
        '/path/b': {
          get: {
            responses: {}
          }
        }
      });

      output.tags = [{
        name: 'included',
        description: 'This tag is included'
      }, {
        name: 'unused',
        description: 'This tag is not used'
      }];

      expectMergeResult(merge([{ oas: first, operationSelection: { excludeTags: ['excluded'] } }, { oas: second }]), {
        output
      });
    });
  });
});