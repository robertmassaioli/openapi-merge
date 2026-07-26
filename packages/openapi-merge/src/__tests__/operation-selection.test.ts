import { merge } from '../index';
import { toOAS } from './_helpers/oas-generation';
import { expectMergeResult } from './_helpers/test-utils';
import { doc32, expectSuccess, op } from './_helpers/documents';

/**
 * Operation selection: filtering operations by tag via `includeTags` and
 * `excludeTags`.
 *
 * Exclusion wins over inclusion when both apply. Selection reaches every
 * operation slot -- including `query`, custom verbs, and webhook operations --
 * and excluded tags are also stripped from the document's top-level `tags`.
 */

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

describe('3.2 - tag selection covers the new slots', () => {
  it('excludes a query operation by tag', () => {
    const output = expectSuccess(merge([{
      oas: doc32({ paths: { '/search': {
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
      oas: doc32({ paths: { '/cache': {
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
      oas: doc32({ paths: { '/search': {
        query: { ...op('searchQ'), tags: ['wanted'] },
        get: { ...op('getSearch'), tags: ['unwanted'] },
      } } }),
      operationSelection: { includeTags: ['wanted'] },
    }]));

    expect(output.paths?.['/search'].query).toBeDefined();
    expect(output.paths?.['/search'].get).toBeUndefined();
  });
});
