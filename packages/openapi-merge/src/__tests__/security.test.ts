import { merge } from "..";
import { toOAS } from "./oas-generation";
import { expectMergeResult, toMergeInputs } from "./test-utils";

describe('OAS Security', () => {
  it('if the first file has a security definition then only that should be taken', () => {
    const first = toOAS({}, {
      securitySchemes: {
        firstScheme: {
          type: 'apiKey',
          name: 'first scheme',
          in: 'query'
        }
      }
    });

    first.security = [{ "first scheme": [] }];

    const second = toOAS({}, {
      securitySchemes: {
        secondScheme: {
          type: 'apiKey',
          name: 'second scheme',
          in: 'query'
        }
      }
    });

    second.security = [{ "second scheme": [] }];

    const output = toOAS({}, {
      securitySchemes: {
        firstScheme: {
          type: 'apiKey',
          name: 'first scheme',
          in: 'query'
        }
      }
    });

    output.security = [{ "first scheme": [] }];

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should take the first available security scheme definition', () => {
    const first = toOAS({});

    first.security = [{ "first scheme": [] }];

    const second = toOAS({}, {
      securitySchemes: {
        secondScheme: {
          type: 'apiKey',
          name: 'second scheme',
          in: 'query'
        }
      }
    });

    second.security = [{ "second scheme": [] }];

    const output = toOAS({}, {
      securitySchemes: {
        secondScheme: {
          type: 'apiKey',
          name: 'second scheme',
          in: 'query'
        }
      }
    });

    output.security = [{ "first scheme": [] }];

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('shoud take the first top level security requirements definition', () => {
    const first = toOAS({}, {
      securitySchemes: {
        firstScheme: {
          type: 'apiKey',
          name: 'first scheme',
          in: 'query'
        }
      }
    });

    const second = toOAS({}, {
      securitySchemes: {
        secondScheme: {
          type: 'apiKey',
          name: 'second scheme',
          in: 'query'
        }
      }
    });

    second.security = [{ "second scheme": [] }];

    const output = toOAS({}, {
      securitySchemes: {
        firstScheme: {
          type: 'apiKey',
          name: 'first scheme',
          in: 'query'
        }
      }
    });

    output.security = [{ "second scheme": [] }];

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should have no security definitions if none are defined', () => {
    const first = toOAS({});
    const second = toOAS({});
    const output = toOAS({});

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });
});