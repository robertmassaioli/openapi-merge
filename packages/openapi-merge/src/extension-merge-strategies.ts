import _ from 'lodash';

/**
 * Configuration for how to combine one document-root `x-*` extension's value
 * across inputs (proposal 47, generalising issue #60).
 *
 * A node mirrors one point in the extension value's own JSON shape: `kind`
 * says what shape is expected there, `strategy` says how to combine it. Left
 * unconfigured (the extension key absent from {@link ExtensionMergeStrategies},
 * or a field absent from an `object`/`merge` node's `fields`), a value is
 * taken wholesale from whichever input declared it first -- today's behaviour,
 * unchanged.
 *
 * `kind` is declarative-only for `'first'`/`'last'`/`'error'`: those three
 * operate on a value of any shape, so a `scalar` node with strategy `'error'`
 * still fails on disagreement even if the actual value turns out to be an
 * object. Checking `kind` there and silently falling back on a mismatch would
 * mean the one strategy whose entire purpose is "tell me about disagreement"
 * could disagree and say nothing -- the worst version of the type-mismatch
 * fallback below. `kind` only gates behaviour for the strategies that inspect
 * internal structure (`concat`, `concat-unique`, `union-by-key`, `merge`),
 * where there is no sensible operation to fall back to except `'first'`.
 */
export type ExtensionMergeNode =
  /** A leaf value: string, number, boolean, or null. */
  | { kind: 'scalar'; strategy: 'first' | 'last' | 'error' }
  /** A JSON array, combined wholesale -- one input's whole array wins. */
  | { kind: 'array'; strategy: 'first' | 'last' | 'error' }
  /**
   * A JSON array, combined element-by-element: every input's array
   * concatenated in input order (`'concat'`), optionally deduplicated by deep
   * equality (`'concat-unique'`). `sortBy` (optional) sorts the result
   * afterwards by a named field, for arrays of objects; omitted, the result
   * keeps concatenation order.
   *
   * If any input's value at this key is not an array, the whole node falls
   * back to `'first'` (see the module-level type-mismatch note).
   */
  | { kind: 'array'; strategy: 'concat' | 'concat-unique'; sortBy?: string }
  /**
   * A JSON array of objects, where elements sharing the same value at `key`
   * across (and within) inputs are the *same* logical entry and are combined
   * using `item`. `item` is required: defaulting it to wholesale `'first'`
   * would make this strategy behave exactly like `'concat-unique'` on the
   * outer array minus true duplicates, silently defeating the reason to pick
   * this strategy over that one.
   *
   * Elements whose key value appears only once across every input's array
   * pass through unchanged (via `item` applied to a single-element group).
   * Output order is first-seen order across all inputs, flattened -- there is
   * no `sortBy` here, because preserving first-seen order is this strategy's
   * point, not an accident of it.
   *
   * If any input's value is not an array, or any element is not an object
   * carrying a string/number/boolean value at `key`, the whole node falls
   * back to `'first'`.
   */
  | { kind: 'array'; strategy: 'union-by-key'; key: string; item: ExtensionMergeNode }
  /** A JSON object, combined wholesale -- one input's whole object wins. */
  | { kind: 'object'; strategy: 'first' | 'last' | 'error' }
  /**
   * A JSON object, combined field by field. A field not listed in `fields`
   * defaults to `'first'`, applied to that field's value wholesale regardless
   * of its own shape -- an unconfigured field is never guessed at.
   *
   * If any input's value at this key is not a plain object, the whole node
   * falls back to `'first'`.
   */
  | { kind: 'object'; strategy: 'merge'; fields?: { [fieldName: string]: ExtensionMergeNode } };

/** Keyed by extension name, e.g. `x-tagGroups`. */
export type ExtensionMergeStrategies = { [extensionKey: string]: ExtensionMergeNode };

export type ExtensionMergeSuccess = { ok: true; value: unknown };

/**
 * `path` names where in the extension's value the disagreement was found
 * (e.g. `x-tagGroups[name=Admin].tags`), for a caller to build a message that
 * points at more than just the extension key.
 */
export type ExtensionMergeFailure = { ok: false; path: string; message: string };

export type ExtensionMergeNodeResult = ExtensionMergeSuccess | ExtensionMergeFailure;

function ok(value: unknown): ExtensionMergeSuccess {
  return { ok: true, value };
}

function fail(path: string, message: string): ExtensionMergeFailure {
  return { ok: false, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A valid `union-by-key` key value: something that can round-trip through `String()` without collapsing distinct values together. */
function isValidKeyValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function dedupeByDeepEquality(items: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const item of items) {
    if (!result.some(existing => _.isEqual(existing, item))) {
      result.push(item);
    }
  }
  return result;
}

/** Numeric comparison when both sides are numbers; string comparison of their `String()` form otherwise. Missing (`undefined`) sorts last. */
function compareSortKeys(a: unknown, b: unknown): number {
  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined) {
    return 1;
  }
  if (b === undefined) {
    return -1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

function sortByField(items: unknown[], field: string): unknown[] {
  const keyOf = (item: unknown): unknown => (isPlainObject(item) ? item[field] : undefined);
  return [...items].sort((a, b) => compareSortKeys(keyOf(a), keyOf(b)));
}

function mergeError(values: unknown[], path: string): ExtensionMergeNodeResult {
  const first = values[0];
  const allAgree = values.every(value => _.isEqual(value, first));
  if (!allAgree) {
    return fail(path, `the inputs disagree on the value at '${path}', and the configured strategy for it is 'error'`);
  }
  return ok(first);
}

function mergeConcat(node: Extract<ExtensionMergeNode, { strategy: 'concat' | 'concat-unique' }>, values: unknown[]): ExtensionMergeNodeResult {
  if (!values.every(Array.isArray)) {
    return ok(values[0]);
  }

  const flattened = (values as unknown[][]).flat();
  const deduped = node.strategy === 'concat-unique' ? dedupeByDeepEquality(flattened) : flattened;
  const sorted = node.sortBy !== undefined ? sortByField(deduped, node.sortBy) : deduped;
  return ok(sorted);
}

function mergeUnionByKey(node: Extract<ExtensionMergeNode, { strategy: 'union-by-key' }>, values: unknown[], path: string): ExtensionMergeNodeResult {
  if (!values.every(Array.isArray)) {
    return ok(values[0]);
  }

  const elements = (values as unknown[][]).flat();
  const eachElementHasAValidKey = elements.every(element => isPlainObject(element) && isValidKeyValue(element[node.key]));
  if (!eachElementHasAValidKey) {
    return ok(values[0]);
  }

  const order: string[] = [];
  const groups = new Map<string, unknown[]>();
  for (const element of elements as Record<string, unknown>[]) {
    const keyValue = String(element[node.key]);
    if (!groups.has(keyValue)) {
      order.push(keyValue);
      groups.set(keyValue, []);
    }
    // Guaranteed present: just inserted above if this is the first element for `keyValue`.
    (groups.get(keyValue) as unknown[]).push(element);
  }

  const merged: unknown[] = [];
  for (const keyValue of order) {
    const groupElements = groups.get(keyValue) as unknown[];
    const result = mergeExtensionNode(node.item, groupElements, `${path}[${node.key}=${keyValue}]`);
    if (!result.ok) {
      return result;
    }
    merged.push(result.value);
  }

  return ok(merged);
}

function mergeObjectFields(node: Extract<ExtensionMergeNode, { strategy: 'merge' }>, values: unknown[], path: string): ExtensionMergeNodeResult {
  if (!values.every(isPlainObject)) {
    return ok(values[0]);
  }

  const objects = values as Record<string, unknown>[];
  const fieldNames = new Set<string>();
  for (const object of objects) {
    for (const key of Object.keys(object)) {
      fieldNames.add(key);
    }
  }

  const fieldsConfig = node.fields ?? {};
  const merged: Record<string, unknown> = {};
  for (const fieldName of fieldNames) {
    const fieldValues = objects.map(object => object[fieldName]).filter(value => value !== undefined);
    const result = mergeExtensionNode(fieldsConfig[fieldName], fieldValues, `${path}.${fieldName}`);
    if (!result.ok) {
      return result;
    }
    if (result.value !== undefined) {
      merged[fieldName] = result.value;
    }
  }

  return ok(merged);
}

/**
 * Combines the values found for one extension key (or one nested field/array
 * element inside it) across whichever inputs declared it.
 *
 * `values` must already have `undefined` entries filtered out -- each element
 * is one input's (or one grouped array element's) actual declared value.
 * `'last'` means last *present* in `values`, not "declared by the last input
 * overall": if only inputs 1 and 3 declare a field, `'last'` returns input
 * 3's value, and the same rule applies one level down -- inside a `merge`
 * node, a field declared only by the first of several occurrences returns
 * that occurrence's value for `'last'` too, because it is the only one
 * present at that field.
 *
 * `node === undefined` (the key, or this field, is not configured) always
 * returns `values[0]` unprocessed -- today's first-wins behaviour, and the
 * same rule an unlisted `fields` entry in a `merge` node uses, so leaving
 * something unconfigured is indistinguishable from how this library already
 * behaved before this mechanism existed.
 */
export function mergeExtensionNode(node: ExtensionMergeNode | undefined, values: unknown[], path: string): ExtensionMergeNodeResult {
  if (values.length === 0) {
    return ok(undefined);
  }

  if (node === undefined) {
    return ok(values[0]);
  }

  switch (node.strategy) {
    case 'first':
      return ok(values[0]);
    case 'last':
      return ok(values[values.length - 1]);
    case 'error':
      return mergeError(values, path);
    case 'concat':
    case 'concat-unique':
      return mergeConcat(node, values);
    case 'union-by-key':
      return mergeUnionByKey(node, values, path);
    case 'merge':
      return mergeObjectFields(node, values, path);
  }
}
