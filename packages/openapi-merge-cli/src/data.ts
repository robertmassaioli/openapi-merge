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
   * @default 1
   */
  headingLevel?: number;
};

/**
 * The common configuration properties of an Input.
 */
export interface ConfigurationInputBase {
  /**
   * The prefix that will be used in the event of a conflict of two definition names.
   *
   * @minLength 1
   */
  disputePrefix?: string;

  /**
   * For this input, you can perform these modifications to its paths elements.
   */
  pathModification?: PathModification;

  /**
   * Choose which OpenAPI Operations should be included from this input.
   */
  operationSelection?: OperationSelection;

  /**
   * This configuration setting lets you configure how the info.description from this OpenAPI file will be merged
   * into the final resulting OpenAPI file
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
 * The multiple types of configuration inputs that are supported.
 */
export type ConfigurationInput = ConfigurationInputFromFile | ConfigurationInputFromUrl;

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