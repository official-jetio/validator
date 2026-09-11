import { describe, it, expect } from "vitest";
import { JetValidator, SchemaDefinition } from "../../src";

/**
 * removeAdditional / useDefaults / coerceTypes are the three options that make
 * validation impure. Every test asserts TWO things: the validation result, and
 * what happened to the data object afterwards.
 *
 * Rules encoded here:
 *
 *  - The ROOT instance can never be replaced. validate(5) cannot hand back "5",
 *    validate(obj) cannot hand back a different obj. Only properties can change.
 *  - removeAdditional deletes IN PLACE. A nested object keeps its identity, so a
 *    reference captured before the call sees the change.
 *  - removeAdditional fires on: additionalProperties === false (true and "all"),
 *    or properties present ("all" only). Never on a bare {type:"object"}.
 *  - useDefaults only applies at a slot the schema enumerates: a properties key
 *    or a tuple index. Not through $ref, not through a property's own allOf,
 *    not at the root.
 *  - A default reachable only through oneOf/anyOf/not/if is a compile error.
 *  - Coercion is NOT rolled back. A losing branch or a failed predicate can
 *    leave a coerced value behind. Same as Ajv.
 */

type Schema = SchemaDefinition & Record<string, unknown>;

type CompiledValidate = ((data: unknown) => boolean) & {
  errors?: Array<Record<string, unknown>> | null;
};

function compile(schema: Schema, opts: Record<string, unknown> = {}) {
  return new JetValidator({ strict: false, ...opts }).compile(
    schema,
  ) as CompiledValidate;
}

function run(validate: CompiledValidate, data: unknown) {
  validate.errors = [];
  const valid = validate(data);
  return { valid, errors: [...(validate.errors ?? [])] };
}

const keywordsOf = (errors: Array<Record<string, unknown>>) =>
  errors.map((e) => e.keyword);

const twice = (validate: CompiledValidate, make: () => any) => {
  const a = make();
  const b = make();
  const ra = run(validate, a);
  const rb = run(validate, b);
  expect(ra.valid).toBe(rb.valid);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  return { valid: ra.valid, errors: ra.errors, data: a };
};

/* ================================================================== *
 * removeAdditional - the firing matrix
 * ================================================================== */

describe("removeAdditional - when it fires", () => {
  const input = () => ({ a: 1, "x-t": 2, junk: "str" });

  const shapes: Array<[string, Schema]> = [
    ["nothing declared", { type: "object" }],
    [
      "additionalProperties false only",
      { type: "object", additionalProperties: false },
    ],
    [
      "properties only",
      { type: "object", properties: { a: { type: "number" } } },
    ],
    [
      "properties + additionalProperties false",
      {
        type: "object",
        properties: { a: { type: "number" } },
        additionalProperties: false,
      },
    ],
    [
      "properties + additionalProperties schema",
      {
        type: "object",
        properties: { a: { type: "number" } },
        additionalProperties: { type: "number" },
      },
    ],
    [
      "patternProperties only",
      { type: "object", patternProperties: { "^x-": {} } },
    ],
    [
      "properties + patternProperties",
      {
        type: "object",
        properties: { a: { type: "number" } },
        patternProperties: { "^x-": {} },
      },
    ],
  ];

  const untouched = { a: 1, "x-t": 2, junk: "str" };

  const expectedTrue: Record<string, Record<string, unknown>> = {
    "nothing declared": untouched,
    "additionalProperties false only": {},
    "properties only": untouched,
    "properties + additionalProperties false": { a: 1 },
    "properties + additionalProperties schema": untouched,
    "patternProperties only": untouched,
    "properties + patternProperties": untouched,
  };

  const expectedAll: Record<string, Record<string, unknown>> = {
    "nothing declared": untouched,
    "additionalProperties false only": {},
    "properties only": { a: 1 },
    "properties + additionalProperties false": { a: 1 },
    "properties + additionalProperties schema": { a: 1 },
    "patternProperties only": untouched,
    "properties + patternProperties": { a: 1, "x-t": 2 },
  };

  for (const [label, schema] of shapes) {
    it(`true - ${label}`, () => {
      const validate = compile(schema, { removeAdditional: true });
      const data = input();
      run(validate, data);
      expect(data).toEqual(expectedTrue[label]);
    });

    it(`"all" - ${label}`, () => {
      const validate = compile(schema, { removeAdditional: "all" });
      const data = input();
      run(validate, data);
      expect(data).toEqual(expectedAll[label]);
    });

    it(`off - ${label} leaves data untouched`, () => {
      const validate = compile(schema);
      const data = input();
      run(validate, data);
      expect(data).toEqual(untouched);
    });
  }

  it('keeps patternProperties matches under "all"', () => {
    const validate = compile(
      {
        type: "object",
        properties: { keep: { type: "number" } },
        patternProperties: { "^x-": { type: "number" } },
      },
      { removeAdditional: "all" },
    );
    const data: Record<string, unknown> = {
      keep: 1,
      "x-trace": 2,
      "x-span": 3,
      junk: 4,
    };

    expect(run(validate, data).valid).toBe(true);
    expect(data).toEqual({ keep: 1, "x-trace": 2, "x-span": 3 });
  });

  it("reports additionalProperties when the option is off", () => {
    const validate = compile({
      type: "object",
      properties: { keep: { type: "number" } },
      additionalProperties: false,
    });
    const data: Record<string, unknown> = { keep: 1, drop: 2 };

    const { valid, errors } = run(validate, data);
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toContain("additionalProperties");
    expect(data).toEqual({ keep: 1, drop: 2 });
  });

  it('compiles for a properties-only schema under "all"', () => {
    const validate = compile(
      { type: "object", properties: { foo: { type: "number" } } },
      { removeAdditional: "all" },
    );
    const data: Record<string, unknown> = { foo: 1, bar: 2 };

    expect(() => run(validate, data)).not.toThrow();
    expect(data).toEqual({ foo: 1 });
  });
});

/* ================================================================== *
 * removeAdditional - deletes in place
 * ================================================================== */

describe("removeAdditional - deletes in place", () => {
  const nested: Schema = {
    type: "object",
    properties: {
      child: {
        type: "object",
        properties: { keep: { type: "number" } },
        additionalProperties: false,
      },
    },
  };

  it("preserves the identity of a nested object", () => {
    const validate = compile(nested, { removeAdditional: true });
    const child: Record<string, unknown> = { keep: 1, drop: 2 };
    const data = { child };

    expect(run(validate, data).valid).toBe(true);
    expect(data.child).toBe(child);
    expect(child).toEqual({ keep: 1 });
  });

  it("is visible through a reference captured before validation", () => {
    const validate = compile(nested, { removeAdditional: true });
    const data = { child: { keep: 1, drop: 2 } as Record<string, unknown> };
    const captured = data.child;

    run(validate, data);
    expect(captured).toEqual({ keep: 1 });
    expect("drop" in captured).toBe(false);
  });

  it("preserves insertion order of surviving keys", () => {
    const validate = compile(
      {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
          c: { type: "number" },
        },
        additionalProperties: false,
      },
      { removeAdditional: true },
    );
    const data: Record<string, unknown> = { a: 1, z: 9, b: 2, y: 8, c: 3 };

    run(validate, data);
    expect(Object.keys(data)).toEqual(["a", "b", "c"]);
  });

  it("does not replace the root object", () => {
    const validate = compile(
      {
        type: "object",
        properties: { keep: { type: "number" } },
        additionalProperties: false,
      },
      { removeAdditional: true },
    );
    const data: Record<string, unknown> = { keep: 1, drop: 2 };
    const same = data;

    run(validate, data);
    expect(data).toBe(same);
    expect(data).toEqual({ keep: 1 });
  });

  it("cleans objects inside arrays", () => {
    const validate = compile(
      {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "number" } },
              additionalProperties: false,
            },
          },
        },
      },
      { removeAdditional: true },
    );
    const first: Record<string, unknown> = { id: 1, junk: "a" };
    const data = { rows: [first, { id: 2, junk: "b" }] };

    expect(run(validate, data).valid).toBe(true);
    expect(data.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(data.rows[0]).toBe(first);
  });

  it("does not throw on a non-object value", () => {
    const validate = compile(
      {
        type: "object",
        properties: { keep: { type: "number" } },
        additionalProperties: false,
      },
      { removeAdditional: true },
    );

    expect(() => run(validate, "not an object")).not.toThrow();
    expect(() => run(validate, null)).not.toThrow();
    expect(() => run(validate, 42)).not.toThrow();
  });

  it("removes inside a $ref'd subschema", () => {
    const validate = compile(
      {
        $defs: {
          slim: {
            type: "object",
            properties: { a: { type: "number" } },
            additionalProperties: false,
          },
        },
        type: "object",
        properties: { inner: { $ref: "#/$defs/slim" } },
      },
      { removeAdditional: true },
    );
    const inner: Record<string, unknown> = { a: 1, junk: 2 };
    const data = { inner };

    expect(run(validate, data).valid).toBe(true);
    expect(inner).toEqual({ a: 1 });
    expect(data.inner).toBe(inner);
  });

  it("removes through a recursive $ref, which is never inlined", () => {
    const validate = compile(
      {
        $defs: {
          node: {
            type: "object",
            properties: {
              v: { type: "integer" },
              child: { $ref: "#/$defs/node" },
            },
            additionalProperties: false,
          },
        },
        $ref: "#/$defs/node",
      },
      { removeAdditional: true },
    );
    const deep: Record<string, unknown> = { v: 3, junk: 1 };
    const data: Record<string, unknown> = {
      v: 1,
      junk: 1,
      child: { v: 2, junk: 1, child: deep },
    };

    expect(run(validate, data).valid).toBe(true);
    expect("junk" in data).toBe(false);
    expect("junk" in deep).toBe(false);
  });

  it("a removed property cannot be flagged as unevaluated", () => {
    const validate = compile(
      {
        type: "object",
        properties: { a: { type: "number" } },
        additionalProperties: false,
        unevaluatedProperties: false,
      },
      { removeAdditional: true, allErrors: true },
    );
    const data: Record<string, unknown> = { a: 1, junk: 2 };

    const { valid, errors } = run(validate, data);
    expect(valid).toBe(true);
    expect(keywordsOf(errors)).not.toContain("unevaluatedProperties");
    expect(data).toEqual({ a: 1 });
  });
});

/* ================================================================== *
 * removeAdditional - inside logical applicators
 * ================================================================== */

describe("removeAdditional inside oneOf - eager, both branches run", () => {
  const schema: Schema = {
    type: "object",
    oneOf: [
      {
        properties: { foo: { type: "string" } },
        required: ["foo"],
        additionalProperties: false,
      },
      {
        properties: { bar: { type: "integer" } },
        required: ["bar"],
        additionalProperties: false,
      },
    ],
  };

  it("the second branch removes foo", () => {
    const validate = compile(schema, { removeAdditional: true });
    const data: Record<string, unknown> = { foo: "abc" };
    expect(run(validate, data).valid).toBe(true);
    expect(data).toEqual({});
  });

  it("the first branch removes bar", () => {
    const validate = compile(schema, { removeAdditional: true });
    const data: Record<string, unknown> = { bar: 1 };
    expect(run(validate, data).valid).toBe(false); // bar already removed by branch 1
    expect(data).toEqual({});
  });

  it("the hoisted refactor keeps both and rejects them together", () => {
    const flattened: Schema = {
      type: "object",
      properties: { foo: { type: "string" }, bar: { type: "integer" } },
      additionalProperties: false,
      oneOf: [{ required: ["foo"] }, { required: ["bar"] }],
    };
    const validate = compile(flattened, { removeAdditional: true });

    const a: Record<string, unknown> = { foo: "abc", junk: 1 };
    expect(run(validate, a).valid).toBe(true);
    expect(a).toEqual({ foo: "abc" });

    const b: Record<string, unknown> = { bar: 1, junk: 2 };
    expect(run(validate, b).valid).toBe(true);
    expect(b).toEqual({ bar: 1 });

    const c: Record<string, unknown> = { foo: "abc", bar: 1, junk: 2 };
    expect(run(validate, c).valid).toBe(false);
    expect(c).toEqual({ foo: "abc", bar: 1 });
  });

  it("cousins declared as true survive both branches", () => {
    const cousins: Schema = {
      type: "object",
      oneOf: [
        {
          properties: { foo: { type: "string" }, bar: true },
          required: ["foo"],
          additionalProperties: false,
        },
        {
          properties: { foo: true, bar: { type: "integer" } },
          required: ["bar"],
          additionalProperties: false,
        },
      ],
    };
    const validate = compile(cousins, { removeAdditional: true });

    const a: Record<string, unknown> = { foo: "abc" };
    expect(run(validate, a).valid).toBe(true);
    expect(a).toEqual({ foo: "abc" });

    const b: Record<string, unknown> = { bar: 1 };
    expect(run(validate, b).valid).toBe(true);
    expect(b).toEqual({ bar: 1 });
  });

  it("is deterministic for an allOf whose branches disagree", () => {
    const validate = compile(
      {
        type: "object",
        allOf: [
          {
            properties: { a: { type: "number" } },
            additionalProperties: false,
          },
          {
            properties: { b: { type: "number" } },
            additionalProperties: false,
          },
        ],
      },
      { removeAdditional: true },
    );

    twice(validate, () => ({ a: 1, b: 2 }));
  });

  it("strips only in the winning if/then branch", () => {
    const validate = compile(
      {
        type: "object",
        properties: { kind: { type: "string" } },
        if: { properties: { kind: { const: "slim" } }, required: ["kind"] },
        then: {
          properties: { kind: true, a: { type: "number" } },
          additionalProperties: false,
        },
        else: {},
      },
      { removeAdditional: true },
    );

    const slim: Record<string, unknown> = { kind: "slim", a: 1, junk: 2 };
    expect(run(validate, slim).valid).toBe(true);
    expect(slim).toEqual({ kind: "slim", a: 1 });

    const fat: Record<string, unknown> = { kind: "fat", a: 1, junk: 2 };
    expect(run(validate, fat).valid).toBe(true);
    expect(fat).toEqual({ kind: "fat", a: 1, junk: 2 });
  });
});

/* ================================================================== *
 * useDefaults - where it applies
 * ================================================================== */

describe("useDefaults - assigns into the data", () => {
  const schema: Schema = {
    type: "object",
    properties: {
      foo: { type: "number" },
      bar: { type: "string", default: "baz" },
    },
    required: ["foo", "bar"],
  };

  it("fills a missing property before required is checked", () => {
    const validate = compile(schema, { useDefaults: true });
    const data: Record<string, unknown> = { foo: 1 };

    expect(run(validate, data).valid).toBe(true);
    expect(data).toEqual({ foo: 1, bar: "baz" });
  });

  it("leaves an existing value alone", () => {
    const validate = compile(schema, { useDefaults: true });
    const data: Record<string, unknown> = { foo: 1, bar: "mine" };

    expect(run(validate, data).valid).toBe(true);
    expect(data.bar).toBe("mine");
  });

  it("does not assign when the option is off", () => {
    const validate = compile(schema);
    const data: Record<string, unknown> = { foo: 1 };

    const { valid, errors } = run(validate, data);
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toContain("required");
    expect("bar" in data).toBe(false);
  });

  it("fills nested properties in place", () => {
    const validate = compile(
      {
        type: "object",
        properties: {
          cfg: {
            type: "object",
            properties: {
              retries: { type: "integer", default: 3 },
              mode: { type: "string", default: "auto" },
            },
          },
        },
      },
      { useDefaults: true },
    );
    const cfg: Record<string, unknown> = {};
    const data = { cfg };

    expect(run(validate, data).valid).toBe(true);
    expect(cfg).toEqual({ retries: 3, mode: "auto" });
    expect(data.cfg).toBe(cfg);
  });

  it("does not share an object default between validations", () => {
    const validate = compile(
      {
        type: "object",
        properties: { opts: { type: "object", default: { nested: [1, 2] } } },
      },
      { useDefaults: true },
    );

    const a: Record<string, any> = {};
    const b: Record<string, any> = {};
    run(validate, a);
    run(validate, b);

    expect(a.opts).toEqual({ nested: [1, 2] });
    expect(b.opts).toEqual({ nested: [1, 2] });
    expect(a.opts).not.toBe(b.opts);

    a.opts.nested.push(3);
    expect(b.opts.nested).toEqual([1, 2]);
  });

  it("cannot modify the root instance", () => {
    const validate = compile(
      { type: "string", default: "fallback" },
      { useDefaults: true },
    );
    let root: unknown;

    run(validate, root);
    expect(root).toBeUndefined();
  });

  it("applies inside dependentSchemas only when triggered", () => {
    const validate = compile(
      {
        type: "object",
        properties: { card: { type: "string" } },
        dependentSchemas: {
          card: { properties: { cvv: { type: "string", default: "000" } } },
        },
      },
      { useDefaults: true },
    );

    const withCard: Record<string, unknown> = { card: "4111" };
    expect(run(validate, withCard).valid).toBe(true);
    expect(withCard.cvv).toBe("000");

    const without: Record<string, unknown> = {};
    expect(run(validate, without).valid).toBe(true);
    expect("cvv" in without).toBe(false);
  });

  it("a default-assigned property counts as evaluated", () => {
    const validate = compile(
      {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "string", default: "filled" },
        },
        unevaluatedProperties: false,
      },
      { useDefaults: true, allErrors: true },
    );
    const data: Record<string, unknown> = { a: 1 };

    const { valid, errors } = run(validate, data);
    expect(valid).toBe(true);
    expect(keywordsOf(errors)).not.toContain("unevaluatedProperties");
    expect(data.b).toBe("filled");
  });
});

describe("useDefaults - tuple positions", () => {
  it("fills prefixItems, which Ajv does not", () => {
    const validate = compile(
      {
        type: "array",
        prefixItems: [{ type: "number" }, { type: "string", default: "z" }],
      },
      { useDefaults: true },
    );
    const data: unknown[] = [1];

    expect(run(validate, data).valid).toBe(true);
    expect(data).toEqual([1, "z"]);
  });

  it("fills the draft-07 tuple items spelling identically", () => {
    const validate = compile(
      {
        type: "array",
        items: [
          { type: "number", default: 9 },
          { type: "string", default: "z" },
        ],
      },
      { useDefaults: true },
    );
    const data: unknown[] = [];

    expect(run(validate, data).valid).toBe(true);
    expect(data).toEqual([9, "z"]);
  });

  it("runs before minItems, so filling can satisfy it", () => {
    const validate = compile(
      {
        type: "array",
        prefixItems: [
          { type: "number", default: 1 },
          { type: "number", default: 2 },
        ],
        minItems: 2,
      },
      { useDefaults: true },
    );
    const data: unknown[] = [];

    expect(run(validate, data).valid).toBe(true);
    expect(data).toEqual([1, 2]);
  });

  it("a filled position counts as evaluated", () => {
    const validate = compile(
      {
        type: "array",
        prefixItems: [{ type: "number" }, { type: "string", default: "z" }],
        unevaluatedItems: false,
      },
      { useDefaults: true, allErrors: true },
    );
    const data: unknown[] = [1];

    const { valid, errors } = run(validate, data);
    expect(valid).toBe(true);
    expect(keywordsOf(errors)).not.toContain("unevaluatedItems");
  });
});

describe('useDefaults: "empty" - null and "" count as missing', () => {
  const schema: Schema = {
    type: "object",
    properties: {
      a: { type: "string", default: "filled" },
      b: { type: "string", default: "filled" },
      c: { type: "string", default: "filled" },
      d: { type: "number", default: 42 },
    },
  };

  it('replaces null and "" but not other falsy values', () => {
    const validate = compile(schema, { useDefaults: "empty" });
    const data: Record<string, unknown> = { a: null, b: "", c: "kept", d: 0 };

    expect(run(validate, data).valid).toBe(true);
    expect(data.a).toBe("filled");
    expect(data.b).toBe("filled");
    expect(data.c).toBe("kept");
    expect(data.d).toBe(0);
  });

  it('leaves null and "" alone under useDefaults: true', () => {
    const validate = compile(schema, { useDefaults: true });
    const data: Record<string, unknown> = { a: null, b: "" };

    run(validate, data);
    expect(data.a).toBeNull();
    expect(data.b).toBe("");
  });
});

describe("useDefaults - where it does NOT reach", () => {
  it("does not follow a $ref", () => {
    const validate = compile(
      {
        $defs: { n: { type: "number", default: 1 } },
        type: "object",
        properties: { v: { $ref: "#/$defs/n" } },
      },
      { useDefaults: true },
    );
    const data: Record<string, unknown> = {};

    run(validate, data);
    expect("v" in data).toBe(false);
  });

  it("does not descend into a property's own allOf", () => {
    const validate = compile(
      {
        type: "object",
        properties: { v: { allOf: [{ type: "number", default: 1 }] } },
      },
      { useDefaults: true },
    );
    const data: Record<string, unknown> = {};

    run(validate, data);
    expect("v" in data).toBe(false);
  });

  it("does nothing under patternProperties or additionalProperties", () => {
    const validate = compile(
      {
        type: "object",
        patternProperties: { "^p": { default: 1 } },
        additionalProperties: { default: 2 },
      },
      { useDefaults: true },
    );
    const data: Record<string, unknown> = {};

    run(validate, data);
    expect(data).toEqual({});
  });
});

describe("useDefaults - conditional applicators are a compile error", () => {
  const positions: Array<[string, Schema]> = [
    [
      "oneOf branch",
      {
        type: "object",
        oneOf: [
          { properties: { n: { type: "number", default: 1 } } },
          { properties: { kind: { const: "b" } }, required: ["kind"] },
        ],
      },
    ],
    [
      "anyOf branch",
      {
        type: "object",
        anyOf: [{ properties: { n: { type: "number", default: 1 } } }],
      },
    ],
    [
      "not",
      {
        type: "object",
        not: {
          properties: { n: { type: "number", default: 1 } },
          required: ["z"],
        },
      },
    ],
    [
      "if predicate",
      {
        type: "object",
        if: { properties: { n: { type: "number", default: 1 } } },
        then: {},
      },
    ],
    [
      "two levels under a oneOf",
      {
        type: "object",
        oneOf: [
          {
            type: "object",
            properties: {
              inner: {
                type: "object",
                properties: { n: { type: "number", default: 1 } },
              },
            },
          },
        ],
      },
    ],
    [
      "tuple position under a oneOf",
      {
        type: "object",
        oneOf: [
          {
            type: "object",
            properties: {
              list: {
                type: "array",
                prefixItems: [{ type: "number", default: 1 }],
              },
            },
          },
        ],
      },
    ],
  ];

  for (const [label, schema] of positions) {
    it(`throws for a default in a ${label}`, () => {
      expect(() => compile(schema, { useDefaults: true })).toThrow();
    });

    it(`compiles fine for a ${label} without useDefaults`, () => {
      expect(() => compile(schema)).not.toThrow();
    });
  }

  it("allows a default in then / elseIf then / else", () => {
    const validate = compile(
      {
        type: "object",
        properties: { kind: { type: "string" } },
        if: { properties: { kind: { const: "a" } }, required: ["kind"] },
        then: { properties: { av: { type: "number", default: 1 } } },
        elseIf: [
          {
            if: { properties: { kind: { const: "b" } }, required: ["kind"] },
            then: { properties: { bv: { type: "number", default: 2 } } },
          },
        ],
        else: { properties: { zv: { type: "number", default: 3 } } },
      },
      { useDefaults: true },
    );

    const b: Record<string, unknown> = { kind: "b" };
    expect(run(validate, b).valid).toBe(true);
    expect(b).toEqual({ kind: "b", bv: 2 });

    const z: Record<string, unknown> = { kind: "zzz" };
    expect(run(validate, z).valid).toBe(true);
    expect(z).toEqual({ kind: "zzz", zv: 3 });
  });

  it("allows a default in an allOf branch", () => {
    const validate = compile(
      {
        type: "object",
        allOf: [{ properties: { mode: { type: "string", default: "auto" } } }],
      },
      { useDefaults: true },
    );
    const data: Record<string, unknown> = {};

    expect(run(validate, data).valid).toBe(true);
    expect(data.mode).toBe("auto");
  });

  it("a default in a winning then counts as evaluated", () => {
    const validate = compile(
      {
        type: "object",
        properties: { kind: { type: "string" } },
        if: { properties: { kind: { const: "x" } }, required: ["kind"] },
        then: { properties: { extra: { type: "number", default: 5 } } },
        unevaluatedProperties: false,
      },
      { useDefaults: true, allErrors: true },
    );
    const data: Record<string, unknown> = { kind: "x" };

    const { valid, errors } = run(validate, data);
    expect(valid).toBe(true);
    expect(keywordsOf(errors)).not.toContain("unevaluatedProperties");
    expect(data.extra).toBe(5);
  });
});

describe("KNOWN GAP: an allOf default lands after the outer required check", () => {
  /**
   * The outer object block emits `required` before handleLogicalOperators
   * reaches the allOf branch, so the assignment is too late to satisfy it.
   * Ajv passes this case. Fix is to read allOf[*].properties in the same
   * hoisted pass. Delete this block when that lands.
   *
   * The verdict is the same in both modes; only the data differs, because
   * fail-fast returns before the allOf branch runs at all.
   */
  const schema: Schema = {
    type: "object",
    required: ["mode"],
    allOf: [{ properties: { mode: { type: "string", default: "auto" } } }],
  };

  it("fails in failFast, and the default never runs", () => {
    const validate = compile(schema, { useDefaults: true, allErrors: false });
    const data: Record<string, unknown> = {};

    expect(run(validate, data).valid).toBe(false);
    expect("mode" in data).toBe(false);
  });

  it("fails in allErrors, but the default lands afterwards", () => {
    const validate = compile(schema, { useDefaults: true, allErrors: true });
    const data: Record<string, unknown> = {};

    expect(run(validate, data).valid).toBe(false);
    expect(data.mode).toBe("auto");
  });
});

/* ================================================================== *
 * coerceTypes
 * ================================================================== */

describe("coerceTypes - rewrites the data to match the type keyword", () => {
  const schema: Schema = {
    type: "object",
    properties: {
      n: { type: "number" },
      i: { type: "integer" },
      b: { type: "boolean" },
      s: { type: "string" },
    },
    required: ["n", "i", "b", "s"],
  };

  it("coerces strings to numbers and booleans, and numbers to strings", () => {
    const validate = compile(schema, { coerceTypes: true });
    const data: Record<string, unknown> = {
      n: "1.5",
      i: "7",
      b: "false",
      s: 12,
    };

    expect(run(validate, data).valid).toBe(true);
    expect(data.n).toBe(1.5);
    expect(data.i).toBe(7);
    expect(data.b).toBe(false);
    expect(data.s).toBe("12");
  });

  it("does not touch values already of the right type", () => {
    const validate = compile(schema, { coerceTypes: true });
    const data: Record<string, unknown> = { n: 1, i: 2, b: true, s: "x" };

    expect(run(validate, data).valid).toBe(true);
    expect(data).toEqual({ n: 1, i: 2, b: true, s: "x" });
  });

  it("fails and leaves the value alone when coercion is impossible", () => {
    const validate = compile(
      { type: "object", properties: { n: { type: "number" } } },
      { coerceTypes: true },
    );
    const data: Record<string, unknown> = { n: "not a number" };

    const { valid, errors } = run(validate, data);
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toContain("type");
    expect(data.n).toBe("not a number");
  });

  it("does not coerce when the option is off", () => {
    const validate = compile(schema);
    const data: Record<string, unknown> = { n: "1", i: "2", b: "true", s: 3 };

    expect(run(validate, data).valid).toBe(false);
    expect(data.n).toBe("1");
  });

  it("coerces nested properties and array items in place", () => {
    const validate = compile(
      {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: { qty: { type: "integer" } },
            },
          },
        },
      },
      { coerceTypes: true },
    );
    const first: Record<string, unknown> = { qty: "3" };
    const data = { rows: [first, { qty: "4" }] };

    expect(run(validate, data).valid).toBe(true);
    expect(data.rows).toEqual([{ qty: 3 }, { qty: 4 }]);
    expect(data.rows[0]).toBe(first);
  });

  it("coerces through patternProperties and additionalProperties", () => {
    const validate = compile(
      {
        type: "object",
        properties: { id: { type: "string" } },
        patternProperties: { "^n_": { type: "integer" } },
        additionalProperties: { type: "number" },
      },
      { coerceTypes: true },
    );
    const data: Record<string, unknown> = { id: 7, n_a: "1", other: "2" };

    expect(run(validate, data).valid).toBe(true);
    expect(data.id).toBe("7");
    expect(data.n_a).toBe(1);
    expect(data.other).toBe(2);
  });

  it("coerces a scalar reached through a $ref", () => {
    const validate = compile(
      {
        $defs: { num: { type: "integer" } },
        type: "object",
        properties: { n: { $ref: "#/$defs/num" } },
      },
      { coerceTypes: true },
    );
    const data: Record<string, unknown> = { n: "42" };

    expect(run(validate, data).valid).toBe(true);
    expect(data.n).toBe(42);
  });

  it("cannot coerce the root scalar in the caller's variable", () => {
    const validate = compile({ type: "number" }, { coerceTypes: true });
    const root = "5";

    expect(run(validate, root).valid).toBe(true);
    expect(root).toBe("5");
    expect(typeof root).toBe("string");
  });

  it("does not coerce property NAMES via propertyNames", () => {
    const validate = compile(
      { type: "object", propertyNames: { type: "string", maxLength: 5 } },
      { coerceTypes: true },
    );
    const data: Record<string, unknown> = { ok: 1 };

    expect(run(validate, data).valid).toBe(true);
    expect(Object.keys(data)).toEqual(["ok"]);
  });
});

describe('coerceTypes: "array" - wraps and unwraps', () => {
  it("wraps a scalar into an array and unwraps a one-element array", () => {
    const validate = compile(
      {
        type: "object",
        properties: {
          foo: { type: "array", items: { type: "number" } },
          bar: { type: "boolean" },
        },
      },
      { coerceTypes: "array" },
    );
    const data: Record<string, unknown> = { foo: "1", bar: ["false"] };

    expect(run(validate, data).valid).toBe(true);
    expect(data.foo).toEqual([1]);
    expect(data.bar).toBe(false);
  });

  it("does not wrap under coerceTypes: true", () => {
    const validate = compile(
      {
        type: "object",
        properties: { foo: { type: "array", items: { type: "number" } } },
      },
      { coerceTypes: true },
    );
    const data: Record<string, unknown> = { foo: "1" };

    expect(run(validate, data).valid).toBe(false);
    expect(data.foo).toBe("1");
  });
});

describe("coerceTypes inside logical applicators - NOT rolled back", () => {
  /**
   * Coercion is emitted at the top of every subschema, before any branch flag
   * is consulted, so it always runs. A losing branch or a failed predicate can
   * leave a coerced value behind. Ajv behaves the same way; what makes it
   * survivable is that the coercion table round-trips for the common pairs.
   * These record the behaviour so a future change is visible.
   */

  it("a losing branch may leave the value coerced, but deterministically", () => {
    const validate = compile(
      {
        type: "object",
        properties: {
          v: {
            oneOf: [
              { type: "integer", minimum: 100 },
              { type: "string", pattern: "^[0-9]+$" },
            ],
          },
        },
      },
      { coerceTypes: true },
    );

    const { valid, data } = twice(validate, () => ({ v: "7" }));
    expect(typeof valid).toBe("boolean");
    expect(data).toHaveProperty("v");
  });

  it("a failed if predicate behaves deterministically", () => {
    const validate = compile(
      {
        type: "object",
        if: {
          properties: { flag: { type: "boolean" } },
          required: ["missing"],
        },
        then: { required: ["a"] },
        else: { required: ["b"] },
      },
      { coerceTypes: true },
    );

    const { valid } = twice(validate, () => ({ flag: "true", b: 1 }));
    expect(valid).toBe(true);
  });

  it("a not predicate behaves deterministically", () => {
    const validate = compile(
      {
        type: "object",
        not: { properties: { n: { type: "number" } }, required: ["n"] },
      },
      { coerceTypes: true },
    );

    twice(validate, () => ({ n: "5" }));
  });

  it("still matches a later branch that needs the original type", () => {
    const validate = compile(
      {
        type: "object",
        properties: {
          v: { anyOf: [{ type: "number" }, { type: "string", minLength: 3 }] },
        },
      },
      { coerceTypes: true },
    );
    const data: Record<string, unknown> = { v: "abc" };

    expect(run(validate, data).valid).toBe(true);
    expect(data.v).toBe("abc");
  });

  it("contains searches deterministically", () => {
    const validate = compile(
      { type: "array", contains: { type: "integer", minimum: 10 } },
      { coerceTypes: true },
    );

    twice(validate, () => ["1", "2", 50]);
  });

  it("a coercion in allOf[0] is seen by a constraint in allOf[1]", () => {
    const validate = compile(
      {
        type: "object",
        allOf: [
          { properties: { n: { type: "integer" } } },
          { properties: { n: { minimum: 5 } } },
        ],
      },
      { coerceTypes: true },
    );
    const data: Record<string, unknown> = { n: "7" };

    expect(run(validate, data).valid).toBe(true);
    expect(data.n).toBe(7);
  });
});

/* ================================================================== *
 * prefixItems bounds and additionalItems - regression guards
 * ================================================================== */

describe("prefixItems only validates positions that exist", () => {
  const schema: Schema = {
    type: "array",
    prefixItems: [{ type: "number" }, { type: "string" }, { type: "boolean" }],
  };

  it("accepts a short array", () => {
    const validate = compile(schema, { allErrors: true });
    expect(run(validate, []).valid).toBe(true);
    expect(run(validate, [1]).valid).toBe(true);
    expect(run(validate, [1, "a"]).valid).toBe(true);
    expect(run(validate, [1, "a", true]).valid).toBe(true);
  });

  it("reports each bad position exactly once", () => {
    const validate = compile(schema, { allErrors: true });
    const { valid, errors } = run(validate, ["x", 1, "no"]);

    expect(valid).toBe(false);
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.dataPath).sort()).toEqual(["/0", "/1", "/2"]);
  });

  it("does not mark absent positions as evaluated", () => {
    const validate = compile(
      { ...schema, unevaluatedItems: false },
      { allErrors: true },
    );
    expect(run(validate, [1, "a"]).valid).toBe(true);

    const { valid, errors } = run(validate, [1, "a", true, "extra"]);
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toContain("unevaluatedItems");
  });

  it("emits the additionalItems error once", () => {
    const validate = compile(
      {
        type: "array",
        items: [{ type: "number" }, { type: "string" }],
        additionalItems: false,
      },
      { allErrors: true },
    );
    const { valid, errors } = run(validate, [1, "a", 3]);

    expect(valid).toBe(false);
    expect(errors.filter((e) => e.keyword === "additionalItems")).toHaveLength(
      1,
    );
  });

  it("validates additionalItems as a schema exactly once per element", () => {
    const validate = compile(
      {
        type: "array",
        items: [{ type: "number" }],
        additionalItems: { type: "string" },
      },
      { allErrors: true },
    );
    const { valid, errors } = run(validate, [1, 2, 3]);

    expect(valid).toBe(false);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.dataPath).sort()).toEqual(["/1", "/2"]);
  });
});

/* ================================================================== *
 * all three together
 * ================================================================== */

describe("all three options together", () => {
  const schema: Schema = {
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: {
          id: { type: "integer" },
          active: { type: "boolean", default: true },
          role: { type: "string", default: "member" },
        },
        required: ["id", "active", "role"],
        additionalProperties: false,
      },
    },
    required: ["user"],
    additionalProperties: false,
  };

  const opts = { removeAdditional: true, useDefaults: true, coerceTypes: true };

  it("coerces, fills and strips in one pass", () => {
    const validate = compile(schema, opts);
    const user: Record<string, unknown> = { id: "42", junk: "x" };
    const data: Record<string, unknown> = { user, extra: 1 };

    expect(run(validate, data).valid).toBe(true);
    expect(data).toEqual({ user: { id: 42, active: true, role: "member" } });
    expect(data.user).toBe(user);
    expect("extra" in data).toBe(false);
  });

  it("leaves earlier mutations applied when a later check fails", () => {
    const validate = compile(schema, opts);
    const data: Record<string, unknown> = {
      user: { id: "not an integer" },
      extra: 1,
    };

    const { valid } = run(validate, data);
    expect(valid).toBe(false);
    expect("extra" in data).toBe(false);
  });

  it("is idempotent on already-normalised data", () => {
    const validate = compile(schema, opts);
    const data: Record<string, unknown> = { user: { id: "42", junk: "x" } };

    expect(run(validate, data).valid).toBe(true);
    const afterFirst = JSON.stringify(data);

    expect(run(validate, data).valid).toBe(true);
    expect(JSON.stringify(data)).toBe(afterFirst);
  });

  it("two compilations of the same schema agree", () => {
    const a = compile(schema, opts);
    const b = compile(schema, opts);

    const da: Record<string, unknown> = {
      user: { id: "5", junk: 1 },
      extra: 1,
    };
    const db: Record<string, unknown> = {
      user: { id: "5", junk: 1 },
      extra: 1,
    };

    expect(run(a, da).valid).toBe(run(b, db).valid);
    expect(JSON.stringify(da)).toBe(JSON.stringify(db));
  });
});
