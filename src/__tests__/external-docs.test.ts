import { toOAS } from "./oas-generation";
import { expectMergeResult, toMergeInputs } from "./test-utils";
import { merge } from "..";

describe('OAS External Docs', () => {
  it('should always take the first docs definition', () => {
    const first = toOAS({});
    const second = toOAS({});

    first.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My first documentation'
    };
    second.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My second documentation'
    };

    const output = toOAS({});
    output.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My first documentation'
    };

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should take the first available docs definition', () => {
    const first = toOAS({});
    const second = toOAS({});

    second.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My second documentation'
    };

    const output = toOAS({});
    output.externalDocs = {
      url: 'https://docs.example.com',
      description: 'My second documentation'
    };

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should return no docs definition if none could be found', () => {
    const first = toOAS({});
    const second = toOAS({});

    const output = toOAS({});

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });
});