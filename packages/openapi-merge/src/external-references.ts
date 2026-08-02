import _ from 'lodash';
import { ErrorMergeResult } from './data';
import { Components31, OpenApiDocument } from './oas31';
import { walkComponentReferences } from './reference-walker';
import { deepEquality } from './component-equivalence';
import { CrossDocumentLookup } from './cross-document-lookup';
import { Components, DEDUPLICATED_COMPONENT_TYPES, processComponents } from './paths-and-components';

/**
 * Cross-document `$ref` resolution (issues #104 and #10).
 *
 * A `$ref` that does not start with `#` names another document -- either one
 * of this merge's own inputs (`#/components/schemas/X` as seen from a
 * *different* input than the one containing the ref, qualified with that
 * input's `sourceIdentity`), or a document this merge never received as an
 * input at all, only as {@link import('./data').MergeOptions.externalDocuments}.
 * Both are resolved through the same entry point, {@link createCrossDocumentResolver},
 * because from the referencing side they look identical: a `$ref` shaped
 * `<identity>#<fragment>`.
 *
 * What differs is what "resolving" means once the identity is known:
 * - **A declared input**: the component is already being merged in as part
 *   of that whole input. Resolving means looking up what it was renamed to
 *   (if anything) in that input's own `referenceModification` map -- the
 *   exact map its own bare in-document refs are rewritten with.
 * - **An external document**: nothing about it is being merged in
 *   automatically. Resolving means reaching into that document, cloning out
 *   *just* the referenced component, deduplicating it into the output like
 *   any other component, and -- since that component may itself `$ref`
 *   something, either locally within the same external document or another
 *   external document entirely -- resolving those the same way, recursively.
 */

type ComponentBucket = typeof DEDUPLICATED_COMPONENT_TYPES[number];

export type ParsedComponentFragment = {
  bucket: ComponentBucket;
  name: string;
};

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Parses a `#`-prefixed fragment like `#/components/schemas/ServerError` into
 * its bucket and name -- matching exactly the shape
 * {@link DEDUPLICATED_COMPONENT_TYPES} already deduplicates.
 *
 * Anything else is unsupported and returns `undefined`, left for the caller
 * to leave unresolved rather than guessed at:
 * - A nested path (`#/components/schemas/Foo/properties/bar`): this library
 *   only ever tracks whole-component renames, never partial ones.
 * - `#/components/securitySchemes/X`: security schemes are addressed by name
 *   in a security requirement object, never by `$ref`, so this shape is not
 *   a reference-target OpenAPI itself defines (issue #33/#94's existing
 *   carve-out for the same reason).
 * - Anything not shaped `#/components/<bucket>/<name>` at all.
 */
export function parseComponentFragment(fragment: string): ParsedComponentFragment | undefined {
  if (!fragment.startsWith('#/')) {
    return undefined;
  }

  // `fragment.slice(2)` drops both the `#` and the `/` that follows it, so
  // splitting `#/components/schemas/X` yields exactly `['components',
  // 'schemas', 'X']` -- not a leading empty string from the delimiter still
  // being present.
  const segments = fragment.slice(2).split('/').map(decodeJsonPointerSegment);

  if (segments.length !== 3 || segments[0] !== 'components') {
    return undefined;
  }

  const [, bucket, name] = segments;

  if (!(DEDUPLICATED_COMPONENT_TYPES as ReadonlyArray<string>).includes(bucket)) {
    return undefined;
  }

  return { bucket: bucket as ComponentBucket, name };
}

/** Splits a cross-document `$ref` into its identity and (`#`-prefixed) fragment, or `undefined` for a bare same-document ref. */
export function splitCrossDocumentRef(ref: string): { identity: string; fragment: string | undefined } | undefined {
  if (ref.startsWith('#')) {
    return undefined;
  }

  const hashIndex = ref.indexOf('#');
  if (hashIndex === -1) {
    // A whole-document reference (`./common/Errors.yml`, no fragment). Legal
    // OpenAPI, but there is no single local pointer in the merged output that
    // means "that whole document" -- left unresolved rather than guessed at.
    return { identity: ref, fragment: undefined };
  }

  return { identity: ref.slice(0, hashIndex), fragment: `#${ref.slice(hashIndex + 1)}` };
}

export type ReferenceModificationByIdentity = Record<string, { [original: string]: string }>;

export type ExternalReferenceResolution =
  | { kind: 'resolved'; ref: string }
  | { kind: 'error'; error: ErrorMergeResult }
  | { kind: 'unresolved' };

/**
 * Builds the resolver used by {@link import('./paths-and-components').mergePathsAndComponents}'s
 * cross-document pass. One resolver per merge call: it caches every
 * identity+fragment it has already placed, and grows `resultComponents` in
 * place as external components are pulled in.
 *
 * @param referenceModificationByIdentity Each declared input's own rename map
 *   (built during that input's normal per-input processing), keyed by its
 *   `sourceIdentity`.
 * @param ambiguousIdentities Identities claimed by more than one declared
 *   input (issue #104 §5.2) -- treated as unmatched rather than guessed at,
 *   since there is no principled way to pick which input a ref meant.
 * @param externalDocuments Documents that are not inputs, only a source of
 *   components to pull in on demand (issue #10).
 * @param resultComponents The merge's own `components`, mutated in place as
 *   external components are placed into it.
 * @param knownDocuments Every document a cross-document `$ref` *inside* a
 *   pulled-in component might itself name -- declared inputs keyed by
 *   `sourceIdentity`, plus `externalDocuments` -- so the dedup check below
 *   (issue: PR #87 / proposal 45, Option C) can resolve one instead of
 *   giving up on it. Built once by {@link import('./paths-and-components').mergePathsAndComponents}
 *   via {@link import('./cross-document-lookup').buildKnownDocuments}, the
 *   same map its own per-input dedup uses.
 */
export function createCrossDocumentResolver(
  referenceModificationByIdentity: ReferenceModificationByIdentity,
  ambiguousIdentities: ReadonlySet<string>,
  externalDocuments: Record<string, OpenApiDocument>,
  resultComponents: Components31,
  knownDocuments: Readonly<Record<string, OpenApiDocument>>,
): (identity: string, fragment: string) => ExternalReferenceResolution {
  // Keyed by `${identity}#${fragment}`, both memoizing completed placements
  // and detecting cycles: an identity+fragment re-entered while still being
  // resolved means a component transitively references itself.
  const resolvedCache = new Map<string, string>();
  const inProgress = new Set<string>();

  function resolveIdentityFragment(identity: string, fragment: string): ExternalReferenceResolution {
    if (ambiguousIdentities.has(identity)) {
      return { kind: 'unresolved' };
    }

    const inputMap = referenceModificationByIdentity[identity];
    if (inputMap !== undefined) {
      return resolveAgainstInputMap(inputMap, fragment);
    }

    const doc = externalDocuments[identity];
    if (doc !== undefined) {
      return pullInComponent(identity, doc, fragment);
    }

    // Not a declared input and never discovered/loaded -- out of scope
    // (issue #104 §8 / issue #37), left exactly as found.
    return { kind: 'unresolved' };
  }

  function resolveAgainstInputMap(inputMap: { [original: string]: string }, fragment: string): ExternalReferenceResolution {
    if (inputMap[fragment] !== undefined) {
      return { kind: 'resolved', ref: inputMap[fragment] };
    }

    const modifiedKeys = Object.keys(inputMap);
    const matchingKeys = modifiedKeys.filter(key => key.startsWith(`${fragment}/`));

    if (matchingKeys.length > 1) {
      throw new Error(`Found more than one matching key for reference '${fragment}': ${JSON.stringify(matchingKeys)}`);
    } else if (matchingKeys.length === 1) {
      return { kind: 'resolved', ref: inputMap[matchingKeys[0]] };
    }

    // No rename recorded for this exact fragment: it survives into the
    // output unchanged, exactly as a same-input bare ref would.
    return { kind: 'resolved', ref: fragment };
  }

  function pullInComponent(identity: string, doc: OpenApiDocument, fragment: string): ExternalReferenceResolution {
    const cacheKey = `${identity}${fragment}`;

    const cached = resolvedCache.get(cacheKey);
    if (cached !== undefined) {
      return { kind: 'resolved', ref: cached };
    }

    if (inProgress.has(cacheKey)) {
      return {
        kind: 'error',
        error: {
          type: 'cyclic-external-reference',
          message: `'${identity}${fragment}' is part of a cycle of external references and cannot be resolved.`,
        },
      };
    }

    const parsed = parseComponentFragment(fragment);
    if (parsed === undefined) {
      return { kind: 'unresolved' };
    }

    const sourceBucket = (doc.components as Components31 | undefined)?.[parsed.bucket] as Components<unknown> | undefined;
    const raw = sourceBucket?.[parsed.name];
    // `== null`, not `=== undefined`: a component that is *present but empty*
    // (`Errors:`, an empty YAML value) means exactly the same thing here as
    // one that is missing entirely -- neither has real content to pull in.
    // `doc` was never a declared input the config author is responsible for,
    // so this stays the existing soft "unresolved" outcome for both, not an
    // error (contrast a `null` in a *declared* input's own content, which
    // does error -- proposal 40 §4.1a).
    if (raw == null) {
      return { kind: 'unresolved' };
    }

    // Marked in-progress (and only unmarked on the way out) *before* any
    // cloning or placement, so a cycle is caught before anything is inserted
    // -- an insert later orphaned by a cycle error would be worse than no
    // insert at all.
    inProgress.add(cacheKey);
    try {
      const cloned = _.cloneDeep(raw);
      const wrapped = { [parsed.bucket]: { [parsed.name]: cloned } } as unknown as Components31;

      let innerError: ErrorMergeResult | undefined;
      walkComponentReferences(wrapped, ref => {
        if (innerError !== undefined) {
          return ref;
        }

        const split = splitCrossDocumentRef(ref);
        // A bare ref (`split === undefined`) is local to *this* external
        // document -- resolved against the same identity, recursively.
        const resolution = split === undefined
          ? resolveIdentityFragment(identity, ref)
          : split.fragment === undefined
            ? { kind: 'unresolved' as const }
            : resolveIdentityFragment(split.identity, split.fragment);

        if (resolution.kind === 'error') {
          innerError = resolution.error;
          return ref;
        }

        return resolution.kind === 'resolved' ? resolution.ref : ref;
      });

      if (innerError !== undefined) {
        return { kind: 'error', error: innerError };
      }

      // Fresh on every call, not memoized across pulls: `resultComponents`
      // grows as earlier pulls in the same pass are placed, and a later
      // dedup check must see them. Mirrors how `mergePathsAndComponents`
      // rebuilds the equivalent lookups on every input, for the same reason.
      const resultLookup = new CrossDocumentLookup(
        { openapi: '3.0.1', info: { title: 'dummy', version: '0' }, components: resultComponents },
        knownDocuments,
      );
      const currentLookup = new CrossDocumentLookup(
        { openapi: '3.0.1', info: { title: 'dummy', version: '0' }, components: doc.components ?? {} },
        knownDocuments,
      );

      const targetBucket = ((resultComponents as unknown as Record<string, Components<unknown> | undefined>)[parsed.bucket]) ?? {};
      (resultComponents as unknown as Record<string, Components<unknown>>)[parsed.bucket] = targetBucket;

      let finalName = parsed.name;
      // `dispute: undefined` -- a discovered document was never declared as
      // an input, so there is no per-input dispute config to consult. A name
      // clash falls back to the same numeric-suffix disambiguation
      // `processComponents` already uses when no dispute is configured.
      const placementError = processComponents(
        targetBucket,
        { [parsed.name]: cloned },
        deepEquality(resultLookup, currentLookup),
        undefined,
        (_from, to) => { finalName = to; },
      );

      if (placementError !== undefined) {
        return { kind: 'error', error: placementError };
      }

      const finalRef = `#/components/${parsed.bucket}/${finalName}`;
      resolvedCache.set(cacheKey, finalRef);
      return { kind: 'resolved', ref: finalRef };
    } finally {
      inProgress.delete(cacheKey);
    }
  }

  return resolveIdentityFragment;
}
