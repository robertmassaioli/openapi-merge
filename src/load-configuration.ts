import { Configuration } from "./data";
import Ajv from 'ajv';
import ConfigurationSchema from './configuration.schema.json';
import { readFileAsString, readYamlOrJSON } from "./file-loading";

async function validateConfiguration(rawData: string): Promise<Configuration | string> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  try {
    const data = await readYamlOrJSON(rawData);

    const ajv = new Ajv();
    const validate = ajv.compile(ConfigurationSchema);
    const valid = validate(data);

    if (!valid) {
      return ajv.errorsText(validate.errors);
    }

    return data as Configuration;
  } catch (e) {
    return `Could not parse configuration: ${e}`;
  }
}

const STANDARD_CONFIG_FILE = 'openapi-merge.json';

export async function loadConfiguration(configLocation?: string): Promise<Configuration | string> {
  const configFile = configLocation === undefined ? STANDARD_CONFIG_FILE : configLocation;

  try {
    const rawData = await readFileAsString(configFile);

    return await validateConfiguration(rawData);
  } catch (e) {
    return `Could not find or read '${configFile}' in the current directory.`
  }
}