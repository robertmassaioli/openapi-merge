import { NarrowedMergeInput, ErrorMergeResult, Dispute } from "./data";
import { Swagger, SwaggerLookup } from "@atlassian/atlassian-openapi";
import { walkAllReferences } from "./reference-walker";
import _ from 'lodash';
import { runOperationSelection } from "./operation-selection";
import { deepEquality } from "./component-equivalence";
import { applyDispute, getDispute } from './dispute';
import { Components31, getPathItemOperations, getPaths, getWebhooks, OpenApiDocument, PathItem32, PathItemMap } from './oas31';

export type PathAndComponents = {
  paths: Swagger.Paths;
  /** 3.1 only; empty for 3.0 inputs, which cannot declare webhooks. */
  webhooks: PathItemMap;
  components: Components31;
  /**
   * The document-level `security` array, first-wins as it has always been --
   * but taken from the input AFTER its security-scheme renames were applied.
   *
   * It is returned from here rather than read from the untouched inputs in
   * `index.ts` because only this function knows what got renamed (issue #33).
   * Reading it upstream produced a document whose top-level requirement named
   * a scheme that deduplication had since renamed away.
   */
  security?: Swagger.SecurityRequirement[];
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

function processComponents<A>(results: Components<A>, components: Components<A>, areEqual: Equal<A>, dispute: Dispute | undefined, addModifiedReference: AddModRef): ErrorMergeResult | undefined {
  for (const key in components) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (components.hasOwnProperty(key)) {
      const component = components[key];

      const modifiedKey = applyDispute(dispute, key, 'undisputed');
      if (modifiedKey !== key) {
        addModifiedReference(key, modifiedKey);
      }

      if (results[modifiedKey] === undefined || areEqual(results[modifiedKey], component)) {
        // Add the schema
        results[modifiedKey] = component;
      } else {
        // Distnguish the name and then add the element
        let schemaPlaced = false;

        // Try and use the dispute prefix first
        if (dispute !== undefined) {
          const preferredSchemaKey = applyDispute(dispute, key, 'disputed');
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

function countOperationsInPathItem(pathItem: PathItem32): number {
  // Counts `query` and `additionalOperations` too. Undercounting here is not a
  // cosmetic bug: dropPathItemsWithNoOperations deletes anything scoring zero,
  // so a 3.2 path item using only the new operation slots used to vanish.
  return getPathItemOperations(pathItem).length;
}

/**
 * Whether a Path Item carries anything worth keeping.
 *
 * An operation count of zero is not sufficient: the spec allows a Path Item to
 * be a Reference Object (`$ref` to a Path Item, typically in
 * `components.pathItems`), which has no operations of its own but is the entire
 * content of the entry. Dropping those made `components.pathItems` unusable,
 * because nothing could reference one and survive.
 */
function pathItemHasContent(pathItem: PathItem32): boolean {
  return pathItem.$ref !== undefined || countOperationsInPathItem(pathItem) > 0;
}

function dropPathItemsWithNoOperations(originalOas: OpenApiDocument): OpenApiDocument {
  const oas = _.cloneDeep(originalOas);

  for (const path in oas.paths) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (oas.paths.hasOwnProperty(path)) {
      const pathItem = oas.paths[path];

      if (!pathItemHasContent(pathItem)) {
        delete oas.paths[path];
      }
    }
  }

  return oas;
}

/**
 * Un-registers the operationIds of a path item that is about to be replaced.
 *
 * Under `'prefer-later'` the earlier definition leaves the output, so its ids
 * must leave `seenOperationIds` with it. Otherwise the winning operation
 * collides with an id that is no longer present anywhere and gets renamed to
 * `getThing1` -- leaving a document in which `getThing` does not exist and the
 * surviving operation has a name nobody chose.
 */
function releaseOperationIds(pathItem: PathItem32, seenOperationIds: Set<string>): void {
  for (const { operation } of getPathItemOperations(pathItem)) {
    if (operation.operationId !== undefined) {
      seenOperationIds.delete(operation.operationId);
    }
  }
}

function findUniqueOperationId(operationId: string, seenOperationIds: Set<string>, dispute: Dispute | undefined): string | ErrorMergeResult {
  // Ask `applyDispute` first rather than short-circuiting on "no conflict".
  //
  // This is the whole of issue #40. Component names are renamed by calling
  // `applyDispute(..., 'undisputed')` and letting it decide, so `alwaysApply`
  // is honoured whether or not anything actually collided. Operation IDs used
  // to return early when there was no collision, so `dispute` was never
  // consulted and `alwaysApply` did nothing -- the same configuration renamed
  // schemas but not operationIds, and which operationIds got renamed depended
  // on input order. Deciding here keeps the two paths symmetrical.
  const candidate = applyDispute(dispute, operationId, 'undisputed');

  if (!seenOperationIds.has(candidate)) {
    return candidate;
  }

  // Try the dispute prefix. A no-op when `alwaysApply` already applied it
  // above, which is why the numeric fallback below is what resolves that case.
  if (dispute !== undefined) {
    const disputeOpId = applyDispute(dispute, operationId, 'disputed');
    if (!seenOperationIds.has(disputeOpId)) {
      return disputeOpId;
    }
  }

  // Incrementally find the right suffix. Built on `candidate`, not on the
  // original: under `alwaysApply` the fallback must keep the prefix, otherwise
  // a collision would silently undo the rename the user asked for.
  for (let antiConflict = 1; antiConflict < 1000; antiConflict++) {
    const tryOpId = `${candidate}${antiConflict}`;
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

function ensureUniqueOperationId(operation: Swagger.Operation, seenOperationIds: Set<string>, dispute: Dispute | undefined): ErrorMergeResult | undefined {
  if (operation.operationId !== undefined) {
    const opId = findUniqueOperationId(operation.operationId, seenOperationIds, dispute);
    if (typeof opId === 'string') {
      operation.operationId = opId;
      seenOperationIds.add(opId);
    } else {
      return opId;
    }
  }
}

function ensureUniqueOperationIds(pathItem: PathItem32, seenOperationIds: Set<string>, dispute: Dispute | undefined): ErrorMergeResult | undefined {
  const operations = getPathItemOperations(pathItem);

  for (let opIndex = 0; opIndex < operations.length; opIndex++) {
    const result = ensureUniqueOperationId(operations[opIndex].operation, seenOperationIds, dispute);
    if (result !== undefined) {
      return result;
    }
  }
}

/**
 * Rewrites every security requirement that names a renamed security scheme.
 *
 * A Security Requirement Object is `{ <schemeName>: string[] }` -- the scheme
 * is an object KEY, not a `$ref`. That makes it invisible to the reference
 * walker that fixes up `#/components/...` pointers after deduplication, so
 * without this a disputed scheme rename produces a document whose requirements
 * name a scheme that is not in `components.securitySchemes`. Such a document
 * looks fine and authorises nothing.
 *
 * Covers the document-level `security` array and the per-operation one, across
 * both `paths` and `webhooks`. Mutates in place; the caller owns a deep clone.
 */
function renameSecurityRequirements(oas: OpenApiDocument, renames: { [from: string]: string }): void {
  if (Object.keys(renames).length === 0) {
    return;
  }

  const rewrite = (requirements: Swagger.SecurityRequirement[] | undefined): Swagger.SecurityRequirement[] | undefined => {
    if (requirements === undefined) {
      return undefined;
    }
    return requirements.map(requirement => {
      const renamed: Swagger.SecurityRequirement = {};
      for (const schemeName of Object.keys(requirement)) {
        renamed[renames[schemeName] ?? schemeName] = requirement[schemeName];
      }
      return renamed;
    });
  };

  oas.security = rewrite(oas.security);

  for (const pathItemMap of [oas.paths, oas.webhooks]) {
    for (const key of Object.keys(pathItemMap ?? {})) {
      const pathItem = (pathItemMap ?? {})[key];
      for (const { operation } of getPathItemOperations(pathItem)) {
        operation.security = rewrite(operation.security);
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
export function mergePathsAndComponents(inputs: NarrowedMergeInput): PathAndComponents | ErrorMergeResult {
  const seenOperationIds = new Set<string>();

  const result: PathAndComponents = {
    webhooks: {},
    paths: {},
    components: {},
  };

  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
    const input = inputs[inputIndex];

    const { oas: originalOas, pathModification, operationSelection } = input;
    const dispute = getDispute(input);
    const duplicatePathHandling = input.duplicatePathHandling ?? 'error';

    const oas = dropPathItemsWithNoOperations(runOperationSelection(_.cloneDeep(originalOas), operationSelection));

    // Original references will be transformed to new non-conflicting references
    const referenceModification: { [originalReference: string]: string } = {};

    // Security schemes are addressed by name rather than by `$ref`, so their
    // renames are tracked separately from `referenceModification` (issue #33).
    const securitySchemeRenames: { [originalName: string]: string } = {};

      // For each component in the original input, place it in the output with deduplicate taking place
    if (oas.components !== undefined) {
      const resultLookup = new SwaggerLookup.InternalLookup({ openapi: '3.0.1', info: { title: 'dummy', version: '0' }, paths: {}, components: result.components });
      // InternalLookup is 3.0-shaped and needs a concrete `paths`. A 3.1
      // document may legitimately have none, and the lookup only resolves
      // component `$ref`s, so an empty object is equivalent for its purposes.
      const currentLookup = new SwaggerLookup.InternalLookup({ ...oas, paths: getPaths(oas) });
      // Every deduplicated component type goes through the same machinery. Kept
      // as one list rather than nine near-identical blocks: the duplication is
      // how `pathItems` came to be missing when 3.1 support landed, and how the
      // error return below came to be dropped in all nine places.
      const DEDUPLICATED_COMPONENT_TYPES = [
        'schemas', 'responses', 'parameters', 'examples', 'requestBodies',
        'headers', 'links', 'pathItems', 'callbacks', 'securitySchemes',
      ] as const;

      // Indexing a heterogeneous record by a dynamic key: every value here is a
      // `{ [name: string]: A }`, but TypeScript cannot prove the A matches
      // across the union, so the maps are addressed through one narrow cast.
      // Runtime behaviour is identical to the nine explicit blocks this replaced.
      const incomingComponents = oas.components as unknown as Record<string, Components<unknown> | undefined>;
      const resultComponents = result.components as unknown as Record<string, Components<unknown> | undefined>;

      for (const componentType of DEDUPLICATED_COMPONENT_TYPES) {
        const incoming = incomingComponents[componentType];
        if (incoming === undefined) {
          continue;
        }

        const target = resultComponents[componentType] ?? {};
        resultComponents[componentType] = target;

        // The returned error was previously discarded at all nine call sites,
        // which made 'component-definition-conflict' unreachable and silently
        // dropped the component instead of reporting it.
        const componentError = processComponents(
          target,
          incoming,
          deepEquality(resultLookup, currentLookup),
          dispute,
          (from: string, to: string) => {
            referenceModification[`#/components/${componentType}/${from}`] = `#/components/${componentType}/${to}`;
            if (componentType === 'securitySchemes') {
              securitySchemeRenames[from] = to;
            }
          },
        );

        if (componentError !== undefined) {
          return componentError;
        }
      }

      // A renamed security scheme is not reachable through `referenceModification`.
      // Security requirements name a scheme as an OBJECT KEY -- `{ apiKey: [] }`
      // -- not as a `$ref`, so the reference walker never sees them and a rename
      // would leave every requirement pointing at a scheme that no longer exists.
      // Applied to this input's clone before its operations are copied out.
      renameSecurityRequirements(oas, securitySchemeRenames);
    }

    if (result.security === undefined && oas.security !== undefined) {
      result.security = oas.security;
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
      if (result.paths[newPath] !== undefined && duplicatePathHandling === 'error') {
        return {
          type: 'duplicate-paths',
          message: `Input ${inputIndex}: The path '${originalPath}' maps to '${newPath}' and this has already been added by another input file`
        };
      }

      const isDuplicate = result.paths[newPath] !== undefined;

      if (isDuplicate && duplicatePathHandling === 'skip-later') {
        // Skipped before `ensureUniqueOperationIds`, deliberately: a path that
        // is not going into the output must not consume operationIds, or it
        // would push an unrelated later operation onto a numeric suffix for a
        // collision with something that was discarded.
        continue;
      }

      if (isDuplicate) {
        // 'prefer-later' by elimination: 'error' returned and 'skip-later'
        // continued above.
        releaseOperationIds(result.paths[newPath], seenOperationIds);
      }

      const copyPathItem = getPaths(oas)[originalPath];

      // Previously discarded, which made 'operation-id-conflict' unreachable.
      const pathOpIdError = ensureUniqueOperationIds(copyPathItem, seenOperationIds, dispute);
      if (pathOpIdError !== undefined) {
        return pathOpIdError;
      }

      result.paths[newPath] = copyPathItem;
    }

    // Webhooks (3.1) are a map of Path Items keyed by an event name. They merge
    // like paths -- same duplicate rule, same operationId uniqueness, same
    // reference rewriting -- but pathModification deliberately does NOT apply:
    // a webhook key is an event name, not a URL path, so prepending "/api" to
    // it would be meaningless.
    const webhookNames = Object.keys(getWebhooks(oas));

    for (let webhookIndex = 0; webhookIndex < webhookNames.length; webhookIndex++) {
      const webhookName = webhookNames[webhookIndex];

      if (result.webhooks[webhookName] !== undefined && duplicatePathHandling === 'error') {
        return {
          type: 'duplicate-webhooks',
          message: `Input ${inputIndex}: The webhook '${webhookName}' has already been added by another input file`
        };
      }

      if (result.webhooks[webhookName] !== undefined && duplicatePathHandling === 'skip-later') {
        continue;
      }

      if (result.webhooks[webhookName] !== undefined) {
        releaseOperationIds(result.webhooks[webhookName], seenOperationIds);
      }

      const copyWebhook = getWebhooks(oas)[webhookName];

      const webhookOpIdError = ensureUniqueOperationIds(copyWebhook, seenOperationIds, dispute);
      if (webhookOpIdError !== undefined) {
        return webhookOpIdError;
      }

      result.webhooks[webhookName] = copyWebhook;
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