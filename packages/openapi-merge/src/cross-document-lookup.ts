import jsonpointer from 'jsonpointer';
import { Swagger, SwaggerLookup, SwaggerTypeChecks as TC } from '@atlassian/atlassian-openapi';
import { OpenApiDocument } from './oas31';
import { splitCrossDocumentRef } from './external-references';

/**
 * `SwaggerLookup.InternalLookup` (from `@atlassian/atlassian-openapi`) is not
 * missing external-ref support by oversight -- its own source comment says
 * so: "Any references that don't start with a # are external, and thus not
 * handled." It assumes whoever calls it already has one, fully self-contained
 * document, and its internal chain-walk (`performLookup`) has no cycle guard
 * of its own -- a purely local reference cycle (two components in one
 * document naming each other) recurses forever.
 *
 * `CrossDocumentLookup` is a second `Lookup` implementation that resolves
 * both a bare (`#`-prefixed) `$ref` and a cross-document `$ref`
 * (`<identity>#<fragment>`) through the *same* recursive walk, against a map
 * of every other document the caller already knows about -- exactly the
 * shape `MergeOptions.externalDocuments` already takes, plus each declared
 * input's own document keyed by its `sourceIdentity`. No fetching happens
 * here or anywhere in this library (see `external-references.ts`'s own
 * docstring); assembling that map is the caller's job, done once per merge in
 * `paths-and-components.ts`.
 *
 * This does not delegate to `InternalLookup` -- it reimplements the same
 * resolution directly (the same `SwaggerTypeChecks` predicates
 * `InternalLookup` itself uses, already public exports, and the same
 * schema-title-backfill rule), so that a single `seen` set can guard *every*
 * hop, local or cross-document, against a cycle. That single walk is also
 * what closes the purely-local cycle case: it isn't a separate feature, it
 * falls out of not having two different resolution mechanisms to keep a
 * cycle guard in sync with.
 *
 * @see 42-proposal-external-ref-equality-in-dedup.md, Option C.
 * @see 43-proposal-local-reference-cycle-guard.md, Option B.
 */
export class CrossDocumentLookup implements SwaggerLookup.Lookup {
  private readonly localDocument: OpenApiDocument;
  private readonly knownDocuments: Readonly<Record<string, OpenApiDocument>>;

  constructor(localDocument: OpenApiDocument, knownDocuments: Readonly<Record<string, OpenApiDocument>> = {}) {
    this.localDocument = localDocument;
    this.knownDocuments = knownDocuments;
  }

  getCallback(c: Swagger.Callback | Swagger.Reference): Swagger.Callback | undefined {
    return this.resolve(c, TC.isCallback);
  }

  getExample(e: Swagger.Example | Swagger.Reference): Swagger.Example | undefined {
    return this.resolve(e, TC.isExample);
  }

  getHeaders(h: Swagger.Header | Swagger.Reference): Swagger.Header | undefined {
    return this.resolve(h, TC.isHeader);
  }

  getLink(link: Swagger.Link | Swagger.Reference): Swagger.Link | undefined {
    return this.resolve(link, TC.isLink);
  }

  getParam(p: Swagger.ParameterOrRef): Swagger.Parameter | undefined {
    return this.resolve(p, TC.isParameter);
  }

  getRequestBody(b: Swagger.RequestBody | Swagger.Reference): Swagger.RequestBody | undefined {
    return this.resolve(b, TC.isRequestBody);
  }

  getResponse(r: Swagger.Response | Swagger.Reference): Swagger.Response | undefined {
    return this.resolve(r, TC.isResponse);
  }

  getSecurityScheme(ss: Swagger.SecurityScheme | Swagger.Reference): Swagger.SecurityScheme | undefined {
    return this.resolve(ss, TC.isSecurityScheme);
  }

  /**
   * Unlike every other accessor, a security scheme named this way is always
   * local: a Security Requirement Object names a scheme declared in the SAME
   * document (`{ apiKey: [] }`, an object key, never a `$ref`), so there is no
   * cross-document form of this lookup to support. Matches `InternalLookup`'s
   * own `getSecuritySchemeByName`: build the bare ref it would have named,
   * and resolve that.
   */
  getSecuritySchemeByName(name: string): Swagger.SecurityScheme | undefined {
    return this.getSecurityScheme({ $ref: `#/components/securitySchemes/${name}` });
  }

  getSchema(s: Swagger.Schema | Swagger.Reference): Swagger.Schema | undefined {
    const result = this.resolve(s, TC.isSchema);
    if (result === undefined || !TC.isReference(s) || (result as { title?: string }).title !== undefined) {
      return result;
    }

    // Matches InternalLookup's own backfill rule exactly, but anchored on the
    // *fragment* portion of the ref that was actually asked for, not the
    // combined identity+fragment string -- an identity containing its own
    // slashes (a relative file path, the common case) would otherwise throw
    // off the segment count this check depends on. For a bare ref there is no
    // identity to strip, so the ref itself is the fragment.
    const fragment = splitCrossDocumentRef(s.$ref)?.fragment ?? s.$ref;
    const segments = fragment.split('/');
    return segments.length === 4 ? { ...result, title: segments[3] } : result;
  }

  private resolve<T>(value: T | Swagger.Reference, tCheck: (v: unknown) => v is T): T | undefined {
    if (!TC.isReference(value)) {
      return value;
    }
    return this.resolveFrom(undefined, this.localDocument, value.$ref, tCheck, new Set());
  }

  /**
   * The single recursive walk both a bare ref and a cross-document ref go
   * through, at every hop.
   *
   * @param identity `undefined` for the top-level local document, otherwise
   *   the identity `doc` was reached under -- both threaded through so a bare
   *   ref discovered partway through (another document's own local alias)
   *   resolves against *that* document, not back against the original
   *   caller's.
   */
  private resolveFrom<T>(
    identity: string | undefined,
    doc: OpenApiDocument,
    ref: string,
    tCheck: (v: unknown) => v is T,
    seen: Set<string>,
  ): T | undefined {
    const split = splitCrossDocumentRef(ref);

    if (split !== undefined) {
      if (split.fragment === undefined) {
        // A whole-document reference (no fragment) -- no single target
        // exists to resolve to, matching `splitCrossDocumentRef`'s own note.
        return undefined;
      }

      const target = this.knownDocuments[split.identity];
      if (target === undefined) {
        // Not one of this merge's declared inputs and not in
        // `externalDocuments` -- out of scope, absent rather than an error.
        return undefined;
      }

      // A redirect, not a fetch -- deliberately not cycle-checked here.
      // `split.fragment` is always `#`-prefixed, so this is always
      // immediately followed by the canonical bare-fetch attempt below,
      // which *is* checked. Keying a redirect too would key it by a
      // different-looking string for the same eventual destination and
      // either under- or over-count revisits.
      return this.resolveFrom(split.identity, target, split.fragment, tCheck, seen);
    }

    // `ref` is bare here -- this is the one place an actual fetch happens, so
    // it's the one place cycle-guarded. Keyed by (identity, ref), not ref
    // alone: the same fragment string can validly exist in two different
    // documents mid-chain, and conflating them would either miss a real
    // cycle or falsely flag two unrelated components as one. The separator
    // is a NUL byte, not a space or `#`: either an identity (a file path) or
    // a component name could legitimately contain those and produce a
    // colliding key for two genuinely different (identity, ref) pairs.
    const key = `${identity ?? ''}\u0000${ref}`;
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);

    // Throws on a malformed pointer (missing the leading slash after `#`) --
    // matches InternalLookup's own behaviour, which hits the same
    // `jsonpointer.get` call today; not a new failure mode.
    const raw: unknown = jsonpointer.get(doc, ref.slice(1));

    if (TC.isReference(raw)) {
      // Re-split on the next call: `raw.$ref` may itself be bare (same
      // document) or cross-document (hands off to another one entirely).
      return this.resolveFrom(identity, doc, raw.$ref, tCheck, seen);
    }

    return tCheck(raw) ? raw : undefined;
  }
}

/**
 * Assembles the map `CrossDocumentLookup` resolves cross-document refs
 * against: every declared input's own document, keyed by its
 * `sourceIdentity`, plus `externalDocuments`.
 *
 * An identity claimed by more than one input (`ambiguousIdentities`, issue
 * #104 §5.2) is left out entirely -- there is no principled way to pick which
 * input a ref meant, matching how `resolveIdentityFragment` in
 * `external-references.ts` already treats the same situation as unresolved
 * rather than guessed at. Declared inputs take precedence over
 * `externalDocuments` on a genuine key collision, mirroring that same
 * function's own lookup order.
 */
export function buildKnownDocuments(
  inputs: ReadonlyArray<{ oas: OpenApiDocument; sourceIdentity?: string }>,
  ambiguousIdentities: ReadonlySet<string>,
  externalDocuments: Readonly<Record<string, OpenApiDocument>>,
): Record<string, OpenApiDocument> {
  const knownDocuments: Record<string, OpenApiDocument> = { ...externalDocuments };

  for (const input of inputs) {
    if (input.sourceIdentity !== undefined && !ambiguousIdentities.has(input.sourceIdentity)) {
      knownDocuments[input.sourceIdentity] = input.oas;
    }
  }

  return knownDocuments;
}
