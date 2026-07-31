import { mergePathItems, isPathItemMergeFailure } from '../merge-path-items';
import { PathItem32 } from '../oas31';
import { ok } from './_helpers/documents';

/**
 * Combining two Path Items that share a key (issue #71, `merge-operations`).
 *
 * Unit tests for the decision itself. The refusals matter more than the
 * successes: each one is a case where a plausible-looking union would silently
 * change what one input's operations mean, and quietly altering semantics is
 * worse than stopping.
 */
describe('mergePathItems (issue #71)', () => {
  const op = (operationId: string) => ({ operationId, responses: ok });
  const expectMerged = (result: ReturnType<typeof mergePathItems>): PathItem32 => {
    if (isPathItemMergeFailure(result)) {
      throw new Error(`expected a merge, got refusal: ${result.reason}`);
    }
    return result;
  };
  const expectRefused = (result: ReturnType<typeof mergePathItems>): string => {
    if (!isPathItemMergeFailure(result)) {
      throw new Error('expected a refusal, got a merged path item');
    }
    return result.reason;
  };

  describe('combining disjoint methods', () => {
    it('combines GET and POST', () => {
      const merged = expectMerged(mergePathItems({ get: op('getThing') }, { post: op('postThing') }));

      expect(Object.keys(merged).sort()).toEqual(['get', 'post']);
      expect(merged.get?.operationId).toBe('getThing');
      expect(merged.post?.operationId).toBe('postThing');
    });

    it('combines several methods at once', () => {
      const merged = expectMerged(
        mergePathItems({ get: op('g'), head: op('h') }, { post: op('p'), delete: op('d') }),
      );

      expect(Object.keys(merged).sort()).toEqual(['delete', 'get', 'head', 'post']);
    });

    it('combines a 3.2 query operation with a standard one', () => {
      const merged = expectMerged(mergePathItems({ get: op('g') }, { query: op('q') }));

      expect(Object.keys(merged).sort()).toEqual(['get', 'query']);
    });

    it('combines additionalOperations from both sides', () => {
      const merged = expectMerged(
        mergePathItems(
          { additionalOperations: { PURGE: op('purge') } },
          { additionalOperations: { LOCK: op('lock') } },
        ),
      );

      expect(Object.keys(merged.additionalOperations ?? {}).sort()).toEqual(['LOCK', 'PURGE']);
    });

    it('combines a standard method with a custom verb', () => {
      const merged = expectMerged(
        mergePathItems({ get: op('g') }, { additionalOperations: { PURGE: op('purge') } }),
      );

      expect(merged.get?.operationId).toBe('g');
      expect(merged.additionalOperations?.PURGE?.operationId).toBe('purge');
    });

    it('treats custom verb names as case-sensitive, per 3.2', () => {
      // `GET` in additionalOperations is a different operation from the
      // standard `get` slot, and from a lowercase custom `get`.
      const merged = expectMerged(
        mergePathItems(
          { additionalOperations: { GET: op('customGet') } },
          { additionalOperations: { get: op('otherGet') } },
        ),
      );

      expect(Object.keys(merged.additionalOperations ?? {}).sort()).toEqual(['GET', 'get']);
    });

    it('keeps identical path-level fields on the result', () => {
      const fields: Pick<PathItem32, 'summary' | 'parameters'> = {
        summary: 'A thing',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      };
      const merged = expectMerged(
        mergePathItems({ ...fields, get: op('g') }, { ...fields, post: op('p') }),
      );

      expect(merged.summary).toBe('A thing');
      expect(merged.parameters).toEqual(fields.parameters);
      expect(Object.keys(merged).sort()).toEqual(['get', 'parameters', 'post', 'summary']);
    });

    it('combines when neither side has any path-level fields', () => {
      // The overwhelmingly common case: two teams each contributing one method.
      const merged = expectMerged(mergePathItems({ get: op('g') }, { post: op('p') }));

      expect(Object.keys(merged).sort()).toEqual(['get', 'post']);
    });
  });

  describe('refusing an overlapping method', () => {
    it('refuses when both define the same standard method', () => {
      const reason = expectRefused(mergePathItems({ get: op('a') }, { get: op('b') }));

      expect(reason).toContain('GET');
      expect(reason).toContain('prefer-later');
    });

    it('refuses when only one of several methods overlaps', () => {
      const reason = expectRefused(
        mergePathItems({ get: op('a'), head: op('h') }, { get: op('b'), post: op('p') }),
      );

      // Partial overlap is still ambiguous: there is no answer for GET.
      expect(reason).toContain('GET');
    });

    it('names every overlapping method', () => {
      const reason = expectRefused(
        mergePathItems({ get: op('a'), post: op('b') }, { get: op('c'), post: op('d') }),
      );

      expect(reason).toContain('GET');
      expect(reason).toContain('POST');
    });

    it('refuses an overlapping custom verb', () => {
      const reason = expectRefused(
        mergePathItems(
          { additionalOperations: { PURGE: op('a') } },
          { additionalOperations: { PURGE: op('b') } },
        ),
      );

      expect(reason).toContain('PURGE');
    });
  });

  describe('refusing on path-level fields', () => {
    it('refuses when parameters differ', () => {
      // The sharp case: merging would silently add a required parameter to
      // operations that never declared one.
      const reason = expectRefused(
        mergePathItems(
          { parameters: [{ name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } }], get: op('g') },
          { parameters: [{ name: 'apiVersion', in: 'query', schema: { type: 'string' } }], post: op('p') },
        ),
      );

      expect(reason).toContain("'parameters'");
      expect(reason).toContain('every operation');
    });

    it('refuses when one side declares parameters and the other does not', () => {
      // Not a disagreement about a value, but still a change in meaning: the
      // incoming operations would inherit a parameter they never had.
      const reason = expectRefused(
        mergePathItems({ parameters: [{ name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } }], get: op('g') }, { post: op('p') }),
      );

      expect(reason).toContain("'parameters'");
    });

    it('refuses when summary differs', () => {
      const reason = expectRefused(
        mergePathItems({ summary: 'One', get: op('g') }, { summary: 'Two', post: op('p') }),
      );

      expect(reason).toContain("'summary'");
    });

    it('refuses when servers differ', () => {
      const reason = expectRefused(
        mergePathItems(
          { servers: [{ url: 'https://a' }], get: op('g') },
          { servers: [{ url: 'https://b' }], post: op('p') },
        ),
      );

      expect(reason).toContain("'servers'");
    });

    it('names every differing field', () => {
      const reason = expectRefused(
        mergePathItems(
          { summary: 'One', description: 'First', get: op('g') },
          { summary: 'Two', description: 'Second', post: op('p') },
        ),
      );

      expect(reason).toContain("'description'");
      expect(reason).toContain("'summary'");
    });

    it('refuses on a differing vendor extension, which it cannot interpret', () => {
      const reason = expectRefused(
        mergePathItems(
          { 'x-owner': 'team-a', get: op('g') } as PathItem32,
          { 'x-owner': 'team-b', post: op('p') } as PathItem32,
        ),
      );

      expect(reason).toContain("'x-owner'");
    });

    it('allows an identical vendor extension', () => {
      const merged = expectMerged(
        mergePathItems(
          { 'x-owner': 'team-a', get: op('g') } as PathItem32,
          { 'x-owner': 'team-a', post: op('p') } as PathItem32,
        ),
      );

      expect(Object.keys(merged).sort()).toEqual(['get', 'post', 'x-owner']);
    });
  });

  describe('refusing a $ref path item', () => {
    it('refuses when the existing side is a $ref', () => {
      const reason = expectRefused(mergePathItems({ $ref: '#/components/pathItems/Shared' }, { post: op('p') }));

      expect(reason).toContain('$ref');
    });

    it('refuses when the incoming side is a $ref', () => {
      const reason = expectRefused(mergePathItems({ get: op('g') }, { $ref: '#/components/pathItems/Shared' }));

      expect(reason).toContain('$ref');
    });

    it('refuses when both are $refs, even to the same target', () => {
      // Identical targets would be safe to collapse, but proving that needs
      // resolution, and the merge deliberately does not resolve references.
      const reason = expectRefused(
        mergePathItems({ $ref: '#/components/pathItems/S' }, { $ref: '#/components/pathItems/S' }),
      );

      expect(reason).toContain('$ref');
    });
  });

  describe('immutability', () => {
    it('does not modify either argument', () => {
      const existing: PathItem32 = { get: op('g') };
      const incoming: PathItem32 = { post: op('p') };

      mergePathItems(existing, incoming);

      expect(Object.keys(existing)).toEqual(['get']);
      expect(Object.keys(incoming)).toEqual(['post']);
    });

    it('deep-clones the incoming operation, so later edits do not leak', () => {
      const incoming: PathItem32 = { post: op('p') };
      const merged = expectMerged(mergePathItems({ get: op('g') }, incoming));

      (incoming.post as { operationId: string }).operationId = 'changed';

      expect(merged.post?.operationId).toBe('p');
    });
  });
});
