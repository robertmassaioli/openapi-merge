import { toOAS } from "./oas-generation";
import { expectMergeResult, toMergeInputs } from "./test-utils";
import { merge } from "..";

describe('OAS Info', () => {
  it('should always take the first info block from the first definition', () => {
    const first = toOAS({});
    const second = toOAS({});

    first.info.title = 'first';
    second.info.title = 'second';

    const output = toOAS({});
    output.info.title = 'first';

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });
});