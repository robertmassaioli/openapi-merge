import { ConfigurationInput } from "./data";
import { loadConfiguration } from "./load-configuration";
import { Command } from 'commander';
/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const pjson = require('../package.json');
import { merge, MergeInput } from 'openapi-merge';
import fs from 'fs';
import path from 'path';
import { isErrorResult } from "openapi-merge/dist/data";

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

function convertInputs(basePath: string, configInputs: ConfigurationInput[], logger: LogWithMillisDiff): MergeInput | string {
  const results: MergeInput = [];

  for (let inputIndex = 0; inputIndex < configInputs.length; inputIndex++) {
    const input = configInputs[inputIndex];

    try {
      const fullPath = path.join(basePath, input.inputFile);
      logger.log(`## Loading input ${inputIndex}: ${fullPath}`);
      const rawData = JSON.parse(fs.readFileSync(fullPath).toString('utf-8'));

      results.push({
        oas: rawData, // Just assume that it is a valid file. Could improve this and do a rudimentary check
        disputePrefix: input.disputePrefix,
        pathModification: input.pathModification
      });
    } catch (e) {
      return `Input ${inputIndex}: could not load configuration file. ${e}`;
    }
  }

  return results;
}

export function main(): void {
  const logger = new LogWithMillisDiff();
  program.parse(process.argv);

  const config = loadConfiguration(program.config);

  if (typeof config === 'string') {
    console.error(config);
    process.exit(ERROR_LOADING_CONFIG);
    return;
  }

  logger.log(`## Loaded the configuration: ${config.inputs.length} inputs`);

  const basePath = path.dirname(program.config || './');

  const inputs = convertInputs(basePath, config.inputs, logger);

  if (typeof inputs === 'string') {
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

main();