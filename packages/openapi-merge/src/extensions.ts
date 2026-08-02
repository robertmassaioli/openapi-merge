import { OpenApiDocument } from './oas31';
import { ErrorMergeResult, isErrorResult } from './data';
import { ExtensionMergeNode, ExtensionMergeStrategies, mergeExtensionNode } from './extension-merge-strategies';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Extensions = { [extensionKey: string]: any };

function extractExtensions(input: OpenApiDocument): Extensions {
  const result: Extensions = {};

  const plainObject: Extensions = input;

  for (const key in plainObject) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (key.startsWith('x-') && plainObject.hasOwnProperty(key)) {
      result[key] = plainObject[key];
    }
  }

  return result;
}

/**
 * Every `x-*` key seen across `extensions`, combined per {@link ExtensionMergeStrategies}
 * (proposal 47). A key absent from `strategies` -- the default, and the whole
 * of this function's behaviour before that mechanism existed -- takes the
 * first input's value wholesale, unchanged from the historical behaviour.
 */
function mergeExtensionsHelper(extensions: Extensions[], strategies: ExtensionMergeStrategies | undefined): Extensions | ErrorMergeResult {
  const allKeys = new Set<string>();
  for (const extension of extensions) {
    for (const key of Object.keys(extension)) {
      allKeys.add(key);
    }
  }

  const result: Extensions = {};
  for (const key of allKeys) {
    const values = extensions.map(extension => extension[key]).filter(value => value !== undefined);
    const node: ExtensionMergeNode | undefined = strategies?.[key];
    const nodeResult = mergeExtensionNode(node, values, key);

    if (!nodeResult.ok) {
      // `nodeResult.message` already names the exact path (e.g.
      // `x-tagGroups[name=Admin].owner`), which always starts with `key` --
      // wrapping it in "Cannot merge the '<key>' extension: ..." here would
      // just repeat that key back at the start of the message.
      return {
        type: 'extension-merge-conflict',
        message: nodeResult.message,
      };
    }

    if (nodeResult.value !== undefined) {
      result[key] = nodeResult.value;
    }
  }

  return result;
}

export function mergeExtensions(
  mergeTarget: OpenApiDocument,
  oass: OpenApiDocument[],
  strategies: ExtensionMergeStrategies | undefined,
): OpenApiDocument | ErrorMergeResult {
  const mergedExtensions = mergeExtensionsHelper([extractExtensions(mergeTarget), ...oass.map(extractExtensions)], strategies);

  if (isErrorResult(mergedExtensions)) {
    return mergedExtensions;
  }

  return {
    ...mergeTarget,
    ...mergedExtensions,
  };
}
