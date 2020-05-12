/**
 * A single Configuration input
 */
export type ConfigurationInput = {
  /**
   * The path to the input OpenAPI Schema that will be merged.
   * 
   * @minLength 1
   */
  inputFile: string;

  /**
   * The prefix that will be used in the event of a conflict of two definition names.
   * 
   * @minLength 1
   */
  disputePrefix?: string;

  /**
   * For this input, you can perform these modifications to its paths elements.
   */
  pathModification?: {
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
};

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
   * The output file to put the results in.
   * 
   * @minLength 1
   */
  output: string;
};