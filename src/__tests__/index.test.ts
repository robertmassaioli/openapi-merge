import 'jest';
import { merge } from '..';
import { expectErrorType, expectMergeResult, toMergeInputs } from './test-utils';
import { toOAS } from './oas-generation';

describe('merge', () => {

  describe('simple cases', () => {
    it('should return an error if no inputs are provided', () => {
      expectErrorType(merge([]), 'no-inputs');
    });

    it('should result in a no-op on a simple swagger file', () => {
      expectMergeResult(merge(toMergeInputs([toOAS({})])), { output: toOAS({}) });
    });
  });

});