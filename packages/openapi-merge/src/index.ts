import { isPresent } from 'ts-is-present';
import { MergeInput, MergeResult, isErrorResult, PathModification, OperationSelection, MergeOptions } from './data';
import { mergeTags } from './tags';
import { mergePathsAndComponents } from './paths-and-components';
import { mergeExtensions } from './extensions';
import { mergeInfos } from './info';
import { negotiateOutputVersion, validateInputVersions } from './openapi-version';
import { OpenApiDocument } from './oas31';
import { mergeServers, ServersStrategy } from './servers';
import { pruneUnusedComponents } from './prune-components';

export { isErrorResult };
export type { MergeInput, MergeResult, PathModification, OperationSelection, MergeOptions, ServersStrategy };

function getFirst<A>(inputs: Array<A>): A | undefined {
  if (inputs.length > 0) {
    return inputs[0];
  }

  return undefined;
}

function getFirstMatching<A, B>(inputs: Array<A>, extract: (input: A) => B | undefined): B | undefined {
  return getFirst(inputs.map(extract).filter(isPresent));
}

/**
 * `$self` (3.2) declares a document's own identity URI.
 *
 * Merging several documents produces a third document that is none of them, so
 * carrying one input's `$self` forward would assert an identity the output does
 * not have -- and because `$self` participates in reference resolution, a stale
 * value can change how relative `$ref`s resolve. It is therefore kept only in
 * the degenerate single-input case, where the output really is that document.
 */
function mergeSelf(inputs: MergeInput): string | undefined {
  return inputs.length === 1 ? inputs[0].oas.$self : undefined;
}

/**
 * Swagger Merge Tool
 */
export function merge(inputs: MergeInput, options?: MergeOptions): MergeResult {
  if (inputs.length === 0) {
    return { type: 'no-inputs', message: 'You must provide at least one OAS file as an input.' };
  }

  // Runs before any merging so that a version problem never leaves a partially
  // merged result, and so that the constructs a newer version would introduce
  // are never silently walked past by 3.0-shaped logic.
  const versionError = validateInputVersions(inputs);
  if (versionError !== undefined) {
    return versionError;
  }

  const pathAndComponentResult = mergePathsAndComponents(inputs);

  if (isErrorResult(pathAndComponentResult)) {
    return pathAndComponentResult;
  }

  const { paths, webhooks, components: retComponents } = pathAndComponentResult;

  const components = Object.keys(retComponents).length === 0 ? undefined : retComponents;

  const output: OpenApiDocument = mergeExtensions(
    {
      // The version the inputs actually declared, rather than a hard-coded
      // 3.0.3. Well defined because every input shares a major.minor by now.
      openapi: negotiateOutputVersion(inputs) ?? '3.0.3',
      info: mergeInfos(inputs),
      servers: mergeServers(inputs, options?.serversStrategy),
      externalDocs: getFirstMatching(inputs, input => input.oas.externalDocs),
      security: getFirstMatching(inputs, input => input.oas.security),
      tags: mergeTags(inputs),
      paths,
      // Omitted entirely for 3.0 documents, which cannot declare webhooks.
      webhooks: Object.keys(webhooks).length === 0 ? undefined : webhooks,
      jsonSchemaDialect: getFirstMatching(inputs, input => input.oas.jsonSchemaDialect),
      $self: mergeSelf(inputs),
      components,
    },
    inputs.map(input => input.oas)
  );

  // Last, so that reachability is computed against the finished document --
  // after operation selection, renaming and reference rewriting have all had
  // their say. Anything earlier would measure a document that does not exist.
  return { output: options?.pruneUnusedComponents === true ? pruneUnusedComponents(output) : output };
}