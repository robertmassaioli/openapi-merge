import { MergeInput, ErrorMergeResult } from "./data";
import { Swagger } from "atlassian-openapi";

export type PathAndComponents = {
  paths: Swagger.Paths;
  components: Swagger.Components;
};

/*
Merge algorithm:

Generate reference mappings for the components. Eliminating duplicates.

Generate reference mappings for the paths.

Copy the elements into the new location.

Update all of the paths and components to the new references.
*/

export function mergePathsAndComponents(inputs: MergeInput): PathAndComponents | ErrorMergeResult {
  const result: PathAndComponents = {
    paths: {},
    components: {},
  };

  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
    const input = inputs[inputIndex];

    const { oas, referenceOverrides, disputePrefix, pathModification } = input;

    // Original references will be transformed to new non-conflicting references
    const referenceModification: { [originalReference: string]: string } = {};

      // For each component in the original input, place it in the output with deduplicate taking place
    if (oas.components !== undefined) {
      if (oas.components.schemas !== undefined) {
        const resultSchemas: Swagger.Components['schemas'] = result.components.schemas || {};
        result.components.schemas = resultSchemas;

        const schemaKeys = Object.keys(oas.components.schemas);

        for (let schemaKeyIndex = 0; schemaKeyIndex < schemaKeys.length; schemaKeyIndex++) {
          const schemaKey = schemaKeys[schemaKeyIndex];

          if (resultSchemas[schemaKey] === undefined) {
            // Add the schema
            resultSchemas[schemaKey] = oas.components.schemas[schemaKey];
          } else {
            // Distnguish the name and then add the element
            let schemaPlaced = false;

            // Try and use the dispute prefix first
            if (disputePrefix !== undefined) {
              const preferredSchemaKey = `${disputePrefix}${schemaKey}`;
              if (resultSchemas[preferredSchemaKey] === undefined) {
                resultSchemas[preferredSchemaKey] = oas.components.schemas[schemaKey];
                referenceModification[`#/components/${schemaKey}`] = `#/components/${preferredSchemaKey}`;
                schemaPlaced = true;
              }
            }

            // Incrementally find the right prefix
            for(let antiConflict = 1; schemaPlaced === false && antiConflict < 1000; antiConflict++) {
              const trySchemaKey = `${schemaKey}${antiConflict}`;

              if (resultSchemas[trySchemaKey] === undefined) {
                resultSchemas[trySchemaKey] = oas.components.schemas[schemaKey];
                referenceModification[`#/components/${schemaKey}`] = `#/components/${trySchemaKey}`;
                schemaPlaced = true;
              }
            }

            // In the unlikely event that we can't find a duplicate, return an error
            if (schemaPlaced === false) {
              return {
                type: 'component-definition-conflict',
                message: `Input ${inputIndex}: The "${schemaKey}" definition had a duplicate in a previous input and could not be deduplicated.`
              };
            }
          }
        }
      }
    }

    // For each path, convert it into the right format (looking out for duplicates)
    const paths = Object.keys(oas.paths);

    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const originalPath = paths[pathIndex];

      const newPath = pathModification === undefined ? originalPath : `${pathModification.prepend || ''}${removeFromStart(originalPath, pathModification.stripStart || '')}`;

      // TODO perform more advanced matching for an existing path than an equals check
      if (result.paths[newPath] !== undefined) {
        return {
          type: 'duplicate-paths',
          message: `Input ${inputIndex}: The path '${originalPath}' maps to '${newPath}' and this has already been added by another input file`
        };
      }

      result.paths[newPath] = oas.paths[originalPath];
    }
  }

  return result;
}

function removeFromStart(input: string, trim: string): string {
  if (input.startsWith(trim)) {
    return input.substring(trim.length);
  }

  return input;
}