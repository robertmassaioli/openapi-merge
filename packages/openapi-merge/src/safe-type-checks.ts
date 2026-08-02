import { Swagger, SwaggerTypeChecks as TC } from "@atlassian/atlassian-openapi";

/**
 * `typeof null === 'object'` in JavaScript, and `@atlassian/atlassian-openapi`'s
 * own type-checking helpers rely on `typeof x === 'object'` to mean "a real
 * object I can index into" -- so every one of them throws on `null` instead of
 * returning `false` (see ai-planning/40-proposal-null-safe-document-walking.md
 * §2.1). A `null` reaches here whenever a structural slot -- a Schema, an
 * Operation, a Parameter -- is left empty in the source document (a YAML key
 * with nothing written after it): technically invalid OpenAPI, but an easy
 * mistake to make and, before this module existed, one that produced a raw
 * `TypeError` pointing into a dependency rather than into the input.
 *
 * Every `TC.*` call this codebase makes goes through the wrapped version here
 * instead, so a `null` in a structural slot always becomes one clear, typed
 * error naming what was expected -- see proposal 40 §3b for why this errors
 * rather than silently skipping the slot or fabricating a stand-in.
 */
export class MalformedDocumentError extends Error {
  constructor(public readonly expected: string, public readonly pointer?: string) {
    const location = pointer === undefined ? '' : ` at '${pointer}'`;
    super(
      `Expected ${expected}${location}, found null -- this usually means an empty value in the source ` +
      `document (a YAML key with nothing written after it).`
    );
    this.name = 'MalformedDocumentError';
  }
}

/** Throws {@link MalformedDocumentError} for `null`; passes everything else through, including `undefined`. */
export function required<T>(value: T | null, expected: string, pointer?: string): T {
  if (value === null) {
    throw new MalformedDocumentError(expected, pointer);
  }
  return value;
}

export function isReference(s: unknown, pointer?: string): s is Swagger.Reference {
  return TC.isReference(required(s, 'a Reference or object', pointer));
}

/**
 * Unlike the other three wrapped here, `TC.isMediaTypeWithExamples` has no
 * `typeof` guard at all (`'examples' in t`) -- it throws on `null`,
 * `undefined`, and every primitive, not just `null`. `required()`'s narrower
 * `=== null` check would leave `undefined`/primitives unguarded, so this one
 * checks the wider condition itself instead of delegating to `required()`.
 */
export function isMediaTypeWithExamples(t: unknown, pointer?: string): t is Swagger.MediaTypeWithExamples {
  if (typeof t !== 'object' || t === null) {
    throw new MalformedDocumentError('a Media Type Object', pointer);
  }
  return TC.isMediaTypeWithExamples(t as Swagger.MediaType);
}

export function isParameterWithSchema(p: unknown, pointer?: string): p is Swagger.ParameterWithSchema {
  return TC.isParameterWithSchema(required(p, 'a Parameter Object', pointer));
}

export function isHeaderWithSchema(o: unknown, pointer?: string): o is Swagger.HeaderWithSchema {
  return TC.isHeaderWithSchema(required(o, 'a Header Object', pointer));
}
