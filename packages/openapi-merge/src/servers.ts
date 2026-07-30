import { NarrowedMergeInput } from './data';
import { Server32 } from './oas31';

/**
 * How the top-level `servers` array is combined across inputs.
 *
 * - `'first'` — the first input that declares `servers` wins and the rest are
 *   discarded. This is the historical behaviour and remains the default: the
 *   tool is aimed at putting several services behind one API gateway, where the
 *   gateway's servers are canonical and a backend's own URLs are an
 *   implementation detail that must not leak into the published document.
 * - `'concat'` — every input's servers, in input order, deduplicated by URL.
 *   For people merging microservice specs to document all of them at once.
 */
export type ServersStrategy = 'first' | 'concat';

export const DEFAULT_SERVERS_STRATEGY: ServersStrategy = 'first';

/**
 * Deduplication is by `url` alone.
 *
 * Two entries with the same URL but different `description`s are the same
 * server described twice, and emitting both would produce a document that
 * offers the reader a meaningless choice. Comparing `variables` as well was
 * considered and rejected: a later input's differing variable defaults for the
 * same URL is a conflict between inputs, and this merge resolves conflicts
 * first-wins everywhere else, so it does so here too rather than inventing a
 * new error for it.
 */
export function mergeServers(inputs: NarrowedMergeInput, strategy: ServersStrategy = DEFAULT_SERVERS_STRATEGY): Server32[] | undefined {
  if (strategy === 'first') {
    const firstWithServers = inputs.find(input => input.oas.servers !== undefined);
    return firstWithServers?.oas.servers;
  }

  const seenUrls = new Set<string>();
  const merged: Server32[] = [];

  for (const input of inputs) {
    for (const server of input.oas.servers ?? []) {
      if (!seenUrls.has(server.url)) {
        seenUrls.add(server.url);
        merged.push(server);
      }
    }
  }

  // Absent rather than empty: an input with `servers: []` should not turn into
  // an output that declares an empty array, because the two mean different
  // things to a reader and `undefined` is what the 'first' strategy produces.
  return merged.length === 0 ? undefined : merged;
}
