import { Modify } from "./reference-walker";
import { Swagger, SwaggerTypeChecks as TC, SwaggerLookup as Lookup } from '@atlassian/atlassian-openapi';
import _ from 'lodash';
import { isPresent } from 'ts-is-present';

export type ReferenceWalker<A> = (component: A, modify: Modify) => void;

function referenceCount<A>(walker: ReferenceWalker<A>, component: A): number {
  let count = 0;
  walker(component, ref => { count++; return ref; });
  return count;
}

export function shallowEquality<A>(referenceWalker: ReferenceWalker<A>): (x: A | Swagger.Reference, y: A | Swagger.Reference) => boolean {
  return (x: A | Swagger.Reference, y: A | Swagger.Reference): boolean => {
    if (!_.isEqual(x, y)) {
      return false;
    }

    // Guard against null/undefined before delegating to type-checking helpers
    // that assume a defined object (see issue #92). If either side is absent
    // and they were still considered _.isEqual above, treat them as equal.
    if (!isPresent(x) || !isPresent(y)) {
      return true;
    }

    if (TC.isReference(x)) {
      return false;
    }

    return referenceCount(referenceWalker, x) === 0;
  }
}

export type ComparisonReferenceTarget = { kind?: string; value: unknown };
export type ComparisonReferenceResolver = (reference: Swagger.Reference) => ComparisonReferenceTarget | undefined;

function resolvedReferenceOrThrow(ref: Swagger.Reference, value: ComparisonReferenceTarget | undefined): ComparisonReferenceTarget {
  if (value === undefined) {
    throw new Error(`Could not resolve reference: ${ref.$ref}`);
  }
  return value;
}

function arraysEquivalent(leftOriginal: Array<string>, rightOriginal: Array<string>): boolean {
  if (leftOriginal.length !== rightOriginal.length) {
    return false;
  }

  const left = [...leftOriginal].sort();
  const right = [...rightOriginal].sort();

  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export function deepEquality<A>(
  xLookup: Lookup.Lookup,
  yLookup: Lookup.Lookup,
  xReferenceResolver: ComparisonReferenceResolver = reference => {
    const value = xLookup.getSchema(reference);
    return value === undefined ? undefined : { kind: 'schemas', value };
  },
  yReferenceResolver: ComparisonReferenceResolver = reference => {
    const value = yLookup.getSchema(reference);
    return value === undefined ? undefined : { kind: 'schemas', value };
  },
): (x: A | Swagger.Reference, y: A | Swagger.Reference) => boolean {
  function compare<T>(x: T | Swagger.Reference, y: T | Swagger.Reference, activeReferencePairs: Set<string>): boolean {
    // If both are references then look up the references and compare them for equality
    if (isPresent(x) && isPresent(y)) {
      if (TC.isReference(x) && TC.isReference(y)) {
        // A pair already active in this recursion is a cycle. Do not retain
        // completed pairs: the same references may compare differently at a
        // later component, or elsewhere in this top-level comparison.
        const pairKey = JSON.stringify([x.$ref, y.$ref]);
        if (activeReferencePairs.has(pairKey)) {
          return true;
        }

        activeReferencePairs.add(pairKey);
        try {
          const xResult = resolvedReferenceOrThrow(x, xReferenceResolver(x));
          const yResult = resolvedReferenceOrThrow(y, yReferenceResolver(y));
          if (xResult.kind !== undefined && yResult.kind !== undefined && xResult.kind !== yResult.kind) {
            return false;
          }
          return compare(xResult.value, yResult.value, activeReferencePairs);
        } finally {
          activeReferencePairs.delete(pairKey);
        }
      } else if (TC.isReference(x) || TC.isReference(y)) {
        return false;
      } else if (typeof x === 'object' && x !== null && typeof y === 'object' && y !== null) {
        // If both are objects then they should have all of the same keys and the values of those keys should match
        if (!arraysEquivalent(Object.keys(x), Object.keys(y))) {
          return false;
        }
        const xKeys = Object.keys(x) as Array<keyof T>;
        return xKeys.every(key => compare(x[key], y[key], activeReferencePairs));
      }
    }

    // If they are not objects or references then you can just run a direct equality
    return _.isEqual(x, y);
  }

  return (x, y) => compare(x, y, new Set());
}
