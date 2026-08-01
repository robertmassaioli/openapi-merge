import { ConfigurationInput, isConfigurationInputFromFile } from "./data";
import { loadConfiguration } from "./load-configuration";
import {
  buildConfiguration, CandidateFile, isScannable, PLACEHOLDER_INPUT, selectInputs, STANDARD_CONFIG_FILE,
} from "./init-command";
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
import { assertInputContained, assertOutputContained, InputOutsideRootError, OutputOutsideRootError, resolveConfigPath } from "./path-resolution";
import { discoverExternalDocuments, DocumentReference, fileInputIdentity, urlInputIdentity } from "./external-reference-discovery";
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
  restrictInputTo?: string;
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
    .option('--restrict-output-to <dir>', 'Refuse to write output anywhere outside this directory (overrides outputRoot in the config).')
    .option('--restrict-input-to <dir>', 'Refuse to read any local input file from outside this directory (overrides inputRoot in the config).');

  // `init` is deliberately NOT registered with `.command()`.
  //
  // Registering a subcommand changes how commander treats a bare invocation:
  // with subcommands present and no default action, `openapi-merge-cli` with no
  // arguments prints help instead of merging. That is the tool's primary use,
  // and silently turning it into a help screen would break every existing
  // pipeline. It is dispatched by hand in `main()` instead, and described here
  // so `--help` still documents it.
  program.addHelpText('after', `
Commands:
  init [--force]             Write a starter openapi-merge.json in the current
                             directory, filled in with any OpenAPI 3.x files
                             found alongside it. Refuses to overwrite an
                             existing configuration unless --force is given.

Run with no arguments to perform the merge described by openapi-merge.json.`);

  return program;
}

/**
 * `openapi-merge-cli init` (see init-command.ts for the scanning decisions).
 *
 * Returns the exit code. Kept out of `main()`'s merge path entirely: `main()`
 * loads the configuration as its first act, which is precisely the file this
 * command exists to create.
 */
async function runInit(force: boolean, logger: LogWithMillisDiff): Promise<ExitCode> {
  const targetPath = path.resolve(process.cwd(), STANDARD_CONFIG_FILE);

  if (fs.existsSync(targetPath) && !force) {
    console.error(
      `'${STANDARD_CONFIG_FILE}' already exists in ${process.cwd()}. ` +
        `Pass --force to overwrite it, or edit the existing file.`,
    );
    return ExitCode.ErrorLoadingConfig;
  }

  const entries = fs.readdirSync(process.cwd(), { withFileTypes: true });
  const candidates: CandidateFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !isScannable(entry.name)) {
      continue;
    }

    // A directory being scanned for specifications is full of files that are
    // not specifications, and several will not parse as JSON or YAML at all.
    // That is ordinary, not an error worth stopping for.
    try {
      candidates.push({
        relativePath: `./${entry.name}`,
        parsed: await readYamlOrJSON(await readFileAsString(entry.name)),
      });
    } catch {
      continue;
    }
  }

  const { inputs, swagger2, minorVersions } = selectInputs(candidates);
  const configuration = buildConfiguration(inputs);

  fs.writeFileSync(targetPath, `${JSON.stringify(configuration, null, 2)}\n`);

  if (inputs.length > 0) {
    logger.log(`## Wrote ${STANDARD_CONFIG_FILE} with ${inputs.length} input${inputs.length === 1 ? '' : 's'}:`);
    inputs.forEach(input => logger.log(`##   ${input}`));
  } else {
    logger.log(`## Wrote ${STANDARD_CONFIG_FILE}. No OpenAPI 3.x files were found here, so it contains a`);
    logger.log(`##   placeholder input -- replace '${PLACEHOLDER_INPUT}' before running the merge.`);
  }

  if (swagger2.length > 0) {
    // Named rather than ignored: people do try to merge 2.0 documents (issue
    // #110), and silence would look like the scan simply missed them.
    logger.log(`## Skipped ${swagger2.length} Swagger 2.0 file${swagger2.length === 1 ? '' : 's'}, which this tool cannot merge:`);
    swagger2.forEach(file => logger.log(`##   ${file}`));
    logger.log('##   Convert them to OpenAPI 3 first, with swagger2openapi or similar.');
  }

  if (minorVersions.length > 1) {
    // Said now, while the user still has the file open, rather than leaving
    // them to discover it as `mixed-openapi-versions` on the next command.
    logger.log(`## WARNING: the inputs declare ${minorVersions.join(' and ')}, and a merge requires them all`);
    logger.log('##   to share one major.minor version. Remove the odd ones out, or convert them,');
    logger.log('##   before running the merge.');
  }

  logger.log(`## Edit ${STANDARD_CONFIG_FILE}, then run openapi-merge-cli to produce '${configuration.output}'.`);

  return ExitCode.Success;
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

async function loadOasForInput(basePath: string, input: ConfigurationInput, inputIndex: number, logger: LogWithMillisDiff, inputRoot: string | undefined): Promise<Swagger.SwaggerV3> {
  if (isConfigurationInputFromFile(input)) {
    const fullPath = resolveConfigPath(basePath, input.inputFile);
    assertInputContained(fullPath, inputRoot);
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

/** The identity a declared input is known by for cross-document `$ref` resolution (issues #104, #10). */
function inputIdentity(basePath: string, input: ConfigurationInput): DocumentReference {
  return isConfigurationInputFromFile(input)
    ? fileInputIdentity(basePath, input.inputFile)
    : urlInputIdentity(input.inputURL);
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

type ConvertedInputs = {
  inputs: MergeInput;
  /** Same order as `inputs` -- each input's own identity for cross-document `$ref` resolution. */
  references: DocumentReference[];
};

async function convertInputs(basePath: string, configInputs: ConfigurationInput[], logger: LogWithMillisDiff, inputRoot: string | undefined): Promise<ConvertedInputs | InputConversionErrors> {
  const results = await Promise.all(configInputs.map<Promise<SingleMergeInput | InputConversionError>>(async (input, inputIndex) => {
    try {
      const oas = await loadOasForInput(basePath, input, inputIndex, logger, inputRoot);

      const output: SingleMergeInput = {
        oas,
        sourceIdentity: inputIdentity(basePath, input).identity,
        pathModification: input.pathModification,
        operationSelection: input.operationSelection,
        description: input.description,
        duplicatePathHandling: input.duplicatePathHandling,
        tag: input.tag,
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
      if (e instanceof InputOutsideRootError) {
        return {
          message: `Input ${inputIndex}: ${e.message}`,
          exitCode: ExitCode.ErrorUnsafeInputPath,
        };
      }
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

  const inputs = results.filter(isSingleMergeInput);
  return { inputs, references: configInputs.map(input => inputIdentity(basePath, input)) };
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

  // Dispatched before the program is even built, so the merge path below is
  // reached with exactly the argv it has always seen.
  if (process.argv[2] === 'init') {
    logger.log(`## ${process.argv[0]}: Running v${pjson.version}`);
    const force = process.argv.slice(3).some(arg => arg === '--force' || arg === '-f');
    const code = await runInit(force, logger);
    if (code !== ExitCode.Success) {
      process.exit(code);
    }
    return;
  }

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

  // The CLI flag overrides whatever is in the config file. Both are resolved
  // against the config's directory so that relative `inputRoot` values mean
  // what a config author would expect. Computed before any input is read, so
  // it can bound the very first file load (proposal 38).
  const inputRootRaw: string | undefined = options.restrictInputTo || config.inputRoot;
  const inputRoot = inputRootRaw === undefined ? undefined : resolveConfigPath(basePath, inputRootRaw);

  const converted = await convertInputs(basePath, config.inputs, logger, inputRoot);

  if ('errors' in converted) {
    converted.errors.forEach(error => console.error(error));
    process.exit(converted.exitCode);
    return;
  }

  const { inputs, references } = converted;

  // Cross-document `$ref` resolution (issues #104, #10). Normalising each
  // input's own refs and resolving anything that names *another* declared
  // input runs unconditionally -- that fix is always safe, since it only
  // ever affects a `$ref` that would otherwise be silently broken.
  // `resolveExternalReferences` controls only whether a `$ref` naming a file
  // or URL nobody declared as an input gets followed and loaded. `inputRoot`
  // bounds where a discovered *file* may come from (proposal 38); a
  // discovered URL is untouched by it.
  const discovery = await discoverExternalDocuments(
    inputs.map((input, i) => ({ document: input.oas, reference: references[i] })),
    config.resolveExternalReferences === true,
    inputRoot,
  );

  // Reported before the containment check below exits, so an ordinary
  // discovery failure elsewhere in the same run is not hidden behind a
  // containment violation -- both are worth knowing about in one pass.
  discovery.warnings.forEach(warning => {
    logger.log(`## WARNING: could not load '${warning.reference.identity}', referenced via $ref -- left unresolved. (${warning.message})`);
  });

  if (discovery.containmentViolations.length > 0) {
    discovery.containmentViolations.forEach(violation => {
      console.error(`${violation.message} (referenced via $ref, not a declared input)`);
    });
    process.exit(ExitCode.ErrorUnsafeInputPath);
    return;
  }

  logger.log(`## Loaded the inputs into memory, merging the results.`);

  const mergeResult = merge(inputs, {
    serversStrategy: config.serversStrategy,
    securitySchemesStrategy: config.securitySchemesStrategy,
    pruneUnusedComponents: config.pruneUnusedComponents,
    externalDocuments: discovery.externalDocuments,
    info: config.info,
  });

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