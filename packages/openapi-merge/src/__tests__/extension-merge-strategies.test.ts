import { ExtensionMergeNode, mergeExtensionNode } from '../extension-merge-strategies';

/**
 * Proposal 48: a recursive merge-strategy tree for `x-*` extension values,
 * generalising issue #60 beyond `x-tagGroups`.
 *
 * These tests exercise `mergeExtensionNode` directly, independent of a whole
 * OpenAPI document -- it is a pure `(node, values, path) => result` function,
 * which is what makes the strategy combinations below tractable to test
 * exhaustively. `document-metadata.test.ts`'s `extensions` block covers the
 * smaller, wiring-level question of this reaching `merge()` correctly.
 */

function expectOk(result: ReturnType<typeof mergeExtensionNode>): unknown {
  if (!result.ok) {
    throw new Error(`expected ok, got failure at '${result.path}': ${result.message}`);
  }
  return result.value;
}

function expectFail(result: ReturnType<typeof mergeExtensionNode>): { path: string; message: string } {
  if (result.ok) {
    throw new Error(`expected failure, got ok: ${JSON.stringify(result.value)}`);
  }
  return { path: result.path, message: result.message };
}

describe('no values / unconfigured', () => {
  it('returns undefined when no input declared the key', () => {
    expect(expectOk(mergeExtensionNode({ kind: 'scalar', strategy: 'error' }, [], 'x-foo'))).toBeUndefined();
  });

  it('takes the first value wholesale when the node is undefined (today\'s default, unconfigured)', () => {
    expect(expectOk(mergeExtensionNode(undefined, ['a', 'b', 'c'], 'x-foo'))).toBe('a');
  });

  it('unconfigured with a single value returns it unprocessed, including internal duplicates', () => {
    // No recursion happens for an unconfigured node -- it's wholesale, not
    // "apply first-wins to every level", so a duplicate-by-name array element
    // inside that one value is not deduplicated.
    const value = [{ name: 'A' }, { name: 'A' }];
    expect(expectOk(mergeExtensionNode(undefined, [value], 'x-foo'))).toBe(value);
  });
});

describe('scalar', () => {
  it('first: takes the first value', () => {
    expect(expectOk(mergeExtensionNode({ kind: 'scalar', strategy: 'first' }, [1, 2, 3], 'x-foo'))).toBe(1);
  });

  it('last: takes the last value', () => {
    expect(expectOk(mergeExtensionNode({ kind: 'scalar', strategy: 'last' }, [1, 2, 3], 'x-foo'))).toBe(3);
  });

  it('last: means last *present*, not last input -- a single value is "last" regardless of position', () => {
    // Simulates only one of several inputs declaring this key: `values` is
    // already dense (undefined entries filtered out by the caller), so a
    // single element is both first and last.
    expect(expectOk(mergeExtensionNode({ kind: 'scalar', strategy: 'last' }, ['only'], 'x-foo'))).toBe('only');
  });

  it('error: succeeds when every value agrees', () => {
    expect(expectOk(mergeExtensionNode({ kind: 'scalar', strategy: 'error' }, ['same', 'same', 'same'], 'x-foo'))).toBe('same');
  });

  it('error: succeeds with only one value declared (agreement is trivial, not a conflict)', () => {
    expect(expectOk(mergeExtensionNode({ kind: 'scalar', strategy: 'error' }, ['only'], 'x-foo'))).toBe('only');
  });

  it('error: fails when values disagree, naming the path', () => {
    const failure = expectFail(mergeExtensionNode({ kind: 'scalar', strategy: 'error' }, ['a', 'b'], 'x-foo'));
    expect(failure.path).toBe('x-foo');
    expect(failure.message).toContain('x-foo');
  });

  it('error: treats null correctly -- does not misclassify it via `typeof null === \'object\'`', () => {
    expect(expectOk(mergeExtensionNode({ kind: 'scalar', strategy: 'error' }, [null, null], 'x-foo'))).toBeNull();
    expect(mergeExtensionNode({ kind: 'scalar', strategy: 'error' }, [null, 'x'], 'x-foo').ok).toBe(false);
  });

  it('kind is declarative only for first/last/error: a "scalar" node still operates on an object value', () => {
    const obj = { a: 1 };
    expect(expectOk(mergeExtensionNode({ kind: 'scalar', strategy: 'first' }, [obj], 'x-foo'))).toBe(obj);
  });

  it('kind is declarative only for error: still reports disagreement even when the values are objects, not scalars', () => {
    // This is the case the advisor flagged: if 'error' silently fell back to
    // 'first' on a kind mismatch, a user who configured 'error' specifically
    // to be told about conflicts would get silence instead. It must not.
    const result = mergeExtensionNode({ kind: 'scalar', strategy: 'error' }, [{ a: 1 }, { a: 2 }], 'x-foo');
    expect(result.ok).toBe(false);
  });
});

describe('array, wholesale (first/last/error)', () => {
  it('first: takes the first array wholesale, no element-level processing', () => {
    const a = [1, 1, 2];
    const b = [3];
    expect(expectOk(mergeExtensionNode({ kind: 'array', strategy: 'first' }, [a, b], 'x-foo'))).toBe(a);
  });

  it('last: takes the last array wholesale', () => {
    const a = [1];
    const b = [2, 3];
    expect(expectOk(mergeExtensionNode({ kind: 'array', strategy: 'last' }, [a, b], 'x-foo'))).toBe(b);
  });

  it('error: fails when two inputs declare different arrays', () => {
    expect(mergeExtensionNode({ kind: 'array', strategy: 'error' }, [[1], [2]], 'x-foo').ok).toBe(false);
  });

  it('error: succeeds when the arrays are deep-equal, not just reference-equal', () => {
    expect(expectOk(mergeExtensionNode({ kind: 'array', strategy: 'error' }, [[1, 2], [1, 2]], 'x-foo'))).toEqual([1, 2]);
  });
});

describe('array, concat / concat-unique', () => {
  it('concat: concatenates in input order, keeping duplicates', () => {
    const result = expectOk(mergeExtensionNode({ kind: 'array', strategy: 'concat' }, [[1, 2], [2, 3]], 'x-foo'));
    expect(result).toEqual([1, 2, 2, 3]);
  });

  it('concat-unique: concatenates and deduplicates by deep equality, including objects', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'concat-unique' },
        [[{ a: 1 }, { a: 2 }], [{ a: 1 }, { a: 3 }]],
        'x-foo',
      ),
    );
    expect(result).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('concat-unique: deduplicates within a single input\'s own array too', () => {
    const result = expectOk(mergeExtensionNode({ kind: 'array', strategy: 'concat-unique' }, [[1, 1, 2]], 'x-foo'));
    expect(result).toEqual([1, 2]);
  });

  it('type mismatch: falls back to the first value wholesale when one input\'s value is not an array', () => {
    const notAnArray = { unexpected: true };
    const result = expectOk(mergeExtensionNode({ kind: 'array', strategy: 'concat' }, [[1, 2], notAnArray], 'x-foo'));
    expect(result).toEqual([1, 2]);
  });

  it('sortBy: sorts an array of objects by a named field, ascending', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'concat', sortBy: 'priority' },
        [[{ name: 'c', priority: 3 }, { name: 'a', priority: 1 }], [{ name: 'b', priority: 2 }]],
        'x-foo',
      ),
    );
    expect((result as Array<{ name: string }>).map(e => e.name)).toEqual(['a', 'b', 'c']);
  });

  it('sortBy: an element missing the sort field sorts last', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'concat', sortBy: 'priority' },
        [[{ name: 'has-field', priority: 1 }, { name: 'no-field' }]],
        'x-foo',
      ),
    );
    expect((result as Array<{ name: string }>).map(e => e.name)).toEqual(['has-field', 'no-field']);
  });

  it('sortBy: several elements missing the field all sort after every element that has it, regardless of comparison order', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'concat', sortBy: 'priority' },
        [[{ name: 'no-field-a' }, { name: 'has-2', priority: 2 }, { name: 'no-field-b' }, { name: 'has-1', priority: 1 }]],
        'x-foo',
      ),
    );
    const names = (result as Array<{ name: string }>).map(e => e.name);
    expect(names.slice(0, 2)).toEqual(['has-1', 'has-2']);
    expect(new Set(names.slice(2))).toEqual(new Set(['no-field-a', 'no-field-b']));
  });

  it('sortBy: string fields sort alphabetically', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'concat', sortBy: 'label' },
        [[{ label: 'charlie' }, { label: 'alpha' }, { label: 'bravo' }]],
        'x-foo',
      ),
    );
    expect((result as Array<{ label: string }>).map(e => e.label)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('sortBy omitted: keeps concatenation order, does not sort', () => {
    const result = expectOk(mergeExtensionNode({ kind: 'array', strategy: 'concat' }, [[3, 1], [2]], 'x-foo'));
    expect(result).toEqual([3, 1, 2]);
  });
});

describe('array, union-by-key', () => {
  const item: ExtensionMergeNode = {
    kind: 'object',
    strategy: 'merge',
    fields: { tags: { kind: 'array', strategy: 'concat-unique' } },
  };

  it('combines elements sharing a key across inputs, per-field', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'union-by-key', key: 'name', item },
        [
          [{ name: 'User', tags: ['get-user', 'put-user'] }],
          [{ name: 'User', tags: ['delete-user'] }, { name: 'Admin', tags: ['admin-only'] }],
        ],
        'x-tagGroups',
      ),
    );
    expect(result).toEqual([
      { name: 'User', tags: ['get-user', 'put-user', 'delete-user'] },
      { name: 'Admin', tags: ['admin-only'] },
    ]);
  });

  it('combines elements sharing a key within a single input\'s own array (PR #127 parity)', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'union-by-key', key: 'name', item },
        [[{ name: 'User', tags: ['one'] }, { name: 'User', tags: ['two'] }]],
        'x-tagGroups',
      ),
    );
    expect(result).toEqual([{ name: 'User', tags: ['one', 'two'] }]);
  });

  it('an element whose key value appears in only one input passes through via `item` applied to a single-element group', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'union-by-key', key: 'name', item },
        [[{ name: 'Solo', tags: ['x'] }]],
        'x-tagGroups',
      ),
    );
    expect(result).toEqual([{ name: 'Solo', tags: ['x'] }]);
  });

  it('output order is first-seen order across all inputs, flattened', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'union-by-key', key: 'name', item },
        [[{ name: 'Second', tags: [] }], [{ name: 'First', tags: [] }, { name: 'Second', tags: [] }]],
        'x-tagGroups',
      ),
    );
    expect((result as Array<{ name: string }>).map(e => e.name)).toEqual(['Second', 'First']);
  });

  it('type mismatch: an input whose value is not an array falls back to the first value wholesale', () => {
    const first = [{ name: 'A', tags: [] }];
    const result = expectOk(
      mergeExtensionNode({ kind: 'array', strategy: 'union-by-key', key: 'name', item }, [first, 'not-an-array'], 'x-tagGroups'),
    );
    expect(result).toBe(first);
  });

  it('type mismatch: an element missing the key field falls back to the first value wholesale', () => {
    const first = [{ name: 'A', tags: [] }, { tags: ['no name field'] }];
    const result = expectOk(
      mergeExtensionNode({ kind: 'array', strategy: 'union-by-key', key: 'name', item }, [first], 'x-tagGroups'),
    );
    expect(result).toBe(first);
  });

  it('type mismatch: an element that is not an object falls back to the first value wholesale', () => {
    const first = ['not-an-object'];
    const result = expectOk(
      mergeExtensionNode({ kind: 'array', strategy: 'union-by-key', key: 'name', item }, [first], 'x-tagGroups'),
    );
    expect(result).toBe(first);
  });

  it('numeric and boolean key values are supported, not just strings', () => {
    const numericItem: ExtensionMergeNode = { kind: 'object', strategy: 'merge', fields: { count: { kind: 'scalar', strategy: 'last' } } };
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'array', strategy: 'union-by-key', key: 'id', item: numericItem },
        [[{ id: 1, count: 'a' }], [{ id: 1, count: 'b' }]],
        'x-foo',
      ),
    );
    expect(result).toEqual([{ id: 1, count: 'b' }]);
  });

  it('propagates a nested `error` failure from `item`, with a path naming which group', () => {
    const errorItem: ExtensionMergeNode = { kind: 'object', strategy: 'merge', fields: { owner: { kind: 'scalar', strategy: 'error' } } };
    const failure = expectFail(
      mergeExtensionNode(
        { kind: 'array', strategy: 'union-by-key', key: 'name', item: errorItem },
        [[{ name: 'Admin', owner: 'team-a' }], [{ name: 'Admin', owner: 'team-b' }]],
        'x-tagGroups',
      ),
    );
    expect(failure.path).toBe('x-tagGroups[name=Admin].owner');
  });
});

describe('object, wholesale (first/last/error)', () => {
  it('first: takes the first object wholesale', () => {
    const a = { x: 1 };
    const b = { x: 2 };
    expect(expectOk(mergeExtensionNode({ kind: 'object', strategy: 'first' }, [a, b], 'x-foo'))).toBe(a);
  });

  it('last: takes the last object wholesale', () => {
    const a = { x: 1 };
    const b = { x: 2 };
    expect(expectOk(mergeExtensionNode({ kind: 'object', strategy: 'last' }, [a, b], 'x-foo'))).toBe(b);
  });

  it('error: fails when the objects are not deep-equal', () => {
    expect(mergeExtensionNode({ kind: 'object', strategy: 'error' }, [{ x: 1 }, { x: 2 }], 'x-foo').ok).toBe(false);
  });
});

describe('object, merge', () => {
  it('recurses per configured field', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'object', strategy: 'merge', fields: { count: { kind: 'scalar', strategy: 'last' }, tags: { kind: 'array', strategy: 'concat-unique' } } },
        [{ count: 1, tags: ['a'] }, { count: 2, tags: ['a', 'b'] }],
        'x-foo',
      ),
    );
    expect(result).toEqual({ count: 2, tags: ['a', 'b'] });
  });

  it('a field not listed in `fields` defaults to wholesale first, regardless of its own shape', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'object', strategy: 'merge', fields: {} },
        [{ unconfigured: { nested: 1 } }, { unconfigured: { nested: 2 } }],
        'x-foo',
      ),
    );
    expect(result).toEqual({ unconfigured: { nested: 1 } });
  });

  it('a field declared by only one occurrence is carried through, using whichever occurrence has it', () => {
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'object', strategy: 'merge', fields: {} },
        [{ onlyInFirst: 'a' }, { onlyInSecond: 'b' }],
        'x-foo',
      ),
    );
    expect(result).toEqual({ onlyInFirst: 'a', onlyInSecond: 'b' });
  });

  it('an explicit `undefined` field value (reachable only via a direct library call, never from parsed JSON/YAML) is treated as absent, the same as a missing field', () => {
    // A config file can never produce this -- JSON/YAML have no way to write
    // "this key with value undefined" -- but a library caller building
    // `MergeInput` in TypeScript by hand could pass `{ field: undefined }`
    // rather than omitting `field`. Treated identically to omitting it,
    // matching how the rest of this library's options (e.g. `MergeOptions`'s
    // own fields) already treat `undefined` as "not provided."
    const result = expectOk(
      mergeExtensionNode(
        { kind: 'object', strategy: 'merge', fields: { field: { kind: 'scalar', strategy: 'last' } } },
        [{ field: undefined }, { field: 'present' }],
        'x-foo',
      ),
    );
    expect(result).toEqual({ field: 'present' });
  });

  it('`fields` omitted entirely behaves as if every field were unconfigured (wholesale first per field)', () => {
    const result = expectOk(
      mergeExtensionNode({ kind: 'object', strategy: 'merge' }, [{ a: 1 }, { a: 2, b: 3 }], 'x-foo'),
    );
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it('type mismatch: a non-object value falls back to the first value wholesale', () => {
    const first = { a: 1 };
    const result = expectOk(mergeExtensionNode({ kind: 'object', strategy: 'merge', fields: {} }, [first, 'not-an-object'], 'x-foo'));
    expect(result).toBe(first);
  });

  it('type mismatch: an array is not a plain object, even though `typeof [] === \'object\'`', () => {
    const first = { a: 1 };
    const result = expectOk(mergeExtensionNode({ kind: 'object', strategy: 'merge', fields: {} }, [first, [1, 2, 3]], 'x-foo'));
    expect(result).toBe(first);
  });

  it('propagates a nested field failure with a path built from the field name', () => {
    const failure = expectFail(
      mergeExtensionNode(
        { kind: 'object', strategy: 'merge', fields: { owner: { kind: 'scalar', strategy: 'error' } } },
        [{ owner: 'team-a' }, { owner: 'team-b' }],
        'x-foo',
      ),
    );
    expect(failure.path).toBe('x-foo.owner');
  });

  it('only the mismatched/failing subtree is affected -- a sibling field still merges normally when a nested type mismatch falls back', () => {
    const result = expectOk(
      mergeExtensionNode(
        {
          kind: 'object',
          strategy: 'merge',
          fields: {
            good: { kind: 'array', strategy: 'concat-unique' },
            malformed: { kind: 'array', strategy: 'concat-unique' },
          },
        },
        [{ good: [1], malformed: 'not-an-array' }, { good: [1, 2] }],
        'x-foo',
      ),
    );
    expect(result).toEqual({ good: [1, 2], malformed: 'not-an-array' });
  });
});

/**
 * The full `x-tagGroups` merge PR #127 hardcodes in TypeScript, re-derived as
 * pure configuration (proposal 48 §4) -- run against the same scenarios that
 * document's own tests use, to demonstrate the tree is expressive enough for
 * the case that motivated it.
 */
describe('x-tagGroups, re-derived as a strategy tree', () => {
  const xTagGroupsNode: ExtensionMergeNode = {
    kind: 'array',
    strategy: 'union-by-key',
    key: 'name',
    item: {
      kind: 'object',
      strategy: 'merge',
      fields: { tags: { kind: 'array', strategy: 'concat-unique' } },
    },
  };

  it('concatenates groups from every input', () => {
    const result = expectOk(
      mergeExtensionNode(
        xTagGroupsNode,
        [[{ name: 'User', tags: ['get-user'] }], [{ name: 'Admin', tags: ['admin-only'] }]],
        'x-tagGroups',
      ),
    );
    expect(result).toEqual([
      { name: 'User', tags: ['get-user'] },
      { name: 'Admin', tags: ['admin-only'] },
    ]);
  });

  it('combines the tags of groups that share a name', () => {
    const result = expectOk(
      mergeExtensionNode(
        xTagGroupsNode,
        [[{ name: 'User', tags: ['get-user', 'put-user'] }], [{ name: 'User', tags: ['delete-user'] }]],
        'x-tagGroups',
      ),
    );
    expect(result).toEqual([{ name: 'User', tags: ['get-user', 'put-user', 'delete-user'] }]);
  });

  it('deduplicates a tag listed by two inputs under the same group', () => {
    const result = expectOk(
      mergeExtensionNode(
        xTagGroupsNode,
        [[{ name: 'User', tags: ['shared', 'a-only'] }], [{ name: 'User', tags: ['shared', 'b-only'] }]],
        'x-tagGroups',
      ),
    );
    expect(result).toEqual([{ name: 'User', tags: ['shared', 'a-only', 'b-only'] }]);
  });

  it('keeps the order in which groups were first seen', () => {
    const result = expectOk(
      mergeExtensionNode(
        xTagGroupsNode,
        [[{ name: 'Second', tags: ['x'] }], [{ name: 'First', tags: ['y'] }, { name: 'Second', tags: ['z'] }]],
        'x-tagGroups',
      ),
    );
    expect((result as Array<{ name: string }>).map(g => g.name)).toEqual(['Second', 'First']);
  });

  it('merges groups sharing a name within a single input', () => {
    const result = expectOk(
      mergeExtensionNode(xTagGroupsNode, [[{ name: 'User', tags: ['one'] }, { name: 'User', tags: ['two'] }]], 'x-tagGroups'),
    );
    expect(result).toEqual([{ name: 'User', tags: ['one', 'two'] }]);
  });

  it('does NOT drop a group left with zero tags -- the documented gap relative to PR #127\'s hardcoded pruning', () => {
    const result = expectOk(mergeExtensionNode(xTagGroupsNode, [[{ name: 'Empty', tags: [] }]], 'x-tagGroups'));
    expect(result).toEqual([{ name: 'Empty', tags: [] }]);
  });
});
