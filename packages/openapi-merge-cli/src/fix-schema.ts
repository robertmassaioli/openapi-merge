import fs from 'fs';
import path from 'path';

const inputFile = path.join('src', 'configuration.schema.json');

const schema = JSON.parse(fs.readFileSync(inputFile).toString());

schema.$id = "https://github.com/robertmassaioli/openapi-merge/blob/main/packages/openapi-merge-cli/src/data.ts";
schema.title = "Configuration";
schema.description = "The Configuration file for the OpenAPI Merge CLI Tool.";

fs.writeFileSync(inputFile, JSON.stringify(schema, null, 2));