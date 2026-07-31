import _ from 'lodash';
import { HTTP_METHODS, HttpMethod, PathItem32 } from './oas31';

/**
 * Combining two Path Items that share a key but not a method (issue #71).
 *
 * `GET /thing` from one service and `POST /thing` from another describe
 * different operations on the same resource, and a merged document can hold
 * both. The other duplicate-path policies choose between whole Path Items, so
 * whichever loses takes its operations with it -- discarding an operation that
 * collided with nothing.
 *
 * This combines them instead, but only where the answer is unambiguous. Every
 * refusal below is a case where a plausible-looking union would silently change
 * what one input's operations mean, and a merge tool that quietly alters
 * semantics is worse than one that stops.
 */

/**
 * Keys that hold operations. Everything else on a Path Item applies to *all* of
 * them, which is what makes those other keys dangerous to combine.
 */
const OPERATION_CONTAINER_KEYS: ReadonlySet<string> = new Set<string>([...HTTP_METHODS, 'additionalOperations']);

export type PathItemMergeFailure = { reason: string };

export function isPathItemMergeFailure(result: PathItem32 | PathItemMergeFailure): result is PathItemMergeFailure {
  return (result as PathItemMergeFailure).reason !== undefined;
}

/** The Path Item's own fields: everything that is not an operation. */
function pathLevelFields(pathItem: PathItem32): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(pathItem)) {
    if (!OPERATION_CONTAINER_KEYS.has(key)) {
      fields[key] = (pathItem as unknown as Record<string, unknown>)[key];
    }
  }
  return fields;
}

/** Standard method slots plus custom verbs, as a flat set of names. */
function methodNames(pathItem: PathItem32): { standard: HttpMethod[]; additional: string[] } {
  return {
    standard: HTTP_METHODS.filter(method => pathItem[method] !== undefined),
    additional: Object.keys(pathItem.additionalOperations ?? {}),
  };
}

/**
 * Combines `incoming` into `existing`, or explains why it will not.
 *
 * Returns a new Path Item; neither argument is modified.
 */
export function mergePathItems(existing: PathItem32, incoming: PathItem32): PathItem32 | PathItemMergeFailure {
  // A Reference Object stands in for a Path Item defined elsewhere. Its
  // operations are not visible here, so there is no way to tell whether the two
  // sides overlap -- and resolving the reference to find out is a different
  // feature (see issue #10, where external resolution was declined).
  if (existing.$ref !== undefined || incoming.$ref !== undefined) {
    return { reason: 'one of them is a $ref to a Path Item, whose operations cannot be compared without resolving it' };
  }

  // Path-level fields are inherited by every operation in the item. If the two
  // sides disagree -- or one declares something the other does not -- then
  // combining the operations under either set changes the meaning of the other
  // side's operations. `parameters` is the sharp case: merging an input whose
  // path declares `tenantId` into one that does not silently adds a required
  // parameter to operations that never had it.
  const existingFields = pathLevelFields(existing);
  const incomingFields = pathLevelFields(incoming);
  if (!_.isEqual(existingFields, incomingFields)) {
    const differing = [...new Set([...Object.keys(existingFields), ...Object.keys(incomingFields)])]
      .filter(key => !_.isEqual(existingFields[key], incomingFields[key]))
      .sort();
    return {
      reason:
        `the path-level field${differing.length === 1 ? '' : 's'} ${differing.map(f => `'${f}'`).join(', ')} ` +
        `differ, and those apply to every operation in the path item`,
    };
  }

  const existingMethods = methodNames(existing);
  const incomingMethods = methodNames(incoming);

  const overlappingStandard = incomingMethods.standard.filter(m => existingMethods.standard.includes(m));
  // Custom verb names are case-sensitive per 3.2, so `GET` and `get` in
  // `additionalOperations` are genuinely different operations.
  const overlappingAdditional = incomingMethods.additional.filter(m => existingMethods.additional.includes(m));
  const overlapping = [...overlappingStandard, ...overlappingAdditional];

  if (overlapping.length > 0) {
    return {
      reason:
        `both define ${overlapping.map(m => m.toUpperCase()).join(', ')}, so there is no single answer for ` +
        `which operation wins -- use 'skip-later' or 'prefer-later' to choose`,
    };
  }

  const merged: PathItem32 = _.cloneDeep(existing);

  for (const method of incomingMethods.standard) {
    merged[method] = _.cloneDeep(incoming[method]);
  }

  if (incomingMethods.additional.length > 0) {
    merged.additionalOperations = { ...(merged.additionalOperations ?? {}) };
    for (const method of incomingMethods.additional) {
      merged.additionalOperations[method] = _.cloneDeep((incoming.additionalOperations ?? {})[method]);
    }
  }

  return merged;
}
