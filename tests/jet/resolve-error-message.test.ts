import { describe, it, expect } from "vitest";
import { Compiler, ValidationError } from "../../src";

type PathContext = { schema: string; mapping?: string };

const msg = (schema: any, pathContext: PathContext, keyword: string) => {
  const compiler = new Compiler(
    [],
    schema,
    { errorMessage: true },
    {} as any,
    new Set(),
    {} as any,
  );
  const eror = compiler.buildErrorReturn(
    pathContext as any,
    { keyword } as any,
    { after: "" } as any,
    "",
    true,
  );
  const error = new Function(`return ${eror}`)() as ValidationError;
  return error.message;
};

describe("resolveErrorMessage - three lookup levels", () => {
  const schema = {
    type: "object",
    properties: {
      age: {
        type: "number",
        minimum: 0,
        errorMessage: { minimum: "Age can't be negative" },
      },
    },
    errorMessage: { properties: { age: { type: "Age must be a number" } } },
  };

  it("resolves at the current level (message on the failing schema)", () => {
    expect(
      msg(
        schema,
        { schema: "#/properties/age", mapping: "/properties/age" },
        "minimum",
      ),
    ).toBe("Age can't be negative");
  });

  it("falls through to the parent level when current has no entry", () => {
    expect(
      msg(
        schema,
        { schema: "#/properties/age", mapping: "/properties/age" },
        "type",
      ),
    ).toBe("Age must be a number");
  });
});

describe("resolveErrorMessage - root centralization and the one-level-down rule", () => {
  it("resolves from root following the full path to any depth", () => {
    const schema = {
      type: "object",
      properties: {
        b: { properties: { c: { properties: { a: { type: "string" } } } } },
      },
      errorMessage: {
        properties: {
          b: { properties: { c: { properties: { a: "resolves from root" } } } },
        },
      },
    };
    expect(
      msg(
        schema,
        {
          schema: "#/properties/b/properties/c/properties/a",
          mapping: "/properties/a",
        },
        "type",
      ),
    ).toBe("resolves from root");
  });

  it("does NOT resolve a message defined two levels down from a non-root errorMessage", () => {
    const schema = {
      type: "object",
      properties: {
        b: {
          properties: { c: { properties: { a: { type: "string" } } } },
          errorMessage: {
            properties: { c: { properties: { a: "won't work" } } },
          },
        },
      },
    };
    expect(
      msg(
        schema,
        {
          schema: "#/properties/b/properties/c/properties/a",
          mapping: "/properties/a",
        },
        "type",
      ),
    ).toBeUndefined();
  });

  it("resolves a message exactly one level down from where it's defined", () => {
    const schema = {
      type: "object",
      properties: {
        b: {
          type: "object",
          properties: {
            c: {
              type: "object",
              properties: { a: { type: "string" } },
              errorMessage: { properties: { a: { type: "a from c" } } },
            },
          },
          errorMessage: { properties: { c: { type: "c from b" } } },
        },
      },
    };
    expect(
      msg(
        schema,
        { schema: "#/properties/b/properties/c", mapping: "/properties/c" },
        "type",
      ),
    ).toBe("c from b");
  });

  it("resolves a deeper node from its immediate parent, not from a grandparent", () => {
    const schema = {
      type: "object",
      properties: {
        b: {
          type: "object",
          properties: {
            c: {
              type: "object",
              properties: { a: { type: "string" } },
              errorMessage: { properties: { a: { type: "a from c" } } },
            },
          },
          errorMessage: { properties: { c: { type: "c from b" } } },
        },
      },
    };
    expect(
      msg(
        schema,
        {
          schema: "#/properties/b/properties/c/properties/a",
          mapping: "/properties/a",
        },
        "type",
      ),
    ).toBe("a from c");
  });
});

describe("resolveErrorMessage - _jetError fallback and schema-string override", () => {
  const schema = {
    type: "object",
    minProperties: 1,
    properties: { name: { type: "string", minLength: 2 } },
    errorMessage: {
      _jetError: "Object validation failed",
      properties: { name: "Invalid name" },
    },
  };

  it("uses _jetError for a plain keyword with no explicit entry", () => {
    expect(
      msg(schema, { schema: "#", mapping: undefined }, "minProperties"),
    ).toBe("Object validation failed");
  });

  it("prefers an explicit per-property message over _jetError", () => {
    expect(
      msg(
        schema,
        { schema: "#/properties/name", mapping: "/properties/name" },
        "type",
      ),
    ).toBe("Invalid name");
  });

  it("a schema-level string overrides every keyword at that level", () => {
    const s = {
      type: "string",
      minLength: 5,
      errorMessage: "Username invalid",
    };
    expect(msg(s, { schema: "#", mapping: undefined }, "minLength")).toBe(
      "Username invalid",
    );
  });
});

describe("resolveErrorMessage - default fallthrough", () => {
  it("returns undefined when no custom message exists anywhere", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    expect(
      msg(
        schema,
        { schema: "#/properties/x", mapping: "/properties/x" },
        "type",
      ),
    ).toBeUndefined();
  });
});

describe("resolveErrorMessage - pointer-encoded property names", () => {
  it("resolves a message for a '/' key (encoded ~1) at the parent level", () => {
    const schema = {
      type: "object",
      properties: { "a/b": { type: "string", minLength: 3 } },
      errorMessage: { properties: { "a/b": { minLength: "slash min" } } },
    };
    expect(
      msg(
        schema,
        { schema: "#/properties/a~1b", mapping: "/properties/a~1b" },
        "minLength",
      ),
    ).toBe("slash min");
  });

  it("resolves a message for a '/' key at the current level", () => {
    const schema = {
      type: "object",
      properties: {
        "a/b": {
          type: "string",
          minLength: 3,
          errorMessage: { minLength: "slash current" },
        },
      },
    };
    expect(
      msg(
        schema,
        { schema: "#/properties/a~1b", mapping: "/properties/a~1b" },
        "minLength",
      ),
    ).toBe("slash current");
  });

  it("resolves a message for a '~' key (encoded ~0) at the parent level", () => {
    const schema = {
      type: "object",
      properties: { "a~b": { type: "string", minLength: 3 } },
      errorMessage: { properties: { "a~b": { minLength: "tilde min" } } },
    };
    expect(
      msg(
        schema,
        { schema: "#/properties/a~0b", mapping: "/properties/a~0b" },
        "minLength",
      ),
    ).toBe("tilde min");
  });

  it("resolves through TWO encoded segments from root", () => {
    const schema = {
      type: "object",
      properties: { "a/b": { properties: { "c/d": { type: "string" } } } },
      errorMessage: {
        properties: { "a/b": { properties: { "c/d": "deep slash" } } },
      },
    };
    expect(
      msg(
        schema,
        {
          schema: "#/properties/a~1b/properties/c~1d",
          mapping: "/properties/c~1d",
        },
        "type",
      ),
    ).toBe("deep slash");
  });
});

describe("resolveErrorMessage - logical operators (anyOf / oneOf / allOf, index-accessed)", () => {
  const arrayForm = {
    anyOf: [
      { type: "string", minLength: 5 },
      { type: "number", minimum: 100 },
    ],
    errorMessage: { anyOf: ["String branch failed", "Number branch failed"] },
  };

  const objectForm = {
    anyOf: [
      { type: "string", minLength: 5 },
      { type: "number", minimum: 100 },
    ],
    errorMessage: {
      anyOf: { 0: "String branch failed", 1: "Number branch failed" },
    },
  };

  const perKeyword = {
    anyOf: [
      { type: "string", minLength: 5, maxLength: 20 },
      { type: "number", minimum: 100 },
    ],
    errorMessage: {
      anyOf: [
        {
          _jetError: "Must be valid string",
          minLength: "String too short",
          maxLength: "String too long",
        },
        { _jetError: "Must be valid number", minimum: "Number too small" },
      ],
    },
  };

  const oneOfArr = {
    oneOf: [
      { type: "string", minLength: 5 },
      { type: "number", minimum: 100 },
    ],
    errorMessage: { oneOf: ["String branch failed", "Number branch failed"] },
  };

  const oneOfObj = {
    oneOf: [
      { type: "string", minLength: 5 },
      { type: "number", minimum: 100 },
    ],
    errorMessage: {
      oneOf: { 0: "String branch failed", 1: "Number branch failed" },
    },
  };

  it("anyOf array form resolves per branch by index", () => {
    expect(
      msg(arrayForm, { schema: "#/anyOf/0", mapping: "/anyOf/0" }, "type"),
    ).toBe("String branch failed");
    expect(
      msg(arrayForm, { schema: "#/anyOf/1", mapping: "/anyOf/1" }, "type"),
    ).toBe("Number branch failed");
  });

  it("anyOf object form resolves per branch by numeric key", () => {
    expect(
      msg(objectForm, { schema: "#/anyOf/0", mapping: "/anyOf/0" }, "type"),
    ).toBe("String branch failed");
    expect(
      msg(objectForm, { schema: "#/anyOf/1", mapping: "/anyOf/1" }, "type"),
    ).toBe("Number branch failed");
  });

  it("anyOf per-keyword within a branch targets the specific keyword", () => {
    expect(
      msg(
        perKeyword,
        { schema: "#/anyOf/0", mapping: "/anyOf/0" },
        "minLength",
      ),
    ).toBe("String too short");
    expect(
      msg(
        perKeyword,
        { schema: "#/anyOf/0", mapping: "/anyOf/0" },
        "maxLength",
      ),
    ).toBe("String too long");
    expect(
      msg(perKeyword, { schema: "#/anyOf/1", mapping: "/anyOf/1" }, "minimum"),
    ).toBe("Number too small");
  });

  it("anyOf per-keyword branch falls back to _jetError for an unlisted keyword", () => {
    expect(
      msg(perKeyword, { schema: "#/anyOf/0", mapping: "/anyOf/0" }, "type"),
    ).toBe("Must be valid string");
    expect(
      msg(perKeyword, { schema: "#/anyOf/1", mapping: "/anyOf/1" }, "type"),
    ).toBe("Must be valid number");
  });

  it("oneOf array form resolves per branch by index", () => {
    expect(
      msg(oneOfArr, { schema: "#/oneOf/0", mapping: "/oneOf/0" }, "type"),
    ).toBe("String branch failed");
    expect(
      msg(oneOfArr, { schema: "#/oneOf/1", mapping: "/oneOf/1" }, "type"),
    ).toBe("Number branch failed");
  });

  it("oneOf object form resolves per branch by numeric key", () => {
    expect(
      msg(oneOfObj, { schema: "#/oneOf/0", mapping: "/oneOf/0" }, "type"),
    ).toBe("String branch failed");
    expect(
      msg(oneOfObj, { schema: "#/oneOf/1", mapping: "/oneOf/1" }, "type"),
    ).toBe("Number branch failed");
  });

  it("allOf resolves per branch by index", () => {
    const allOf = {
      allOf: [
        { type: "object", minProperties: 1 },
        { type: "object", maxProperties: 3 },
      ],
      errorMessage: { allOf: ["Needs a property", "Too many properties"] },
    };
    expect(
      msg(allOf, { schema: "#/allOf/0", mapping: "/allOf/0" }, "minProperties"),
    ).toBe("Needs a property");
    expect(
      msg(allOf, { schema: "#/allOf/1", mapping: "/allOf/1" }, "maxProperties"),
    ).toBe("Too many properties");
  });

  it("does NOT resolve a general string on an index-accessed operator", () => {
    const schema = {
      oneOf: [{ type: "string" }, { type: "number" }],
      errorMessage: { oneOf: "err" },
    };
    expect(
      msg(schema, { schema: "#/oneOf/0", mapping: "/oneOf/0" }, "type"),
    ).toBeUndefined();
  });
});

describe("resolveErrorMessage - properties / patternProperties (key-accessed)", () => {
  it("control: the same context DOES resolve in keyed form", () => {
    const schema = {
      type: "object",
      properties: { c: { type: "string" } },
      errorMessage: { properties: { c: { type: "c must be a string" } } },
    };
    expect(
      msg(
        schema,
        { schema: "#/properties/c", mapping: "/properties/c" },
        "type",
      ),
    ).toBe("c must be a string");
  });

  it("does NOT resolve a general string on properties (navigation keyword)", () => {
    const schema = {
      type: "object",
      properties: { c: { type: "string" } },
      errorMessage: { properties: "error" },
    };
    expect(
      msg(
        schema,
        { schema: "#/properties/c", mapping: "/properties/c" },
        "type",
      ),
    ).toBeUndefined();
  });

  it("resolves patternProperties by its regex key", () => {
    const schema = {
      type: "object",
      patternProperties: { "^[0-9]+$": { type: "number" } },
      errorMessage: {
        patternProperties: {
          "^[0-9]+$": { type: "Numeric keys must map to numbers" },
        },
      },
    };
    expect(
      msg(
        schema,
        {
          schema: "#/patternProperties/^[0-9]+$",
          mapping: "/patternProperties/^[0-9]+$",
        },
        "type",
      ),
    ).toBe("Numeric keys must map to numbers");
  });
});

describe("resolveErrorMessage - prefixItems / items (arrays)", () => {
  const arrayForm = {
    type: "array",
    prefixItems: [{ type: "string" }, { type: "number" }],
    errorMessage: {
      prefixItems: ["First must be a string", "Second must be a number"],
    },
  };

  const objectForm = {
    type: "array",
    prefixItems: [{ type: "string" }, { type: "number" }],
    errorMessage: {
      prefixItems: {
        0: "First must be a string",
        1: "Second must be a number",
      },
    },
  };

  const perKeyword = {
    type: "array",
    prefixItems: [{ type: "string", minLength: 2 }, { type: "number" }],
    errorMessage: {
      prefixItems: {
        0: { type: "First must be a string", minLength: "First too short" },
      },
    },
  };

  it("prefixItems array form resolves per index", () => {
    expect(
      msg(
        arrayForm,
        { schema: "#/prefixItems/0", mapping: "/prefixItems/0" },
        "type",
      ),
    ).toBe("First must be a string");
    expect(
      msg(
        arrayForm,
        { schema: "#/prefixItems/1", mapping: "/prefixItems/1" },
        "type",
      ),
    ).toBe("Second must be a number");
  });

  it("prefixItems object form resolves per numeric key", () => {
    expect(
      msg(
        objectForm,
        { schema: "#/prefixItems/0", mapping: "/prefixItems/0" },
        "type",
      ),
    ).toBe("First must be a string");
  });

  it("prefixItems per-keyword within an index targets the keyword", () => {
    expect(
      msg(
        perKeyword,
        { schema: "#/prefixItems/0", mapping: "/prefixItems/0" },
        "minLength",
      ),
    ).toBe("First too short");
    expect(
      msg(
        perKeyword,
        { schema: "#/prefixItems/0", mapping: "/prefixItems/0" },
        "type",
      ),
    ).toBe("First must be a string");
  });

  it("single-schema items takes a general string (schema-accepting)", () => {
    const schema = {
      type: "array",
      items: { type: "number" },
      errorMessage: { items: "Every item must be a number" },
    };
    expect(msg(schema, { schema: "#/items", mapping: "/items" }, "type")).toBe(
      "Every item must be a number",
    );
  });

  it("unevaluatedItems takes a general string", () => {
    const schema = {
      type: "array",
      prefixItems: [{ type: "string" }],
      unevaluatedItems: { type: "number" },
      errorMessage: { unevaluatedItems: "Unevaluated items must be numbers" },
    };
    expect(
      msg(
        schema,
        { schema: "#/unevaluatedItems", mapping: "/unevaluatedItems" },
        "type",
      ),
    ).toBe("Unevaluated items must be numbers");
  });
});

describe("resolveErrorMessage - schema-accepting keywords (then / else)", () => {
  const generalString = {
    type: "object",
    if: { properties: { country: { const: "US" } } },
    then: { required: ["stateCode"], minProperties: 2 },
    else: { required: ["countryCode"] },
    errorMessage: {
      then: "US addresses need a state code",
      else: "Non-US addresses need a country code",
    },
  };

  it("then general string covers any plain keyword failure inside then", () => {
    expect(
      msg(generalString, { schema: "#/then", mapping: "/then" }, "required"),
    ).toBe("US addresses need a state code");
    expect(
      msg(
        generalString,
        { schema: "#/then", mapping: "/then" },
        "minProperties",
      ),
    ).toBe("US addresses need a state code");
  });

  it("else general string resolves for its branch", () => {
    expect(
      msg(generalString, { schema: "#/else", mapping: "/else" }, "required"),
    ).toBe("Non-US addresses need a country code");
  });

  it("drills into then from root following the full path", () => {
    const schema = {
      if: { properties: { country: { const: "US" } } },
      then: { properties: { postalCode: { pattern: "^[0-9]{5}$" } } },
      errorMessage: {
        then: { properties: { postalCode: "Invalid ZIP code format" } },
      },
    };
    expect(
      msg(
        schema,
        {
          schema: "#/then/properties/postalCode",
          mapping: "/properties/postalCode",
        },
        "pattern",
      ),
    ).toBe("Invalid ZIP code format");
  });

  it("resolves from an errorMessage defined inside then", () => {
    const schema = {
      if: { properties: { country: { const: "US" } } },
      then: {
        properties: { postalCode: { pattern: "^[0-9]{5}$" } },
        errorMessage: { properties: { postalCode: "Invalid ZIP code format" } },
      },
    };
    expect(
      msg(
        schema,
        {
          schema: "#/then/properties/postalCode",
          mapping: "/properties/postalCode",
        },
        "pattern",
      ),
    ).toBe("Invalid ZIP code format");
  });
});

describe("resolveErrorMessage - schema-accepting keywords (not / additionalProperties / propertyNames)", () => {
  it("not resolves a message on the not keyword itself", () => {
    const schema = {
      type: "string",
      not: { pattern: "^admin" },
      errorMessage: { not: "Username cannot start with 'admin'" },
    };
    expect(msg(schema, { schema: "#", mapping: undefined }, "not")).toBe(
      "Username cannot start with 'admin'",
    );
  });

  it("additionalProperties takes a general string", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: { type: "number" },
      errorMessage: {
        additionalProperties: "Additional properties must be numbers",
      },
    };
    expect(
      msg(
        schema,
        { schema: "#/additionalProperties", mapping: "/additionalProperties" },
        "type",
      ),
    ).toBe("Additional properties must be numbers");
  });

  it("additionalProperties can drill in per keyword", () => {
    const schema = {
      type: "object",
      additionalProperties: { type: "number" },
      errorMessage: { additionalProperties: { type: "Must be numeric" } },
    };
    expect(
      msg(
        schema,
        { schema: "#/additionalProperties", mapping: "/additionalProperties" },
        "type",
      ),
    ).toBe("Must be numeric");
  });

  it("propertyNames resolves via a general string", () => {
    const schema = {
      type: "object",
      propertyNames: { pattern: "^[a-z]+$" },
      errorMessage: {
        propertyNames: "Property names must be lowercase letters",
      },
    };
    expect(
      msg(
        schema,
        { schema: "#/propertyNames", mapping: "/propertyNames" },
        "pattern",
      ),
    ).toBe("Property names must be lowercase letters");
  });

  it("propertyNames resolves via a keyword-targeted object", () => {
    const schema = {
      type: "object",
      propertyNames: { pattern: "^[a-z]+$" },
      errorMessage: {
        propertyNames: { pattern: "Property names must be lowercase letters" },
      },
    };
    expect(
      msg(
        schema,
        { schema: "#/propertyNames", mapping: "/propertyNames" },
        "pattern",
      ),
    ).toBe("Property names must be lowercase letters");
  });
});

describe("resolveErrorMessage - required (general string only)", () => {
  it("resolves a whole-keyword general string", () => {
    const schema = {
      type: "object",
      properties: { email: { type: "string" }, name: { type: "string" } },
      required: ["email", "name"],
      errorMessage: { required: "Email and name are both required" },
    };
    expect(msg(schema, { schema: "#", mapping: undefined }, "required")).toBe(
      "Email and name are both required",
    );
  });

  it("does NOT resolve a per-field object form", () => {
    const schema = {
      type: "object",
      properties: { email: { type: "string" }, name: { type: "string" } },
      required: ["email", "name"],
      errorMessage: {
        required: { email: "Email required", name: "Name required" },
      },
    };
    expect(
      msg(schema, { schema: "#", mapping: undefined }, "required"),
    ).toBeUndefined();
  });
});

describe("resolveErrorMessage - dependentRequired (whole-keyword string)", () => {
  it("resolves a single message for any dependentRequired failure", () => {
    const schema = {
      type: "object",
      properties: {
        creditCard: { type: "string" },
        cvv: { type: "string" },
        billingAddress: { type: "string" },
      },
      dependentRequired: { creditCard: ["cvv", "billingAddress"] },
      errorMessage: { dependentRequired: "A required dependency is missing" },
    };
    expect(
      msg(schema, { schema: "#", mapping: undefined }, "dependentRequired"),
    ).toBe("A required dependency is missing");
  });
});

describe("resolveErrorMessage - dependentSchemas / dependencies (key-accessed)", () => {
  const dependentSchemas = {
    type: "object",
    dependentSchemas: {
      paymentMethod: { required: ["cardNumber"], maxProperties: 2 },
    },
    errorMessage: {
      dependentSchemas: {
        paymentMethod: {
          _jetError: "Payment method rules failed",
          required: "Card number required when payment method is present",
        },
      },
    },
  };

  it("targets a keyword inside a dependent sub-schema per key", () => {
    expect(
      msg(
        dependentSchemas,
        {
          schema: "#/dependentSchemas/paymentMethod",
          mapping: "/dependentSchemas/paymentMethod",
        },
        "required",
      ),
    ).toBe("Card number required when payment method is present");
  });

  it("falls back to _jetError for an unlisted keyword in the sub-schema", () => {
    expect(
      msg(
        dependentSchemas,
        {
          schema: "#/dependentSchemas/paymentMethod",
          mapping: "/dependentSchemas/paymentMethod",
        },
        "maxProperties",
      ),
    ).toBe("Payment method rules failed");
  });

  it("resolves the schema form of dependencies like dependentSchemas", () => {
    const schema = {
      type: "object",
      dependencies: {
        email: { type: "object", required: ["verified"] },
      },
      errorMessage: {
        dependencies: { email: { required: "Verification status required" } },
      },
    };
    expect(
      msg(
        schema,
        { schema: "#/dependencies/email", mapping: "/dependencies/email" },
        "required",
      ),
    ).toBe("Verification status required");
  });
});
