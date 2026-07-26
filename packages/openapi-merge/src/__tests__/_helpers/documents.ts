import { Swagger } from '@atlassian/atlassian-openapi';
import { isErrorResult, MergeResult } from '../../data';
import { OpenApiDocument } from '../../oas31';

/**
 * Document builders and assertions shared across the test suites.
 *
 * These live here rather than being redefined per file so that a test can be
 * moved between suites without dragging a private copy of `doc`/`op` with it.
 */

/** The minimal valid Responses Object. */
export const ok = { '200': { description: 'ok' } };

/** An operation with an id and nothing else of interest. */
export const op = (operationId: string): Swagger.Operation => ({ operationId, responses: ok });

/** An operation carrying tags, for operation-selection tests. */
export const tagged = (operationId: string, tags: string[]): Swagger.Operation =>
  ({ operationId, responses: ok, tags });

/**
 * Build a Schema Object from an arbitrary shape.
 *
 * The 3.0-derived `Swagger.Schema` type does not model JSON Schema 2020-12, so
 * 3.1 spellings (`type` as an array, numeric `exclusiveMinimum`, `$schema`) do
 * not typecheck against it. Harmless at runtime because the merge treats schema
 * contents as opaque -- it compares and copies them without interpretation --
 * so this keeps tests honest about real document shapes without widening the
 * library's types.
 */
export function schema(shape: Record<string, unknown>): Swagger.Schema {
  return shape as unknown as Swagger.Schema;
}

/**
 * Read a deeply nested value by key path.
 *
 * These documents nest a long way (a callback holds a path item holds an
 * operation holds a request body holds a media type holds a schema), and
 * spelling that out as nested casts is unreadable and easy to get one level
 * wrong.
 */
export function at(root: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], root);
}

function docAt(version: string): (partial: Partial<OpenApiDocument>) => OpenApiDocument {
  return partial => ({
    openapi: version,
    info: { title: 'Test', version: '1.0.0' },
    ...partial,
  } as OpenApiDocument);
}

export const doc30 = docAt('3.0.3');
export const doc31 = docAt('3.1.1');
export const doc32 = docAt('3.2.0');

/** Narrow a MergeResult to its successful branch, failing the test otherwise. */
export function expectSuccess(result: MergeResult): OpenApiDocument {
  if (isErrorResult(result)) {
    throw new Error(`Expected success, got ${result.type}: ${result.message}`);
  }
  return result.output;
}

/** Assert the merge failed with a specific ErrorType, returning the message. */
export function expectMergeError(result: MergeResult, type: string): string {
  if (!isErrorResult(result)) {
    throw new Error(`Expected ${type}, got success: ${JSON.stringify(result, null, 2)}`);
  }
  expect(result.type).toBe(type);
  return result.message;
}

export const pathKeys = (o: OpenApiDocument): string[] => Object.keys(o.paths ?? {}).sort();
export const schemaKeys = (o: OpenApiDocument): string[] => Object.keys(o.components?.schemas ?? {}).sort();
export const webhookKeys = (o: OpenApiDocument): string[] => Object.keys(o.webhooks ?? {}).sort();
export const pathItem = (o: OpenApiDocument, path: string): Record<string, unknown> =>
  (o.paths ?? {})[path] as unknown as Record<string, unknown>;
