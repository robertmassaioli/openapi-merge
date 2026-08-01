import path from 'path';
import { Configuration } from "./data";
import Ajv from 'ajv';
// ajv 8 unbundled its format validators. The generated schema uses `format:
// "uri"` on inputURL, which ajv 8 rejects as an unknown format unless the
// standard formats are registered explicitly.
import addFormats from 'ajv-formats';
import ConfigurationSchema from './configuration.schema.json';
import { readFileAsString, readYamlOrJSON } from "./file-loading";
import { STANDARD_CONFIG_FILE_CANDIDATES } from "./config-file-names";
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
  try {
    const data = await readYamlOrJSON(rawData);

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

/**
 * Loads the configuration from an explicit path (`-c`, or a path a caller
 * already resolved). One file, one attempt -- unlike the no-`-c` default
 * below, there is nothing to fall back to.
 */
async function loadFromExplicitPath(configFile: string): Promise<Configuration | string> {
  try {
    const rawData = await readFileAsString(configFile);

    return await validateConfiguration(rawData);
  } catch {
    // The specific fs error is deliberately not surfaced: the actionable part is
    // which path was tried and from where.
    return `Could not find or read '${configFile}' in the current directory: ${process.cwd()}`;
  }
}

/**
 * Resolves the no-`-c` default: try `openapi-merge.yaml` first, then fall
 * back to `openapi-merge.json` (`STANDARD_CONFIG_FILE_CANDIDATES`, in that
 * order) for anyone with a configuration written before `init` moved to
 * YAML. Only a *missing or unreadable* candidate falls through -- a
 * candidate that exists but fails to parse or validate is reported as-is,
 * rather than silently trying the next name and masking the real problem.
 */
export async function loadConfiguration(
  configLocation?: string,
  onDefaultResolved?: (fileName: string) => void,
): Promise<Configuration | string> {
  if (configLocation !== undefined) {
    return loadFromExplicitPath(configLocation);
  }

  for (const candidate of STANDARD_CONFIG_FILE_CANDIDATES) {
    let rawData: string;
    try {
      rawData = await readFileAsString(candidate);
    } catch {
      continue;
    }
    onDefaultResolved?.(candidate);
    return await validateConfiguration(rawData);
  }

  return (
    `Could not find or read '${STANDARD_CONFIG_FILE_CANDIDATES.join("' or '")}' ` +
    `in the current directory: ${process.cwd()}`
  );
}