import { ConfigurationInput, isConfigurationInputFromFile } from "./data";
import { loadConfiguration } from "./load-configuration";
import { Command } from 'commander';
/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const pjson = require('../package.json');
import { merge, MergeInput } from 'openapi-merge';
import fs from 'fs';
import path from 'path';
import { isErrorResult, SingleMergeInput } from "openapi-merge/dist/data";
import { Swagger } from "atlassian-openapi";
import fetch from 'isomorphic-fetch';

const ERROR_LOADING_CONFIG = 1;
const ERROR_LOADING_INPUTS = 2;
const ERROR_MERGING = 3;

const program = new Command();

program.version(pjson.version);

program
  .option('-c, --config <config_file>', 'The path to the configuration file for the merge tool.');


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

async function loadOasForInput(basePath: string, input: ConfigurationInput, inputIndex: number, logger: LogWithMillisDiff): Promise<Swagger.SwaggerV3> {
  if (isConfigurationInputFromFile(input)) {
    const fullPath = path.join(basePath, input.inputFile);
    logger.log(`## Loading input ${inputIndex}: ${fullPath}`);
    return JSON.parse(fs.readFileSync(fullPath).toString('utf-8'));
  } else {
    logger.log(`## Loading input ${inputIndex} from URL: ${input.inputURL}`);
    return await fetch(input.inputURL).then(rsp => rsp.json());
  }
}

type InputConversionErrors = {
  errors: string[];
};

function isString<A extends object>(s: A | string): s is string {
  return typeof s === 'string';
}

function isSingleMergeInput(i: SingleMergeInput | string): i is SingleMergeInput {
  return typeof i !== 'string';
}

async function convertInputs(basePath: string, configInputs: ConfigurationInput[], logger: LogWithMillisDiff): Promise<MergeInput | InputConversionErrors> {
  const results = await Promise.all(configInputs.map<Promise<SingleMergeInput | string>>(async (input, inputIndex) => {
    try {
      const oas = await loadOasForInput(basePath, input, inputIndex, logger);

      return {
        oas,
        disputePrefix: input.disputePrefix,
        pathModification: input.pathModification,
        operationSelection: input.operationSelection
      };
    } catch (e) {
      return `Input ${inputIndex}: could not load configuration file. ${e}`;
    }
  }));

  const errors = results.filter(isString);

  if (errors.length > 0) {
    return { errors };
  }

  return results.filter(isSingleMergeInput);
}

export async function main(): Promise<void> {
  const logger = new LogWithMillisDiff();
  program.parse(process.argv);
  logger.log(`## ${process.argv[0]}: Running v${pjson.version}`);

  const config = loadConfiguration(program.config);

  if (typeof config === 'string') {
    console.error(config);
    process.exit(ERROR_LOADING_CONFIG);
    return;
  }

  logger.log(`## Loaded the configuration: ${config.inputs.length} inputs`);

  const basePath = path.dirname(program.config || './');

  const inputs = await convertInputs(basePath, config.inputs, logger);

  if ('errors' in inputs) {
    console.error(inputs);
    process.exit(ERROR_LOADING_INPUTS);
    return;
  }

  logger.log(`## Loaded the inputs into memory, merging the results.`);

  const mergeResult = merge(inputs);

  if (isErrorResult(mergeResult)) {
    console.error(`Error merging files: ${mergeResult.message} (${mergeResult.type})`);
    process.exit(ERROR_MERGING);
    return;
  }

  const outputFullPath = path.join(basePath, config.output);
  logger.log(`## Inputs merged, writing the results out to '${outputFullPath}'`);

  fs.writeFileSync(outputFullPath, JSON.stringify(mergeResult.output, null, 2));

  logger.log(`## Finished writing to '${outputFullPath}'`);
}