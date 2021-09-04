import { Modify } from "./reference-walker";
import { Swagger, SwaggerTypeChecks as TC, SwaggerLookup as Lookup } from 'atlassian-openapi';
import _ from 'lodash';

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

    if (TC.isReference(x)) {
      return false;
    }

    return referenceCount(referenceWalker, x) === 0;
  }
}

function isSchemaOrThrowError(ref: Swagger.Reference, s: Swagger.Schema | undefined): Swagger.Schema {
  if (s === undefined) {
    throw new Error(`Could not resolve reference: ${ref.$ref}`);
  }
  return s;
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

// The idea is that, if you have made this comparison before, then don't do it again, just return true becauese you have a cycle
type SeenResult = 'seen-before' | 'new';

class ReferenceRecord {
  private leftRightSeen: { [leftRef: string]: { [rightRef: string]: boolean }} = {};

  public checkAndStore(left: Swagger.Reference, right: Swagger.Reference): SeenResult {
    if (this.leftRightSeen[left.$ref] === undefined) {
      this.leftRightSeen[left.$ref] = {};
    }

    const leftLookup = this.leftRightSeen[left.$ref];

    const result: SeenResult = leftLookup[right.$ref] === true ? 'seen-before' : 'new';
    leftLookup[right.$ref] = true;
    return result;
  }
}

export function deepEquality<A>(xLookup: Lookup.Lookup, yLookup: Lookup.Lookup): (x: A | Swagger.Reference, y: A | Swagger.Reference) => boolean {
  const refRecord = new ReferenceRecord();

  function compare<T>(x: T | Swagger.Reference, y: T | Swagger.Reference): boolean {
    // If both are references then look up the references and compare them for equality
    if (TC.isReference(x) && TC.isReference(y)) {
      if (refRecord.checkAndStore(x, y) === 'seen-before') {
        return true;
      }

      const xResult = isSchemaOrThrowError(x, xLookup.getSchema(x));
      const yResult = isSchemaOrThrowError(y, yLookup.getSchema(y));
      return compare(xResult, yResult);
    } else if (TC.isReference(x) || TC.isReference(y)) {
      return false;
    } else if (typeof x === 'object' && typeof y === 'object') {
      // If both are objects then they should have all of the same keys and the values of those keys should match
      if (!arraysEquivalent(Object.keys(x), Object.keys(y))) {
        return false;
      }

      const xKeys = Object.keys(x) as Array<keyof T>;
      return xKeys.every(key => compare(x[key], y[key]));
    }

    // If they are not objects or references then you can just run a direct equality
    return _.isEqual(x, y);
  }

  return compare;
}