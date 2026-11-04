import { Swagger, SwaggerLookup } from '@atlassian/atlassian-openapi';
import { deepEquality, shallowEquality } from '../component-equivalence';
import { walkSchemaReferences } from '../reference-walker';

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

describe('deepEquality: heterogeneous reference targets and cycle bookkeeping', () => {
  it('uses the default schema lookup resolvers when no custom resolver is supplied', () => {
    const document = (type: Swagger.Schema['type']): Swagger.SwaggerV3 => ({
      openapi: '3.0.3',
      info: { title: 't', version: '1' },
      paths: {},
      components: { schemas: { Item: { type } } },
    });
    const compare = deepEquality(
      new SwaggerLookup.InternalLookup(document('string')),
      new SwaggerLookup.InternalLookup(document('string')),
    );

    expect(compare(
      { $ref: '#/components/schemas/Item' },
      { $ref: '#/components/schemas/Item' },
    )).toBe(true);
  });

  it('compares two resolved non-schema values structurally', () => {
    const left = { $ref: '#/components/headers/Trace' } as Swagger.Reference;
    const right = { $ref: '#/components/headers/Trace' } as Swagger.Reference;
    const compare = deepEquality(
      buildLookup(),
      buildLookup(),
      () => ({ kind: 'headers', value: { description: 'trace', required: false } }),
      () => ({ kind: 'headers', value: { description: 'trace', required: false } }),
    );

    expect(compare(left, right)).toBe(true);
  });

  it('does not retain an unequal reference pair between calls', () => {
    const left = { $ref: '#/components/headers/Trace' } as Swagger.Reference;
    const right = { $ref: '#/components/headers/Trace' } as Swagger.Reference;
    const compare = deepEquality(
      buildLookup(),
      buildLookup(),
      () => ({ kind: 'headers', value: { description: 'left' } }),
      () => ({ kind: 'headers', value: { description: 'right' } }),
    );

    expect(compare(left, right)).toBe(false);
    expect(compare(left, right)).toBe(false);
  });

  it('breaks active cycles while still comparing the rest of each object', () => {
    const leftRef = { $ref: '#/components/headers/Left' } as Swagger.Reference;
    const rightRef = { $ref: '#/components/headers/Right' } as Swagger.Reference;
    const compare = deepEquality(
      buildLookup(),
      buildLookup(),
      () => ({ kind: 'headers', value: { next: leftRef, marker: 'same' } }),
      () => ({ kind: 'headers', value: { next: rightRef, marker: 'same' } }),
    );

    expect(compare(leftRef, rightRef)).toBe(true);
    const unequal = deepEquality(
      buildLookup(),
      buildLookup(),
      () => ({ kind: 'headers', value: { next: leftRef, marker: 'left' } }),
      () => ({ kind: 'headers', value: { next: rightRef, marker: 'right' } }),
    );
    expect(unequal(leftRef, rightRef)).toBe(false);
  });

  it('does not compare known references to different component kinds as equal', () => {
    const schemaRef = { $ref: '#/components/schemas/Item' } as Swagger.Reference;
    const headerRef = { $ref: '#/components/headers/Item' } as Swagger.Reference;
    const sameShape = { description: 'same' };
    const compare = deepEquality(
      buildLookup(),
      buildLookup(),
      () => ({ kind: 'schemas', value: sameShape }),
      () => ({ kind: 'headers', value: sameShape }),
    );

    expect(compare(schemaRef, headerRef)).toBe(false);
  });
});

describe('shallowEquality: reference counting', () => {
  it('treats two identical reference-free schemas as equal', () => {
    // Reaches referenceCount: equal, present, not a Reference, zero refs found.
    const compare = shallowEquality<Swagger.Schema>(walkSchemaReferences);

    expect(compare({ type: 'string' }, { type: 'string' })).toBe(true);
  });

  it('treats two identical schemas that contain a reference as NOT equal', () => {
    // Identical, but referenceCount > 0: shallow equality cannot know whether
    // the two $refs resolve to the same thing, so it must decline.
    const compare = shallowEquality<Swagger.Schema>(walkSchemaReferences);
    const withRef = (): Swagger.Schema => ({ properties: { a: { $ref: '#/components/schemas/A' } } });

    expect(compare(withRef(), withRef())).toBe(false);
  });

  it('returns false when the two values differ', () => {
    const compare = shallowEquality<Swagger.Schema>(walkSchemaReferences);

    expect(compare({ type: 'string' }, { type: 'number' })).toBe(false);
  });

  it('returns false when both sides are the same reference', () => {
    const compare = shallowEquality<Swagger.Schema>(walkSchemaReferences);
    const ref: Swagger.Reference = { $ref: '#/components/schemas/A' };

    expect(compare(ref, { ...ref })).toBe(false);
  });
});
