import { ConfigurationInput } from "./data";
import { loadConfiguration } from "./load-configuration";
import { Command } from 'commander';
/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const pjson = require('../package.json');
import { merge, MergeInput } from 'openapi-merge';
import fs from 'fs';
import { isErrorResult } from "openapi-merge/dist/data";

const ERROR_LOADING_CONFIG = 1;
const ERROR_LOADING_INPUTS = 2;
const ERROR_MERGING = 3;

const program = new Command();

program.version(pjson.version);

program
  .option('-c, --config <config_file>', 'The path to the configuration file for the merge tool.');

function convertInputs(configInputs: ConfigurationInput[]): MergeInput | string {
  const results: MergeInput = [];

  for (let inputIndex = 0; inputIndex < configInputs.length; inputIndex++) {
    const input = configInputs[inputIndex];

    try {
      const rawData = JSON.parse(fs.readFileSync(input.inputFile).toString('utf-8'));

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
  program.parse(process.argv);

  const config = loadConfiguration(program.config);

  if (typeof config === 'string') {
    console.error(config);
    process.exit(ERROR_LOADING_CONFIG);
    return;
  }

  console.log(JSON.stringify(config));

  const inputs = convertInputs(config.inputs)

  if (typeof inputs === 'string') {
    console.error(inputs);
    process.exit(ERROR_LOADING_INPUTS);
    return;
  }

  const mergeResult = merge(inputs);

  if (isErrorResult(mergeResult)) {
    console.error(`Error merging files: ${mergeResult.message} (${mergeResult.type})`);
    process.exit(ERROR_MERGING);
    return;
  }

  fs.writeFileSync(config.output, JSON.stringify(mergeResult.output, null, 2));
}

main();