import { Swagger, SwaggerLookup } from 'atlassian-openapi';
import { deepEquality, shallowEquality } from '../component-equivalence';

// A minimal Lookup that backs onto a trivially valid empty document; the
// tests below never produce $ref objects so the lookup is never consulted.
function buildLookup(): SwaggerLookup.InternalLookup {
  const emptyOas: Swagger.SwaggerV3 = {
    openapi: '3.0.3',
    info: { title: 't', version: '1' },
    paths: {},
  };
  return new SwaggerLookup.InternalLookup(emptyOas);
}

describe('component-equivalence: null and undefined handling (issue #92)', () => {
  describe('deepEquality', () => {
    const compare = deepEquality(buildLookup(), buildLookup());

    it('does not throw and returns true when both sides are null', () => {
      expect(() => compare(null as unknown as Swagger.Schema, null as unknown as Swagger.Schema)).not.toThrow();
      expect(compare(null as unknown as Swagger.Schema, null as unknown as Swagger.Schema)).toBe(true);
    });

    it('does not throw and returns true when both sides are undefined', () => {
      expect(() => compare(undefined as unknown as Swagger.Schema, undefined as unknown as Swagger.Schema)).not.toThrow();
      expect(compare(undefined as unknown as Swagger.Schema, undefined as unknown as Swagger.Schema)).toBe(true);
    });

    it('does not throw and returns false when one side is null and the other is an object', () => {
      const obj: Swagger.Schema = { type: 'string' };
      expect(() => compare(null as unknown as Swagger.Schema, obj)).not.toThrow();
      expect(compare(null as unknown as Swagger.Schema, obj)).toBe(false);
      expect(compare(obj, null as unknown as Swagger.Schema)).toBe(false);
    });

    it('does not throw and returns false when one side is undefined and the other is a reference', () => {
      const ref: Swagger.Reference = { $ref: '#/components/schemas/Test' };
      expect(() => compare(undefined as unknown as Swagger.Schema, ref)).not.toThrow();
      expect(compare(undefined as unknown as Swagger.Schema, ref)).toBe(false);
    });

    it('does not throw on nested objects that contain null values (regression for issue #92 stack trace)', () => {
      // The original report had a stack trace ending in
      //   TypeError: Cannot use 'in' operator to search for '$ref' in null
      // This object shape reproduces that situation: a property on a real
      // schema whose value is `null`.
      const left = { type: 'object', properties: { foo: null } } as unknown as Swagger.Schema;
      const right = { type: 'object', properties: { foo: null } } as unknown as Swagger.Schema;
      expect(() => compare(left, right)).not.toThrow();
      expect(compare(left, right)).toBe(true);
    });
  });

  describe('shallowEquality', () => {
    // A walker that never reports any references; sufficient for these tests.
    const noopWalker = (): void => undefined;
    const compare = shallowEquality<Swagger.Schema>(noopWalker);

    it('does not throw and returns true when both sides are null', () => {
      expect(() => compare(null as unknown as Swagger.Schema, null as unknown as Swagger.Schema)).not.toThrow();
      expect(compare(null as unknown as Swagger.Schema, null as unknown as Swagger.Schema)).toBe(true);
    });

    it('does not throw and returns false when one side is null and the other is an object', () => {
      const obj: Swagger.Schema = { type: 'string' };
      expect(() => compare(null as unknown as Swagger.Schema, obj)).not.toThrow();
      expect(compare(null as unknown as Swagger.Schema, obj)).toBe(false);
    });
  });
});
