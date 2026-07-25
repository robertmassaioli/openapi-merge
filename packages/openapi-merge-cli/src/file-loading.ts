import fs from 'fs';
// js-yaml 5 is ESM with named exports only -- there is no default export.
import { load as loadYaml } from 'js-yaml';

export class JsonOrYamlParseError extends Error {
  constructor(jsonError: Error, yamlError: Error) {
    super(`Failed to parse the input as either JSON or YAML.\n\nJSON Error: ${jsonError.message}\n\nYAML Error: ${yamlError.message}`);
  }
}

function readFilePromise(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  })
}

export async function readFileAsString(filePath: string): Promise<string> {
  return (await readFilePromise(filePath)).toString('utf-8');
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export async function readYamlOrJSON(fileContents: string): Promise<unknown> {
  let jsonError: Error;
  try {
    return JSON.parse(fileContents);
  } catch (e) {
    jsonError = toError(e);
  }

  let yamlError: Error;
  try {
    // `load` is the js-yaml 4+ name for what used to be `safeLoad`: it refuses
    // to instantiate arbitrary types, which is what we want for untrusted specs.
    return loadYaml(fileContents);
  } catch (e) {
    yamlError = toError(e);
  }

  throw new JsonOrYamlParseError(jsonError, yamlError);
}