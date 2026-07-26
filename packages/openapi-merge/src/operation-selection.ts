import _ from 'lodash';
import { Swagger } from "@atlassian/atlassian-openapi";
import { OperationSelection } from './data';
import { getPathItemOperations, HttpMethod, OpenApiDocument, PathItem32 } from './oas31';

/**
 * Remove an operation from a Path Item, whether it sits in a standard method
 * slot or under `additionalOperations`.
 */
function deleteOperation(pathItem: PathItem32, method: string, isAdditional: boolean): void {
  if (isAdditional) {
    delete pathItem.additionalOperations?.[method];
  } else {
    delete pathItem[method as HttpMethod];
  }
}

function operationContainsAnyTag(operation: Swagger.Operation, tags: string[]): boolean {
  return operation.tags !== undefined && operation.tags.some(tag => tags.includes(tag));
}

function dropOperationsThatHaveTags(originalOas: OpenApiDocument, excludedTags: string[]): OpenApiDocument {
  if (excludedTags.length === 0) {
    return originalOas;
  }

  const oas = _.cloneDeep(originalOas);

  for (const path in oas.paths) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (oas.paths.hasOwnProperty(path)) {
      const pathItem = oas.paths[path];

      // Covers `query` and every custom verb in `additionalOperations`, so tag
      // filtering cannot silently skip a 3.2 operation.
      for (const { method, operation, isAdditional } of getPathItemOperations(pathItem)) {
        if (operationContainsAnyTag(operation, excludedTags)) {
          deleteOperation(pathItem, method, isAdditional);
        }
      }
    }
  }

  return oas;
}

function includeOperationsThatHaveTags(originalOas: OpenApiDocument, includeTags: string[]): OpenApiDocument {
  if (includeTags.length === 0) {
    return originalOas;
  }

  const oas = _.cloneDeep(originalOas);

  for (const path in oas.paths) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (oas.paths.hasOwnProperty(path)) {
      const pathItem = oas.paths[path];

      // Covers `query` and every custom verb in `additionalOperations`, so tag
      // filtering cannot silently skip a 3.2 operation.
      for (const { method, operation, isAdditional } of getPathItemOperations(pathItem)) {
        if (!operationContainsAnyTag(operation, includeTags)) {
          deleteOperation(pathItem, method, isAdditional);
        }
      }
    }
  }

  return oas;
}


export function runOperationSelection(originalOas: OpenApiDocument, operationSelection: OperationSelection | undefined): OpenApiDocument {
  if (operationSelection === undefined) {
    return originalOas;
  }

  return dropOperationsThatHaveTags(includeOperationsThatHaveTags(originalOas, operationSelection.includeTags || []), operationSelection.excludeTags || []);
}