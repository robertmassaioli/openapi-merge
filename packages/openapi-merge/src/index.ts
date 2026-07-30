import { isPresent } from 'ts-is-present';
import { MergeInput, NarrowedMergeInput, MergeResult, isErrorResult, PathModification, OperationSelection, MergeOptions } from './data';
import { mergeTags } from './tags';
import { mergePathsAndComponents } from './paths-and-components';
import { mergeExtensions } from './extensions';
import { mergeInfos } from './info';
import { resolveOutputVersion, validateInputVersions } from './openapi-version';
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
function mergeSelf(inputs: NarrowedMergeInput): string | undefined {
  return inputs.length === 1 ? inputs[0].oas.$self : undefined;
}

/**
 * Swagger Merge Tool
 */
export function merge(inputs: MergeInput, options?: MergeOptions): MergeResult {
  if (inputs.length === 0) {
    return { type: 'no-inputs', message: 'You must provide at least one OAS file as an input.' };
  }

  // The one place the input union is narrowed (issue #75). `openapi-types`
  // documents describe the same JSON as ours and differ only in how strictly
  // they model it -- `PathsObject` values are declared possibly-undefined,
  // several component maps are looser -- so the cast is safe in the direction
  // that matters: every value present at runtime is one this library can read.
  // Nothing below this line sees the union.
  const narrowedInputs = inputs as NarrowedMergeInput;

  // Runs before any merging so that a version problem never leaves a partially
  // merged result, and so that the constructs a newer version would introduce
  // are never silently walked past by 3.0-shaped logic.
  const versionError = validateInputVersions(narrowedInputs);
  if (versionError !== undefined) {
    return versionError;
  }

  const outputVersion = resolveOutputVersion(narrowedInputs, options?.openapiVersion);
  if (outputVersion !== undefined && typeof outputVersion !== 'string') {
    return outputVersion;
  }

  const pathAndComponentResult = mergePathsAndComponents(narrowedInputs);

  if (isErrorResult(pathAndComponentResult)) {
    return pathAndComponentResult;
  }

  const { paths, webhooks, components: retComponents, security } = pathAndComponentResult;

  const components = Object.keys(retComponents).length === 0 ? undefined : retComponents;

  const output: OpenApiDocument = mergeExtensions(
    {
      // The version the narrowedInputs actually declared, rather than a hard-coded
      // 3.0.3. Well defined because every input shares a major.minor by now.
      openapi: outputVersion ?? '3.0.3',
      info: mergeInfos(narrowedInputs),
      servers: mergeServers(narrowedInputs, options?.serversStrategy),
      externalDocs: getFirstMatching(narrowedInputs, input => input.oas.externalDocs),
      // Comes back from mergePathsAndComponents rather than being read off the
      // inputs here: still first-wins, but after security-scheme renames have
      // been applied to it (issue #33).
      security,
      tags: mergeTags(narrowedInputs),
      paths,
      // Omitted entirely for 3.0 documents, which cannot declare webhooks.
      webhooks: Object.keys(webhooks).length === 0 ? undefined : webhooks,
      jsonSchemaDialect: getFirstMatching(narrowedInputs, input => input.oas.jsonSchemaDialect),
      $self: mergeSelf(narrowedInputs),
      components,
    },
    narrowedInputs.map(input => input.oas)
  );

  // Last, so that reachability is computed against the finished document --
  // after operation selection, renaming and reference rewriting have all had
  // their say. Anything earlier would measure a document that does not exist.
  return { output: options?.pruneUnusedComponents === true ? pruneUnusedComponents(output) : output };
}