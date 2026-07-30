import { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import { merge } from '../index';
import { MergeInputDocument } from '../oas31';
import { expectSuccess } from './_helpers/documents';

/**
 * Issue #75: documents from `openapi-types` are accepted without a cast.
 *
 * The reported symptom was a compile error, so most of what matters here is
 * checked by `bun run typecheck` rather than at runtime -- the assignments
 * below fail the build if the input type ever narrows again, which is the
 * regression worth guarding. `bun test` transpiles without typechecking, so
 * these would pass even while broken; the typecheck step in `bun run lint` is
 * what actually enforces them.
 *
 * The runtime cases exist to prove the accompanying claim: that the two
 * libraries describe the same JSON, so a document typed by one really can be
 * merged by the other.
 */
describe('openapi-types compatibility (issue #75)', () => {
  it('accepts an OpenAPIV3.Document without a cast', () => {
    const parsed: OpenAPIV3.Document = {
      openapi: '3.0.3',
      info: { title: 'Parsed by swagger-parser', version: '1.0.0' },
      paths: {
        '/thing': {
          get: { operationId: 'getThing', responses: { '200': { description: 'ok' } } },
        },
      },
    };

    // The exact call from the issue. It did not compile before.
    const output = expectSuccess(merge([{ oas: parsed }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/thing']);
  });

  it('accepts an OpenAPIV3_1.Document without a cast', () => {
    const parsed: OpenAPIV3_1.Document = {
      openapi: '3.1.1',
      info: { title: '3.1 document', version: '1.0.0' },
      paths: {
        '/thing': {
          get: { operationId: 'getThing', responses: { '200': { description: 'ok' } } },
        },
      },
    };

    const output = expectSuccess(merge([{ oas: parsed }]));

    expect(Object.keys(output.paths ?? {})).toEqual(['/thing']);
  });

  it('merges an openapi-types document together with a plain one', () => {
    const fromParser: OpenAPIV3.Document = {
      openapi: '3.0.3',
      info: { title: 'A', version: '1.0.0' },
      paths: { '/a': { get: { operationId: 'getA', responses: { '200': { description: 'ok' } } } } },
    };

    const output = expectSuccess(
      merge([
        { oas: fromParser },
        {
          oas: {
            openapi: '3.0.3',
            info: { title: 'B', version: '1.0.0' },
            paths: { '/b': { get: { operationId: 'getB', responses: { '200': { description: 'ok' } } } } },
          },
        },
      ]),
    );

    expect(Object.keys(output.paths ?? {}).sort()).toEqual(['/a', '/b']);
  });

  it('carries components through from an openapi-types document', () => {
    const parsed: OpenAPIV3.Document = {
      openapi: '3.0.3',
      info: { title: 'With components', version: '1.0.0' },
      paths: {
        '/a': {
          get: {
            operationId: 'getA',
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } },
              },
            },
          },
        },
      },
      components: { schemas: { Thing: { type: 'object', properties: { id: { type: 'string' } } } } },
    };

    const output = expectSuccess(merge([{ oas: parsed }]));

    expect(Object.keys(output.components?.schemas ?? {})).toEqual(['Thing']);
  });

  it('assigns all three document types to MergeInputDocument', () => {
    // A pure type assertion. Its value is in `bun run typecheck`: if the union
    // is ever narrowed back, the build fails here with a clear pointer to #75.
    const v3: MergeInputDocument = {
      openapi: '3.0.3',
      info: { title: 'v3', version: '1' },
      paths: {},
    } satisfies OpenAPIV3.Document;

    // 3.1 requires at least one of paths / webhooks / components.
    const v31: MergeInputDocument = {
      openapi: '3.1.1',
      info: { title: 'v31', version: '1' },
      webhooks: {},
    } satisfies OpenAPIV3_1.Document;

    const own: MergeInputDocument = { openapi: '3.2.0', info: { title: 'own', version: '1' }, paths: {} };

    expect([v3, v31, own].map(d => d.openapi)).toEqual(['3.0.3', '3.1.1', '3.2.0']);
  });
});
