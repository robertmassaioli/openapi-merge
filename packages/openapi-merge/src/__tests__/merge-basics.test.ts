import { merge } from '../index';
import { expectErrorType, expectMergeResult, toMergeInputs } from './_helpers/test-utils';
import { toOAS } from './_helpers/oas-generation';

/**
 * The smallest possible contracts of `merge` itself: it rejects an empty input
 * list, and merging a single document is a no-op that returns it unchanged.
 *
 * Everything more specific lives in a suite named for the concept it covers.
 */
describe('merge basics', () => {
  it('should return an error if no inputs are provided', () => {
    expectErrorType(merge([]), 'no-inputs');
    });

  it('should result in a no-op on a simple swagger file', () => {
    expectMergeResult(merge(toMergeInputs([toOAS({})])), { output: toOAS({}) });
    });
});