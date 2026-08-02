import { merge } from '../index';
import { toOAS } from './_helpers/oas-generation';
import { expectMergeResult } from './_helpers/test-utils';
import { doc30, doc31, doc32, expectSuccess, op, pathKeys, tagged } from './_helpers/documents';

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
 * Issue #111: wildcards driving a real merge.
 *
 * Tag selection was exact-match, so a team with `service-a`, `service-b`, …
 * had to enumerate every tag and update the config whenever one appeared.
 * Forgetting silently includes or excludes the wrong operations.
 */
describe('wildcard tag selection (issue #111)', () => {
  const doc = () =>
    doc30({
      paths: {
        '/a': { get: tagged('a', ['service-a']) },
        '/b': { get: tagged('b', ['service-b']) },
        '/other': { get: tagged('other', ['public']) },
      },
      tags: [{ name: 'service-a' }, { name: 'service-b' }, { name: 'public' }],
    });

  it('excludes every tag matching a wildcard', () => {
    const output = expectSuccess(
      merge([{ oas: doc(), operationSelection: { excludeTags: ['service-*'] } }]),
    );

    expect(pathKeys(output)).toEqual(['/other']);
  });

  it('includes only the tags matching a wildcard', () => {
    const output = expectSuccess(
      merge([{ oas: doc(), operationSelection: { includeTags: ['service-*'] } }]),
    );

    expect(pathKeys(output)).toEqual(['/a', '/b']);
  });

  it('removes wildcard-excluded tags from the top-level tags list', () => {
    const output = expectSuccess(
      merge([{ oas: doc(), operationSelection: { excludeTags: ['service-*'] } }]),
    );

    // Otherwise the operations go and their declarations stay, describing
    // tags the document no longer uses.
    expect(output.tags?.map(t => t.name)).toEqual(['public']);
  });

  it('still supports exact tags unchanged', () => {
    const output = expectSuccess(
      merge([{ oas: doc(), operationSelection: { excludeTags: ['service-a'] } }]),
    );

    expect(pathKeys(output)).toEqual(['/b', '/other']);
    expect(output.tags?.map(t => t.name)).toEqual(['service-b', 'public']);
  });

  it('mixes exact and wildcard patterns in one list', () => {
    const output = expectSuccess(
      merge([{ oas: doc(), operationSelection: { excludeTags: ['public', 'service-*'] } }]),
    );

    expect(pathKeys(output)).toEqual([]);
  });

  it('applies wildcards to webhook operations too', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc31({
            paths: {},
            webhooks: { ping: { post: tagged('ping', ['internal-ping']) }, keep: { post: tagged('keep', ['public']) } },
          }),
          operationSelection: { excludeTags: ['internal-*'] },
        },
      ]),
    );

    expect(Object.keys(output.webhooks ?? {})).toEqual(['keep']);
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

/**
 * Path-based operation selection: `includePaths`/`excludePaths` (proposal 43
 * / PR #67).
 *
 * Same shape as tag selection above -- exclusion wins over inclusion, every
 * operation slot is reached -- plus the two questions specific to paths:
 * ordering relative to `pathModification`, and how a path rule composes with
 * a tag rule configured on the same input.
 */
describe('path-based operation selection (proposal 43 / PR #67)', () => {
  it('removes only the operations matching an exclude selector', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/admin/users': { get: op('adminUsers'), post: op('createAdminUser') },
              '/customer/details': { get: op('customerDetails') },
            },
          }),
          operationSelection: { excludePaths: [{ path: '/admin/users', method: 'get' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/admin/users', '/customer/details']);
    expect(Object.keys(output.paths?.['/admin/users'] ?? {})).toEqual(['post']);
  });

  it('drops a path whose operations are all excluded', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/keep': { get: op('k') }, '/drop': { get: op('d') } } }),
          operationSelection: { excludePaths: [{ path: '/drop' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/keep']);
  });

  it('keeps only the operations matching an include selector', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/admin/users': { get: op('adminUsers') },
              '/customer/details': { get: op('customerDetails') },
            },
          }),
          operationSelection: { includePaths: [{ path: '/admin/*' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/admin/users']);
  });

  it('filters per operation, keeping a path whose other method survives', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/thing': { get: op('getThing'), post: op('postThing') } } }),
          operationSelection: { includePaths: [{ path: '/thing', method: 'get' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/thing']);
    expect(Object.keys(output.paths?.['/thing'] ?? {})).toEqual(['get']);
  });

  it('gives exclusion precedence when a path is both included and excluded', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/a': { get: op('a') }, '/b': { get: op('b') } } }),
          operationSelection: { includePaths: [{ path: '/a' }, { path: '/b' }], excludePaths: [{ path: '/a' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/b']);
  });

  it('matches by wildcard, covering paths added after the config was written', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/admin/users': { get: op('adminUsers') },
              '/admin/roles': { get: op('adminRoles') },
              '/public/status': { get: op('status') },
            },
          }),
          operationSelection: { excludePaths: [{ path: '/admin/*' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/public/status']);
  });

  it('matches a path containing regex syntax literally', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/v1.2/status': { get: op('status') }, '/v1x2/status': { get: op('other') } } }),
          operationSelection: { excludePaths: [{ path: '/v1.2/status' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/v1x2/status']);
  });

  it('matches selectors against the pre-pathModification path, not the merged output path', () => {
    // A selector for the merged, post-modification path silently matches
    // nothing -- proposal 43 §3 -- so this pins the opposite as the real
    // behaviour: the selector below is written against '/users', this
    // input's own original path, even though pathModification renames it to
    // '/service/users' in the output.
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/users': { get: op('users') }, '/other': { get: op('other') } } }),
          pathModification: { prepend: '/service' },
          operationSelection: { excludePaths: [{ path: '/users' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/service/other']);
  });

  it('applies path selection to webhook operations too', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc31({
            paths: {},
            webhooks: { ping: { post: op('ping') }, keep: { post: op('keep') } },
          }),
          operationSelection: { excludePaths: [{ path: 'ping' }] },
        },
      ]),
    );

    expect(Object.keys(output.webhooks ?? {})).toEqual(['keep']);
  });

  it('includePaths drops every webhook whose event name does not match a selector (allow-list, same as includeTags)', () => {
    // Deliberate, not a bug: includePaths is an allow-list, and webhook event
    // names essentially never look like a path pattern such as '/admin/*'.
    // This mirrors includeTags already dropping untagged webhook operations.
    const output = expectSuccess(
      merge([
        {
          oas: doc31({
            paths: { '/admin/users': { get: op('adminUsers') } },
            webhooks: { ping: { post: op('ping') } },
          }),
          operationSelection: { includePaths: [{ path: '/admin/*' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/admin/users']);
    expect(output.webhooks ?? {}).toEqual({});
  });

  it('applies path selection to 3.2 query and additionalOperations slots', () => {
    const output = expectSuccess(merge([{
      oas: doc32({ paths: { '/cache': {
        get: op('getCache'),
        additionalOperations: { PURGE: op('purge') },
      } } }),
      operationSelection: { excludePaths: [{ path: '/cache', method: 'PURGE' }] },
    }]));

    expect(output.paths?.['/cache'].additionalOperations?.PURGE).toBeUndefined();
    expect(output.paths?.['/cache'].get).toBeDefined();
  });

  it('requires an operation to clear both a tag include list and a path include list', () => {
    // No precedent for this composition in the codebase (includeTags and
    // excludeTags are an include-then-exclude pair, not two include lists) --
    // proposal 43 §3 decided "both must pass" on its own merits.
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/admin/wanted': { get: tagged('adminWanted', ['Wanted']) },
              '/admin/unwanted': { get: tagged('adminUnwanted', ['Unwanted']) },
              '/other/wanted': { get: tagged('otherWanted', ['Wanted']) },
            },
          }),
          operationSelection: { includeTags: ['Wanted'], includePaths: [{ path: '/admin/*' }] },
        },
      ]),
    );

    // '/admin/unwanted' clears the path filter but not the tag filter;
    // '/other/wanted' clears the tag filter but not the path filter.
    expect(pathKeys(output)).toEqual(['/admin/wanted']);
  });

  it('excludes an operation matched by either a tag exclude or a path exclude', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: {
              '/a': { get: tagged('a', ['internal']) },
              '/b': { get: op('b') },
              '/admin/c': { get: op('c') },
            },
          }),
          operationSelection: { excludeTags: ['internal'], excludePaths: [{ path: '/admin/*' }] },
        },
      ]),
    );

    expect(pathKeys(output)).toEqual(['/b']);
  });
});
