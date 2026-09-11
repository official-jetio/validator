import { describe, it, expect } from "vitest";
import { JetValidator, SchemaDefinition } from "../../src";

function makeValidator(opts: Record<string, unknown> = {}) {
  return new JetValidator({ allErrors: false, strict: false, ...opts });
}

function standalone(
  v: JetValidator,
  schema: SchemaDefinition,
  opts?: Record<string, unknown>,
) {
  const { code, functionName } = v.generateStandalone(
    schema,
    { functionName: "compileTests" },
    opts as any,
  );
  const fn = new Function(`${code}\n;return ${functionName};`)();
  return fn as ((data: any) => any) & { errors?: any[] };
}

describe("compile keyword - standalone emission", () => {
  it("emits the factory once even when the keyword is used at multiple sites", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "mult",
      type: "number",
      schemaType: "number",
      compile: (s: number) => {
        const MULT_FACTORY_SENTINEL = s;
        return (d: number) =>
          d % MULT_FACTORY_SENTINEL === 0 ? true : { message: `x${s}` };
      },
    });

    const { code } = v.generateStandalone({
      type: "object",
      properties: {
        a: { type: "number", mult: 2 },
        b: { type: "number", mult: 5 },
      },
    } as SchemaDefinition);
    expect((code.match(/MULT_FACTORY_SENTINEL =/g) || []).length).toBe(2);
  });

  it("never references a runtime keyword map in standalone output", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "mult",
      type: "number",
      schemaType: "number",
      compile: (s: number) => (d: number) => d % s === 0,
    });

    const { code } = v.generateStandalone({
      type: "number",
      mult: 3,
    } as SchemaDefinition);

    expect(code).not.toContain("customKeywords.get");
  });
});

describe("compile keyword - standalone execution", () => {
  it("captures the schema value in the produced closure", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "even",
      type: "number",
      schemaType: "boolean",
      compile: (s: boolean) =>
        s
          ? (d: number) => (d % 2 === 0 ? true : { message: "must be even" })
          : () => true,
    });
    const validate = standalone(v, { even: true } as SchemaDefinition);

    expect(validate(4)).toBe(true);
    expect(validate(5)).toBe(false);
    expect(validate.errors![0].message).toBe("must be even");
    const validate2 = standalone(v, { even: [] } as SchemaDefinition);
    expect(validate2(4)).toBe(true);
    expect(validate2(5)).toBe(true);
  });

  it("treats a false return from the produced fn as failure", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "positive",
      type: "number",
      schemaType: "boolean",
      compile: (s: boolean) => (d: number) => !s || d > 0,
    });
    const validate = standalone(v, { positive: true } as SchemaDefinition);

    expect(validate(5)).toBe(true);
    expect(validate(-1)).toBe(false);
    expect(validate.errors![0].keyword).toBe("positive");
    expect(validate.errors![0].message).toContain("positive");
  });

  it("spreads custom error properties from the produced fn", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "mult",
      type: "number",
      schemaType: "number",
      compile: (s: number) => (d: number) =>
        d % s === 0 ? true : { message: "no", divisor: s, remainder: d % s },
    });
    const validate = standalone(v, { mult: 3 } as SchemaDefinition);

    validate(7);
    expect(validate.errors![0]).toMatchObject({ divisor: 3, remainder: 1 });
  });

  it("gives the produced fn access to rootData", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "matchesField",
      type: "string",
      schemaType: "string",
      compile: (field: string) => (d: string, rootData: any) =>
        d === rootData[field] ? true : { message: `must match ${field}` },
    });
    const validate = standalone(v, {
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

  it("keeps produced closures isolated per schema position", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "mult",
      type: "number",
      schemaType: "number",
      compile: (s: number) => (d: number) =>
        d % s === 0 ? true : { message: `not x${s}` },
    });
    const validate = standalone(v, {
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

  it("validates one field based on another via rootData", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "requiredIf",
      schemaType: "object",
      compile: (cond: any) => (d: unknown, rootData: any) => {
        const { field, value } = cond as { field: string; value: unknown };
        if (rootData[field] === value && (d === undefined || d === "")) {
          return { message: "required" };
        }
        return true;
      },
    });
    const validate = standalone(v, {
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

  it("only runs the produced fn for the declared data type", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "even",
      type: "number",
      schemaType: "boolean",
      compile: (s: boolean) => (d: number) => !s || d % 2 === 0,
    });
    const validate = standalone(v, { even: true } as SchemaDefinition);

    expect(validate("string")).toBe(true);
    expect(validate(3)).toBe(false);
  });

  it("includes value in verbose mode", () => {
    const v = makeValidator({ verbose: true });
    v.addKeyword({
      keyword: "bad",
      type: "number",
      schemaType: "boolean",
      compile: () => () => ({ message: "x" }),
    });
    const validate = standalone(v, { bad: true } as SchemaDefinition, {
      verbose: true,
    });

    validate(9);
    expect(validate.errors![0]).toHaveProperty("value", 9);
  });

  it("awaits async produced fns", async () => {
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
    const validate = standalone(v, { uniqueEmail: true } as SchemaDefinition, {
      async: true,
    });

    await expect(validate("a@b.com")).resolves.toBe(true);
    await expect(validate("nope")).resolves.toBe(false);
    expect(validate.errors![0].message).toBe("invalid email");
  });
});

describe("compile keyword - runtime/standalone parity", () => {
  it("produces identical results across both paths", () => {
    const define = (v: JetValidator) =>
      v.addKeyword({
        keyword: "mult",
        type: "number",
        schemaType: "number",
        compile: (s: number) => (d: number) =>
          d % s === 0 ? true : { message: `not x${s}` },
      });

    const schema = {
      type: "object",
      properties: {
        a: { type: "number", mult: 2 },
        b: { type: "number", mult: 5 },
      },
    } as SchemaDefinition;

    const rt = makeValidator();
    define(rt);
    const runtime = rt.compile(schema);

    const sa = makeValidator();
    define(sa);
    const emitted = standalone(sa, schema);

    for (const data of [
      { a: 4, b: 10 },
      { a: 4, b: 7 },
      { a: 3, b: 10 },
    ]) {
      expect(emitted(data)).toBe(runtime(data));
    }
  });
});
