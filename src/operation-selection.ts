import _ from 'lodash';
import { Swagger } from "atlassian-openapi";
import { OperationSelection } from './data';

const allMethods: Swagger.Method[] = [
  'get' , 'put' , 'post' , 'delete' , 'options' , 'head' , 'patch' , 'trace'
]

function operationContainsAnyTag(operation: Swagger.Operation, tags: string[]): boolean {
  return operation.tags !== undefined && operation.tags.some(tag => tags.includes(tag));
}

function dropOperationsThatHaveTags(originalOas: Swagger.SwaggerV3, excludedTags: string[]): Swagger.SwaggerV3 {
  if (excludedTags.length === 0) {
    return originalOas;
  }

  const oas = _.cloneDeep(originalOas);

  for (const path in oas.paths) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (oas.paths.hasOwnProperty(path)) {
      const pathItem = oas.paths[path];

      for (let i = 0; i < allMethods.length; i++) {
        const method = allMethods[i];
        const operation = pathItem[method];

        if (operation !== undefined && operationContainsAnyTag(operation, excludedTags)) {
          delete pathItem[method];
        }
      }
    }
  }

  return oas;
}

function includeOperationsThatHaveTags(originalOas: Swagger.SwaggerV3, includeTags: string[]): Swagger.SwaggerV3 {
  if (includeTags.length === 0) {
    return originalOas;
  }

  const oas = _.cloneDeep(originalOas);

  for (const path in oas.paths) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (oas.paths.hasOwnProperty(path)) {
      const pathItem = oas.paths[path];

      for (let i = 0; i < allMethods.length; i++) {
        const method = allMethods[i];
        const operation = pathItem[method];

        if (operation !== undefined && !operationContainsAnyTag(operation, includeTags)) {
          delete pathItem[method];
        }
      }
    }
  }

  return oas;
}


export function runOperationSelection(originalOas: Swagger.SwaggerV3, operationSelection: OperationSelection | undefined): Swagger.SwaggerV3 {
  if (operationSelection === undefined) {
    return originalOas;
  }

  return dropOperationsThatHaveTags(includeOperationsThatHaveTags(originalOas, operationSelection.includeTags || []), operationSelection.excludeTags || []);
}