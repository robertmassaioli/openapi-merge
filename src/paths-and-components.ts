import { MergeInput, ErrorMergeResult } from "./data";
import { Swagger, SwaggerLookup } from "atlassian-openapi";
import { walkAllReferences } from "./reference-walker";
import _ from 'lodash';
import { runOperationSelection } from "./operation-selection";
import { deepEquality } from "./component-equivalence";

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

function countOperationsInPathItem(pathItem: Swagger.PathItem): number {
  let count = 0;
  count += pathItem.get !== undefined ? 1 : 0;
  count += pathItem.put !== undefined ? 1 : 0;
  count += pathItem.post !== undefined ? 1 : 0;
  count += pathItem.delete !== undefined ? 1 : 0;
  count += pathItem.options !== undefined ? 1 : 0;
  count += pathItem.head !== undefined ? 1 : 0;
  count += pathItem.patch !== undefined ? 1 : 0;
  count += pathItem.trace !== undefined ? 1 : 0;
  return count;
}

function dropPathItemsWithNoOperations(originalOas: Swagger.SwaggerV3): Swagger.SwaggerV3 {
  const oas = _.cloneDeep(originalOas);

  for (const path in oas.paths) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (oas.paths.hasOwnProperty(path)) {
      const pathItem = oas.paths[path];

      if (countOperationsInPathItem(pathItem) === 0) {
        delete oas.paths[path];
      }
    }
  }

  return oas;
}

function findUniqueOperationId(operationId: string, seenOperationIds: Set<string>, disputePrefix: string | undefined): string | ErrorMergeResult {
  if (!seenOperationIds.has(operationId)) {
    return operationId;
  }

  // Try the dispute prefix
  if (disputePrefix !== undefined) {
    const disputeOpId = `${disputePrefix}${operationId}`;
    if (!seenOperationIds.has(disputeOpId)) {
      return disputeOpId;
    }
  }

  // Incrementally find the right prefix
  for (let antiConflict = 1; antiConflict < 1000; antiConflict++) {
    const tryOpId = `${operationId}${antiConflict}`;
    if (!seenOperationIds.has(tryOpId)) {
      return tryOpId;
    }
  }

  // Fail with an error
  return {
    type: 'operation-id-conflict',
    message: `Could not resolve a conflict for the operationId '${operationId}'`
  };
}

function ensureUniqueOperationId(operation: Swagger.Operation, seenOperationIds: Set<string>, disputePrefix: string | undefined): ErrorMergeResult | undefined {
  if (operation.operationId !== undefined) {
    const opId = findUniqueOperationId(operation.operationId, seenOperationIds, disputePrefix);
    if (typeof opId === 'string') {
      operation.operationId = opId;
      seenOperationIds.add(opId);
    } else {
      return opId;
    }
  }
}

function ensureUniqueOperationIds(pathItem: Swagger.PathItem, seenOperationIds: Set<string>, disputePrefix: string | undefined): ErrorMergeResult | undefined {
  const operations = [
    pathItem.get,
    pathItem.put,
    pathItem.post,
    pathItem.delete,
    pathItem.patch,
    pathItem.head,
    pathItem.trace,
    pathItem.options
  ];

  for (let opIndex = 0; opIndex < operations.length; opIndex++) {
    const operation = operations[opIndex];

    if (operation !== undefined) {
      const result = ensureUniqueOperationId(operation, seenOperationIds, disputePrefix);
      if (result !== undefined) {
        return result;
      }
    }
  }
}

/**
 * Merge algorithm:
 *
 * Generate reference mappings for the components. Eliminating duplicates.
 * Generate reference mappings for the paths.
 * Copy the elements into the new location.
 * Update all of the paths and components to the new references.
 *
 * @param inputs
 */
export function mergePathsAndComponents(inputs: MergeInput): PathAndComponents | ErrorMergeResult {
  const seenOperationIds = new Set<string>();

  const result: PathAndComponents = {
    paths: {},
    components: {},
  };

  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
    const input = inputs[inputIndex];

    const { oas: originalOas, disputePrefix, pathModification, operationSelection } = input;

    const oas = dropPathItemsWithNoOperations(runOperationSelection(_.cloneDeep(originalOas), operationSelection));

    // Original references will be transformed to new non-conflicting references
    const referenceModification: { [originalReference: string]: string } = {};

      // For each component in the original input, place it in the output with deduplicate taking place
    if (oas.components !== undefined) {
      const resultLookup = new SwaggerLookup.InternalLookup({ openapi: '3.0.1', info: { title: 'dummy', version: '0' }, paths: {}, components: result.components });
      const currentLookup = new SwaggerLookup.InternalLookup(oas);
      if (oas.components.schemas !== undefined) {
        result.components.schemas = result.components.schemas || {};

        processComponents(result.components.schemas, oas.components.schemas, deepEquality(resultLookup, currentLookup), disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/schemas/${from}`] = `#/components/schemas/${to}`;
        });
      }

      if (oas.components.responses !== undefined) {
        result.components.responses = result.components.responses || {};

        processComponents(result.components.responses, oas.components.responses, deepEquality(resultLookup, currentLookup), disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/responses/${from}`] = `#/components/responses/${to}`;
        });
      }

      if (oas.components.parameters !== undefined) {
        result.components.parameters = result.components.parameters || {};

        processComponents(result.components.parameters, oas.components.parameters, deepEquality(resultLookup, currentLookup), disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/parameters/${from}`] = `#/components/parameters/${to}`;
        });
      }

      // examples
      if (oas.components.examples !== undefined) {
        result.components.examples = result.components.examples || {};

        processComponents(result.components.examples, oas.components.examples, deepEquality(resultLookup, currentLookup), disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/examples/${from}`] = `#/components/examples/${to}`;
        });
      }

      // requestBodies
      if (oas.components.requestBodies !== undefined) {
        result.components.requestBodies = result.components.requestBodies || {};

        processComponents(result.components.requestBodies, oas.components.requestBodies, deepEquality(resultLookup, currentLookup), disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/requestBodies/${from}`] = `#/components/requestBodies/${to}`;
        });
      }

      // headers
      if (oas.components.headers !== undefined) {
        result.components.headers = result.components.headers || {};

        processComponents(result.components.headers, oas.components.headers, deepEquality(resultLookup, currentLookup), disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/headers/${from}`] = `#/components/headers/${to}`;
        });
      }

      // security schemes are different, we just take the security schemes from the first file that has any
      if (oas.components.securitySchemes !== undefined && Object.keys(oas.components.securitySchemes).length > 0 && result.components.securitySchemes === undefined) {
        result.components.securitySchemes = oas.components.securitySchemes;
      }

      // links
      if (oas.components.links !== undefined) {
        result.components.links = result.components.links || {};

        processComponents(result.components.links, oas.components.links, deepEquality(resultLookup, currentLookup), disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/links/${from}`] = `#/components/links/${to}`;
        });
      }

      // callbacks
      if (oas.components.callbacks !== undefined) {
        result.components.callbacks = result.components.callbacks || {};

        processComponents(result.components.callbacks, oas.components.callbacks, deepEquality(resultLookup, currentLookup), disputePrefix, (from: string, to: string) => {
          referenceModification[`#/components/callbacks/${from}`] = `#/components/callbacks/${to}`;
        });
      }
    }

    // For each path, convert it into the right format (looking out for duplicates)
    const paths = Object.keys(oas.paths || {});

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

      const copyPathItem = oas.paths[originalPath];

      ensureUniqueOperationIds(copyPathItem, seenOperationIds, input.disputePrefix);

      result.paths[newPath] = copyPathItem;
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