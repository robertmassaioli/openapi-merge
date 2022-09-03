import { MergeResult, MergeInput } from '..';
import { ErrorType, isErrorResult, SingleMergeInput } from '../data';
import { Swagger } from 'atlassian-openapi';

export function expectErrorType(result: MergeResult, type: ErrorType): void {
  if (isErrorResult(result)) {
    expect(result.type).toEqual(type);
  } else {
    throw new Error(`Expected an error, but instead got: ${JSON.stringify(result, null, 2)}`);
  }
}

export function expectMergeResult(actual: MergeResult, expected: MergeResult): void {
  if (isErrorResult(actual)) {
    throw new Error(`We expected to have a successful merge and instead got: ${JSON.stringify(actual, null, 2)}`);
  }

  expect(actual).toEqual(expected);
}

export function toMergeInputs(oass: Swagger.SwaggerV3[]): MergeInput {
  return oass.map<SingleMergeInput>((oas) => ({ oas }));
}
