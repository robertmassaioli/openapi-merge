import { merge } from '../index';
import { toOAS } from './_helpers/oas-generation';
import { expectMergeResult } from './_helpers/test-utils';
import { doc30, doc32, expectSuccess, op, pathKeys, tagged } from './_helpers/documents';

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

/**
 * Issue #100: selecting only the operations carrying a given tag.
 *
 * The reported need was already met by `includeTags`; the proposal for this
 * issue concluded there were no code-level gaps, only documentation ones, and
 * a probe against the current code confirmed it.
 *
 * So these tests exist to pin the semantics the README now states. Every
 * assertion here corresponds to a sentence in
 * `packages/openapi-merge-cli/README.md`, so the documentation cannot quietly
 * drift away from the behaviour -- which is the actual risk for a feature whose
 * problem was that nobody could tell what it did.
 */
describe('tag-based path selection, as documented (issue #100)', () => {
  const service = (name: string, tag: string) =>
    doc30({
      paths: {
        [`/${name}/owned`]: { get: tagged(`${name}Owned`, [tag]) },
        [`/${name}/other`]: { get: tagged(`${name}Other`, ['Shared']) },
      },
    });

  it('takes only the operations carrying each service tag', () => {
    const output = expectSuccess(
      merge([
        { oas: service('one', 'Service1'), operationSelection: { includeTags: ['Service1'] } },
        { oas: service('two', 'Service2'), operationSelection: { includeTags: ['Service2'] } },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/one/owned', '/two/owned']);
  });

  it('filters per operation, keeping a path whose other method survives', () => {
    // README: "if GET /thing carries the tag and POST /thing does not, the
    // merged document contains /thing with only its GET".
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/thing': { get: tagged('getThing', ['Wanted']), post: tagged('postThing', ['Unwanted']) },
            },
          }),
          operationSelection: { includeTags: ['Wanted'] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/thing']);
    expect(Object.keys(output.paths?.['/thing'] ?? {})).toEqual(['get']);
  });

  it('drops a path whose operations are all filtered out', () => {
    // README: "A path whose operations are all filtered out is dropped
    // entirely."
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: { '/keep': { get: tagged('k', ['Wanted']) }, '/drop': { get: tagged('d', ['Unwanted']) } },
          }),
          operationSelection: { includeTags: ['Wanted'] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/keep']);
  });

  it('excludes an operation with no tags at all', () => {
    // README: "includeTags is an allow-list, so an operation with no tags at
    // all does not survive it." This is the behaviour most likely to surprise.
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/tagged': { get: tagged('t', ['Wanted']) }, '/untagged': { get: op('u') } } }),
          operationSelection: { includeTags: ['Wanted'] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/tagged']);
  });

  it('leaves the top-level tags array alone under includeTags', () => {
    // README: "The top-level tags array is only pruned by excludeTags."
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: { '/a': { get: tagged('a', ['Wanted']) } },
            tags: [{ name: 'Wanted', description: 'Kept.' }, { name: 'Unwanted', description: 'Also kept.' }],
          }),
          operationSelection: { includeTags: ['Wanted'] },
        },
      ]),
    );

    expect(output.tags?.map(t => t.name)).toEqual(['Wanted', 'Unwanted']);
  });

  it('gives exclusion precedence when a tag is both included and excluded', () => {
    // Documented in the excludeTags bullet: "the exclusion rule will take
    // precedence".
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/a': { get: tagged('a', ['Both']) }, '/b': { get: tagged('b', ['Wanted']) } } }),
          operationSelection: { includeTags: ['Both', 'Wanted'], excludeTags: ['Both'] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/b']);
  });
});
