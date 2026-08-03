import { isPresent } from 'ts-is-present';
import { MergeInput, MergeResult, isErrorResult, PathModification, OperationSelection, MergeOptions, PathSelector, ExtensionMergeNode, ExtensionMergeStrategies } from './data';
import { mergeTags } from './tags';
import { mergePathsAndComponents } from './paths-and-components';
import { mergeExtensions } from './extensions';
import { mergeInfos } from './info';
import { negotiateOutputVersion, validateInputVersions } from './openapi-version';
import { OpenApiDocument } from './oas31';
import { mergeServers, ServersStrategy } from './servers';
import { SecuritySchemesStrategy } from './security-schemes';
import { pruneUnusedComponents } from './prune-components';
import { MalformedDocumentError } from './safe-type-checks';

export { isErrorResult };
export { MalformedDocumentError };
export type { MergeInput, MergeResult, PathModification, OperationSelection, MergeOptions, ServersStrategy, SecuritySchemesStrategy, PathSelector, ExtensionMergeNode, ExtensionMergeStrategies, OpenApiDocument };

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

  // `mergePathsAndComponents` and the reference walker it drives return errors
  // for everything except a `null` in a structural slot (proposal 40): that
  // one is *thrown*, from deep inside a recursive walk with no return-type
  // threaded through it, and caught narrowly here rather than at every one of
  // the dozens of intermediate call sites. Only `MalformedDocumentError` is
  // caught -- anything else (e.g. the "more than one matching key" internal
  // invariant errors) is a real bug and must keep propagating as an exception.
  let pathAndComponentResult: ReturnType<typeof mergePathsAndComponents>;
  try {
    pathAndComponentResult = mergePathsAndComponents(inputs, options?.securitySchemesStrategy, options?.externalDocuments);
  } catch (e) {
    if (e instanceof MalformedDocumentError) {
      return { type: 'malformed-document', message: e.message };
    }
    throw e;
  }

  if (isErrorResult(pathAndComponentResult)) {
    return pathAndComponentResult;
  }

  const { paths, webhooks, components: retComponents, security } = pathAndComponentResult;

  const components = Object.keys(retComponents).length === 0 ? undefined : retComponents;

  const extensionsResult = mergeExtensions(
    {
      // The version the inputs actually declared, rather than a hard-coded
      // 3.0.3. Well defined because every input shares a major.minor by now.
      openapi: negotiateOutputVersion(inputs) ?? '3.0.3',
      info: mergeInfos(inputs, options?.info),
      servers: mergeServers(inputs, options?.serversStrategy),
      externalDocs: getFirstMatching(inputs, input => input.oas.externalDocs),
      // Comes back from mergePathsAndComponents rather than being read off the
      // inputs here: still first-wins, but after security-scheme renames have
      // been applied to it (issue #33).
      security,
      tags: mergeTags(inputs),
      paths,
      // Omitted entirely for 3.0 documents, which cannot declare webhooks.
      webhooks: Object.keys(webhooks).length === 0 ? undefined : webhooks,
      jsonSchemaDialect: getFirstMatching(inputs, input => input.oas.jsonSchemaDialect),
      $self: mergeSelf(inputs),
      components,
    },
    inputs.map(input => input.oas),
    options?.extensionMergeStrategies
  );

  // Only reachable when an `x-*` extension is configured with the `'error'`
  // strategy (proposal 47) and inputs disagree at that point -- every other
  // path through `mergeExtensions` always succeeds.
  if (isErrorResult(extensionsResult)) {
    return extensionsResult;
  }

  const output: OpenApiDocument = extensionsResult;

  // Last, so that reachability is computed against the finished document --
  // after operation selection, renaming and reference rewriting have all had
  // their say. Anything earlier would measure a document that does not exist.
  //
  // No try/catch needed here unlike above: `output` is built entirely from
  // pieces `mergePathsAndComponents` already walked and validated, so
  // `pruneUnusedComponents` cannot encounter a `null` the catch above did not
  // already catch first (see the comment on `securitySchemesInUse`).
  return { output: options?.pruneUnusedComponents === true ? pruneUnusedComponents(output) : output };
}