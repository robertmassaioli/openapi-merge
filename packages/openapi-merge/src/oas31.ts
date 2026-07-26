import { Swagger } from '@atlassian/atlassian-openapi';

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

/** A map of name to Path Item, the shape shared by `paths` and `webhooks`. */
export type PathItemMap = { [key: string]: Swagger.PathItem };

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
export type OpenApiDocument = Omit<Swagger.SwaggerV3, 'paths' | 'components'> & {
  paths?: Swagger.Paths;
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
