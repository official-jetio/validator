import { describe, it, expect } from "vitest";
import { JetValidator, SchemaDefinition } from "../../src";

type CompiledValidate = ((data: unknown) => boolean) & {
  errors?: Array<Record<string, unknown>> | null;
};

interface ErrorExpectation {
  keyword: string;
  dataPath?: string;
  schemaPath?: string;
}

interface Sample {
  data: unknown;
  valid: boolean;
  allErrors?: ErrorExpectation[];
  failFast?: ErrorExpectation[];
}

interface Case {
  id: string;
  description: string;
  schema: SchemaDefinition;
  samples: Sample[];
}

function makeValidator(opts: Record<string, unknown> = {}) {
  return new JetValidator({
    strict: false,
    $data: true,
    ...opts,
  });
}

function projectError(e: Record<string, unknown>) {
  return {
    keyword: e.keyword,
    dataPath: e.dataPath,
    schemaPath: e.schemaPath,
  };
}

function matchErrors(
  actual: Array<Record<string, unknown>>,
  expected: ErrorExpectation[],
) {
  const projected = actual.map(projectError);

  const dump = () =>
    "\nexpected (" +
    expected.length +
    "):\n" +
    expected.map((e) => "  " + JSON.stringify(e)).join("\n") +
    "\nactual (" +
    projected.length +
    "):\n" +
    projected.map((e) => "  " + JSON.stringify(e)).join("\n");

  expect(projected.length, "error count mismatch" + dump()).toBe(
    expected.length,
  );

  const remaining = [...projected];
  for (const exp of expected) {
    const idx = remaining.findIndex(
      (got) =>
        got.keyword === exp.keyword &&
        (exp.dataPath === undefined || got.dataPath === exp.dataPath) &&
        (exp.schemaPath === undefined || got.schemaPath === exp.schemaPath),
    );
    expect(
      idx,
      "no actual error matched " + JSON.stringify(exp) + dump(),
    ).not.toBe(-1);
    remaining.splice(idx, 1);
  }
}

function runCase(c: Case) {
  describe(c.id, () => {
    for (const mode of ["allErrors", "failFast"] as const) {
      describe(mode, () => {
        const validate = makeValidator({
          allErrors: mode === "allErrors",
        }).compile(c.schema) as CompiledValidate;

        c.samples.forEach((sample, i) => {
          it(`sample ${i} (${sample.valid ? "valid" : "invalid"})`, () => {
            validate.errors = [];
            const result = validate(sample.data);
            expect(result, c.description).toBe(sample.valid);

            if (sample.valid) {
              expect(
                validate.errors ?? [],
                "valid data must clear errors",
              ).toHaveLength(0);
              return;
            }

            const expected =
              mode === "allErrors" ? sample.allErrors : sample.failFast;
            if (expected) matchErrors(validate.errors ?? [], expected);
          });
        });
      });
    }
  });
}

runCase({
  id: "data-ref-everything",
  description:
    "$data across every keyword family: number bounds, string len, pattern, const, enum, multipleOf, required, property/item counts, uniqueItems, min/maxContains. All comparison values pulled from sibling data.",
  schema: {
    type: "object",
    properties: {
      limit: { type: "integer" },
      floor: { type: "integer" },
      exFloor: { type: "integer" },
      exCap: { type: "integer" },
      step: { type: "number" },
      minLen: { type: "integer" },
      maxLen: { type: "integer" },
      pat: { type: "string" },
      expected: {},
      allowed: { type: "array" },
      reqList: { type: "array" },
      minProps: { type: "integer" },
      maxProps: { type: "integer" },
      minCount: { type: "integer" },
      maxCount: { type: "integer" },

      value: { maximum: { $data: "1/limit" }, minimum: { $data: "1/floor" } },
      exValue: {
        exclusiveMinimum: { $data: "1/exFloor" },
        exclusiveMaximum: { $data: "1/exCap" },
      },
      multiple: { multipleOf: { $data: "1/step" } },
      word: {
        type: "string",
        minLength: { $data: "1/minLen" },
        maxLength: { $data: "1/maxLen" },
        pattern: { $data: "1/pat" },
      },
      matchConst: { const: { $data: "1/expected" } },
      matchEnum: { enum: { $data: "1/allowed" } },
      obj: {
        type: "object",
        required: { $data: "1/reqList" },
        minProperties: { $data: "1/minProps" },
        maxProperties: { $data: "1/maxProps" },
      },
      list: {
        type: "array",
        contains: { type: "integer" },
        minContains: { $data: "1/minCount" },
        maxContains: { $data: "1/maxCount" },
      },
      uniq: { type: "array", uniqueItems: { $data: "1/needUnique" } },
      needUnique: { type: "boolean" },
    },
  },
  samples: [
    {
      data: {
        limit: 10,
        floor: 0,
        exFloor: 0,
        exCap: 10,
        step: 5,
        minLen: 2,
        maxLen: 6,
        pat: "^a",
        expected: { tag: "x" },
        allowed: ["red", "green"],
        reqList: ["a", "b"],
        minProps: 1,
        maxProps: 4,
        minCount: 1,
        maxCount: 3,
        needUnique: true,
        value: 5,
        exValue: 5,
        multiple: 15,
        word: "abcd",
        matchConst: { tag: "x" },
        matchEnum: "green",
        obj: { a: 1, b: 2 },
        list: [1, 2, "skip"],
        uniq: [1, 2, 3],
      },
      valid: true,
    },
    {
      data: {
        limit: 10,
        floor: 0,
        exFloor: 0,
        exCap: 10,
        step: 5,
        minLen: 2,
        maxLen: 6,
        pat: "^a",
        expected: { tag: "x" },
        allowed: ["red", "green"],
        reqList: ["a", "b"],
        minProps: 2,
        maxProps: 3,
        minCount: 2,
        maxCount: 3,
        needUnique: true,
        value: 11, // error
        exValue: 0, // error
        multiple: 12, // error
        word: "zzzzzzz", // 2 errors
        matchConst: { tag: "y" }, // error
        matchEnum: "blue", // error
        obj: { a: 1 }, // 2 error
        list: ["only", "strings"], // 2 error
        uniq: [1, 1, 2], // error
      },
      valid: false,
      allErrors: [
        { keyword: "maximum", dataPath: "/value" },
        { keyword: "exclusiveMinimum", dataPath: "/exValue" },
        { keyword: "multipleOf", dataPath: "/multiple" },
        { keyword: "maxLength", dataPath: "/word" },
        { keyword: "pattern", dataPath: "/word" },
        { keyword: "const", dataPath: "/matchConst" },
        { keyword: "enum", dataPath: "/matchEnum" },
        { keyword: "required", dataPath: "/obj" },
        { keyword: "minProperties", dataPath: "/obj" },
        { keyword: "minContains", dataPath: "/list" },
        { keyword: "uniqueItems", dataPath: "/uniq" },
      ],
      failFast: [{ keyword: "maximum", dataPath: "/value" }],
    },
  ],
});

runCase({
  id: "data-ref-missing-pointer-ignored",
  description:
    "$data pointer resolving to undefined: keyword is skipped (guard's typeof/Array.isArray check fails), value passes.",
  schema: {
    type: "object",
    properties: {
      cap: {},
      n: { maximum: { $data: "1/cap" } },
    },
  },
  samples: [{ data: { n: 9999 }, valid: true }],
});

runCase({
  id: "data-ref-wrong-type-ignored",
  description:
    "$data resolving to a non-number for a numeric keyword must be ignored, not coerced.",
  schema: {
    type: "object",
    properties: {
      cap: {},
      n: { maximum: { $data: "1/cap" } },
    },
  },
  samples: [
    { data: { cap: "not-a-number", n: 500 }, valid: true },
    {
      data: { cap: 3, n: 500 },
      valid: false,
      failFast: [{ keyword: "maximum", dataPath: "/n" }],
    },
  ],
});

runCase({
  id: "data-ref-uniqueitems-false",
  description:
    "$data uniqueItems resolving to false must NOT enforce uniqueness; only true enforces.",
  schema: {
    type: "object",
    properties: {
      flag: { type: "boolean" },
      arr: { type: "array", uniqueItems: { $data: "1/flag" } },
    },
  },
  samples: [
    { data: { flag: false, arr: [1, 1, 1] }, valid: true },
    {
      data: { flag: true, arr: [1, 1, 1] },
      valid: false,
      failFast: [{ keyword: "uniqueItems", dataPath: "/arr" }],
    },
  ],
});

runCase({
  id: "data-ref-required-array",
  description:
    "$data required pulling the required-key list from data; guarded by Array.isArray.",
  schema: {
    type: "object",
    properties: {
      need: { type: "array" },
      need2: {},
      obj: { type: "object", required: { $data: "1/need" } },
      obj2: { type: "object", required: { $data: "1/need2" } },
    },
  },
  samples: [
    { data: { need: ["a", "b"], obj: { a: 1, b: 2 } }, valid: true },
    {
      data: { need: ["a", "b"], obj: { a: 1 } },
      valid: false,
      failFast: [{ keyword: "required", dataPath: "/obj" }],
    },
    {
      data: { need: "not-array", obj: {} },
      valid: false,
      failFast: [{ dataPath: "/need", keyword: "type" }],
    }, // need failed type array
    {
      data: { need2: ["a", "b"], obj2: { a: 1 } },
      valid: false,
      failFast: [{ keyword: "required", dataPath: "/obj2" }],
    },
    { data: { need2: "not-array", obj2: {} }, valid: true },
  ],
});

runCase({
  id: "data-ref-enum-empty-array",
  description:
    "$data enum resolving to an empty array: nothing can match -> enum fails for any value.",
  schema: {
    type: "object",
    properties: {
      opts: { type: "array" },
      pick: { enum: { $data: "1/opts" } },
    },
  },
  samples: [
    {
      data: { opts: [], pick: "anything" },
      valid: false,
      failFast: [{ keyword: "enum", dataPath: "/pick" }],
    },
    { data: { opts: ["anything"], pick: "anything" }, valid: true },
  ],
});

runCase({
  id: "data-ref-const-object-deep",
  description:
    "$data const against an object value must deep-equal, not reference-equal.",
  schema: {
    type: "object",
    properties: {
      golden: {},
      candidate: { const: { $data: "1/golden" } },
    },
  },
  samples: [
    {
      data: {
        golden: { a: [1, 2], b: { c: 3 } },
        candidate: { a: [1, 2], b: { c: 3 } },
      },
      valid: true,
    },
    {
      data: { golden: { a: [1, 2] }, candidate: { a: [1, 3] } },
      valid: false,
      failFast: [{ keyword: "const", dataPath: "/candidate" }],
    },
  ],
});

runCase({
  id: "data-ref-pattern-invalid-regex",
  description:
    "$data pattern resolving to an invalid regex must be swallowed by try/catch, not throw.",
  schema: {
    type: "object",
    properties: {
      rx: { type: "string" },
      s: { pattern: { $data: "1/rx" } },
    },
  },
  samples: [
    { data: { rx: "(unclosed", s: "whatever" }, valid: true },
    {
      data: { rx: "^a", s: "zzz" },
      valid: false,
      failFast: [{ keyword: "pattern", dataPath: "/s" }],
    },
  ],
});

runCase({
  id: "data-ref-maxcontains-large-break",
  description:
    "$data maxContains must resolve once (hoisted) and drive the loop break; malformed ref -> Infinity (never over-max).",
  schema: {
    type: "object",
    properties: {
      cap: {},
      list: {
        type: "array",
        contains: { type: "integer" },
        maxContains: { $data: "1/cap" },
      },
    },
  },
  samples: [
    {
      data: { cap: 2, list: [1, 2, 3] },
      valid: false,
      failFast: [{ keyword: "maxContains", dataPath: "/list" }],
    },
    { data: { cap: 5, list: [1, 2, 3] }, valid: true },
    { data: { cap: "bad", list: [1, 2, 3, 4, 5] }, valid: true },
  ],
});

runCase({
  id: "data-ref-absolute-pointer",
  description:
    "Absolute $data pointer (/root/...) resolves from document root, not relative to current.",
  schema: {
    type: "object",
    properties: {
      cap: { type: "integer" },
      nested: {
        type: "object",
        properties: {
          n: { maximum: { $data: "/cap" } },
        },
      },
    },
  },
  samples: [
    { data: { cap: 10, nested: { n: 5 } }, valid: true },
    {
      data: { cap: 10, nested: { n: 50 } },
      valid: false,
      failFast: [{ keyword: "maximum", dataPath: "/nested/n" }],
    },
  ],
});

runCase({
  id: "data-ref-under-anyof-rollback",
  description:
    "$data keyword inside an anyOf branch: when a sibling branch matches, the $data branch's errors AND its guard block must roll back cleanly (no leak, no brace imbalance on the $data path). UNVERIFIED: failFast keyword/schemaPath below is a hypothesis - if the strict matcher reds here, correct it against real output right in this block.",
  schema: {
    type: "object",
    properties: {
      cap: { type: "integer" },
      val: {
        anyOf: [
          { type: "integer", maximum: { $data: "2/cap" } },
          { type: "string", minLength: 3 },
        ],
      },
    },
  },
  samples: [
    { data: { cap: 10, val: "hello" }, valid: true },
    { data: { cap: 10, val: 5 }, valid: true },
    {
      data: { cap: 10, val: 50 },
      valid: false,
      allErrors: [
        { keyword: "maximum", schemaPath: "#/properties/val/anyOf/0" },
        { keyword: "type", schemaPath: "#/properties/val/anyOf/1" },
        { keyword: "anyOf", dataPath: "/val", schemaPath: "#/properties/val" },
      ],
      failFast: [
        { keyword: "maximum", schemaPath: "#/properties/val/anyOf/0" },
        { keyword: "type", schemaPath: "#/properties/val/anyOf/1" },
        { keyword: "anyOf", dataPath: "/val", schemaPath: "#/properties/val" },
      ],
    },
  ],
});

runCase({
  id: "data-ref-under-oneof-rollback",
  description:
    "$data keyword inside a oneOf branch: same rollback discipline as anyOf, but oneOf must evaluate all branches to detect 0-or-2+ matches, so the $data branch cannot be skipped. UNVERIFIED: the failFast expectation below is a hypothesis - correct it against real output right in this block if the strict matcher reds.",
  schema: {
    type: "object",
    properties: {
      cap: { type: "integer" },
      val: {
        oneOf: [
          { type: "integer", maximum: { $data: "1/cap" } },
          { type: "string", minLength: 3 },
        ],
      },
    },
  },
  samples: [
    { data: { cap: 10, val: "hello" }, valid: true },
    { data: { cap: 10, val: 5 }, valid: true },
    {
      data: { cap: 10, val: 50 },
      valid: false,
      allErrors: [
        { keyword: "maximum", schemaPath: "#/properties/val/oneOf/0" },
        { keyword: "type", schemaPath: "#/properties/val/oneOf/1" },
        { keyword: "oneOf", schemaPath: "#/properties/val" },
      ],
      failFast: [
        { keyword: "maximum", schemaPath: "#/properties/val/oneOf/0" },
        { keyword: "type", schemaPath: "#/properties/val/oneOf/1" },
        { keyword: "oneOf", schemaPath: "#/properties/val" },
      ],
    },
  ],
});
