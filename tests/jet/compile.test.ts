import { describe, it, expect } from "vitest";
import { JetValidator, SchemaDefinition } from "../../src";

function makeValidator(opts: Record<string, unknown> = {}) {
  return new JetValidator({ allErrors: false, strict: false, ...opts });
}

describe("compile keyword - return contract", () => {
  it("captures the schema value in a closure and returns true/error", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "even",
      type: "number",
      schemaType: "boolean",
      compile: (s) =>
        s
          ? (d: number) => (d % 2 === 0 ? true : { message: "must be even" })
          : () => true,
    });
    const validate = v.compile({ even: true } as SchemaDefinition);

    expect(validate(4)).toBe(true);
    expect(validate(5)).toBe(false);
    expect(validate.errors![0].message).toBe("must be even");
  });

  it("treats a false return from the compiled fn as failure", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "positive",
      type: "number",
      schemaType: "boolean",
      compile: (s) => (d: number) => !s || d > 0,
    });
    const validate = v.compile({ positive: true } as SchemaDefinition);

    expect(validate(5)).toBe(true);
    expect(validate(-1)).toBe(false);
    expect(validate.errors![0].keyword).toBe("positive");
    expect(validate.errors![0].message).toContain("positive");
  });

  it("spreads custom error properties from the compiled fn", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "mult",
      type: "number",
      schemaType: "number",
      compile: (s) => (d: number) =>
        d % s === 0 ? true : { message: "no", divisor: s, remainder: d % s },
    });
    const validate = v.compile({ mult: 3 } as SchemaDefinition);

    validate(7);
    expect(validate.errors![0]).toMatchObject({ divisor: 3, remainder: 1 });
  });
});

describe("compile keyword - compiled fn arguments", () => {
  it("gives the compiled fn access to rootData", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "matchesField",
      type: "string",
      schemaType: "string",
      compile: (field) => (d: string, rootData: any) =>
        d === rootData[field] ? true : { message: `must match ${field}` },
    });
    const validate = v.compile({
      type: "object",
      properties: {
        password: { type: "string" },
        confirm: { type: "string", matchesField: "password" },
      },
      required: ["password", "confirm"],
    } as SchemaDefinition);

    expect(validate({ password: "secret1", confirm: "secret1" })).toBe(true);
    expect(validate({ password: "secret1", confirm: "nope" })).toBe(false);
  });

  it("passes the data path as the third argument", () => {
    const v = makeValidator();
    const paths: string[] = [];
    v.addKeyword({
      keyword: "capture",
      type: "string",
      schemaType: "boolean",
      compile: () => (_d: string, _r: any, dataPath: string) => {
        paths.push(dataPath);
        return true;
      },
    });
    const validate = v.compile({
      type: "object",
      properties: { name: { type: "string", capture: true } },
    } as SchemaDefinition);

    validate({ name: "x" });
    expect(paths[0]).toEqual("/name");
  });
});

describe("compile keyword - closure isolation", () => {
  it("keeps closures isolated per schema position", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "mult",
      type: "number",
      schemaType: "number",
      compile: (s) => (d: number) =>
        d % s === 0 ? true : { message: `not x${s}` },
    });
    const validate = v.compile({
      type: "object",
      properties: {
        a: { type: "number", mult: 2 },
        b: { type: "number", mult: 5 },
      },
    } as SchemaDefinition);

    expect(validate({ a: 4, b: 10 })).toBe(true);
    expect(validate({ a: 4, b: 7 })).toBe(false);
    expect(validate.errors![0].message).toBe("not x5");
  });
});

describe("compile keyword - conditional via rootData", () => {
  it("validates one field based on another", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "requiredIf",
      schemaType: "object",
      compile: (cond) => (d: unknown, rootData: any) => {
        const { field, value } = cond as { field: string; value: unknown };
        if (rootData[field] === value && (d === undefined || d === "")) {
          return { message: "required" };
        }
        return true;
      },
    });
    const validate = v.compile({
      type: "object",
      properties: {
        country: { type: "string" },
        state: { requiredIf: { field: "country", value: "US" } },
      },
    } as SchemaDefinition);

    expect(validate({ country: "US", state: "CA" })).toBe(true);
    expect(validate({ country: "US", state: "" })).toBe(false);
    expect(validate({ country: "FR", state: "" })).toBe(true);
  });
});

describe("compile keyword - applicability", () => {
  it("only runs the compiled fn for the declared data type", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "even",
      type: "number",
      schemaType: "boolean",
      compile: (s) => (d: number) => !s || d % 2 === 0,
    });
    const validate = v.compile({ even: true } as SchemaDefinition);

    expect(validate("string")).toBe(true);
    expect(validate(3)).toBe(false);
  });

  it("skips compilation when schemaType does not match", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "range",
      type: "number",
      schemaType: "array",
      compile: (s) => (d: number) => d >= s[0] && d <= s[1],
    });
    const validate = v.compile({ type: "number", range: 5 } as any);

    expect(validate(3)).toBe(true);
  });
});

describe("compile keyword - metaSchema", () => {
  it("validates the keyword value against metaSchema at compile time", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "range",
      type: "number",
      schemaType: "array",
      metaSchema: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
      },
      compile: (s) => (d: number) => d >= s[0] && d <= s[1],
    });

    expect(() =>
      v.compile({ type: "number", range: [1] } as SchemaDefinition),
    ).toThrow();
    expect(() =>
      v.compile({ type: "number", range: [1, 10] } as SchemaDefinition),
    ).not.toThrow();
  });
});

describe("compile keyword - error shape", () => {
  it("includes value in verbose mode", () => {
    const v = makeValidator({ verbose: true });
    v.addKeyword({
      keyword: "bad",
      type: "number",
      schemaType: "boolean",
      compile: () => () => ({ message: "x" }),
    });
    const validate = v.compile({ bad: true } as SchemaDefinition);

    validate(9);
    expect(validate.errors![0]).toHaveProperty("value", 9);
  });
});

describe("compile keyword - async", () => {
  it("awaits async compiled fns", async () => {
    const v = makeValidator({ async: true });
    v.addKeyword({
      keyword: "uniqueEmail",
      type: "string",
      async: true,
      schemaType: "boolean",
      compile: () => async (d: string) => {
        await Promise.resolve();
        return d.includes("@") ? true : { message: "invalid email" };
      },
    });
    const validate = v.compile({ uniqueEmail: true } as SchemaDefinition, {
      async: true,
    });

    await expect(validate("a@b.com")).resolves.toBe(true);
    await expect(validate("nope")).resolves.toBe(false);
    expect(validate.errors![0].message).toBe("invalid email");
  });
});
