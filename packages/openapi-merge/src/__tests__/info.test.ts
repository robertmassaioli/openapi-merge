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

  it('should only take the first description if no DescriptionMergeBehaviour is set', () => {
    const first = toOAS({});
    const second = toOAS({});
    const third = toOAS({});

    second.info.description = 'Second description';
    third.info.description = 'Third description';

    const output = toOAS({});
    output.info.description = 'Second description';

    expectMergeResult(merge(toMergeInputs([first, second, third])), {
      output
    });
  });

  it(`should only take the values with 'append' set to true if any DescriptionMergeBehaviour is set`, () => {
    const first = toOAS({});
    const second = toOAS({});
    const third = toOAS({});

    first.info.description = 'First description';
    second.info.description = 'Second description';
    third.info.description = 'Third description';

    const output = toOAS({});
    output.info.description = 'First description\n\nThird description';

    const mergeInputs = toMergeInputs([first, second, third]);

    mergeInputs[0].description = {
      append: true
    };

    mergeInputs[2].description = {
      append: true
    };

    expectMergeResult(merge(mergeInputs), { output });
  });

  it('should append the title specified in DescriptionMergeBehaviour with the right heading level', () => {
    const first = toOAS({});
    const second = toOAS({});
    const third = toOAS({});

    first.info.description = 'First description';
    second.info.description = 'Second description';
    third.info.description = 'Third description';

    const mergeInputs = toMergeInputs([first, second, third]);

    mergeInputs[0].description = {
      append: true,
      title: {
        value: 'First heading',
        headingLevel: 3
      }
    };

    mergeInputs[1].description = {
      append: true
    };

    mergeInputs[2].description = {
      append: true,
      title: {
        value: 'Third heading'
      }
    };

    const output = toOAS({});
    output.info.description = '### First heading\n\nFirst description\n\nSecond description\n\n# Third heading\n\nThird description';

    expectMergeResult(merge(mergeInputs), { output });
  });
});