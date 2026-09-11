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
    { functionName: "validateTests" },
    opts as any,
  );
  const fn = new Function(`${code}\n;return ${functionName};`)();
  return fn as ((data: any) => any) & { errors?: any[] };
}

describe("validate keyword - standalone emission", () => {
  it("serializes the validate fn and never references a runtime keyword map", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "divisibleBy",
      type: "number",
      schemaType: "number",
      validate: (s: number, d: number) =>
        d % s !== 0 ? { message: `Must be divisible by ${s}` } : true,
    });

    const { code } = v.generateStandalone({
      divisibleBy: 7,
    } as SchemaDefinition);

    expect(code).not.toContain("customKeywords.get");
    expect(code).toContain("Must be divisible by");
  });
});

describe("validate keyword - standalone execution", () => {
  it("returns true on success and an error object on failure", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "divisibleBy",
      type: "number",
      schemaType: "number",
      validate: (s: number, d: number) =>
        d % s !== 0 ? { message: `Must be divisible by ${s}` } : true,
    });
    const validate = standalone(v, { divisibleBy: 7 } as SchemaDefinition);

    expect(validate(14)).toBe(true);
    expect(validate(10)).toBe(false);
    expect(validate.errors![0]).toMatchObject({
      keyword: "divisibleBy",
      message: "Must be divisible by 7",
    });
  });

  it("treats a false return as failure with the default message", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "isEven",
      type: "number",
      schemaType: "boolean",
      validate: (s: boolean, d: number) => (!s ? true : d % 2 === 0),
    });
    const validate = standalone(v, { isEven: true } as SchemaDefinition);

    expect(validate(4)).toBe(true);
    expect(validate(7)).toBe(false);
    expect(validate.errors![0].keyword).toBe("isEven");
    expect(validate.errors![0].message).toContain("isEven");
  });

  it("preserves custom properties returned in the error object", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "divBy",
      type: "number",
      schemaType: "number",
      validate: (s: number, d: number) =>
        d % s !== 0
          ? { message: "not divisible", divisor: s, remainder: d % s }
          : true,
    });
    const validate = standalone(v, { divBy: 3 } as SchemaDefinition);

    validate(7);
    expect(validate.errors![0]).toMatchObject({
      message: "not divisible",
      divisor: 3,
      remainder: 1,
    });
  });

  it("includes value only in verbose mode", () => {
    const build = (verbose: boolean) => {
      const v = makeValidator({ verbose });
      v.addKeyword({
        keyword: "bad",
        type: "number",
        schemaType: "boolean",
        validate: () => ({ message: "x" }),
      });
      return standalone(v, { bad: true } as SchemaDefinition, { verbose });
    };

    const verbose = build(true);
    verbose(5);
    expect(verbose.errors![0]).toHaveProperty("value", 5);

    const plain = build(false);
    plain(5);
    expect(plain.errors![0].value).toBeUndefined();
  });

  it("populates keyword, schemaPath and dataPath at the root", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "fail",
      type: "number",
      schemaType: "boolean",
      validate: () => ({ message: "no" }),
    });
    const validate = standalone(v, { fail: true } as SchemaDefinition);

    validate(1);
    const e = validate.errors![0];
    expect(e.keyword).toBe("fail");
    expect(e.schemaPath).toBe("#");
    expect(["/", ""]).toContain(e.dataPath);
  });

  it("provides rootData for cross-field checks", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "matches",
      type: "string",
      schemaType: "string",
      validate: (field: string, d: string, _parent: any, ctx: any) =>
        d === ctx.rootData[field] ? true : { message: `must match ${field}` },
    });
    const validate = standalone(v, {
      type: "object",
      properties: {
        pw: { type: "string" },
        confirm: { type: "string", matches: "pw" },
      },
    } as SchemaDefinition);

    expect(validate({ pw: "abc", confirm: "abc" })).toBe(true);
    expect(validate({ pw: "abc", confirm: "xyz" })).toBe(false);
  });

  it("exposes parentDataProperty through the returned error (no closure)", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "reportProp",
      schemaType: "boolean",
      validate: (_s: boolean, _d: unknown, _parent: any, ctx: any) => ({
        message: String(ctx.parentDataProperty),
      }),
    });
    const validate = standalone(v, {
      type: "array",
      items: { type: "string", reportProp: true },
    } as SchemaDefinition);

    validate(["a", "b"]);
    expect(validate.errors![0].message).toBe("0");
  });

  it("skips the keyword when data is not the declared type", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "divBy",
      type: "number",
      schemaType: "number",
      validate: (s: number, d: number) => d % s === 0,
    });
    const validate = standalone(v, { divBy: 2 } as SchemaDefinition);

    expect(validate("hello")).toBe(true);
    expect(validate(3)).toBe(false);
    expect(validate(4)).toBe(true);
  });

  it("rejects an invalid keyword value at generation time via metaSchema", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "minAge",
      type: "number",
      schemaType: "number",
      metaSchema: { type: "number", minimum: 0, maximum: 150 },
      validate: (s: number, d: number) => d >= s,
    });

    expect(() =>
      v.generateStandalone({ minAge: 200 } as SchemaDefinition),
    ).toThrow();
    expect(() =>
      v.generateStandalone({ minAge: 18 } as SchemaDefinition),
    ).not.toThrow();
  });

  it("awaits async keywords and returns the same error shape", async () => {
    const v = makeValidator({ async: true });
    v.addKeyword({
      keyword: "existsInDb",
      type: "string",
      async: true,
      schemaType: "boolean",
      validate: async (s: boolean, d: string) => {
        await Promise.resolve();
        return d === "known" ? true : { message: "not found" };
      },
    });
    const validate = standalone(v, { existsInDb: true } as SchemaDefinition, {
      async: true,
    });

    await expect(validate("known")).resolves.toBe(true);
    await expect(validate("nope")).resolves.toBe(false);
    expect(validate.errors![0].message).toBe("not found");
  });

  it("collects multiple keyword errors in allErrors mode", () => {
    const v = makeValidator({ allErrors: true });
    v.addKeyword({
      keyword: "kA",
      type: "number",
      schemaType: "boolean",
      validate: () => ({ message: "A" }),
    });
    v.addKeyword({
      keyword: "kB",
      type: "number",
      schemaType: "boolean",
      validate: () => ({ message: "B" }),
    });
    const validate = standalone(
      v,
      { type: "number", kA: true, kB: true } as SchemaDefinition,
      { allErrors: true },
    );

    expect(validate(5)).toBe(false);
    const msgs = validate.errors!.map((e) => e.message);
    expect(msgs).toContain("A");
    expect(msgs).toContain("B");
  });
});

describe("validate keyword - runtime/standalone parity", () => {
  it("produces identical results across both paths", () => {
    const define = (v: JetValidator) =>
      v.addKeyword({
        keyword: "divisibleBy",
        type: "number",
        schemaType: "number",
        validate: (s: number, d: number) =>
          d % s !== 0 ? { message: `Must be divisible by ${s}` } : true,
      });

    const schema = { divisibleBy: 7 } as SchemaDefinition;

    const rt = makeValidator();
    define(rt);
    const runtime = rt.compile(schema);

    const sa = makeValidator();
    define(sa);
    const emitted = standalone(sa, schema);

    for (const data of [14, 10, 21, 5]) {
      expect(emitted(data)).toBe(runtime(data));
    }
  });
});
