import { describe, it, expect } from "vitest";
import { JetValidator, SchemaDefinition } from "../../src";

type CompiledValidate = ((data: unknown) => boolean | Promise<unknown>) & {
  errors?: ValidationError[] | null;
};

interface ValidationError {
  keyword?: string;
  message?: string;
  dataPath?: string;
  schemaPath?: string;
  expected?: unknown;
  value?: unknown;
  [key: string]: unknown;
}

function createValidator(options: Record<string, unknown> = {}): JetValidator {
  const jet = new JetValidator({
    allErrors: true,
    strict: false,
    errorMessage: true,
    verbose: true,
    $data: true,
    ...options,
  });

  jet.addKeyword({
    keyword: "nonEmptyString",
    schemaType: "boolean",
    macro: (enabled) => (enabled ? { type: "string", minLength: 1 } : true),
  });

  jet.addKeyword({
    keyword: "currencyCode",
    type: "string",
    schemaType: "array",
    compile: (allowed) => {
      const supported = new Set(allowed as string[]);
      return (data) =>
        supported.has(data)
          ? true
          : {
              keyword: "currencyCode",
              message: `Unsupported currency: ${data}`,
            };
    },
  });

  jet.addKeyword({
    keyword: "notInFuture",
    type: "string",
    schemaType: "boolean",
    validate: (enabled, data) => {
      if (!enabled) return true;
      const t = Date.parse(data);
      if (Number.isNaN(t))
        return {
          keyword: "notInFuture",
          message: `Not a valid timestamp: ${data}`,
        };
      if (t > Date.now())
        return {
          keyword: "notInFuture",
          message: `Timestamp is in the future: ${data}`,
        };
      return true;
    },
  });

  jet.addKeyword({
    keyword: "uniqueItemsBy",
    type: "array",
    schemaType: ["string", "array"],
    validate: (key, data) => {
      if (!Array.isArray(data)) return true;
      const keys = Array.isArray(key) ? key : [key];
      const seen = new Set<string>();
      for (const item of data) {
        const composite = keys
          .map((k) => JSON.stringify(item?.[k]))
          .join("\u0000");
        if (seen.has(composite))
          return {
            keyword: "uniqueItemsBy",
            message: `Duplicate item by [${keys.join(", ")}]`,
          };
        seen.add(composite);
      }
      return true;
    },
  });

  jet.addKeyword({
    keyword: "equalsSum",
    type: "number",
    schemaType: "array",
    validate: (fields, data, _parentSchema, ctx) => {
      const parent = ctx.parentData ?? {};
      const sum = fields.reduce(
        (acc: number, f: string) => acc + Math.round(Number(parent[f]) * 100),
        0,
      );
      if (sum !== Math.round(Number(data) * 100))
        return {
          keyword: "equalsSum",
          expected: fields.join(" + "),
          message: `Expected ${data} to equal ${fields.join(" + ")}`,
        };
      return true;
    },
  });

  jet.addKeyword({
    keyword: "equalsProduct",
    type: "number",
    schemaType: "array",
    validate: (fields, data, _parentSchema, ctx) => {
      const parent = ctx.parentData ?? {};
      const product = fields.reduce(
        (acc: number, f: string) => acc * Number(parent[f]),
        1,
      );
      if (Math.round(product * 100) !== Math.round(Number(data) * 100))
        return {
          keyword: "equalsProduct",
          expected: fields.join(" * "),
          message: `Expected ${data} to equal ${fields.join(" * ")}`,
        };
      return true;
    },
  });

  jet.addKeyword({
    keyword: "maxDecimalPlaces",
    type: "number",
    schemaType: "number",
    code: (places, _parentSchema, ctx) => {
      const v = ctx.dataVar;
      return `
        {
          const _mdp_s = String(${v});
          const _mdp_dot = _mdp_s.indexOf(".");
          if (_mdp_dot !== -1 && _mdp_s.length - _mdp_dot - 1 > ${places}) {
            ${ctx.buildError({
              keyword: "maxDecimalPlaces",
              expected: places,
              message: `Must have at most ${places} decimal places`,
            })}
          }
        }
      `;
    },
  });

  jet.addKeyword({
    keyword: "luhn",
    type: "string",
    schemaType: "boolean",
    code: (enabled, _parentSchema, ctx) => {
      if (!enabled) return "";
      const v = ctx.dataVar;
      return `
        {
          const _luhn_s = String(${v}).replace(/\\D/g, "");
          let _luhn_sum = 0, _luhn_alt = false;
          for (let _luhn_i = _luhn_s.length - 1; _luhn_i >= 0; _luhn_i--) {
            let _luhn_d = _luhn_s.charCodeAt(_luhn_i) - 48;
            if (_luhn_alt) { _luhn_d *= 2; if (_luhn_d > 9) _luhn_d -= 9; }
            _luhn_sum += _luhn_d;
            _luhn_alt = !_luhn_alt;
          }
          if (_luhn_s.length === 0 || _luhn_sum % 10 !== 0) {
            ${ctx.buildError({ keyword: "luhn", message: "Failed Luhn checksum" })}
          }
        }
      `;
    },
  });

  jet.addKeyword({
    keyword: "asyncAllowed",
    type: "string",
    schemaType: "array",
    async: true,
    validate: async (allowed, data) => {
      await Promise.resolve();
      return allowed.includes(data)
        ? true
        : { keyword: "asyncAllowed", message: `Not allowed: ${data}` };
    },
  });

  jet.addKeyword({
    keyword: "markEvaluated",
    type: "object",
    schemaType: "string",
    code: (prop, _parentSchema, ctx) => ctx.addEvaluatedProperty(prop),
  });

  return jet;
}

async function evaluate(
  validate: CompiledValidate,
  data: unknown,
): Promise<{ valid: boolean; errors: ValidationError[] }> {
  let result: boolean | Promise<unknown>;
  try {
    result = validate(data);
  } catch (e: any) {
    return {
      valid: false,
      errors: e?.errors ?? [{ message: String(e?.message ?? e) }],
    };
  }

  if (result && typeof (result as Promise<unknown>).then === "function") {
    try {
      const resolved = await result;
      if (resolved === false)
        return { valid: false, errors: validate.errors ?? [] };
      return { valid: true, errors: [] };
    } catch (e: any) {
      return {
        valid: false,
        errors: e?.errors ??
          validate.errors ?? [{ message: String(e?.message ?? e) }],
      };
    }
  }

  if (result === false) return { valid: false, errors: validate.errors ?? [] };
  return { valid: true, errors: [] };
}

function keywordsOf(errors: ValidationError[]): string[] {
  return errors.map((e) => e.keyword ?? "").sort();
}

const v = createValidator();
const vAsyncAll = createValidator({ async: true });

interface KeywordCase {
  name: string;
  schema: SchemaDefinition;
  data: unknown;
  valid: boolean;
  keywords?: string[];
}

const keywordCases: KeywordCase[] = [
  {
    name: "macro nonEmptyString - non-empty passes",
    schema: { nonEmptyString: true },
    data: "hello",
    valid: true,
  },
  {
    name: "macro nonEmptyString - empty fails as minLength",
    schema: { nonEmptyString: true },
    data: "",
    valid: false,
    keywords: ["minLength"],
  },

  {
    name: "compile currencyCode - supported passes",
    schema: { type: "string", currencyCode: ["USD", "EUR"] },
    data: "USD",
    valid: true,
  },
  {
    name: "compile currencyCode - unsupported fails",
    schema: { type: "string", currencyCode: ["USD", "EUR"] },
    data: "XYZ",
    valid: false,
    keywords: ["currencyCode"],
  },

  {
    name: "validate notInFuture - past passes",
    schema: { type: "string", notInFuture: true },
    data: "2020-01-01T00:00:00Z",
    valid: true,
  },
  {
    name: "validate notInFuture - future fails",
    schema: { type: "string", notInFuture: true },
    data: "2999-01-01T00:00:00Z",
    valid: false,
    keywords: ["notInFuture"],
  },

  {
    name: "validate uniqueItemsBy - distinct passes",
    schema: { type: "array", uniqueItemsBy: "sku" },
    data: [{ sku: "a" }, { sku: "b" }],
    valid: true,
  },
  {
    name: "validate uniqueItemsBy - duplicate fails",
    schema: { type: "array", uniqueItemsBy: "sku" },
    data: [{ sku: "a" }, { sku: "a" }],
    valid: false,
    keywords: ["uniqueItemsBy"],
  },

  {
    name: "validate equalsSum - matching passes",
    schema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
        t: { type: "number", equalsSum: ["a", "b"] },
      },
    },
    data: { a: 1, b: 2, t: 3 },
    valid: true,
  },
  {
    name: "validate equalsSum - mismatch fails",
    schema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
        t: { type: "number", equalsSum: ["a", "b"] },
      },
    },
    data: { a: 1, b: 2, t: 9 },
    valid: false,
    keywords: ["equalsSum"],
  },

  {
    name: "validate equalsProduct - matching passes",
    schema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
        p: { type: "number", equalsProduct: ["a", "b"] },
      },
    },
    data: { a: 2, b: 3, p: 6 },
    valid: true,
  },
  {
    name: "validate equalsProduct - mismatch fails",
    schema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
        p: { type: "number", equalsProduct: ["a", "b"] },
      },
    },
    data: { a: 2, b: 3, p: 99 },
    valid: false,
    keywords: ["equalsProduct"],
  },

  {
    name: "code maxDecimalPlaces - within limit passes",
    schema: { type: "number", maxDecimalPlaces: 2 },
    data: 1.5,
    valid: true,
  },
  {
    name: "code maxDecimalPlaces - over limit fails",
    schema: { type: "number", maxDecimalPlaces: 2 },
    data: 1.234,
    valid: false,
    keywords: ["maxDecimalPlaces"],
  },

  {
    name: "code luhn - valid checksum passes",
    schema: { type: "string", luhn: true },
    data: "4111111111111111",
    valid: true,
  },
  {
    name: "code luhn - invalid checksum fails",
    schema: { type: "string", luhn: true },
    data: "1111111111111111",
    valid: false,
    keywords: ["luhn"],
  },
];

describe("custom keyword flavors (macro / compile / validate / code)", () => {
  it.each(keywordCases)("$name", async (c) => {
    const validate = v.compile(c.schema) as CompiledValidate;
    const { valid, errors } = await evaluate(validate, c.data);
    expect(valid).toBe(c.valid);
    if (c.keywords) expect(keywordsOf(errors)).toEqual([...c.keywords].sort());
  });
});

describe("custom keyword type guarding", () => {
  const skipCases: KeywordCase[] = [
    {
      name: "maxDecimalPlaces ignores strings",
      schema: { maxDecimalPlaces: 2 },
      data: "not-a-number",
      valid: true,
    },
    {
      name: "luhn ignores numbers",
      schema: { luhn: true },
      data: 123,
      valid: true,
    },
    {
      name: "notInFuture ignores numbers",
      schema: { notInFuture: true },
      data: 123,
      valid: true,
    },
    {
      name: "currencyCode ignores numbers",
      schema: { currencyCode: ["USD"] },
      data: 123,
      valid: true,
    },
  ];
  it.each(skipCases)("$name", async (c) => {
    const validate = v.compile(c.schema) as CompiledValidate;
    const { valid } = await evaluate(validate, c.data);
    expect(valid).toBe(c.valid);
  });
});

describe("async custom keyword", () => {
  const schema: SchemaDefinition = { type: "string", asyncAllowed: ["a", "b"] };

  it("via constructor async:true - allowed passes", async () => {
    const { valid } = await evaluate(
      vAsyncAll.compile(schema) as CompiledValidate,
      "a",
    );
    expect(valid).toBe(true);
  });
  it("via constructor async:true - disallowed fails", async () => {
    const { valid, errors } = await evaluate(
      vAsyncAll.compile(schema) as CompiledValidate,
      "z",
    );
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === "asyncAllowed")).toBe(true);
  });

  it("via compile({ async: true }) - allowed passes", async () => {
    const { valid } = await evaluate(
      v.compile(schema, { async: true }) as CompiledValidate,
      "b",
    );
    expect(valid).toBe(true);
  });
  it("via compile({ async: true }) - disallowed fails", async () => {
    const { valid, errors } = await evaluate(
      v.compile(schema, { async: true }) as CompiledValidate,
      "z",
    );
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === "asyncAllowed")).toBe(true);
  });

  it("wraps a purely-sync custom keyword when compiled async", async () => {
    const { valid } = await evaluate(
      vAsyncAll.compile({
        type: "number",
        maxDecimalPlaces: 2,
      }) as CompiledValidate,
      1.5,
    );
    expect(valid).toBe(true);
  });
});

describe("code keyword evaluated-property tracking", () => {
  it("addEvaluatedProperty satisfies unevaluatedProperties:false", async () => {
    const schema: SchemaDefinition = {
      type: "object",
      markEvaluated: "extra",
      unevaluatedProperties: false,
    };
    const { valid } = await evaluate(v.compile(schema) as CompiledValidate, {
      extra: 1,
    });
    expect(valid).toBe(true);
  });

  it("control - without the keyword an unmarked property fails", async () => {
    const schema: SchemaDefinition = {
      type: "object",
      unevaluatedProperties: false,
    };
    const { valid } = await evaluate(v.compile(schema) as CompiledValidate, {
      extra: 1,
    });
    expect(valid).toBe(false);
  });
});
