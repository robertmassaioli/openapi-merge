import path from 'path';
import { Configuration } from "./data";
import Ajv from 'ajv';
import ConfigurationSchema from './configuration.schema.json';
import { readFileAsString, readYamlOrJSON } from "./file-loading";
import process from 'process';

const YAML_EXTENSIONS = ['.yaml', '.yml'];

/**
 * Cross-field semantic checks that the generated JSON Schema cannot
 * express on its own. Returns an error message string on failure, or
 * `undefined` on success.
 *
 * Currently:
 * - YAML 1.1 disallows tab characters as indentation. If the output
 *   file extension is `.yaml` or `.yml` AND `formatting.indent.style`
 *   is `'tabs'`, reject with a clear, actionable message (issue #114).
 */
export function validateConfigurationSemantics(config: Configuration): string | undefined {
  const indent = config.formatting?.indent;
  if (indent && indent.style === 'tabs') {
    const ext = path.extname(config.output).toLowerCase();
    if (YAML_EXTENSIONS.includes(ext)) {
      return (
        `Tab indentation is not supported for YAML output (output: '${config.output}'). ` +
        `YAML 1.1 disallows tab characters as indentation. Use ` +
        `{ "style": "spaces", "width": N } in formatting.indent, or write to a ` +
        `.json output.`
      );
    }
  }
  return undefined;
}

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

    const config = data as Configuration;
    const semanticError = validateConfigurationSemantics(config);
    if (semanticError !== undefined) {
      return semanticError;
    }

    return config;
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
    return `Could not find or read '${configFile}' in the current directory: ${process.cwd()}`;
  }
}