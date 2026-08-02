import { MergeInput, ErrorMergeResult, Dispute } from "./data";
import { Swagger, SwaggerLookup } from "@atlassian/atlassian-openapi";
import { walkAllReferences } from "./reference-walker";
import _ from 'lodash';
import { runOperationSelection } from "./operation-selection";
import { isPathItemMergeFailure, mergePathItems } from './merge-path-items';
import { injectTag } from './tag-injection';
import { deepEquality } from "./component-equivalence";
import { applyDispute, getDispute } from './dispute';
import { DEFAULT_SECURITY_SCHEMES_STRATEGY, SecuritySchemesStrategy } from './security-schemes';
import { Components31, getPathItemOperations, getPaths, getWebhooks, OpenApiDocument, PathItem32, PathItemMap } from './oas31';
import { createCrossDocumentResolver, ReferenceModificationByIdentity, splitCrossDocumentRef } from './external-references';
import { isReference, required } from './safe-type-checks';

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

export type Components<A> = { [key: string]: A };
export type Equal<A> = (x: A, y: A) => boolean;
export type AddModRef = (from: string, to: string) => void;

/**
 * Every deduplicated component type goes through the same machinery. Kept as
 * one list rather than nine near-identical blocks: the duplication is how
 * `pathItems` came to be missing when 3.1 support landed, and how the error
 * return in {@link processComponents} came to be dropped in all nine places.
 *
 * Exported (rather than local to {@link mergePathsAndComponents}) so
 * `external-references.ts` validates a pulled-in `$ref`'s fragment against
 * exactly the same set of bucket names this function already deduplicates --
 * one list, not two that can drift apart.
 */
export const DEDUPLICATED_COMPONENT_TYPES = [
  'schemas', 'responses', 'parameters', 'examples', 'requestBodies',
  'headers', 'links', 'pathItems', 'callbacks',
] as const;

export function processComponents<A>(results: Components<A>, components: Components<A>, areEqual: Equal<A>, dispute: Dispute | undefined, addModifiedReference: AddModRef): ErrorMergeResult | undefined {
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
  // `countOperationsInPathItem` first, not `pathItem.$ref` -- it goes through
  // `getPathItemOperations`, which is what actually guards against a `null`
  // Path Item (`paths: { '/a': }`). Checking `.$ref` first would dereference
  // the same `null` unguarded, one line earlier.
  return countOperationsInPathItem(pathItem) > 0 || pathItem.$ref !== undefined;
}

function dropPathItemsWithNoOperations(originalOas: OpenApiDocument): OpenApiDocument {
  const oas = _.cloneDeep(originalOas);

  // Webhooks as well as paths. An `excludeTags` rule that empties a webhook
  // used to leave `{ ping: {} }` behind -- an event the document announces and
  // then says nothing about -- while the equivalent path was dropped. Surfaced
  // by a wildcard test for issue #111; the inconsistency predates it.
  for (const map of [oas.paths, oas.webhooks]) {
    // Not just `!== undefined`: a document in the wild can carry `paths: null`,
    // which the previous `for...in` tolerated silently and `Object.keys` does
    // not. There is a test for exactly that input, and it caught this.
    if (map === undefined || map === null) {
      continue;
    }

    for (const key of Object.keys(map)) {
      if (!pathItemHasContent(map[key])) {
        delete map[key];
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
    const { operation } = operations[opIndex];

    const result = ensureUniqueOperationId(operation, seenOperationIds, dispute);
    if (result !== undefined) {
      return result;
    }

    const callbackError = ensureUniqueCallbackOperationIds(operation, seenOperationIds, dispute);
    if (callbackError !== undefined) {
      return callbackError;
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
  // Runs unconditionally, not gated on `renames` being non-empty: a bare
  // `security: [ ]` list item (a genuine authoring mistake -- see proposal 40)
  // must be caught the same way regardless of whether some *other* scheme
  // elsewhere in this input happened to collide and need renaming. Gating on
  // that would make whether this input's own mistake is caught depend on what
  // else it is merged with, which is not a distinction a config author can see.
  const rewrite = (requirements: Swagger.SecurityRequirement[] | undefined, pointer: string): Swagger.SecurityRequirement[] | undefined => {
    if (requirements === undefined) {
      return undefined;
    }
    // Not just the `undefined` check above: `security:` present but empty
    // (no list at all) parses as `null`, and `.map` on it would otherwise
    // crash -- the exact failure mode this proposal exists to remove.
    const list = required(requirements as Swagger.SecurityRequirement[] | null, 'a Security Requirements array', pointer);
    return list.map((requirement, index) => {
      const item = required(requirement as Swagger.SecurityRequirement | null, 'a Security Requirement Object', `${pointer}/${index}`);
      const renamed: Swagger.SecurityRequirement = {};
      for (const schemeName of Object.keys(item)) {
        renamed[renames[schemeName] ?? schemeName] = item[schemeName];
      }
      return renamed;
    });
  };

  oas.security = rewrite(oas.security, '#/security');

  for (const [mapName, pathItemMap] of [['paths', oas.paths], ['webhooks', oas.webhooks]] as const) {
    for (const key of Object.keys(pathItemMap ?? {})) {
      const pathItem = (pathItemMap ?? {})[key];
      for (const { method, operation } of getPathItemOperations(pathItem)) {
        operation.security = rewrite(operation.security, `#/${mapName}/${key}/${method}/security`);
      }
    }
  }
}

/**
 * Operation IDs nested inside an operation's `callbacks` (issue #105).
 *
 * The specification requires an operationId to be "unique among all operations
 * described in the API", and an operation inside a Callback Object is one of
 * them -- a Callback is a map of runtime expressions to Path Items, and those
 * Path Items hold real operations.
 *
 * They were skipped, so two inputs declaring the same callback operationId
 * produced a document with a duplicate: invalid, and silently so. References
 * inside callbacks were already rewritten correctly, which made this the one
 * remaining callback-shaped gap.
 *
 * A `$ref` callback is left alone: the operations live in the component it
 * points at, and that component is walked in its own right.
 */
function ensureUniqueCallbackOperationIds(
  operation: Swagger.Operation,
  seenOperationIds: Set<string>,
  dispute: Dispute | undefined,
): ErrorMergeResult | undefined {
  const callbacks = operation.callbacks;
  if (callbacks === undefined) {
    return undefined;
  }

  for (const callbackName of Object.keys(callbacks)) {
    const callback = callbacks[callbackName];
    if (isReference(callback, `#/callbacks/${callbackName}`)) {
      continue;
    }

    for (const expression of Object.keys(callback)) {
      const result = ensureUniqueOperationIds(callback[expression] as PathItem32, seenOperationIds, dispute);
      if (result !== undefined) {
        return result;
      }
    }
  }

  return undefined;
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
export function mergePathsAndComponents(
  inputs: MergeInput,
  securitySchemesStrategy: SecuritySchemesStrategy = DEFAULT_SECURITY_SCHEMES_STRATEGY,
  externalDocuments: Record<string, OpenApiDocument> = {},
): PathAndComponents | ErrorMergeResult {
  const seenOperationIds = new Set<string>();

  const result: PathAndComponents = {
    webhooks: {},
    paths: {},
    components: {},
  };

  // Every declared input's own `referenceModification` map, kept past the end
  // of its loop iteration (unlike before #104/#10) so a *different* input's
  // `$ref` into this one -- forward or backward, since this is only read once
  // every input has had its turn -- can be resolved against it in the
  // cross-document pass below.
  const referenceModificationByIdentity: ReferenceModificationByIdentity = {};

  // An identity claimed by more than one input (the config can legitimately
  // list the same file twice, e.g. with different `pathModification`) has no
  // principled resolution -- which copy would a cross-document `$ref` have
  // meant? Treated as unmatched rather than guessed at (issue #104 §5.2).
  const ambiguousIdentities = new Set<string>();
  {
    const seenIdentities = new Set<string>();
    for (const input of inputs) {
      if (input.sourceIdentity === undefined) {
        continue;
      }
      if (seenIdentities.has(input.sourceIdentity)) {
        ambiguousIdentities.add(input.sourceIdentity);
      }
      seenIdentities.add(input.sourceIdentity);
    }
  }

  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
    const input = inputs[inputIndex];

    const { oas: originalOas, pathModification, operationSelection } = input;
    const dispute = getDispute(input);
    const duplicatePathHandling = input.duplicatePathHandling ?? 'error';

    // Tag injection comes last: after selection has decided what survives, and
    // after empty path items are dropped, so nothing is tagged that is not in
    // the output (issue #112).
    const oas = injectTag(
      dropPathItemsWithNoOperations(runOperationSelection(_.cloneDeep(originalOas), operationSelection)),
      input.tag,
    );

    // Original references will be transformed to new non-conflicting references
    const referenceModification: { [originalReference: string]: string } = {};
    if (input.sourceIdentity !== undefined && !ambiguousIdentities.has(input.sourceIdentity)) {
      referenceModificationByIdentity[input.sourceIdentity] = referenceModification;
    }

    // Security schemes are addressed by name rather than by `$ref`, so their
    // renames are tracked separately from `referenceModification` (issue #33).
    const securitySchemeRenames: { [originalName: string]: string } = {};

      // For each component in the original input, place it in the output with deduplicate taking place
    if (oas.components !== undefined) {
      // Not just `!== undefined`: `components:` present but empty parses as
      // `null`, which every access below would otherwise crash on partway
      // through instead of failing clearly, right here.
      const components = required(oas.components as Components31 | null, 'a Components Object', '#/components');
      oas.components = components;

      const resultLookup = new SwaggerLookup.InternalLookup({ openapi: '3.0.1', info: { title: 'dummy', version: '0' }, paths: {}, components: result.components });
      // InternalLookup is 3.0-shaped and needs a concrete `paths`. A 3.1
      // document may legitimately have none, and the lookup only resolves
      // component `$ref`s, so an empty object is equivalent for its purposes.
      const currentLookup = new SwaggerLookup.InternalLookup({ ...oas, paths: getPaths(oas) });

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
          },
        );

        if (componentError !== undefined) {
          return componentError;
        }
      }

      // `securitySchemes` is handled apart from the loop above because, unlike
      // the other nine buckets, how it combines is configurable (issue #33).
      if (components.securitySchemes !== undefined) {
        // Not just `!== undefined`: `securitySchemes:` present but empty
        // parses as `null`, and `Object.keys` below would otherwise crash.
        components.securitySchemes = required(
          components.securitySchemes as Components31['securitySchemes'] | null,
          'a Security Schemes map',
          '#/components/securitySchemes',
        );
      }
      const incomingSchemes = components.securitySchemes;
      if (incomingSchemes !== undefined && Object.keys(incomingSchemes).length > 0) {
        if (securitySchemesStrategy === 'first') {
          // The behaviour before #33: the first input to declare any wins.
          if (result.components.securitySchemes === undefined) {
            result.components.securitySchemes = incomingSchemes;
          }
        } else {
          const target = result.components.securitySchemes ?? {};
          result.components.securitySchemes = target;

          const areEqual = deepEquality(resultLookup, currentLookup);

          if (securitySchemesStrategy === 'error') {
            // Refuse a genuine conflict rather than renaming around it.
            // Identical definitions are agreement, not conflict, so they still
            // collapse quietly.
            for (const name of Object.keys(incomingSchemes)) {
              const existing = target[name];
              if (existing !== undefined && !areEqual(existing, incomingSchemes[name])) {
                return {
                  type: 'component-definition-conflict',
                  message:
                    `Input ${inputIndex}: the security scheme '${name}' is already defined differently by another ` +
                    `input. Set securitySchemesStrategy to 'merge' to rename it automatically, or to 'first' to ` +
                    `keep only the first input's schemes.`,
                };
              }
            }
          }

          const schemesError = processComponents(
            target,
            incomingSchemes,
            areEqual,
            dispute,
            (from: string, to: string) => {
              referenceModification[`#/components/securitySchemes/${from}`] = `#/components/securitySchemes/${to}`;
              securitySchemeRenames[from] = to;
            },
          );

          if (schemesError !== undefined) {
            return schemesError;
          }
        }
      }
    }

    // A renamed security scheme is not reachable through `referenceModification`.
    // Security requirements name a scheme as an OBJECT KEY -- `{ apiKey: [] }`
    // -- not as a `$ref`, so the reference walker never sees them and a rename
    // would leave every requirement pointing at a scheme that no longer exists.
    // Applied to this input's clone before its operations are copied out.
    //
    // Unconditional -- not nested inside `oas.components !== undefined` --
    // because `security`/`operation.security` can carry a malformed entry
    // (proposal 40) whether or not this input declares any components at all,
    // and `securitySchemeRenames` is simply empty (a safe no-op rename map)
    // when it does not.
    renameSecurityRequirements(oas, securitySchemeRenames);

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

      if (isDuplicate && duplicatePathHandling === 'merge-operations') {
        const incoming = getPaths(oas)[originalPath];

        // Operation IDs first: the incoming operations are joining a document
        // that already contains the existing ones, so they must be
        // disambiguated against everything seen so far, exactly as they would
        // be on a path of their own.
        const opIdError = ensureUniqueOperationIds(incoming, seenOperationIds, dispute);
        if (opIdError !== undefined) {
          return opIdError;
        }

        const combined = mergePathItems(result.paths[newPath], incoming);
        if (isPathItemMergeFailure(combined)) {
          return {
            type: 'duplicate-paths',
            message:
              `Input ${inputIndex}: The path '${originalPath}' maps to '${newPath}', which another input already ` +
              `added, and they could not be combined because ${combined.reason}.`,
          };
        }

        result.paths[newPath] = combined;
        continue;
      }

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

      if (result.webhooks[webhookName] !== undefined && duplicatePathHandling === 'merge-operations') {
        const incoming = getWebhooks(oas)[webhookName];

        const opIdError = ensureUniqueOperationIds(incoming, seenOperationIds, dispute);
        if (opIdError !== undefined) {
          return opIdError;
        }

        const combined = mergePathItems(result.webhooks[webhookName], incoming);
        if (isPathItemMergeFailure(combined)) {
          return {
            type: 'duplicate-webhooks',
            message:
              `Input ${inputIndex}: The webhook '${webhookName}' has already been added by another input file, ` +
              `and they could not be combined because ${combined.reason}.`,
          };
        }

        result.webhooks[webhookName] = combined;
        continue;
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

  // Cross-document `$ref`s (issues #104 and #10) -- deliberately a second
  // pass over the *finished* `result`, not folded into the loop above. A
  // `$ref` in input A may name input C, processed later in the loop above;
  // C's own `referenceModification` map (and, for issue #10, anything
  // `externalDocuments` needs pulled in) is only complete once every input
  // has had its turn, so resolving cross-document refs any earlier would get
  // a forward reference wrong.
  const resolveCrossDocumentReference = createCrossDocumentResolver(
    referenceModificationByIdentity,
    ambiguousIdentities,
    externalDocuments,
    result.components,
  );

  let crossDocumentError: ErrorMergeResult | undefined;
  // `walkAllReferences` wants a full `OpenApiDocument`; `result` only carries
  // the subset it actually reads (`paths`/`webhooks`/`components`), the same
  // gap `SwaggerLookup.InternalLookup` papers over elsewhere in this file.
  walkAllReferences({ openapi: '3.0.1', info: { title: 'dummy', version: '0' }, ...result }, ref => {
    if (crossDocumentError !== undefined || ref.startsWith('#')) {
      // Bare same-document refs were already handled correctly by the
      // per-input pass above; nothing further to do for them here.
      return ref;
    }

    const split = splitCrossDocumentRef(ref);
    if (split === undefined || split.fragment === undefined) {
      // No fragment: a whole-document reference, left untouched (see
      // `splitCrossDocumentRef`'s own note on why there is no single local
      // pointer that could stand in for it).
      return ref;
    }

    const resolution = resolveCrossDocumentReference(split.identity, split.fragment);
    if (resolution.kind === 'error') {
      crossDocumentError = resolution.error;
      return ref;
    }

    return resolution.kind === 'resolved' ? resolution.ref : ref;
  });

  if (crossDocumentError !== undefined) {
    return crossDocumentError;
  }

  return result;
}