import { Swagger } from '@atlassian/atlassian-openapi';
import { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

/**
 * OpenAPI 3.1 modelled as a delta over the 3.0 types.
 *
 * The underlying type package describes 3.0 only: it types `paths` as required
 * and knows nothing of `webhooks`, `components.pathItems` or
 * `jsonSchemaDialect`. Rather than replace it -- a large change to an
 * unmaintained but otherwise working dependency -- this module describes only
 * what 3.1 added. Everything 3.1 left alone keeps using `Swagger.*` directly.
 *
 * This is deliberately not a re-typing of OpenAPI. It claims only to describe
 * the constructs this library has to merge.
 */

/**
 * The nine HTTP methods a Path Item may carry.
 *
 * `query` is the 3.2 addition. This list exists once; every place that needs to
 * consider "all the operations in a path item" goes through
 * {@link getPathItemOperations} rather than repeating it. Four separate copies
 * of the eight-method version of this list is why a 3.2 path item containing
 * only `query` was scored as having zero operations and deleted outright.
 */
export const HTTP_METHODS = [
  'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query',
] as const;

export type HttpMethod = typeof HTTP_METHODS[number];

/**
 * A Path Item, including the 3.2 additions.
 *
 * `query` is a normal method slot. `additionalOperations` maps arbitrary custom
 * verbs (`PURGE`, `LOCK`, ...) to Operations; its keys are opaque to us, only
 * the Operation values are interpreted.
 */
export type PathItem32 = Swagger.PathItem & {
  query?: Swagger.Operation;
  additionalOperations?: { [method: string]: Swagger.Operation };
};

/**
 * A Tag, including the 3.2 additions.
 *
 * `summary` supersedes the `x-displayName` extension, `parent` enables
 * hierarchical tags, and `kind` classifies a tag (`nav`, `badge`, `audience`).
 * They are carried through the merge as ordinary tag fields.
 */
export type Tag32 = Swagger.Tag & {
  summary?: string;
  parent?: string;
  kind?: string;
};

/**
 * A Server Object, including the 3.2 `name` field.
 *
 * `name` gives a server a stable identifier so tooling can refer to it.
 */
export type Server32 = Swagger.Server & {
  name?: string;
};

/** A map of name to Path Item, the shape shared by `paths` and `webhooks`. */
export type PathItemMap = { [key: string]: PathItem32 };

/**
 * Every operation a Path Item contains: the nine standard methods plus any
 * custom verbs under `additionalOperations`.
 *
 * Returns entries rather than just values so callers that need to delete an
 * operation (tag-based selection) can address it.
 */
export function getPathItemOperations(
  pathItem: PathItem32,
): Array<{ method: string; operation: Swagger.Operation; isAdditional: boolean }> {
  const found: Array<{ method: string; operation: Swagger.Operation; isAdditional: boolean }> = [];

  for (const method of HTTP_METHODS) {
    const operation = pathItem[method];
    if (operation !== undefined) {
      found.push({ method, operation, isAdditional: false });
    }
  }

  const additional = pathItem.additionalOperations;
  if (additional !== undefined) {
    for (const method of Object.keys(additional)) {
      found.push({ method, operation: additional[method], isAdditional: true });
    }
  }

  return found;
}

/**
 * 3.1 adds `pathItems` to the component types.
 *
 * Modelled as an intersection so every existing component type keeps its
 * original definition.
 */
export type Components31 = Swagger.Components & {
  pathItems?: PathItemMap;
};

/**
 * An OpenAPI document this library can merge: 3.0 or 3.1.
 *
 * Differences from `Swagger.SwaggerV3`, all of them 3.1 additions:
 *
 * - `paths` is **optional**. 3.1 allows a document that describes only
 *   webhooks, which has no `paths` member at all. This is the change that
 *   cannot be expressed by extension alone, hence the `Omit`.
 * - `webhooks` is a map of Path Items, structurally identical to `paths`.
 * - `jsonSchemaDialect` names the default JSON Schema dialect for Schema
 *   Objects in the document.
 * - `components` may carry `pathItems`.
 */
export type OpenApiDocument = Omit<Swagger.SwaggerV3, 'paths' | 'components' | 'tags' | 'servers'> & {
  paths?: PathItemMap;
  /** 3.2: the document's own identity URI. See the merge policy in oas32 tests. */
  $self?: string;
  tags?: Tag32[];
  servers?: Server32[];
  webhooks?: PathItemMap;
  jsonSchemaDialect?: string;
  components?: Components31;
};

/** `paths` is optional in 3.1; this is the "there are no paths" case flattened. */
export function getPaths(oas: OpenApiDocument): Swagger.Paths {
  return oas.paths ?? {};
}

/** `webhooks` is 3.1-only and optional even there. */
export function getWebhooks(oas: OpenApiDocument): PathItemMap {
  return oas.webhooks ?? {};
}

/**
 * A document this library will accept as merge input (issue #75).
 *
 * `OpenApiDocument` is how this library models a specification. Consumers
 * frequently arrive with `OpenAPIV3.Document` or `OpenAPIV3_1.Document`
 * instead, because that is what `@apidevtools/swagger-parser` and most other
 * tooling returns. The two describe the *same JSON* -- they differ only in how
 * strictly each models it. `openapi-types` marks `PathsObject` values as
 * possibly `undefined` and types several component maps more loosely, so
 * assignment fails in a dozen nested places even though every value is
 * structurally fine at runtime.
 *
 * Widening each field individually was tried and abandoned: the mismatches
 * cascade through `paths`, `components.responses`, `headers` and further down,
 * and loosening all of them would weaken the types this library relies on
 * internally for no benefit.
 *
 * Accepting the union instead keeps full checking inside the library while
 * letting a caller pass what their parser gave them. `merge()` narrows once, at
 * the boundary, where the reasoning lives.
 */
export type MergeInputDocument = OpenApiDocument | OpenAPIV3.Document | OpenAPIV3_1.Document;
