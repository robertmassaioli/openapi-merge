import {
  DocumentReference, normalizeCrossDocumentRefs, resolveCrossDocumentIdentity,
} from '../external-reference-discovery';
import { OpenApiDocument } from 'openapi-merge/dist/oas31';

/**
 * The pure identity-classification/resolution logic behind cross-document
 * `$ref` discovery (issues #104, #10), tested directly rather than through a
 * mocked `fetch` -- these are plain functions with no I/O, and the URL-vs-file
 * classification is exactly the part most worth pinning down precisely.
 */
describe('resolveCrossDocumentIdentity', () => {
  const fileRef = (identity: string): DocumentReference => ({ identity, kind: 'file' });
  const urlRef = (identity: string): DocumentReference => ({ identity, kind: 'url' });

  it('resolves a relative path from a file relative to that file\'s own directory', () => {
    const result = resolveCrossDocumentIdentity('../common/Errors.yml', fileRef('/repo/specs/a/Api.yml'));
    expect(result).toEqual({ identity: '/repo/specs/common/Errors.yml', kind: 'file' });
  });

  it('resolves a same-directory relative path from a file', () => {
    const result = resolveCrossDocumentIdentity('./Sibling.yml', fileRef('/repo/specs/a/Api.yml'));
    expect(result).toEqual({ identity: '/repo/specs/a/Sibling.yml', kind: 'file' });
  });

  it('treats an absolute URL found inside a file input as a URL identity, not a path', () => {
    const result = resolveCrossDocumentIdentity('https://example.com/errors.yaml', fileRef('/repo/specs/a/Api.yml'));
    expect(result).toEqual({ identity: 'https://example.com/errors.yaml', kind: 'url' });
  });

  it('resolves a relative reference from a URL against that URL', () => {
    const result = resolveCrossDocumentIdentity('../common/Errors.yml', urlRef('https://example.com/specs/a/Api.yml'));
    expect(result).toEqual({ identity: 'https://example.com/specs/common/Errors.yml', kind: 'url' });
  });

  it('resolves an absolute URL reference from a URL to itself, unchanged', () => {
    const result = resolveCrossDocumentIdentity('https://other.example.com/errors.yaml', urlRef('https://example.com/specs/a/Api.yml'));
    expect(result).toEqual({ identity: 'https://other.example.com/errors.yaml', kind: 'url' });
  });

  it('two different relative spellings of the same file resolve to the same identity', () => {
    const a = resolveCrossDocumentIdentity('../common/Errors.yml', fileRef('/repo/specs/a/Api.yml'));
    const b = resolveCrossDocumentIdentity('../../common/Errors.yml', fileRef('/repo/specs/a/nested/Api.yml'));
    expect(a.identity).toBe(b.identity);
    expect(a.identity).toBe('/repo/specs/common/Errors.yml');
  });
});

describe('normalizeCrossDocumentRefs', () => {
  const self: DocumentReference = { identity: '/repo/specs/a/Api.yml', kind: 'file' };

  function doc(schemas: Record<string, unknown>): OpenApiDocument {
    return { openapi: '3.0.3', info: { title: 'T', version: '1' }, components: { schemas } } as unknown as OpenApiDocument;
  }

  it('rewrites a relative cross-document ref to an absolute identity, in place', () => {
    const document = doc({ Widget: { $ref: '../common/Errors.yml#/components/schemas/ServerError' } });

    normalizeCrossDocumentRefs(document, self);

    expect((document.components?.schemas?.Widget as { $ref: string }).$ref)
      .toBe('/repo/specs/common/Errors.yml#/components/schemas/ServerError');
  });

  it('returns the distinct identities discovered', () => {
    const document = doc({
      A: { $ref: '../common/Errors.yml#/components/schemas/X' },
      B: { $ref: '../common/Errors.yml#/components/schemas/Y' },
      C: { $ref: '../other/Thing.yml#/components/schemas/Z' },
    });

    const found = normalizeCrossDocumentRefs(document, self);

    expect(found.map(f => f.identity).sort()).toEqual([
      '/repo/specs/common/Errors.yml',
      '/repo/specs/other/Thing.yml',
    ]);
  });

  it('leaves a bare same-document ref untouched', () => {
    const document = doc({
      A: { type: 'object' },
      B: { $ref: '#/components/schemas/A' },
    });

    const found = normalizeCrossDocumentRefs(document, self);

    expect((document.components?.schemas?.B as { $ref: string }).$ref).toBe('#/components/schemas/A');
    expect(found).toEqual([]);
  });

  it('leaves a whole-document ref (no fragment) untouched and does not report it as discovered', () => {
    // Legal OpenAPI, but there is no single local pointer that could stand in
    // for "that whole document" -- deliberately out of scope (issue #104 §5.1).
    const document = doc({ Widget: { $ref: '../common/Errors.yml' } });

    const found = normalizeCrossDocumentRefs(document, self);

    expect((document.components?.schemas?.Widget as { $ref: string }).$ref).toBe('../common/Errors.yml');
    expect(found).toEqual([]);
  });
});
