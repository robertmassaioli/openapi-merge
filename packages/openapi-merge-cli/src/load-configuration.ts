import path from 'path';
import { Configuration } from "./data";
import Ajv from 'ajv';
// ajv 8 unbundled its format validators. The generated schema uses `format:
// "uri"` on inputURL, which ajv 8 rejects as an unknown format unless the
// standard formats are registered explicitly.
import addFormats from 'ajv-formats';
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

/**
 * Validates an already-parsed configuration against the generated schema.
 *
 * Exported so that a configuration synthesized from command-line arguments
 * (issue #45) is checked by exactly the same schema as one read from a file,
 * rather than by a second, drifting set of checks.
 */
export function validateConfigurationData(data: unknown): Configuration | string {
  try {
    const ajv = new Ajv();
    addFormats(ajv);
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

async function validateConfiguration(rawData: string): Promise<Configuration | string> {
  try {
    return validateConfigurationData(await readYamlOrJSON(rawData));
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
  } catch {
    // The specific fs error is deliberately not surfaced: the actionable part is
    // which path was tried and from where.
    return `Could not find or read '${configFile}' in the current directory: ${process.cwd()}`;
  }
}