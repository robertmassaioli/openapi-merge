import fs from 'fs';
import yaml from 'js-yaml';

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

export async function readYamlOrJSON(fileContents: string): Promise<unknown> {
  let jsonError: Error;
  try {
    return JSON.parse(fileContents);
  } catch (e) {
    jsonError = e;
  }

  let yamlError: Error;
  try {
    return yaml.safeLoad(fileContents);
  } catch (e) {
    yamlError = e;
  }

  throw new JsonOrYamlParseError(jsonError, yamlError);
}