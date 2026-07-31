import _ from 'lodash';
import { TagInjection } from './data';
import { getPathItemOperations, OpenApiDocument } from './oas31';

/**
 * Adds an input's configured tag to every operation it contributes (issue #112).
 *
 * The merged document can then say which service an operation came from without
 * anyone editing the upstream specifications, which are usually owned by
 * somebody else.
 *
 * Runs after `operationSelection`, so the injected tag cannot influence the
 * rules that decided which operations survive. Injecting first would let
 * `includeTags: ['billing']` match operations only because this input injects
 * `billing` -- a filter that appears to do nothing.
 *
 * Appended rather than replacing: an operation's own tags say what it does, and
 * the injected one says where it came from. Both are worth keeping, and a
 * document that lost the former would be much less useful than one that never
 * had the latter.
 */
export function injectTag(originalOas: OpenApiDocument, tag: TagInjection | undefined): OpenApiDocument {
  if (tag === undefined) {
    return originalOas;
  }

  const oas = _.cloneDeep(originalOas);

  for (const map of [oas.paths, oas.webhooks]) {
    if (map === undefined || map === null) {
      continue;
    }

    for (const key of Object.keys(map)) {
      for (const { operation } of getPathItemOperations(map[key])) {
        const existing = operation.tags ?? [];
        // Already tagged by the author: adding it twice would be an invalid
        // duplicate in the operation's tag list.
        if (!existing.includes(tag.name)) {
          operation.tags = [...existing, tag.name];
        }
      }
    }
  }

  return oas;
}
