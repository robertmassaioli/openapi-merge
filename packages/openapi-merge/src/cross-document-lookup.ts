import jsonpointer from 'jsonpointer';
import { Swagger, SwaggerLookup, SwaggerTypeChecks as TC } from '@atlassian/atlassian-openapi';
import { OpenApiDocument, getPaths } from './oas31';
import { splitCrossDocumentRef } from './external-references';

/**
 * `SwaggerLookup.InternalLookup` (from `@atlassian/atlassian-openapi`) is not
 * missing external-ref support by oversight -- its own source comment says
 * so: "Any references that don't start with a # are external, and thus not
 * handled." It assumes whoever calls it already has one, fully self-contained
 * document.
 *
 * `CrossDocumentLookup` is a second `Lookup` implementation for when that
 * assumption doesn't hold: it resolves a bare (`#`-prefixed) `$ref` exactly
 * as `InternalLookup` already does (including that class's own quirks, like
 * backfilling a missing schema `title` -- delegated to it wholesale, not
 * reimplemented, so there is no behavioural drift from the local-only case
 * every existing caller already depends on), and resolves a cross-document
 * `$ref` (`<identity>#<fragment>`) against a map of every other document the
 * caller already knows about -- exactly the shape `MergeOptions.externalDocuments`
 * already takes, plus each declared input's own document keyed by its
 * `sourceIdentity`. No fetching happens here or anywhere in this library
 * (see `external-references.ts`'s own docstring); assembling that map is the
 * caller's job, done once per merge in `paths-and-components.ts`.
 *
 * @see 42-proposal-external-ref-equality-in-dedup.md, Option C.
 */
export class CrossDocumentLookup implements SwaggerLookup.Lookup {
  private readonly localDocument: OpenApiDocument;
  private readonly localLookup: SwaggerLookup.InternalLookup;
  private readonly knownDocuments: Readonly<Record<string, OpenApiDocument>>;
  private readonly childLookups = new Map<string, CrossDocumentLookup>();

  constructor(localDocument: OpenApiDocument, knownDocuments: Readonly<Record<string, OpenApiDocument>> = {}) {
    this.localDocument = localDocument;
    this.knownDocuments = knownDocuments;
    this.localLookup = new SwaggerLookup.InternalLookup({
      openapi: '3.0.1',
      info: { title: 'dummy', version: '0' },
      paths: getPaths(localDocument),
      components: localDocument.components,
    });
  }

  getCallback(c: Swagger.Callback | Swagger.Reference): Swagger.Callback | undefined {
    return this.resolve(c, (l, v) => l.getCallback(v));
  }

  getExample(e: Swagger.Example | Swagger.Reference): Swagger.Example | undefined {
    return this.resolve(e, (l, v) => l.getExample(v));
  }

  getHeaders(h: Swagger.Header | Swagger.Reference): Swagger.Header | undefined {
    return this.resolve(h, (l, v) => l.getHeaders(v));
  }

  getLink(link: Swagger.Link | Swagger.Reference): Swagger.Link | undefined {
    return this.resolve(link, (l, v) => l.getLink(v));
  }

  getParam(p: Swagger.ParameterOrRef): Swagger.Parameter | undefined {
    return this.resolve(p, (l, v) => l.getParam(v));
  }

  getRequestBody(b: Swagger.RequestBody | Swagger.Reference): Swagger.RequestBody | undefined {
    return this.resolve(b, (l, v) => l.getRequestBody(v));
  }

  getResponse(r: Swagger.Response | Swagger.Reference): Swagger.Response | undefined {
    return this.resolve(r, (l, v) => l.getResponse(v));
  }

  getSchema(s: Swagger.Schema | Swagger.Reference): Swagger.Schema | undefined {
    return this.resolve(s, (l, v) => l.getSchema(v));
  }

  getSecurityScheme(ss: Swagger.SecurityScheme | Swagger.Reference): Swagger.SecurityScheme | undefined {
    return this.resolve(ss, (l, v) => l.getSecurityScheme(v));
  }

  /**
   * Unlike every other accessor, a security scheme named this way is always
   * local: a Security Requirement Object names a scheme declared in the SAME
   * document (`{ apiKey: [] }`, an object key, never a `$ref`), so there is no
   * cross-document form of this lookup to support.
   */
  getSecuritySchemeByName(name: string): Swagger.SecurityScheme | undefined {
    return this.localLookup.getSecuritySchemeByName(name);
  }

  private resolve<T>(
    value: T | Swagger.Reference,
    accessor: (lookup: SwaggerLookup.Lookup, value: T | Swagger.Reference) => T | undefined,
  ): T | undefined {
    return this.resolveWithSeen(value, accessor, new Set());
  }

  private resolveWithSeen<T>(
    value: T | Swagger.Reference,
    accessor: (lookup: SwaggerLookup.Lookup, value: T | Swagger.Reference) => T | undefined,
    seen: Set<string>,
  ): T | undefined {
    if (!TC.isReference(value)) {
      return value;
    }

    const split = splitCrossDocumentRef(value.$ref);

    if (split === undefined) {
      // A bare ref: `InternalLookup` already chases any chain of *local*
      // aliases correctly (including, for schemas, its own title-backfill).
      const result = accessor(this.localLookup, value);
      if (result !== undefined) {
        return result;
      }
      // `InternalLookup` returns `undefined` for two reasons it cannot tell
      // apart: genuinely absent, or present but itself a cross-document
      // ref -- which, by its own design (see this class's own docstring),
      // it never chases. Only the second case is recoverable; probe for it.
      return this.chaseForeignAlias(value.$ref, accessor, seen);
    }

    if (split.fragment === undefined) {
      // A whole-document reference (no fragment) -- no single target exists
      // to resolve to, matching `splitCrossDocumentRef`'s own contract.
      return undefined;
    }

    const doc = this.knownDocuments[split.identity];
    if (doc === undefined) {
      // Not one of this merge's declared inputs and not in
      // `externalDocuments` -- out of scope, exactly as `InternalLookup`
      // already treats an unresolvable ref: absent, not an error.
      return undefined;
    }

    const key = `${split.identity}${split.fragment}`;
    if (seen.has(key)) {
      // Defensive: a genuine cross-document cycle (A -> B -> A). Not expected
      // in valid OpenAPI, but this class does not assume its input is valid
      // -- `deepEquality`'s own cycle guard only tracks the top-level pair
      // being compared, not lookups called any other way.
      return undefined;
    }
    seen.add(key);

    return this.lookupFor(split.identity, doc).resolveWithSeen(
      { $ref: split.fragment } as T | Swagger.Reference,
      accessor,
      seen,
    );
  }

  /**
   * Called only after a bare ref's own document failed to resolve it. Fetches
   * exactly one raw pointer hop -- no `tCheck`, no further local chasing,
   * both already exhausted by `InternalLookup` above -- and, if what's there
   * is itself a reference (necessarily the reason `InternalLookup` gave up:
   * a foreign `$ref` it doesn't chase), keeps resolving from there. Anything
   * else (truly missing, or present but not a reference) is indistinguishable
   * from "not found" and correctly falls through to `undefined`.
   */
  private chaseForeignAlias<T>(
    ref: string,
    accessor: (lookup: SwaggerLookup.Lookup, value: T | Swagger.Reference) => T | undefined,
    seen: Set<string>,
  ): T | undefined {
    if (!ref.startsWith('#/')) {
      return undefined;
    }

    const raw: unknown = jsonpointer.get(this.localDocument, ref.slice(1));
    if (!TC.isReference(raw)) {
      return undefined;
    }

    return this.resolveWithSeen(raw as T | Swagger.Reference, accessor, seen);
  }

  private lookupFor(identity: string, doc: OpenApiDocument): CrossDocumentLookup {
    let cached = this.childLookups.get(identity);
    if (cached === undefined) {
      cached = new CrossDocumentLookup(doc, this.knownDocuments);
      this.childLookups.set(identity, cached);
    }
    return cached;
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
