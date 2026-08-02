/* eslint-disable no-prototype-builtins */
import { Swagger } from "@atlassian/atlassian-openapi";
import { Components31, getPathItemOperations, getPaths, getWebhooks, OpenApiDocument, PathItem32, PathItemMap } from './oas31';
import { isHeaderWithSchema, isMediaTypeWithExamples, isParameterWithSchema, isReference, required } from './safe-type-checks';

export type Modify = (input: string) => string;

/**
 * Composes a child JSON Pointer segment, or stays `undefined` if the parent
 * pointer is -- a caller that does not know its own location (most of this
 * codebase's existing tests, calling these functions directly) gets no
 * location in a thrown error rather than a pointer rooted at "undefined".
 */
function child(pointer: string | undefined, segment: string): string | undefined {
  return pointer === undefined ? undefined : `${pointer}/${segment}`;
}

export function walkSchemaReferences(schema: Swagger.Schema | Swagger.Reference, modify: Modify, pointer?: string): void {
  if (isReference(schema, pointer)) {
    schema.$ref = modify(schema.$ref);
  } else {
    if (schema.not !== undefined) walkSchemaReferences(schema.not, modify, child(pointer, 'not'));

    if (schema.allOf !== undefined) {
      schema.allOf.forEach((childSchema, index) => walkSchemaReferences(childSchema, modify, child(pointer, `allOf/${index}`)));
    }

    if (schema.oneOf !== undefined) {
      schema.oneOf.forEach((childSchema, index) => walkSchemaReferences(childSchema, modify, child(pointer, `oneOf/${index}`)));
    }

    if (schema.anyOf !== undefined) {
      schema.anyOf.forEach((childSchema, index) => walkSchemaReferences(childSchema, modify, child(pointer, `anyOf/${index}`)));
    }

    if (schema.items !== undefined) {
      walkSchemaReferences(schema.items, modify, child(pointer, 'items'));
    }

    for (const propertyKey in schema.properties) {
      if (schema.properties.hasOwnProperty(propertyKey)) {
        const property = schema.properties[propertyKey];
        walkSchemaReferences(property, modify, child(pointer, `properties/${propertyKey}`));
      }
    }

    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
      walkSchemaReferences(schema.additionalProperties, modify, child(pointer, 'additionalProperties'));
    }

    walkDiscriminatorPointers(schema, modify, pointer);
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
function walkDiscriminatorPointers(schema: Swagger.Schema, modify: Modify, pointer?: string): void {
  const discriminator = (schema as {
    discriminator?: { mapping?: Record<string, string>; defaultMapping?: string };
  }).discriminator;
  if (discriminator === undefined) {
    return;
  }

  const SCHEMA_PREFIX = '#/components/schemas/';

  const rewriteTarget = (value: string, targetPointer: string | undefined): string => {
    const target = required(value as string | null, 'a mapping target string', targetPointer);

    if (target.startsWith('#/')) {
      return modify(target);
    }

    if (!target.includes('/') && !target.includes('#')) {
      const rewritten = modify(`${SCHEMA_PREFIX}${target}`);
      if (rewritten !== `${SCHEMA_PREFIX}${target}` && rewritten.startsWith(SCHEMA_PREFIX)) {
        return rewritten.slice(SCHEMA_PREFIX.length);
      }
    }

    return target;
  };

  const mapping = discriminator.mapping;
  if (mapping !== undefined) {
    for (const key of Object.keys(mapping)) {
      mapping[key] = rewriteTarget(mapping[key], child(pointer, `discriminator/mapping/${key}`));
    }
  }

  if (discriminator.defaultMapping !== undefined) {
    discriminator.defaultMapping = rewriteTarget(discriminator.defaultMapping, child(pointer, 'discriminator/defaultMapping'));
  }
}

export function walkExampleReferences(example: Swagger.Example | Swagger.Reference, modify: Modify, pointer?: string): void {
  if (isReference(example, pointer)) {
    example.$ref = modify(example.$ref);
  }
}

/**
 * Unlike the functions above, a `MediaType` is not reached via a `TC.*` check
 * of its own -- callers pull it straight out of a `content` map -- so a
 * `null` media type (`content: { 'application/json': }`) needs its own guard
 * rather than inheriting one from the first line of this function.
 */
function walkMediaTypeReferences(mediaType: Swagger.MediaType, modify: Modify, pointer?: string): void {
  const media = required(mediaType as Swagger.MediaType | null, 'a Media Type Object', pointer);

  if (media.schema !== undefined) walkSchemaReferences(media.schema, modify, child(pointer, 'schema'));

  if (isMediaTypeWithExamples(media, pointer)) {
    if (media.schema !== undefined) walkSchemaReferences(media.schema, modify, child(pointer, 'schema'));

    for (const exampleKey of Object.keys(media.examples)) {
      const example = media.examples[exampleKey];
      walkExampleReferences(example, modify, child(pointer, `examples/${exampleKey}`));
    }
  }
}

export function walkParameterReferences(parameterOrRef: Swagger.ParameterOrRef, modify: Modify, pointer?: string): void {
  if (isReference(parameterOrRef, pointer)) {
    parameterOrRef.$ref = modify(parameterOrRef.$ref);
  } else if (isParameterWithSchema(parameterOrRef, pointer)) {
    walkSchemaReferences(parameterOrRef.schema, modify, child(pointer, 'schema'));

    if ('examples' in parameterOrRef) {
      for (const exampleKey in parameterOrRef.examples) {
        if (parameterOrRef.examples.hasOwnProperty(exampleKey)) {
          const example = parameterOrRef.examples[exampleKey];
          walkExampleReferences(example, modify, child(pointer, `examples/${exampleKey}`));
        }
      }
    }
  } else {
    for (const contentKey in parameterOrRef.content) {
      if (parameterOrRef.content.hasOwnProperty(contentKey)) {
        const mediaType = parameterOrRef.content[contentKey];
        walkMediaTypeReferences(mediaType, modify, child(pointer, `content/${contentKey}`));
      }
    }
  }
}

export function walkRequestBodyReferences(requestBody: Swagger.RequestBody | Swagger.Reference, modify: Modify, pointer?: string): void {
  if (isReference(requestBody, pointer)) {
    requestBody.$ref = modify(requestBody.$ref);
  } else {
    for (const contentKey in requestBody.content) {
      if (requestBody.content.hasOwnProperty(contentKey)) {
        const mediaType = requestBody.content[contentKey];
        walkMediaTypeReferences(mediaType, modify, child(pointer, `content/${contentKey}`));
      }
    }
  }
}

export function walkHeaderReferences(header: Swagger.Header | Swagger.Reference, modify: Modify, pointer?: string): void {
  if (isReference(header, pointer)) {
    header.$ref = modify(header.$ref);
  } else if (isHeaderWithSchema(header, pointer)) {
    if (header.schema !== undefined) walkSchemaReferences(header.schema, modify, child(pointer, 'schema'));

    if ('examples' in header) {
      for (const exampleKey in header.examples) {
        if (header.examples.hasOwnProperty(exampleKey)) {
          const example = header.examples[exampleKey];
          walkExampleReferences(example, modify, child(pointer, `examples/${exampleKey}`));
        }
      }
    }
  } else {
    for (const contentKey in header.content) {
      if (header.content.hasOwnProperty(contentKey)) {
        const mediaType = header.content[contentKey];
        walkMediaTypeReferences(mediaType, modify, child(pointer, `content/${contentKey}`));
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

export function walkLinkReferences(link: Swagger.Link | Swagger.Reference, modify: Modify, pointer?: string): void {
  if (isReference(link, pointer)) {
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
      // point into this document. Also covers `operationRef: null` -- the
      // regex coerces it to the string "null", which never matches.
      return;
    }

    const rewrittenPath = modify(`#/paths/${parsed.path}`);
    if (rewrittenPath !== `#/paths/${parsed.path}` && rewrittenPath.startsWith('#/paths/')) {
      const newPath = rewrittenPath.slice('#/paths/'.length);
      (link as { operationRef?: string }).operationRef = `#/paths/${escapePointerSegment(newPath)}/${parsed.method}`;
    }
  }
}

export function walkResponseReferences(response: Swagger.Response | Swagger.Reference, modify: Modify, pointer?: string): void {
  if (isReference(response, pointer)) {
    response.$ref = modify(response.$ref);
  } else {
    if (response.headers !== undefined) {
      for (const headerKey of Object.keys(response.headers)) {
        const headerOrRef = response.headers[headerKey];
        walkHeaderReferences(headerOrRef, modify, child(pointer, `headers/${headerKey}`));
      }
    }

    if (response.content !== undefined) {
      const contentKeys = Object.keys(response.content);
      for (let contentKeyIndex = 0; contentKeyIndex < contentKeys.length; contentKeyIndex++) {
        const contentKey = contentKeys[contentKeyIndex];
        const mediaType = response.content[contentKey];
        walkMediaTypeReferences(mediaType, modify, child(pointer, `content/${contentKey}`));
      }
    }

    if (response.links !== undefined) {
      const linkKeys = Object.keys(response.links);
      for (let linkKeyIndex = 0; linkKeyIndex < linkKeys.length; linkKeyIndex++) {
        const linkKey = linkKeys[linkKeyIndex];
        const linkOrRef = response.links[linkKey];
        walkLinkReferences(linkOrRef, modify, child(pointer, `links/${linkKey}`));
      }
    }
  }
}

export function walkCallbackReferences(callback: Swagger.Callback | Swagger.Reference, modify: Modify, pointer?: string): void {
  if (isReference(callback, pointer)) {
    callback.$ref = modify(callback.$ref);
  } else {
    for (const pathItemKey in callback) {
      if (callback.hasOwnProperty(pathItemKey)) {
        const pathItem = callback[pathItemKey];
        walkPathItemReferences(pathItem, modify, child(pointer, pathItemKey));
      }
    }
  }
}

/**
 * Never receives a `null` operation at runtime: its one caller,
 * `walkPathItemReferences`, reaches this only through `getPathItemOperations`,
 * which throws on a `null` operation before returning it (proposal 40 §4.1,
 * `oas31.ts`) -- so this does not need its own guard on top of that one.
 */
function walkOperationReferences(operation: Swagger.Operation, modify: Modify, pointer?: string): void {
  if (operation.parameters !== undefined) {
    operation.parameters.forEach((parameterOrRef, index) => walkParameterReferences(parameterOrRef, modify, child(pointer, `parameters/${index}`)));
  }

  if (operation.requestBody !== undefined) {
    walkRequestBodyReferences(operation.requestBody, modify, child(pointer, 'requestBody'));
  }

  for (const responseKey in operation.responses) {
    if (operation.responses.hasOwnProperty(responseKey)) {
      const response = operation.responses[responseKey];
      walkResponseReferences(response, modify, child(pointer, `responses/${responseKey}`));
    }
  }

  if (operation.callbacks !== undefined) {
    const callbackKeys = Object.keys(operation.callbacks);
    for (let callbackKeyIndex = 0; callbackKeyIndex < callbackKeys.length; callbackKeyIndex++) {
      const callbackKey = callbackKeys[callbackKeyIndex];
      const callback = operation.callbacks[callbackKey];
      walkCallbackReferences(callback, modify, child(pointer, `callbacks/${callbackKey}`));
    }
  }
}

/**
 * Unlike most functions above, a Path Item is not reached via a `TC.*` check
 * of its own, and -- unlike `walkOperationReferences` -- has more than one
 * caller that can hand it a `null` before anything else has had a chance to
 * validate it (the CLI's `normalizeCrossDocumentRefs` walks a raw, just-parsed
 * document, before `dropPathItemsWithNoOperations` ever runs). It needs its
 * own guard.
 */
function walkPathItemReferences(pathItem: PathItem32, modify: Modify, pointer?: string): void {
  const item = required(pathItem as PathItem32 | null, 'a Path Item Object or Reference', pointer);

  if (item['$ref'] !== undefined) {
    item['$ref'] = modify(item['$ref']);
  } else {
    // Includes `query` and every custom verb in `additionalOperations`; a $ref
    // inside one of those is a real reference and must be rewritten like any other.
    for (const { method, operation } of getPathItemOperations(item)) {
      walkOperationReferences(operation, modify, child(pointer, method));
    }

    if (item.parameters !== undefined) {
      item.parameters.forEach((parameterOrRef, index) => walkParameterReferences(parameterOrRef, modify, child(pointer, `parameters/${index}`)));
    }
  }
}

export function walkComponentReferences(components: Components31, modify: Modify, pointer?: string): void {
  if (components.schemas !== undefined) {
    for (const schemaKey in components.schemas) {
      if (components.schemas.hasOwnProperty(schemaKey)) {
        const schema = components.schemas[schemaKey];
        walkSchemaReferences(schema, modify, child(pointer, `schemas/${schemaKey}`));
      }
    }
  }

  if (components.responses !== undefined) {
    for (const responsesKey in components.responses) {
      if (components.responses.hasOwnProperty(responsesKey)) {
        const response = components.responses[responsesKey];

        walkResponseReferences(response, modify, child(pointer, `responses/${responsesKey}`));
      }
    }
  }

  if (components.parameters !== undefined) {
    for (const parameterKey in components.parameters) {
      if (components.parameters.hasOwnProperty(parameterKey)) {
        const parameter = components.parameters[parameterKey];
        walkParameterReferences(parameter, modify, child(pointer, `parameters/${parameterKey}`));
      }
    }
  }

  if (components.examples !== undefined) {
    for (const exampleKey in components.examples) {
      if (components.examples.hasOwnProperty(exampleKey)) {
        const example = components.examples[exampleKey];
        walkExampleReferences(example, modify, child(pointer, `examples/${exampleKey}`));
      }
    }
  }

  if (components.requestBodies !== undefined) {
    for (const requestBodyKey in components.requestBodies) {
      if (components.requestBodies.hasOwnProperty(requestBodyKey)) {
        const requestBody = components.requestBodies[requestBodyKey];
        walkRequestBodyReferences(requestBody, modify, child(pointer, `requestBodies/${requestBodyKey}`));
      }
    }
  }

  if (components.headers !== undefined) {
    for (const headerKey in components.headers) {
      if (components.headers.hasOwnProperty(headerKey)) {
        const header = components.headers[headerKey];
        walkHeaderReferences(header, modify, child(pointer, `headers/${headerKey}`));
      }
    }
  }

  if (components.links !== undefined) {
    for (const linkKey in components.links) {
      if (components.links.hasOwnProperty(linkKey)) {
        const link = components.links[linkKey];
        walkLinkReferences(link, modify, child(pointer, `links/${linkKey}`));
      }
    }
  }

  // 3.1 component type: a map of Path Items, walked like any other.
  if (components.pathItems !== undefined) {
    walkPathItemMapReferences(components.pathItems, modify, child(pointer, 'pathItems'));
  }

  if (components.callbacks !== undefined) {
    for (const componentKey in components.callbacks) {
      if (components.callbacks.hasOwnProperty(componentKey)) {
        const callback = components.callbacks[componentKey];
        walkCallbackReferences(callback, modify, child(pointer, `callbacks/${componentKey}`));
      }
    }
  }
}

/**
 * Walk a map of Path Items. Shared by `paths`, `webhooks` and
 * `components.pathItems`, which are structurally identical.
 */
export function walkPathItemMapReferences(items: PathItemMap, modify: Modify, pointer?: string): void {
  for (const key in items) {
    if (items.hasOwnProperty(key)) {
      walkPathItemReferences(items[key], modify, child(pointer, key));
    }
  }
}

export function walkPathReferences(paths: Swagger.Paths, modify: Modify, pointer?: string): void {
  for (const pathKey in paths) {
    if (paths.hasOwnProperty(pathKey)) {
      const path = paths[pathKey];
      walkPathItemReferences(path, modify, child(pointer, pathKey));
    }
  }
}

export function walkAllReferences(oas: OpenApiDocument, modify: Modify): void {
  walkPathReferences(getPaths(oas), modify, '#/paths');

  // 3.1: webhooks are Path Items and carry references exactly as paths do.
  // Missing them is how a $ref inside a webhook survived into the output while
  // the component it pointed at was renamed underneath it.
  walkPathItemMapReferences(getWebhooks(oas), modify, '#/webhooks');

  if (oas.components !== undefined) {
    // Not just `!== undefined`: a document can carry `components:` present
    // but empty, which parses as `null` -- required() turns that into a clear
    // error instead of a crash three calls down in walkComponentReferences.
    const components = required(oas.components as Components31 | null, 'a Components Object', '#/components');
    walkComponentReferences(components, modify, '#/components');
  }
}
