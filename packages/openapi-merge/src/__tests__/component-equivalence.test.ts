import { Swagger, SwaggerLookup } from "atlassian-openapi";
import { deepEquality } from "../component-equivalence";
import { toOAS } from "./oas-generation";

describe("component-equivalence", () => {
  describe("deepEquality", () => {
    const schemas = {
      FooNoRef: {
        type: "number",
      },
      BarLocalRef: {
        type: "object",
        properties: {
          referencedProp: { $ref: "#/components/schemas/FooNoRef" },
        },
      },
      BazExternalRef: {
        type: "object",
        properties: {
          referencedProp: { $ref: "/external/file.yaml#/components/schemas/Ref" },
        },
      },
    } as const;
    it("compares 2 equal Bar schemas", () => {
      const oas1: Swagger.SwaggerV3 = toOAS({}, { schemas });
      const lookup1 = new SwaggerLookup.InternalLookup(oas1);
      const lookup2 = new SwaggerLookup.InternalLookup(oas1);

      const compare = deepEquality(lookup1, lookup2);
      const actualResult = compare(schemas.BarLocalRef, schemas.BarLocalRef);

      expect(actualResult).toBe(true);
    });

    it("compares unequal Foo and Bar schemas", () => {
      const oas1: Swagger.SwaggerV3 = toOAS({}, { schemas });
      const lookup1 = new SwaggerLookup.InternalLookup(oas1);
      const lookup2 = new SwaggerLookup.InternalLookup(oas1);

      const compare = deepEquality(lookup1, lookup2);
      const actualResult = compare(schemas.FooNoRef, schemas.BarLocalRef);

      expect(actualResult).toBe(false);
    }); 

    it("compares 2 equal Baz schemas having external ref", () => {
      const oas1: Swagger.SwaggerV3 = toOAS({}, { schemas });
      const lookup1 = new SwaggerLookup.InternalLookup(oas1);
      const lookup2 = new SwaggerLookup.InternalLookup(oas1);

      const compare = deepEquality(lookup1, lookup2);
      const actualResult = compare(schemas.BazExternalRef, schemas.BazExternalRef);

      expect(actualResult).toBe(true);
    });
  });
});
