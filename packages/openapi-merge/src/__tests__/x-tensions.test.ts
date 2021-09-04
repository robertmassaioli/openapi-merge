import { toOAS } from "./oas-generation";
import { merge } from "..";
import { expectMergeResult, toMergeInputs } from "./test-utils";

describe('extensions', () => {
  it('should take the first extension definition at the top level', () => {
    const first = toOAS({});
    first["x-atlassian-narrative"] = {
      documents: [{
        anchor: 'first-intro',
        title: 'First Introduction',
        body: 'First intro section for reading'
      }]
    };

    const second = toOAS({});
    second["x-atlassian-narrative"] = {
      documents: [{
        anchor: 'second-intro',
        title: 'Second Introduction',
        body: 'Second intro section for reading'
      }]
    };

    const output = toOAS({});
    output["x-atlassian-narrative"] = {
      documents: [{
        anchor: 'first-intro',
        title: 'First Introduction',
        body: 'First intro section for reading'
      }]
    };

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });
});