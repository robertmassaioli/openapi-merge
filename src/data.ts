import { Swagger } from 'atlassian-openapi';

export type SingleMergeInput = {
  oas: Swagger.SwaggerV3;
  disputePrefix?: string;
  referenceOverrides?: { [reference: string]: string };
  pathModification?: PathModification;
};

export type PathModification = {
  stripStart?: string;
  prepend?: string;
}

export type MergeInput = Array<SingleMergeInput>;

export type SuccessfulMergeResult = {
  output: Swagger.SwaggerV3;
};

export type ErrorType = 'no-inputs' | 'duplicate-paths' | 'component-definition-conflict';

export type ErrorMergeResult = {
  type: ErrorType;
  message: string;
};

export function isErrorResult<A>(t: A | ErrorMergeResult): t is ErrorMergeResult {
  return 'type' in t && 'message' in t;
}

export type MergeResult = SuccessfulMergeResult | ErrorMergeResult;