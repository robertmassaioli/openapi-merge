import _ from 'lodash';
import { Swagger } from "@atlassian/atlassian-openapi";
import { OperationSelection } from './data';
import { getPathItemOperations, HttpMethod, OpenApiDocument, PathItem32, PathItemMap } from './oas31';
import { TagMatcher } from './tag-matching';

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

function operationContainsAnyTag(operation: Swagger.Operation, matcher: TagMatcher): boolean {
  return matcher.matchesAny(operation.tags);
}

/**
 * Every Path Item map in a document that holds operations subject to selection:
 * `paths` and, from 3.1, `webhooks`.
 *
 * Webhook operations are operations. Filtering only `paths` meant `excludeTags`
 * silently failed to remove a tagged webhook operation, which is exactly the
 * kind of quiet omission the whole tag mechanism exists to prevent.
 */
function operationBearingMaps(oas: OpenApiDocument): Array<PathItemMap | undefined> {
  return [oas.paths, oas.webhooks];
}

/** Remove every operation for which `shouldRemove` holds, across paths and webhooks. */
function removeOperations(
  originalOas: OpenApiDocument,
  shouldRemove: (operation: Swagger.Operation) => boolean,
): OpenApiDocument {
  const oas = _.cloneDeep(originalOas);

  for (const map of operationBearingMaps(oas)) {
    if (map === undefined) {
      continue;
    }

    for (const key of Object.keys(map)) {
      const pathItem = map[key];

      // Covers `query` and every custom verb in `additionalOperations`, so tag
      // filtering cannot silently skip a 3.2 operation either.
      for (const { method, operation, isAdditional } of getPathItemOperations(pathItem)) {
        if (shouldRemove(operation)) {
          deleteOperation(pathItem, method, isAdditional);
        }
      }
    }
  }

  return oas;
}

function dropOperationsThatHaveTags(originalOas: OpenApiDocument, excludedTags: string[]): OpenApiDocument {
  const matcher = new TagMatcher(excludedTags);
  if (matcher.isEmpty) {
    return originalOas;
  }

  return removeOperations(originalOas, operation => operationContainsAnyTag(operation, matcher));
}

function includeOperationsThatHaveTags(originalOas: OpenApiDocument, includeTags: string[]): OpenApiDocument {
  const matcher = new TagMatcher(includeTags);
  if (matcher.isEmpty) {
    return originalOas;
  }

  return removeOperations(originalOas, operation => !operationContainsAnyTag(operation, matcher));
}


export function runOperationSelection(originalOas: OpenApiDocument, operationSelection: OperationSelection | undefined): OpenApiDocument {
  if (operationSelection === undefined) {
    return originalOas;
  }

  return dropOperationsThatHaveTags(includeOperationsThatHaveTags(originalOas, operationSelection.includeTags || []), operationSelection.excludeTags || []);
}