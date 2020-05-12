import { Configuration } from "./data";
import Ajv from 'ajv';
import ConfigurationSchema from './configuration.schema.json';
import fs from 'fs';

function validateConfiguration(rawData: string): Configuration | string {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  let data: any;
  try {
    data = JSON.parse(rawData);
  } catch (e) {
    return `Could not parse configuration: ${e}`;
  }

  const ajv = new Ajv();
  const validate = ajv.compile(ConfigurationSchema);
  const valid = validate(data);

  if (!valid) {
    return ajv.errorsText(validate.errors);
  }

  return data;
}

const STANDARD_CONFIG_FILE = 'openapi-merge.json';

export function loadConfiguration(configLocation?: string): Configuration | string {
  const configFile = configLocation === undefined ? STANDARD_CONFIG_FILE : configLocation;

  try {
    const rawData = fs.readFileSync(configFile);

    return validateConfiguration(rawData.toString('utf8'));
  } catch (e) {
    return `Could not find or read '${configFile}' in the current directory.`
  }
}