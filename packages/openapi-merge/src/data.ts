import { OpenApiDocument } from './oas31';

import { ServersStrategy } from './servers';

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

export interface DisputeBase {
  /**
   * If this is set to true, then this prefix will always be applied to every Schema, even if there is no dispute
   * for that particular schema. This may prevent the deduplication of common schemas from different OpenApi files.
   */
  alwaysApply?: boolean;
}

export interface DisputePrefix extends DisputeBase {
  /**
   * The prefix to use when a schema is in dispute.
   */
  prefix: string;
}

export interface DisputeSuffix extends DisputeBase {
  /**
   * The suffix to use when a schema is in dispute.
   */
  suffix: string;
}

export type Dispute = DisputePrefix | DisputeSuffix;

/**
 * What to do when this input declares a path another input already added
 * (issue #71).
 *
 * - `'error'` (default) — fail with `duplicate-paths`, the historical
 *   behaviour. Unchanged for anyone who does not set this.
 * - `'skip-later'` — keep the definition already present and drop this input's.
 * - `'prefer-later'` — replace the definition already present with this one.
 *
 * Per input rather than global, because the thing people actually want to
 * express is "this one input wins and the rest are additive", which a single
 * global setting cannot say.
 */
export type DuplicatePathHandling = 'error' | 'skip-later' | 'prefer-later';

export interface SingleMergeInputBase {
  oas: OpenApiDocument;

  pathModification?: PathModification;

  /**
   * How to resolve a path this input shares with one already merged.
   *
   * Applies to `webhooks` as well, which collide by event name in exactly the
   * same way.
   *
   * @default 'error'
   */
  duplicatePathHandling?: DuplicatePathHandling;

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
}

/**
 * The original SingelMergeInput, now deprecated. This is included for backwards compatibility, to prevent a breaking
 * change and should be removed in the next major version.
 *
 * @deprecated
 */
export interface SingleMergeInputV1 extends SingleMergeInputBase {
  /**
   * The prefix to use in the event of a dispute.
   *
   * @deprecated
   */
  disputePrefix?: string;
}

/**
 * The current expected format of the SingleMergeInput.
 */
export interface SingleMergeInputV2 extends SingleMergeInputBase {
  /**
   * This dictates how any disputes will be resolved between similar elements across multiple OpenAPI files.
   */
  dispute?: Dispute;
}

export type SingleMergeInput = SingleMergeInputV1 | SingleMergeInputV2;

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

/**
 * Document-level options for a merge.
 *
 * Deliberately a single bag passed as `merge()`'s second argument rather than
 * per-input fields. Everything in here concerns the *output* document, so a
 * per-input value would raise a question with no good answer: which input wins
 * when two of them disagree about a property the output has only one of?
 *
 * Optional in every position, and every default reproduces the behaviour that
 * existed before the option did, so `merge(inputs)` is unchanged.
 */
export interface MergeOptions {
  /**
   * How to combine the top-level `servers` array. Defaults to `'first'`.
   * See {@link ServersStrategy} for why that is the default (issue #4).
   */
  serversStrategy?: ServersStrategy;
}

export type SuccessfulMergeResult = {
  output: OpenApiDocument;
};

export type ErrorType =
  | 'no-inputs'
  | 'duplicate-paths'
  | 'component-definition-conflict'
  | 'operation-id-conflict'
  /** An input declared a version this library cannot merge, or none at all. */
  | 'unsupported-openapi-version'
  /** The inputs did not all declare the same OpenAPI major.minor version. */
  | 'mixed-openapi-versions'
  /** Two inputs declared the same webhook name (3.1). */
  | 'duplicate-webhooks';

export type ErrorMergeResult = {
  type: ErrorType;
  message: string;
};

export function isErrorResult<A>(t: A | ErrorMergeResult): t is ErrorMergeResult {
  return typeof t === 'object' && t !== null && 'type' in t && 'message' in t;
}

export type MergeResult = SuccessfulMergeResult | ErrorMergeResult;