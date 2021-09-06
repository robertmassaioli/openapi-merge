import { Swagger } from 'atlassian-openapi';

export type OperationSelection = {
  /**
   * Only Operatinos that have these tags will be taken from this OpenAPI file. If a single Operation contains
   * an includeTag and an excludeTag then it will be excluded; exclusion takes precedence.
   */
  includeTags?: string[];

  /**
   * Any Operation that has any one of these tags will be excluded from the final result. If a single Operation contains
   * an includeTag and an excludeTag then it will be excluded; exclusion takes precedence.
   */
  excludeTags?: string[];
};

export type SingleMergeInput = {
  oas: Swagger.SwaggerV3;
  disputePrefix?: string;
  //referenceOverrides?: { [reference: string]: string };
  pathModification?: PathModification;

  /**
   * Any Operation tagged with one of the paths in this definition will be excluded from the merge result. Any tag
   * mentioned in this list will also be excluded from the top level list of tags.
   */
  operationSelection?: OperationSelection;

  /**
   * This configuration setting lets you configure how the info.description from this OpenAPI file will be merged
   * into the final resulting OpenAPI file
   */
  description?: DescriptionMergeBehaviour;
};

export type PathModification = {
  stripStart?: string;
  prepend?: string;
};

export type DescriptionMergeBehaviour = {
  /**
   * Wether or not the description for this OpenAPI file will be merged into the description of the final file.
   */
  append: boolean;

  /**
   * You may optionally include a Markdown Title to demarcate this particular section of the merged description files.
   */
  title?: DescriptionTitle;
};

export type DescriptionTitle = {
  /**
   * The value of the included title.
   *
   * @minLength 1
   */
  value: string;

  /**
   * What heading level this heading will be at: from h1 through to h6. The default value is 1 and will create h1 elements
   * in Markdown format.
   *
   * @minimum 1
   * @maximum 6
   */
  headingLevel?: number;
};

export type MergeInput = Array<SingleMergeInput>;

export type SuccessfulMergeResult = {
  output: Swagger.SwaggerV3;
};

export type ErrorType = 'no-inputs' | 'duplicate-paths' | 'component-definition-conflict' | 'operation-id-conflict';

export type ErrorMergeResult = {
  type: ErrorType;
  message: string;
};

export function isErrorResult<A>(t: A | ErrorMergeResult): t is ErrorMergeResult {
  return 'type' in t && 'message' in t;
}

export type MergeResult = SuccessfulMergeResult | ErrorMergeResult;