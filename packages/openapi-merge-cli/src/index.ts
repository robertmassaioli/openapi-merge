import { ConfigurationInput, isConfigurationInputFromFile } from "./data";
import { loadConfiguration } from "./load-configuration";
import { Command } from 'commander';
// package.json sits outside tsconfig's rootDir, so it cannot be imported as a
// module without widening the compilation. require() is the pragmatic option.
/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const pjson = require('../package.json');
import { merge, MergeInput } from 'openapi-merge';
import fs from 'fs';
import path from 'path';
import { ErrorMergeResult, isErrorResult, SingleMergeInput } from "openapi-merge/dist/data";
import { OpenApiDocument } from "openapi-merge/dist/oas31";
import { Swagger } from "@atlassian/atlassian-openapi";
import { dump as dumpYaml } from 'js-yaml';
import { readFileAsString, readYamlOrJSON } from "./file-loading";
import { ExitCode } from "./exit-codes";
import { assertOutputContained, OutputOutsideRootError, resolveConfigPath } from "./path-resolution";
import { indentToJsonStringifyArg, indentToYamlArg } from "./formatting";
import { DEFAULT_INDENT, Indent } from "./data";

export { ExitCode } from "./exit-codes";

/**
 * The parsed command-line options.
 *
 * Commander no longer exposes options as properties on the Command instance --
 * they come from `opts()` -- so this names the shape rather than reaching for
 * `any`.
 */
type CliOptions = {
  config?: string;
  restrictOutputTo?: string;
};

// Built per invocation rather than once at module scope. A Command retains the
// values from a previous parse, and a later parse does not clear options that
// are absent from it, so a module-scope singleton leaks state between calls to
// `main()` -- a second call without `-c` would silently reuse the first call's
// config file. Covered by the two isolation tests in main-integration.test.ts.
function buildProgram(): Command {
  const program = new Command();

  program.version(pjson.version);

  program
    .option('-c, --config <config_file>', 'The path to the configuration file for the merge tool.')
    .option('--restrict-output-to <dir>', 'Refuse to write output anywhere outside this directory (overrides outputRoot in the config).');

  return program;
}


class LogWithMillisDiff {
  private prevTime: number;
  private currTime: number;

  constructor() {
    this.prevTime = this.currTime = this.getCurrentTimeMillis();
  }

  public log(input: string): void {
    this.currTime = this.getCurrentTimeMillis()
    console.log(`${input} (+${this.currTime - this.prevTime}ms)`);
    this.prevTime = this.currTime;
  }

  private getCurrentTimeMillis(): number {
    return new Date().getTime();
  }
}

/**
 * Thrown when an `inputURL` responds with a non-2xx status.
 *
 * Without this check the response body is fed straight to the YAML parser, and
 * a body like `not found` is a *valid YAML string scalar* -- so it parses
 * cleanly, gets cast to SwaggerV3, and the merge silently produces a spec with
 * no `info` block while exiting 0.
 */
export class InputUrlStatusError extends Error {
  public constructor(
    public readonly url: string,
    public readonly status: number,
    statusText: string,
  ) {
    super(`Received HTTP ${status}${statusText ? ` ${statusText}` : ''} when fetching '${url}'`);
  }

  /**
   * Which exit code this status maps to.
   *
   * The split is by responsibility, because that is what a caller can act on:
   * a 4xx is the request's fault and will fail again identically, a 5xx is the
   * server's and may not. Anything else gets its own code rather than being
   * forced into whichever neighbour is closest.
   */
  public get exitCode(): ExitCode {
    if (this.status >= 400 && this.status < 500) {
      return ExitCode.ErrorInputUrlClientStatus;
    }
    if (this.status >= 500 && this.status < 600) {
      return ExitCode.ErrorInputUrlServerStatus;
    }
    return ExitCode.ErrorInputUrlUnexpectedStatus;
  }
}

/**
 * Version problems get their own exit code because their remedy is different:
 * `ErrorMerging` means the documents conflict and the merge config needs to
 * change; `ErrorOpenApiVersion` means they were never eligible to be merged
 * together and the inputs themselves need to change.
 */
function exitCodeForMergeError(type: ErrorMergeResult['type']): ExitCode {
  switch (type) {
    case 'unsupported-openapi-version':
    case 'mixed-openapi-versions':
      return ExitCode.ErrorOpenApiVersion;
    default:
      return ExitCode.ErrorMerging;
  }
}

async function loadOasForInput(basePath: string, input: ConfigurationInput, inputIndex: number, logger: LogWithMillisDiff): Promise<Swagger.SwaggerV3> {
  if (isConfigurationInputFromFile(input)) {
    const fullPath = resolveConfigPath(basePath, input.inputFile);
    logger.log(`## Loading input ${inputIndex}: ${fullPath}`);
    return (await readYamlOrJSON(await readFileAsString(fullPath))) as Swagger.SwaggerV3;
  } else {
    logger.log(`## Loading input ${inputIndex} from URL: ${input.inputURL}`);
    const response = await fetch(input.inputURL);
    if (!response.ok) {
      throw new InputUrlStatusError(input.inputURL, response.status, response.statusText);
    }
    const inputContents = await response.text();
    return (await readYamlOrJSON(inputContents)) as Swagger.SwaggerV3;
  }
}

type InputConversionError = {
  message: string;
  exitCode: ExitCode;
};

type InputConversionErrors = {
  errors: string[];
  exitCode: ExitCode;
};

function isConversionError(s: SingleMergeInput | InputConversionError): s is InputConversionError {
  return 'message' in s && 'exitCode' in s;
}

function isSingleMergeInput(i: SingleMergeInput | InputConversionError): i is SingleMergeInput {
  return !isConversionError(i);
}

async function convertInputs(basePath: string, configInputs: ConfigurationInput[], logger: LogWithMillisDiff): Promise<MergeInput | InputConversionErrors> {
  const results = await Promise.all(configInputs.map<Promise<SingleMergeInput | InputConversionError>>(async (input, inputIndex) => {
    try {
      const oas = await loadOasForInput(basePath, input, inputIndex, logger);

      const output: SingleMergeInput = {
        oas,
        pathModification: input.pathModification,
        operationSelection: input.operationSelection,
        description: input.description,
        duplicatePathHandling: input.duplicatePathHandling,
      };

      if ('dispute' in input) {
        return {
          ...output,
          dispute: input.dispute
        };
      } else if ('disputePrefix' in input) {
        return {
          ...output,
          disputePrefix: input.disputePrefix
        };
      }

      return output;
    } catch (e) {
      return {
        message: `Input ${inputIndex}: could not load configuration file. ${e}`,
        exitCode: e instanceof InputUrlStatusError
          ? e.exitCode
          : ExitCode.ErrorLoadingInputs,
      };
    }
  }));

  const errors = results.filter(isConversionError);

  if (errors.length > 0) {
    // `Promise.all` preserves the order of `configInputs`, so "the first input
    // that failed" is deterministic. When inputs fail for different reasons we
    // report that first failure's code rather than trying to rank them.
    return { errors: errors.map(e => e.message), exitCode: errors[0].exitCode };
  }

  return results.filter(isSingleMergeInput);
}

function isYamlExtension(filePath: string): boolean {
  const extension = path.extname(filePath);
  return ['.yaml', '.yml'].includes(extension);
}

function dumpAsYaml(blob: unknown, indent: Indent = DEFAULT_INDENT): string {
  // Note: The JSON stringify and parse is required to strip the undefined values: https://github.com/nodeca/js-yaml/issues/571
  return dumpYaml(JSON.parse(JSON.stringify(blob)), { indent: indentToYamlArg(indent) });
}

function writeOutput(outputFullPath: string, outputSchema: OpenApiDocument, indent: Indent = DEFAULT_INDENT): void {
  const fileContents = isYamlExtension(outputFullPath)
    ? dumpAsYaml(outputSchema, indent)
    : JSON.stringify(outputSchema, null, indentToJsonStringifyArg(indent));

  fs.writeFileSync(outputFullPath, fileContents);
}

export async function main(): Promise<void> {
  const logger = new LogWithMillisDiff();
  const program = buildProgram();
  program.parse(process.argv);
  const options = program.opts<CliOptions>();
  logger.log(`## ${process.argv[0]}: Running v${pjson.version}`);

  const config = await loadConfiguration(options.config);

  if (typeof config === 'string') {
    console.error(config);
    process.exit(ExitCode.ErrorLoadingConfig);
    return;
  }

  logger.log(`## Loaded the configuration: ${config.inputs.length} inputs`);

  const basePath = path.dirname(options.config || './');

  const inputs = await convertInputs(basePath, config.inputs, logger);

  if ('errors' in inputs) {
    inputs.errors.forEach(error => console.error(error));
    process.exit(inputs.exitCode);
    return;
  }

  logger.log(`## Loaded the inputs into memory, merging the results.`);

  const mergeResult = merge(inputs, { serversStrategy: config.serversStrategy });

  if (isErrorResult(mergeResult)) {
    console.error(`Error merging files: ${mergeResult.message} (${mergeResult.type})`);
    process.exit(exitCodeForMergeError(mergeResult.type));
    return;
  }

  const outputFullPath = resolveConfigPath(basePath, config.output);

  // The CLI flag overrides whatever is in the config file. Both are resolved
  // against the config's directory so that relative `outputRoot` values mean
  // what a config author would expect.
  const outputRootRaw: string | undefined = options.restrictOutputTo || config.outputRoot;
  const outputRoot = outputRootRaw === undefined ? undefined : resolveConfigPath(basePath, outputRootRaw);

  try {
    assertOutputContained(outputFullPath, outputRoot);
  } catch (e) {
    if (e instanceof OutputOutsideRootError) {
      console.error(e.message);
      process.exit(ExitCode.ErrorUnsafePath);
      return;
    }
    throw e;
  }

  logger.log(`## Inputs merged, writing the results out to '${outputFullPath}'`);


  writeOutput(outputFullPath, mergeResult.output, config.formatting?.indent);

  logger.log(`## Finished writing to '${outputFullPath}'`);
}