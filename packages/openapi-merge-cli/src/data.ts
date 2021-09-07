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
}

export type PathModification = {
  /**
     * If a path starts with these characters, then stip them from the beginning of the path. Will run before prepend.
     *
     * @minLength 1
     */
  stripStart?: string;

  /**
   * Append these characters to the start of the paths for this input. Will run after stripStart.
   *
   * @minLength 1
   */
  prepend?: string;
}

export type DescriptionMergeBehaviour = {
  /**
   * Wether or not the description for this OpenAPI file will be merged into the description of the final file.
   *
   * @default false
   */
  append: boolean;

  /**
   * You may optionally include a Markdown Title to demarcate this particular section of the merged description files.
   *
   * @examples require("./examples-for-schema.ts").DescriptionTitleExamples
   */
  title?: DescriptionTitle;
};

export type DescriptionTitle = {
  /**
   * The value of the included title.
   *
   * @minLength 1
   * @example Section Title
   */
  value: string;

  /**
   * What heading level this heading will be at: from h1 through to h6. The default value is 1 and will create h1 elements
   * in Markdown format.
   *
   * @minimum 1
   * @maximum 6
   * @default 1
   */
  headingLevel?: number;
};

export type DisputeV1 = {
  /**
   * The prefix that will be used in the event of a conflict of two definition names.
   *
   * @deprecated
   * @minLength 1
   */
  disputePrefix?: string;
};

export interface DisputeBase {
  /**
   * If this is set to true, then this prefix will always be applied to every Schema, even if there is no dispute
   * for that particular schema. This may prevent the deduplication of common schemas from different OpenApi files.
   *
   * @default false
   */
  alwaysApply?: boolean;
}

/**
 * A dispute with a configurable prefix.
 */
export interface DisputePrefix extends DisputeBase {
  /**
   * The prefix to use when a schema is in dispute.
   *
   * @minLength 1
   */
  prefix: string;
}

/**
 * A dispute with a configurable suffix.
 */
export interface DisputeSuffix extends DisputeBase {
  /**
   * The suffix to use when a schema is in dispute.
   *
   * @minLength 1
   */
  suffix: string;
}

export type Dispute = DisputePrefix | DisputeSuffix;

export type DisputeV2 = {
  /**
   * The dispute algorithm that should be used for this input.
   *
   * @examples require("./examples-for-schema.ts").DisputeExamples
   */
  dispute?: Dispute;
};

/**
 * The common configuration properties of an Input.
 */
export interface ConfigurationInputBase {
  /**
   * For this input, you can perform these modifications to its paths elements.
   *
   * @examples @examples require("./examples-for-schema.ts").PathModificationExamples
   */
  pathModification?: PathModification;

  /**
   * Choose which OpenAPI Operations should be included from this input.
   *
   * @examples require("./examples-for-schema.ts").OperationSelectionExamples
   */
  operationSelection?: OperationSelection;

  /**
   * This configuration setting lets you configure how the info.description from this OpenAPI file will be merged
   * into the final resulting OpenAPI file
   *
   * @examples require('./examples-for-schema.ts').DescriptionMergeBehaviourExamples
   */
  description?: DescriptionMergeBehaviour;
}

/**
 * A single Configuration input from a File.
 */
export interface ConfigurationInputFromFile extends ConfigurationInputBase {
  /**
   * The path to the input OpenAPI Schema that will be merged.
   *
   * @minLength 1
   */
  inputFile: string;
}

/**
 * A single Configuration input from a URL
 */
export interface ConfigurationInputFromUrl extends ConfigurationInputBase {
  /**
   * The input url that we should load our configuration file from.
   *
   * @format uri
   * @pattern ^https?://
   */
  inputURL: string;
}

/**
 * This only exists to support the original form of `disputePrefix`.
 *
 * @deprecated
 */
export type ConfigurationInputV1 = (ConfigurationInputFromFile | ConfigurationInputFromUrl) & DisputeV1;

/**
 * When a new major version is released this will become the default way of doing things and the types can simplify
 * dramatically.
 */
export type ConfigurationInputV2 = (ConfigurationInputFromFile | ConfigurationInputFromUrl) & DisputeV2;

/**
 * The multiple types of configuration inputs that are supported.
 */
export type ConfigurationInput = ConfigurationInputV1 | ConfigurationInputV2;

export function isConfigurationInputFromFile(input: ConfigurationInput): input is ConfigurationInputFromFile {
  return 'inputFile' in input;
}

/**
 * The Configuration file for the OpenAPI Merge CLI Tool.
 */
export type Configuration = {
  /**
   * The input items for the merge algorithm. You must provide at least one.
   *
   * @minItems 1
   * @examples require('./examples-for-schema.ts').ConfigurationInputExamples
   */
  inputs: ConfigurationInput[];

  /**
   * The output file to put the results in. If you use the .yml or .yaml extension then the schema will be output
   * in YAML format, otherwise, it will be output in JSON format.
   *
   * @minLength 1
   */
  output: string;
};