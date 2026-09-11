import { describe, it, expect } from "vitest";
import { JetValidator, SchemaDefinition } from "../../src";

function makeValidator(opts: Record<string, unknown> = {}) {
  return new JetValidator({ allErrors: false, strict: false, ...opts });
}

describe("validate keyword - return contract", () => {
  it("returns true on success and an error object on failure", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "divisibleBy",
      type: "number",
      schemaType: "number",
      validate: (s, d) =>
        d % s !== 0 ? { message: `Must be divisible by ${s}` } : true,
    });
    const validate = v.compile({ divisibleBy: 7 } as SchemaDefinition);

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
      validate: (s, d) => (!s ? true : (d as number) % 2 === 0),
    });
    const validate = v.compile({ isEven: true } as SchemaDefinition);

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
      validate: (s, d) =>
        d % s !== 0
          ? { message: "not divisible", divisor: s, remainder: d % s }
          : true,
    });
    const validate = v.compile({ divBy: 3 } as SchemaDefinition);

    validate(7);
    expect(validate.errors![0]).toMatchObject({
      message: "not divisible",
      divisor: 3,
      remainder: 1,
    });
  });
});

describe("validate keyword - error shape", () => {
  it("includes value only in verbose mode", () => {
    const build = (verbose: boolean) => {
      const v = makeValidator({ verbose });
      v.addKeyword({
        keyword: "bad",
        type: "number",
        schemaType: "boolean",
        validate: () => ({ message: "x" }),
      });
      return v.compile({ bad: true } as SchemaDefinition);
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
    const validate = v.compile({ fail: true } as SchemaDefinition);

    validate(1);
    const e = validate.errors![0];
    expect(e.keyword).toBe("fail");
    expect(e.schemaPath).toBe("#");
    expect(["/", ""]).toContain(e.dataPath);
  });
});

describe("validate keyword - dataContext", () => {
  it("exposes parentData and parentDataProperty for array items", () => {
    const v = makeValidator({ allErrors: true });
    const seen: Array<{ parentData: unknown; prop: unknown }> = [];
    v.addKeyword({
      keyword: "uniqueInParent",
      schemaType: "boolean",
      validate: (s, d, _parent, ctx) => {
        seen.push({ parentData: ctx.parentData, prop: ctx.parentDataProperty });
        if (!s || !Array.isArray(ctx.parentData)) return true;
        return ctx.parentData.filter((x) => x === d).length <= 1;
      },
    });
    const validate = v.compile({
      type: "array",
      items: { type: "string", uniqueInParent: true },
    } as SchemaDefinition);

    expect(validate(["a", "b", "c"])).toBe(true);
    expect(seen[0].parentData).toEqual(["a", "b", "c"]);
    expect(seen[0].prop).toBe(0);
    expect(validate(["a", "a"])).toBe(false);
  });

  it("provides rootData for cross-field checks", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "matches",
      type: "string",
      schemaType: "string",
      validate: (field, d, _parent, ctx) =>
        d === ctx.rootData[field] ? true : { message: `must match ${field}` },
    });
    const validate = v.compile({
      type: "object",
      properties: {
        pw: { type: "string" },
        confirm: { type: "string", matches: "pw" },
      },
    } as SchemaDefinition);

    expect(validate({ pw: "abc", confirm: "abc" })).toBe(true);
    expect(validate({ pw: "abc", confirm: "xyz" })).toBe(false);
  });

  it("receives the parent schema snapshot as the third argument", () => {
    const v = makeValidator();
    let seenParent: any;
    v.addKeyword({
      keyword: "inspect",
      type: "string",
      schemaType: "boolean",
      validate: (_s, _d, parent) => {
        seenParent = parent;
        return true;
      },
    });
    const validate = v.compile({
      type: "string",
      minLength: 2,
      inspect: true,
    } as SchemaDefinition);

    validate("hello");
    expect(seenParent).toMatchObject({ type: "string", minLength: 2 });
  });
});

describe("validate keyword - applicability", () => {
  it("skips the keyword when data is not the declared type", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "divBy",
      type: "number",
      schemaType: "number",
      validate: (s, d) => d % s === 0,
    });
    const validate = v.compile({ divBy: 2 } as SchemaDefinition);

    expect(validate("hello")).toBe(true);
    expect(validate(3)).toBe(false);
    expect(validate(4)).toBe(true);
  });

  it("silently skips when the schema value has the wrong schemaType", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "divBy",
      type: "number",
      schemaType: "number",
      validate: (s, d) => d % s === 0,
    });
    const validate = v.compile({ divBy: "2" } as any);

    expect(validate(3)).toBe(true);
  });
});

describe("validate keyword - metaSchema", () => {
  it("rejects an invalid keyword value at compile time", () => {
    const v = makeValidator();
    v.addKeyword({
      keyword: "minAge",
      type: "number",
      schemaType: "number",
      metaSchema: { type: "number", minimum: 0, maximum: 150 },
      validate: (s, d) => d >= s,
    });

    expect(() => v.compile({ minAge: 200 } as SchemaDefinition)).toThrow();
    expect(() => v.compile({ minAge: 18 } as SchemaDefinition)).not.toThrow();
  });
});

describe("validate keyword - allErrors", () => {
  it("collects multiple keyword errors", () => {
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
    const validate = v.compile({
      type: "number",
      kA: true,
      kB: true,
    } as SchemaDefinition);

    expect(validate(5)).toBe(false);
    const msgs = validate.errors!.map((e) => e.message);
    expect(msgs).toContain("A");
    expect(msgs).toContain("B");
  });
});

describe("validate keyword - async", () => {
  it("awaits async keywords and returns the same error shape", async () => {
    const v = makeValidator({ async: true });
    v.addKeyword({
      keyword: "existsInDb",
      type: "string",
      async: true,
      schemaType: "boolean",
      validate: async (s, d) => {
        await Promise.resolve();
        return d === "known" ? true : { message: "not found" };
      },
    });
    const validate = v.compile({ existsInDb: true } as SchemaDefinition, {
      async: true,
    });

    await expect(validate("known")).resolves.toBe(true);
    await expect(validate("nope")).resolves.toBe(false);
    expect(validate.errors![0].message).toBe("not found");
  });
});
