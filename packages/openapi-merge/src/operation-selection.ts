import _ from 'lodash';
import { Swagger } from "@atlassian/atlassian-openapi";
import { OperationSelection, PathSelector } from './data';
import { getPathItemOperations, HttpMethod, OpenApiDocument, PathItem32, PathItemMap } from './oas31';
import { TagMatcher } from './tag-matching';
import { PathMatcher } from './path-matching';

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

/**
 * Remove every operation for which `shouldRemove` holds, across paths and
 * webhooks. `path` and `method` are the operation's own, pre-`pathModification`
 * key and method (including a 3.2 `additionalOperations` custom verb) -- a
 * tag-based predicate ignores them; a path-based one (`PathMatcher`) needs
 * them, since neither is present on the Operation Object itself.
 */
function removeOperations(
  originalOas: OpenApiDocument,
  shouldRemove: (operation: Swagger.Operation, path: string, method: string) => boolean,
): OpenApiDocument {
  const oas = _.cloneDeep(originalOas);

  for (const map of operationBearingMaps(oas)) {
    if (map === undefined) {
      continue;
    }

    for (const key of Object.keys(map)) {
      const pathItem = map[key];

      // Covers `query` and every custom verb in `additionalOperations`, so
      // selection cannot silently skip a 3.2 operation either.
      for (const { method, operation, isAdditional } of getPathItemOperations(pathItem)) {
        if (shouldRemove(operation, key, method)) {
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

/**
 * `includePaths`/`excludePaths` (proposal 43 / PR #67).
 *
 * Composed the same way `includeTags`/`excludeTags` already are in
 * `runOperationSelection` below: sequential removal passes, which is what
 * gives "an operation excluded by either kind is excluded" and "an operation
 * must clear every include list configured" for free, without a separate
 * combining step.
 */
function dropOperationsThatHavePaths(originalOas: OpenApiDocument, excludedPaths: PathSelector[]): OpenApiDocument {
  const matcher = new PathMatcher(excludedPaths);
  if (matcher.isEmpty) {
    return originalOas;
  }

  return removeOperations(originalOas, (_operation, path, method) => matcher.matches(path, method));
}

function includeOperationsThatHavePaths(originalOas: OpenApiDocument, includedPaths: PathSelector[]): OpenApiDocument {
  const matcher = new PathMatcher(includedPaths);
  if (matcher.isEmpty) {
    return originalOas;
  }

  return removeOperations(originalOas, (_operation, path, method) => !matcher.matches(path, method));
}

/**
 * Runs before `pathModification` is applied (`paths-and-components.ts`), so
 * `includePaths`/`excludePaths` selectors are matched against this input's
 * own original path spelling, not the path it will have in the merged output.
 */
export function runOperationSelection(originalOas: OpenApiDocument, operationSelection: OperationSelection | undefined): OpenApiDocument {
  if (operationSelection === undefined) {
    return originalOas;
  }

  const byTags = dropOperationsThatHaveTags(
    includeOperationsThatHaveTags(originalOas, operationSelection.includeTags || []),
    operationSelection.excludeTags || [],
  );

  return dropOperationsThatHavePaths(
    includeOperationsThatHavePaths(byTags, operationSelection.includePaths || []),
    operationSelection.excludePaths || [],
  );
}