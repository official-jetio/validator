import { describe, it, expect } from "vitest";
import { JetValidator, SchemaDefinition } from "../../src";

/**
 * `elseIf` is a custom extension shaped like a standard if/then chain:
 *
 *   { if, then, elseIf: [{ if, then }, ...], else }
 *
 * Selection is first-match-wins: try `if`, then each `elseIf[i].if` in order,
 * and fall back to `else` only if nothing matched. The winning branch's `then`
 * (or `else`) is the ONLY subschema that reports errors - every `if` is a
 * silent predicate. With no `else`, an unmatched chain is vacuously valid.
 *
 * Assumptions to sanity-check on review:
 *  - option to surface custom messages is `errorMessage: true` (as in the
 *    Compiler tests) and messages land on `error.message`;
 *  - schemaPath labelling for elseIf branches is intentionally NOT asserted
 *    here (I don't want to guess the internal path). Tests key on `keyword`
 *    + `dataPath`, which are stable regardless of that convention.
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

describe("elseIf - selection is first-match-wins", () => {
  const schema: Schema = {
    type: "integer",
    if: { minimum: 100 },
    then: { multipleOf: 10 },
    elseIf: [
      { if: { minimum: 10 }, then: { multipleOf: 5 } },
      { if: { minimum: 1 }, then: { multipleOf: 2 } },
    ],
    else: { const: 0 },
  };

  for (const mode of ["allErrors", "failFast"] as const) {
    describe(mode, () => {
      const validate = compile(schema, { allErrors: mode === "allErrors" });

      it("takes `then` when `if` matches, ignoring later elseIf conditions", () => {
        expect(run(validate, 150).valid).toBe(true);
        const { valid, errors } = run(validate, 155);
        expect(valid).toBe(false);
        expect(keywordsOf(errors)).toEqual(["multipleOf"]);
      });

      it("falls to the first elseIf whose `if` matches", () => {
        expect(run(validate, 50).valid).toBe(true);
        const { valid, errors } = run(validate, 52);
        expect(valid).toBe(false);
        expect(keywordsOf(errors)).toEqual(["multipleOf"]);
      });

      it("skips an earlier elseIf and uses a later one that matches", () => {
        expect(run(validate, 4).valid).toBe(true);
        const { valid, errors } = run(validate, 5);
        expect(valid).toBe(false);
        expect(keywordsOf(errors)).toEqual(["multipleOf"]);
      });

      it("uses `else` only when neither `if` nor any elseIf matched", () => {
        expect(run(validate, 0).valid).toBe(true);
        const { valid, errors } = run(validate, -1);
        expect(valid).toBe(false);
        expect(keywordsOf(errors)).toEqual(["const"]);
      });
    });
  }
});

describe("elseIf - a discriminated object routes to exactly one branch", () => {
  const schema: Schema = {
    type: "object",
    required: ["kind"],
    properties: { kind: { type: "string" } },
    if: { properties: { kind: { const: "circle" } }, required: ["kind"] },
    then: {
      required: ["radius"],
      properties: { radius: { type: "number", minimum: 0 } },
    },
    elseIf: [
      {
        if: { properties: { kind: { const: "rect" } }, required: ["kind"] },
        then: {
          required: ["w", "h"],
          properties: { w: { type: "number" }, h: { type: "number" } },
        },
      },
      {
        if: { properties: { kind: { const: "poly" } }, required: ["kind"] },
        then: {
          required: ["sides"],
          properties: { sides: { type: "integer", minimum: 3 } },
        },
      },
    ],
    else: { required: ["note"], properties: { note: { type: "string" } } },
  };

  for (const mode of ["allErrors", "failFast"] as const) {
    describe(mode, () => {
      const validate = compile(schema, { allErrors: mode === "allErrors" });

      it("accepts each shape when its own branch is satisfied", () => {
        expect(run(validate, { kind: "circle", radius: 4 }).valid).toBe(true);
        expect(run(validate, { kind: "rect", w: 2, h: 3 }).valid).toBe(true);
        expect(run(validate, { kind: "poly", sides: 5 }).valid).toBe(true);
        expect(run(validate, { kind: "blob", note: "ok" }).valid).toBe(true);
      });

      it("reports only the `then` branch when `if` matched", () => {
        const { valid, errors } = run(validate, { kind: "circle", radius: -1 });
        expect(valid).toBe(false);
        expect(errors).toHaveLength(1);
        expect(errors[0].keyword).toBe("minimum");
        expect(errors[0].dataPath).toBe("/radius");
        expect(errors[0].schemaPath).toBe("#/then/properties/radius");
      });

      it("reports only the matched elseIf branch, never a sibling", () => {
        const { valid, errors } = run(validate, { kind: "poly", sides: 2 });
        expect(valid).toBe(false);
        expect(errors).toHaveLength(1);
        expect(errors[0].keyword).toBe("minimum");
        expect(errors[0].dataPath).toBe("/sides");
        expect(errors[0].schemaPath).toBe("#/elseIf/1/then/properties/sides");
      });

      it("reports the `else` branch when nothing matched", () => {
        const { valid, errors } = run(validate, { kind: "blob" });
        expect(valid).toBe(false);
        expect(keywordsOf(errors)).toEqual(["required"]);
        expect(errors[0].schemaPath).toBe("#/else");
      });

      it("collects (allErrors) or short-circuits (failFast) within the winning branch", () => {
        const { valid, errors } = run(validate, {
          kind: "rect",
          w: "x",
          h: "y",
        });
        expect(valid).toBe(false);
        if (mode === "allErrors") {
          expect(keywordsOf(errors)).toEqual(["type", "type"]);
          expect(errors.map((e) => e.dataPath).sort()).toEqual(["/h", "/w"]);
          expect(errors.map((e) => e.schemaPath).sort()).toEqual([
            "#/elseIf/0/then/properties/h",
            "#/elseIf/0/then/properties/w",
          ]);
        } else {
          expect(errors).toHaveLength(1);
          expect(errors[0].keyword).toBe("type");
          expect(errors[0].schemaPath).toBe("#/elseIf/0/then/properties/w");
        }
      });
    });
  }
});

describe("elseIf - no `else`: an unmatched chain is vacuously valid", () => {
  const schema: Schema = {
    type: "object",
    properties: { kind: { type: "string" } },
    if: { properties: { kind: { const: "a" } }, required: ["kind"] },
    then: { required: ["av"] },
    elseIf: [
      {
        if: { properties: { kind: { const: "b" } }, required: ["kind"] },
        then: { required: ["bv"] },
      },
    ],
  };

  const validate = compile(schema, { allErrors: true });

  it("passes when no branch matches and there is no else", () => {
    expect(run(validate, { kind: "z" }).valid).toBe(true);
    expect(run(validate, {}).valid).toBe(true);
  });

  it("still enforces `then` when `if` matches", () => {
    const { valid, errors } = run(validate, { kind: "a" });
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toEqual(["required"]);
    expect(errors[0].schemaPath).toBe("#/then");
  });

  it("still enforces a matched elseIf branch", () => {
    const { valid, errors } = run(validate, { kind: "b" });
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toEqual(["required"]);
    expect(errors[0].schemaPath).toBe("#/elseIf/0/then");
  });
});

describe("elseIf - unevaluatedProperties tracks the winning branch", () => {
  const schema: Schema = {
    type: "object",
    required: ["kind"],
    properties: { kind: { type: "string" } },
    if: { properties: { kind: { const: "user" } }, required: ["kind"] },
    then: { required: ["name"], properties: { name: { type: "string" } } },
    elseIf: [
      {
        if: { properties: { kind: { const: "org" } }, required: ["kind"] },
        then: {
          required: ["orgId"],
          properties: { orgId: { type: "integer" } },
        },
      },
    ],
    else: { required: ["ref"], properties: { ref: { type: "boolean" } } },
    unevaluatedProperties: false,
  };

  const validate = compile(schema, { allErrors: true });

  it("counts props evaluated by the winning `then` (if branch)", () => {
    expect(run(validate, { kind: "user", name: "Ada" }).valid).toBe(true);
  });

  it("counts props evaluated by a winning elseIf branch", () => {
    expect(run(validate, { kind: "org", orgId: 7 }).valid).toBe(true);
  });

  it("counts props evaluated by the `else` branch", () => {
    expect(run(validate, { kind: "x", ref: true }).valid).toBe(true);
  });

  it("flags a property no branch evaluated", () => {
    const { valid, errors } = run(validate, {
      kind: "user",
      name: "Ada",
      extra: 1,
    });
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toContain("unevaluatedProperties");
  });

  it("does not let a losing branch's property count as evaluated", () => {
    const { valid, errors } = run(validate, {
      kind: "user",
      name: "Ada",
      orgId: 7,
    });
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toContain("unevaluatedProperties");
  });
});

describe("elseIf - unevaluatedItems tracks the winning branch", () => {
  const covered: Schema = {
    type: "array",
    if: { minItems: 4 },
    then: { items: { type: "number" } },
    elseIf: [{ if: { minItems: 2 }, then: { items: { type: "string" } } }],
    else: { items: { type: "boolean" } },
    unevaluatedItems: false,
  };

  const partial: Schema = {
    type: "array",
    if: { minItems: 3 },
    then: {
      prefixItems: [
        { type: "integer" },
        { type: "integer" },
        { type: "integer" },
      ],
    },
    elseIf: [
      { if: { minItems: 1 }, then: { prefixItems: [{ type: "integer" }] } },
    ],
    unevaluatedItems: false,
  };

  it("passes when the winning branch evaluates every item", () => {
    const v = compile(covered, { allErrors: true });
    expect(run(v, [1, 2, 3, 4]).valid).toBe(true);
    expect(run(v, ["a", "b", "c"]).valid).toBe(true);
    expect(run(v, [true]).valid).toBe(true);
    expect(run(v, []).valid).toBe(true);
  });

  it("flags a trailing item the winning `then` left unevaluated", () => {
    const v = compile(partial, { allErrors: true });
    expect(run(v, [1, 2, 3]).valid).toBe(true);
    const { valid, errors } = run(v, [1, 2, 3, 4]);
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toContain("unevaluatedItems");
  });

  it("flags a trailing item a winning elseIf branch left unevaluated", () => {
    const v = compile(partial, { allErrors: true });
    expect(run(v, [1]).valid).toBe(true);
    const { valid, errors } = run(v, [1, 2]);
    expect(valid).toBe(false);
    expect(keywordsOf(errors)).toContain("unevaluatedItems");
  });
});

describe("elseIf - custom messages resolve for the winning branch", () => {
  const schema: Schema = {
    type: "integer",
    if: { minimum: 100 },
    then: {
      multipleOf: 10,
      errorMessage: { multipleOf: "large values must be multiples of 10" },
    },
    elseIf: [
      {
        if: { minimum: 10 },
        then: {
          multipleOf: 5,
          errorMessage: "mid values must be multiples of 5",
        },
      },
    ],
    else: {
      const: 0,
      errorMessage: { const: "small values must be exactly 0" },
    },
  };

  const validate = compile(schema, { allErrors: true, errorMessage: true });

  it("uses the `then` branch's keyword-targeted message", () => {
    const { valid, errors } = run(validate, 155);
    expect(valid).toBe(false);
    expect(errors[0].message).toBe("large values must be multiples of 10");
  });

  it("uses the elseIf branch's schema-level message", () => {
    const { valid, errors } = run(validate, 12);
    expect(valid).toBe(false);
    expect(errors[0].message).toBe("mid values must be multiples of 5");
  });

  it("uses the `else` branch's message", () => {
    const { valid, errors } = run(validate, 3);
    expect(valid).toBe(false);
    expect(errors[0].message).toBe("small values must be exactly 0");
  });
});

describe("elseIf - root level custom messages resolve for the winning branch", () => {
  const schema: Schema = {
    type: "integer",
    if: { minimum: 100 },
    then: {
      multipleOf: 10,
      errorMessage: { multipleOf: "large values must be multiples of 10" },
    },
    elseIf: [
      {
        if: { minimum: 10 },
        then: {
          multipleOf: 5,
          errorMessage: "mid values must be multiples of 5",
        },
      },
    ],
    else: {
      const: 0,
      errorMessage: { const: "small values must be exactly 0" },
    },
    errorMessage: {
      then: "large values must be multiples of 10",
      elseIf: [
        {
          then: "mid values must be multiples of 5",
        },
      ],
      else: {
        const: "small values must be exactly 0",
      },
    },
  };

  const validate = compile(schema, { allErrors: true, errorMessage: true });

  it("uses the `then` branch's keyword-targeted message", () => {
    const { valid, errors } = run(validate, 155);
    expect(valid).toBe(false);
    expect(errors[0].message).toBe("large values must be multiples of 10");
  });

  it("uses the elseIf branch's schema-level message", () => {
    const { valid, errors } = run(validate, 12);
    expect(valid).toBe(false);
    expect(errors[0].message).toBe("mid values must be multiples of 5");
  });

  it("uses the `else` branch's message", () => {
    const { valid, errors } = run(validate, 3);
    expect(valid).toBe(false);
    expect(errors[0].message).toBe("small values must be exactly 0");
  });
});

const countKeyword = (errors: Array<Record<string, unknown>>, kw: string) =>
  errors.filter((e) => e.keyword === kw).length;

describe("elseIf — a failed `if` predicate rolls back the properties it evaluated", () => {
  const schema: Schema = {
    type: "object",
    properties: { tag: { type: "string" } },
    if: {
      required: ["ga"],
      properties: { ga: {}, i1: {}, i2: {} },
    },
    then: {},
    elseIf: [
      {
        if: {
          required: ["gb"],
          properties: { gb: {}, j1: {}, j2: {} },
        },
        then: {},
      },
    ],
    else: {},
    unevaluatedProperties: false,
  };

  const validate = compile(schema, { allErrors: false });

  it("keeps the props when the `if` matches (they count as evaluated)", () => {
    const data = { tag: "t", ga: true, i1: 1, i2: 2 };
    expect(run(validate, data).valid).toBe(true);
  });

  it("rolls back every property the `if` evaluated when the `if` fails", () => {
    const data = { tag: "t", i1: 1, i2: 2 };
    const { valid, errors } = run(validate, data);

    expect(valid).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].keyword).toBe("unevaluatedProperties");
  });

  it("rolls back the failed `if`'s props even when a later branch matches", () => {
    const data = { tag: "t", i1: 1, i2: 2, gb: true, j1: 3, j2: 4 };
    const { valid, errors } = run(validate, data);

    expect(valid).toBe(false);
    expect(errors[0].keyword).toBe("unevaluatedProperties");

    const flagged = errors[0].dataPath;
    expect(flagged).toContain("");
  });

  it("rolls back a failed elseIf predicate's props too", () => {
    const data = { tag: "t", j1: 3, j2: 4 };
    const { valid, errors } = run(validate, data);

    expect(valid).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].keyword).toBe("unevaluatedProperties");
  });
});
