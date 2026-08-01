import path from 'path';
import { OpenApiDocument } from 'openapi-merge/dist/oas31';
import { walkAllReferences } from 'openapi-merge/dist/reference-walker';
import { readFileAsString, readYamlOrJSON } from './file-loading';
import { resolveConfigPath } from './path-resolution';

/**
 * Discovering and loading `$ref`-only documents (issue #10) -- files or URLs
 * nobody named in `inputs`, reached only by following a `$ref` from something
 * that *was* loaded.
 *
 * Kept entirely in the CLI, not the library: `openapi-merge` deliberately has
 * no file-path or network awareness (see proposal 36 §3), so all of the async
 * I/O and path/URL resolution happens here, synchronously handed off to
 * `merge()` as a plain `Record<identity, OpenApiDocument>` once it's done --
 * exactly the "pre-downloaded mapping" shape issue #10's own note describes.
 */

export type DocumentKind = 'file' | 'url';

export type DocumentReference = {
  identity: string;
  kind: DocumentKind;
};

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Resolves the identity a cross-document `$ref`'s non-fragment portion names,
 * given the identity and kind of the document *containing* that `$ref`.
 *
 * Pure and side-effect free (no file reads, no network) so it is unit
 * testable without mocking `fetch` or touching the filesystem -- the exact
 * classification/resolution logic this feature depends on getting right for
 * both files and URLs, isolated from the I/O around it.
 *
 * - From a **file**: an absolute URL in the ref is a URL identity; anything
 *   else is a file path resolved relative to the referencing file's own
 *   directory (not the config's `basePath` -- matching what the ref's author
 *   meant by a path like `../common/Errors.yml`).
 * - From a **URL**: resolved via `new URL(ref, referencingIdentity)`, which
 *   correctly handles both a relative ref and one that is itself absolute.
 */
export function resolveCrossDocumentIdentity(refTarget: string, referencing: DocumentReference): DocumentReference {
  if (referencing.kind === 'url') {
    return { identity: new URL(refTarget, referencing.identity).href, kind: 'url' };
  }

  if (ABSOLUTE_URL.test(refTarget)) {
    return { identity: new URL(refTarget).href, kind: 'url' };
  }

  return { identity: path.resolve(path.dirname(referencing.identity), refTarget), kind: 'file' };
}

/**
 * Splits a cross-document `$ref` into its target and (`#`-prefixed) fragment.
 * `undefined` for a bare same-document ref (`#/...`) or a whole-document ref
 * with no fragment -- both left alone by the normalisation pass below,
 * exactly as the library's own `splitCrossDocumentRef` leaves them alone.
 */
function splitRefTarget(ref: string): { target: string; fragment: string } | undefined {
  if (ref.startsWith('#')) {
    return undefined;
  }
  const hashIndex = ref.indexOf('#');
  if (hashIndex === -1) {
    return undefined;
  }
  return { target: ref.slice(0, hashIndex), fragment: `#${ref.slice(hashIndex + 1)}` };
}

/**
 * Rewrites every cross-document `$ref` in `doc` to `<absolute identity>#<fragment>`,
 * mutating it in place, and returns the distinct identities it named.
 *
 * Every document this feature touches -- declared inputs and discovered
 * documents alike -- goes through this exactly once, immediately after being
 * parsed. That is what lets a `$ref` found *inside* a discovered document
 * resolve correctly later: by the time anything downstream reads it, its
 * cross-document refs are already absolute, not relative to a directory
 * nothing downstream knows about.
 */
export function normalizeCrossDocumentRefs(doc: OpenApiDocument, self: DocumentReference): DocumentReference[] {
  const discovered = new Map<string, DocumentReference>();

  walkAllReferences(doc, ref => {
    const split = splitRefTarget(ref);
    if (split === undefined) {
      return ref;
    }

    const target = resolveCrossDocumentIdentity(split.target, self);
    if (!discovered.has(target.identity)) {
      discovered.set(target.identity, target);
    }

    return `${target.identity}${split.fragment}`;
  });

  return [...discovered.values()];
}

async function loadDocument(reference: DocumentReference): Promise<OpenApiDocument> {
  if (reference.kind === 'url') {
    const response = await fetch(reference.identity);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return (await readYamlOrJSON(await response.text())) as OpenApiDocument;
  }
  return (await readYamlOrJSON(await readFileAsString(reference.identity))) as OpenApiDocument;
}

export type DiscoveryWarning = {
  reference: DocumentReference;
  message: string;
};

export type DiscoveryResult = {
  externalDocuments: Record<string, OpenApiDocument>;
  warnings: DiscoveryWarning[];
};

/**
 * The declared-input identity for a file input, matching what
 * `loadOasForInput` already resolves it to.
 */
export function fileInputIdentity(basePath: string, inputFile: string): DocumentReference {
  return { identity: resolveConfigPath(basePath, inputFile), kind: 'file' };
}

/** The declared-input identity for a URL input -- the URL itself. */
export function urlInputIdentity(inputURL: string): DocumentReference {
  return { identity: inputURL, kind: 'url' };
}

/**
 * Normalises every declared input's own cross-document refs (unconditional
 * -- this is issue #104, always on), then, if `enableDiscovery` is set,
 * follows any newly-named identity that is not itself a declared input:
 * loads it, normalises *its* refs the same way, and keeps following whatever
 * that turns up, until nothing new remains (issue #10).
 *
 * A discovered identity that fails to load is warned about and left out of
 * `externalDocuments` -- any `$ref` naming it is then simply unresolved by
 * the library, exactly as a `$ref` to a declared input that does not exist
 * would be.
 */
export async function discoverExternalDocuments(
  declaredInputs: ReadonlyArray<{ document: OpenApiDocument; reference: DocumentReference }>,
  enableDiscovery: boolean,
): Promise<DiscoveryResult> {
  const known = new Set(declaredInputs.map(input => input.reference.identity));
  const externalDocuments: Record<string, OpenApiDocument> = {};
  const warnings: DiscoveryWarning[] = [];

  const worklist: DocumentReference[] = [];
  for (const input of declaredInputs) {
    const found = normalizeCrossDocumentRefs(input.document, input.reference);
    if (enableDiscovery) {
      for (const target of found) {
        if (!known.has(target.identity)) {
          known.add(target.identity);
          worklist.push(target);
        }
      }
    }
  }

  while (enableDiscovery && worklist.length > 0) {
    // Shift, not pop: breadth-first, so documents are loaded in roughly the
    // order they were first referenced -- easier to reason about than an
    // arbitrary order, though nothing downstream depends on it.
    const next = worklist.shift();
    if (next === undefined) {
      break;
    }

    try {
      const document = await loadDocument(next);
      externalDocuments[next.identity] = document;

      const found = normalizeCrossDocumentRefs(document, next);
      for (const target of found) {
        if (!known.has(target.identity)) {
          known.add(target.identity);
          worklist.push(target);
        }
      }
    } catch (e) {
      warnings.push({ reference: next, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return { externalDocuments, warnings };
}
