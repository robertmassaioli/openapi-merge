import { MergeInput, ErrorMergeResult } from "./data";
import { Swagger, SwaggerTypeChecks as TC } from "atlassian-openapi";
import { walkAllReferences, walkSchemaReferences } from "./reference-walker";
import * as _ from 'lodash';

export type PathAndComponents = {
  paths: Swagger.Paths;
  components: Swagger.Components;
};

function removeFromStart(input: string, trim: string): string {
  if (input.startsWith(trim)) {
    return input.substring(trim.length);
  }

  return input;
}

/*
Merge algorithm:

Generate reference mappings for the components. Eliminating duplicates.

Generate reference mappings for the paths.

Copy the elements into the new location.

Update all of the paths and components to the new references.
*/

function referenceCountInSchema(schema: Swagger.Schema): number {
  let count = 0;
  walkSchemaReferences(schema, ref => { count++; return ref; });
  return count;
}

function schemasEqual(a: Swagger.Schema | Swagger.Reference, b: Swagger.Schema | Swagger.Reference): boolean {
  if (!_.isEqual(a, b)) {
    return false;
  }

  if (TC.isReference(a)) {
    return false;
  }

  return referenceCountInSchema(a) === 0;
}

type Components<A> = { [key: string]: A };
type Equal<A> = (x: A, y: A) => boolean;
type AddModRef = (from: string, to: string) => void;

function processComponents<A>(results: Components<A>, components: Components<A>, areEqual: Equal<A>, disputePrefix: string | undefined, addModifiedReference: AddModRef): ErrorMergeResult | undefined {
  for (const key in components) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (components.hasOwnProperty(key)) {
      const component = components[key];

      if (results[key] === undefined || areEqual(results[key], component)) {
        // Add the schema
        results[key] = component;
      } else {
        // Distnguish the name and then add the element
        let schemaPlaced = false;

        // Try and use the dispute prefix first
        if (disputePrefix !== undefined) {
          const preferredSchemaKey = `${disputePrefix}${key}`;
          if (results[preferredSchemaKey] === undefined || areEqual(results[preferredSchemaKey], component)) {
            results[preferredSchemaKey] = component;
            addModifiedReference(key, preferredSchemaKey);
            schemaPlaced = true;
          }
        }

        // Incrementally find the right prefix
        for(let antiConflict = 1; schemaPlaced === false && antiConflict < 1000; antiConflict++) {
          const trySchemaKey = `${key}${antiConflict}`;

          if (results[trySchemaKey] === undefined) {
            results[trySchemaKey] = component;
            addModifiedReference(key, trySchemaKey);
            schemaPlaced = true;
          }
        }

        // In the unlikely event that we can't find a duplicate, return an error
        if (schemaPlaced === false) {
          return {
            type: 'component-definition-conflict',
            message: `The "${key}" definition had a duplicate in a previous input and could not be deduplicated.`
          };
        }
      }
    }
  }
}

export function mergePathsAndComponents(inputs: MergeInput): PathAndComponents | ErrorMergeResult {
  const result: PathAndComponents = {
    paths: {},
    components: {},
  };

  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
    const input = inputs[inputIndex];

    const { oas: originalOas, disputePrefix, pathModification } = input;

    const oas = _.cloneDeep(originalOas);

    // Original references will be transformed to new non-conflicting references
    const referenceModification: { [originalReference: string]: string } = {};

      // For each component in the original input, place it in the output with deduplicate taking place
    if (oas.components !== undefined) {
      if (oas.components.schemas !== undefined) {
        result.components.schemas = result.components.schemas || {};

        processComponents(result.components.schemas, oas.components.schemas, schemasEqual, disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/schemas/${from}`] = `#/components/schemas/${to}`;
        });
      }

      if (oas.components.responses !== undefined) {
        result.components.responses = result.components.responses || {};

        processComponents(result.components.responses, oas.components.responses, () => false, disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/responses/${from}`] = `#/components/responses/${to}`;
        });
      }

      if (oas.components.parameters !== undefined) {
        result.components.parameters = result.components.parameters || {};

        processComponents(result.components.parameters, oas.components.parameters, () => false, disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/parameters/${from}`] = `#/components/parameters/${to}`;
        });
      }

      // examples
      if (oas.components.examples !== undefined) {
        result.components.examples = result.components.examples || {};

        processComponents(result.components.examples, oas.components.examples, () => false, disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/examples/${from}`] = `#/components/examples/${to}`;
        });
      }

      // requestBodies
      if (oas.components.requestBodies !== undefined) {
        result.components.requestBodies = result.components.requestBodies || {};

        processComponents(result.components.requestBodies, oas.components.requestBodies, () => false, disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/requestBodies/${from}`] = `#/components/requestBodies/${to}`;
        });
      }

      // headers
      if (oas.components.headers !== undefined) {
        result.components.headers = result.components.headers || {};

        processComponents(result.components.headers, oas.components.headers, () => false, disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/headers/${from}`] = `#/components/headers/${to}`;
        });
      }

      // security schemes
      /*
      if (oas.components.responses !== undefined) {
        result.components.responses = result.components.responses || {};

        processComponents(result.components.responses, oas.components.responses, () => false, disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/responses/${from}`] = `#/components/responses/${to}`;
        });
      }
      */

      // links
      if (oas.components.links !== undefined) {
        result.components.links = result.components.links || {};

        processComponents(result.components.links, oas.components.links, () => false, disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/links/${from}`] = `#/components/links/${to}`;
        });
      }

      // callbacks
      if (oas.components.callbacks !== undefined) {
        result.components.callbacks = result.components.callbacks || {};

        processComponents(result.components.callbacks, oas.components.callbacks, () => false, disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/callbacks/${from}`] = `#/components/callbacks/${to}`;
        });
      }
    }

    // For each path, convert it into the right format (looking out for duplicates)
    const paths = Object.keys(oas.paths);

    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const originalPath = paths[pathIndex];

      const newPath = pathModification === undefined ? originalPath : `${pathModification.prepend || ''}${removeFromStart(originalPath, pathModification.stripStart || '')}`;

      if (originalPath !== newPath) {
        referenceModification[`#/paths/${originalPath}`] = `#/paths/${newPath}`;
      }

      // TODO perform more advanced matching for an existing path than an equals check
      if (result.paths[newPath] !== undefined) {
        return {
          type: 'duplicate-paths',
          message: `Input ${inputIndex}: The path '${originalPath}' maps to '${newPath}' and this has already been added by another input file`
        };
      }

      result.paths[newPath] = oas.paths[originalPath];
    }

    // Update the references to point to the right location
    const modifiedKeys = Object.keys(referenceModification);
    walkAllReferences(oas, ref => {
      if (referenceModification[ref] !== undefined) {
        return referenceModification[ref];
      }

      const matchingKeys = modifiedKeys.filter(key => key.startsWith(`${ref}/`));

      if (matchingKeys.length > 1) {
        throw new Error(`Found more than one matching key for reference '${ref}': ${JSON.stringify(matchingKeys)}`);
      } else if (matchingKeys.length === 1) {
        return referenceModification[matchingKeys[0]];
      }

      return ref;
    });
  }

  return result;
}