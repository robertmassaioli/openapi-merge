/* eslint-disable no-prototype-builtins */
import { Swagger, SwaggerTypeChecks as TC } from "@atlassian/atlassian-openapi";
import { Components31, getPathItemOperations, getPaths, getWebhooks, OpenApiDocument, PathItem32, PathItemMap } from './oas31';

export type Modify = (input: string) => string;

export function walkSchemaReferences(schema: Swagger.Schema | Swagger.Reference, modify: Modify): void {
  if (TC.isReference(schema)) {
    schema.$ref = modify(schema.$ref);
  } else {
    if (schema.not !== undefined) walkSchemaReferences(schema.not, modify);

    if (schema.allOf !== undefined) {
      for (const childSchema of schema.allOf) {
        walkSchemaReferences(childSchema, modify);
      }
    }

    if (schema.oneOf !== undefined) {
      for (const childSchema of schema.oneOf) {
        walkSchemaReferences(childSchema, modify);
      }
    }

    if (schema.anyOf !== undefined) {
      for (const childSchema of schema.anyOf) {
        walkSchemaReferences(childSchema, modify);
      }
    }

    if (schema.items !== undefined) {
      walkSchemaReferences(schema.items, modify);
    }

    for (const propertyKey in schema.properties) {
      if (schema.properties.hasOwnProperty(propertyKey)) {
        const property = schema.properties[propertyKey];
        walkSchemaReferences(property, modify);
      }
    }

    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
      walkSchemaReferences(schema.additionalProperties, modify);
    }

    walkDiscriminatorPointers(schema, modify);
  }
}

/**
 * Rewrites the pointers inside a Discriminator Object (issues #99 and #106).
 *
 * A Discriminator maps a property value to a schema, and the targets are
 * pointers -- but they are plain strings in a plain object rather than `$ref`
 * members, so the reference walker never saw them. When deduplication renamed
 * `Dog` to `Dog1` the `oneOf` `$ref` was rewritten and these were not, leaving
 * a document that resolves to nothing while looking entirely valid.
 *
 * Covers `mapping` (#99) and 3.2's `defaultMapping` (#106), which is the schema
 * to use when the discriminating value matches no entry.
 *
 * The specification allows a target to be written two ways, and both occur:
 *
 * - a full reference, `#/components/schemas/Dog`;
 * - a bare schema name, `Dog`, defined as shorthand for exactly that reference.
 *
 * A bare name is rewritten by asking `modify` about the reference it
 * abbreviates and writing back the abbreviated form of the answer. Preserving
 * the author's spelling matters: expanding every shorthand would produce a
 * large, noisy diff in documents this tool merely passes through.
 *
 * A URL or relative file path is left untouched -- it does not point into this
 * document's components.
 */
function walkDiscriminatorPointers(schema: Swagger.Schema, modify: Modify): void {
  const discriminator = (schema as {
    discriminator?: { mapping?: Record<string, string>; defaultMapping?: string };
  }).discriminator;
  if (discriminator === undefined) {
    return;
  }

  const SCHEMA_PREFIX = '#/components/schemas/';

  const rewriteTarget = (value: string): string => {
    if (value.startsWith('#/')) {
      return modify(value);
    }

    if (!value.includes('/') && !value.includes('#')) {
      const rewritten = modify(`${SCHEMA_PREFIX}${value}`);
      if (rewritten !== `${SCHEMA_PREFIX}${value}` && rewritten.startsWith(SCHEMA_PREFIX)) {
        return rewritten.slice(SCHEMA_PREFIX.length);
      }
    }

    return value;
  };

  const mapping = discriminator.mapping;
  if (mapping !== undefined) {
    for (const key of Object.keys(mapping)) {
      mapping[key] = rewriteTarget(mapping[key]);
    }
  }

  if (discriminator.defaultMapping !== undefined) {
    discriminator.defaultMapping = rewriteTarget(discriminator.defaultMapping);
  }
}

export function walkExampleReferences(example: Swagger.Example | Swagger.Reference, modify: Modify): void {
  if (TC.isReference(example)) {
    example.$ref = modify(example.$ref);
  }
}

function walkMediaTypeReferences(mediaType: Swagger.MediaType, modify: Modify): void {
  if (mediaType.schema !== undefined) walkSchemaReferences(mediaType.schema, modify);

  if (TC.isMediaTypeWithExamples(mediaType)) {
    if (mediaType.schema !== undefined) walkSchemaReferences(mediaType.schema, modify);

    for (const exampleKey of Object.keys(mediaType.examples)) {
      const example = mediaType.examples[exampleKey];
      walkExampleReferences(example, modify);
    }
  }
}

export function walkParameterReferences(parameterOrRef: Swagger.ParameterOrRef, modify: Modify): void {
  if (TC.isReference(parameterOrRef)) {
    parameterOrRef.$ref = modify(parameterOrRef.$ref);
  } else if(TC.isParameterWithSchema(parameterOrRef)) {
    walkSchemaReferences(parameterOrRef.schema, modify);

    if ('examples' in parameterOrRef) {
      for (const exampleKey in parameterOrRef.examples) {
        if (parameterOrRef.examples.hasOwnProperty(exampleKey)) {
          const example = parameterOrRef.examples[exampleKey];
          walkExampleReferences(example, modify);
        }
      }
    }
  } else {
    for (const contentKey in parameterOrRef.content) {
      if (parameterOrRef.content.hasOwnProperty(contentKey)) {
        const mediaType = parameterOrRef.content[contentKey];
        walkMediaTypeReferences(mediaType, modify);
      }
    }
  }
}

export function walkRequestBodyReferences(requestBody: Swagger.RequestBody | Swagger.Reference, modify: Modify): void {
  if (TC.isReference(requestBody)) {
    requestBody.$ref = modify(requestBody.$ref);
  } else {
    for (const contentKey in requestBody.content) {
      if (requestBody.content.hasOwnProperty(contentKey)) {
        const mediaType = requestBody.content[contentKey];
        walkMediaTypeReferences(mediaType, modify);
      }
    }
  }
}

export function walkHeaderReferences(header: Swagger.Header | Swagger.Reference, modify: Modify): void {
  if (TC.isReference(header)) {
    header.$ref = modify(header.$ref);
  } else if (TC.isHeaderWithSchema(header)) {
    if (header.schema !== undefined) walkSchemaReferences(header.schema, modify);

    if ('examples' in header) {
      for (const exampleKey in header.examples) {
        if (header.examples.hasOwnProperty(exampleKey)) {
          const example = header.examples[exampleKey];
          walkExampleReferences(example, modify);
        }
      }
    }
  } else {
    for (const contentKey in header.content) {
      if (header.content.hasOwnProperty(contentKey)) {
        const mediaType = header.content[contentKey];
        walkMediaTypeReferences(mediaType, modify);
      }
    }
  }
}

/**
 * `#/paths/~1thing/get` -> the path `/thing`, or undefined if not that shape.
 *
 * A JSON Pointer escapes `/` as `~1` and `~` as `~0`, so a path key appears in
 * an `operationRef` in escaped form while `referenceModification` is keyed on
 * the raw path. Decoding is what connects the two.
 */
function parseOperationRef(operationRef: string): { path: string; method: string } | undefined {
  const match = /^#\/paths\/([^/]+)\/([^/]+)$/.exec(operationRef);
  if (match === null) {
    return undefined;
  }
  return { path: match[1].replace(/~1/g, '/').replace(/~0/g, '~'), method: match[2] };
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function walkLinkReferences(link: Swagger.Link | Swagger.Reference, modify: Modify): void {
  if (TC.isReference(link)) {
    link.$ref = modify(link.$ref);
  } else {
    // A Link's `operationRef` is a URI pointing at an Operation (issue #106).
    // `pathModification` can move the path out from under it, and nothing
    // rewrote it: prepending "/api" left every operationRef dangling, in a
    // document that still looked valid.
    //
    // `operationId` links need no rewriting here -- ensureUniqueOperationIds
    // renames the operation and its id together, and a link by id follows the
    // id, not a location.
    const operationRef = (link as { operationRef?: string }).operationRef;
    if (operationRef === undefined) {
      return;
    }

    const parsed = parseOperationRef(operationRef);
    if (parsed === undefined) {
      // An external or otherwise unrecognised URI. Left alone: it does not
      // point into this document.
      return;
    }

    const rewrittenPath = modify(`#/paths/${parsed.path}`);
    if (rewrittenPath !== `#/paths/${parsed.path}` && rewrittenPath.startsWith('#/paths/')) {
      const newPath = rewrittenPath.slice('#/paths/'.length);
      (link as { operationRef?: string }).operationRef = `#/paths/${escapePointerSegment(newPath)}/${parsed.method}`;
    }
  }
}

export function walkResponseReferences(response: Swagger.Response | Swagger.Reference, modify: Modify): void {
  if (TC.isReference(response)) {
    response.$ref = modify(response.$ref);
  } else {
    if (response.headers !== undefined) {
      for (const headerKey of Object.keys(response.headers)) {
        const headerOrRef = response.headers[headerKey];
        walkHeaderReferences(headerOrRef, modify);
      }
    }

    if (response.content !== undefined) {
      const contentKeys = Object.keys(response.content);
      for (let contentKeyIndex = 0; contentKeyIndex < contentKeys.length; contentKeyIndex++) {
        const contentKey = contentKeys[contentKeyIndex];
        const mediaType = response.content[contentKey];
        walkMediaTypeReferences(mediaType, modify);
      }
    }

    if (response.links !== undefined) {
      const linkKeys = Object.keys(response.links);
      for (let linkKeyIndex = 0; linkKeyIndex < linkKeys.length; linkKeyIndex++) {
        const linkKey = linkKeys[linkKeyIndex];
        const linkOrRef = response.links[linkKey];
        walkLinkReferences(linkOrRef, modify);
      }
    }
  }
}

export function walkCallbackReferences(callback: Swagger.Callback | Swagger.Reference, modify: Modify): void {
  if (TC.isReference(callback)) {
    callback.$ref = modify(callback.$ref);
  } else {
    for (const pathItemKey in callback) {
      if (callback.hasOwnProperty(pathItemKey)) {
        const pathItem = callback[pathItemKey];
        walkPathItemReferences(pathItem, modify);
      }
    }
  }
}

function walkOperationReferences(operation: Swagger.Operation, modify: Modify): void {
  if (operation.parameters !== undefined) {
    for (const parameterOrRef of operation.parameters) {
      walkParameterReferences(parameterOrRef, modify);
    }
  }

  if (operation.requestBody !== undefined) {
    walkRequestBodyReferences(operation.requestBody, modify);
  }

  for (const responseKey in operation.responses) {
    if (operation.responses.hasOwnProperty(responseKey)) {
      const response = operation.responses[responseKey];
      walkResponseReferences(response, modify);
    }
  }

  if (operation.callbacks !== undefined) {
    const callbackKeys = Object.keys(operation.callbacks);
    for (let callbackKeyIndex = 0; callbackKeyIndex < callbackKeys.length; callbackKeyIndex++) {
      const callbackKey = callbackKeys[callbackKeyIndex];
      const callback = operation.callbacks[callbackKey];
      walkCallbackReferences(callback, modify);
    }
  }
}

function walkPathItemReferences(pathItem: PathItem32, modify: Modify): void {
  if (pathItem['$ref'] !== undefined) {
    pathItem['$ref'] = modify(pathItem['$ref']);
  } else {
    // Includes `query` and every custom verb in `additionalOperations`; a $ref
    // inside one of those is a real reference and must be rewritten like any other.
    for (const { operation } of getPathItemOperations(pathItem)) {
      walkOperationReferences(operation, modify);
    }

    if (pathItem.parameters !== undefined) {
      for (let parameterIndex = 0; parameterIndex < pathItem.parameters.length; parameterIndex++) {
        walkParameterReferences(pathItem.parameters[parameterIndex], modify);
      }
    }
  }
}

export function walkComponentReferences(components: Components31, modify: Modify): void {
  if (components.schemas !== undefined) {
    for (const schemaKey in components.schemas) {
      if (components.schemas.hasOwnProperty(schemaKey)) {
        const schema = components.schemas[schemaKey];
        walkSchemaReferences(schema, modify);
      }
    }
  }

  if (components.responses !== undefined) {
    for (const responsesKey in components.responses) {
      if (components.responses.hasOwnProperty(responsesKey)) {
        const response = components.responses[responsesKey];

        walkResponseReferences(response, modify);
      }
    }
  }

  if (components.parameters !== undefined) {
    for (const parameterKey in components.parameters) {
      if (components.parameters.hasOwnProperty(parameterKey)) {
        const parameter = components.parameters[parameterKey];
        walkParameterReferences(parameter, modify);
      }
    }
  }

  if (components.examples !== undefined) {
    for (const exampleKey in components.examples) {
      if (components.examples.hasOwnProperty(exampleKey)) {
        const example = components.examples[exampleKey];
        walkExampleReferences(example, modify);
      }
    }
  }

  if (components.requestBodies !== undefined) {
    for (const requestBodyKey in components.requestBodies) {
      if (components.requestBodies.hasOwnProperty(requestBodyKey)) {
        const requestBody = components.requestBodies[requestBodyKey];
        walkRequestBodyReferences(requestBody, modify);
      }
    }
  }

  if (components.headers !== undefined) {
    for (const headerKey in components.headers) {
      if (components.headers.hasOwnProperty(headerKey)) {
        const header = components.headers[headerKey];
        walkHeaderReferences(header, modify);
      }
    }
  }

  if (components.links !== undefined) {
    for (const linkKey in components.links) {
      if (components.links.hasOwnProperty(linkKey)) {
        const link = components.links[linkKey];
        walkLinkReferences(link, modify);
      }
    }
  }

  // 3.1 component type: a map of Path Items, walked like any other.
  if (components.pathItems !== undefined) {
    walkPathItemMapReferences(components.pathItems, modify);
  }

  if (components.callbacks !== undefined) {
    for (const componentKey in components.callbacks) {
      if (components.callbacks.hasOwnProperty(componentKey)) {
        const callback = components.callbacks[componentKey];
        walkCallbackReferences(callback, modify);
      }
    }
  }
}

/**
 * Walk a map of Path Items. Shared by `paths`, `webhooks` and
 * `components.pathItems`, which are structurally identical.
 */
export function walkPathItemMapReferences(items: PathItemMap, modify: Modify): void {
  for (const key in items) {
    if (items.hasOwnProperty(key)) {
      walkPathItemReferences(items[key], modify);
    }
  }
}

export function walkPathReferences(paths: Swagger.Paths, modify: Modify): void {
  for (const pathKey in paths) {
    if (paths.hasOwnProperty(pathKey)) {
      const path = paths[pathKey];
      walkPathItemReferences(path, modify);
    }
  }
}

export function walkAllReferences(oas: OpenApiDocument, modify: Modify): void {
  walkPathReferences(getPaths(oas), modify);

  // 3.1: webhooks are Path Items and carry references exactly as paths do.
  // Missing them is how a $ref inside a webhook survived into the output while
  // the component it pointed at was renamed underneath it.
  walkPathItemMapReferences(getWebhooks(oas), modify);

  if (oas.components !== undefined) walkComponentReferences(oas.components, modify);
}