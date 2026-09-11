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
  return new JetValidator({ strict: false, ...opts });
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
  expect(projected.length, "error count mismatch" + /*dump*/ "").toBe(
    expected.length,
  );
  expected.forEach((exp, i) => {
    const got = projected[i];
    expect(got.keyword, `pos ${i} keyword`).toBe(exp.keyword);
    if (exp.dataPath !== undefined)
      expect(got.dataPath, `pos ${i} dataPath`).toBe(exp.dataPath);
    if (exp.schemaPath !== undefined)
      expect(got.schemaPath, `pos ${i} schemaPath`).toBe(exp.schemaPath);
  });
}

function runCorpus(cases: Case[]) {
  for (const c of cases) {
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
              const errors = [...(validate.errors ?? [])];

              expect(result, c.description).toBe(sample.valid);

              if (sample.valid) {
                expect(errors, "valid data must clear errors").toHaveLength(0);
                return;
              }

              const expected =
                mode === "allErrors" ? sample.allErrors : sample.failFast;
              if (expected) matchErrors(errors, expected);
            });
          });
        });
      }
    });
  }
}

const corpus: Case[] = [
  {
    id: "not-anyof-predicate-suppression",
    description:
      "not{anyOf}: predicate must suppress ALL branch errors. Bug: allErrors detection via error-count marked every branch valid.",
    schema: { not: { anyOf: [{ type: "string" }, { type: "number" }] } },
    samples: [
      { data: true, valid: true },
      {
        data: "hi",
        valid: false,
        allErrors: [{ keyword: "not", schemaPath: "#" }],
        failFast: [{ keyword: "not", schemaPath: "#" }],
      },
      {
        data: 5,
        valid: false,
        allErrors: [{ keyword: "not", schemaPath: "#" }],
        failFast: [{ keyword: "not", schemaPath: "#" }],
      },
    ],
  },

  {
    id: "anyof-collect-then-abandon",
    description:
      "anyOf: failed branch errors must be abandoned when a later branch matches (no leak).",
    schema: { anyOf: [{ type: "string", minLength: 9 }, { type: "number" }] },
    samples: [
      { data: 5, valid: true },
      { data: "long enough", valid: true },
      {
        data: true,
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#" },
        ],
        failFast: [
          { keyword: "type", schemaPath: "#/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "oneof-multi-match",
    description:
      "oneOf: matching >1 branch must fail (the case anyOf can't test).",
    schema: { oneOf: [{ type: "integer" }, { type: "number", minimum: 0 }] },
    samples: [
      {
        data: 5,
        valid: false,
        allErrors: [{ keyword: "oneOf", schemaPath: "#" }],
        failFast: [{ keyword: "oneOf", schemaPath: "#" }],
      },
      { data: -3, valid: true },
      { data: 2.5, valid: true },
      {
        data: -1.5,
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/oneOf/0" },
          { keyword: "minimum", schemaPath: "#/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#" },
        ],
        failFast: [
          { keyword: "type", schemaPath: "#/oneOf/0" },
          { keyword: "minimum", schemaPath: "#/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "ref-recursion-no-crosscall-corruption",
    description:
      "recursive $ref: fn.errors is a one-statement handoff; nested calls must not clobber. Two-level nesting.",
    schema: {
      type: "object",
      required: ["billing"],
      properties: {
        billing: { $ref: "#/$defs/address" },
        shipping: { $ref: "#/$defs/address" },
      },
      $defs: {
        address: {
          type: "object",
          required: ["street", "zip"],
          properties: {
            street: { type: "string" },
            zip: { type: "string", minLength: 5 },
            shipping: { $ref: "#/$defs/address" },
          },
        },
      },
    },
    samples: [
      { data: { billing: { street: "Main", zip: "12345" } }, valid: true },
      {
        data: {
          billing: {
            street: "x",
            zip: "12345",
            shipping: { street: "y", zip: "1", shipping: { zip: "222222" } },
          },
        },
        valid: false,
        allErrors: [
          { keyword: "minLength", dataPath: "/billing/shipping/zip" },
          { keyword: "required", dataPath: "/billing/shipping/shipping" },
        ],
        failFast: [{ keyword: "minLength", dataPath: "/billing/shipping/zip" }],
      },
    ],
  },

  {
    id: "ref-under-anyof-rollback",
    description:
      "$ref inside anyOf branch: branch0 ref errors must be abandoned when branch1 matches.",
    schema: {
      type: "object",
      properties: {
        contact: {
          anyOf: [{ $ref: "#/$defs/email" }, { $ref: "#/$defs/phone" }],
        },
      },
      $defs: {
        email: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string", minLength: 5 } },
        },
        phone: {
          type: "object",
          required: ["phone"],
          properties: { phone: { type: "string", minLength: 7 } },
        },
      },
    },
    samples: [
      { data: { contact: { email: "a@b.co" } }, valid: true },
      { data: { contact: { phone: "5551234" } }, valid: true },
      {
        data: { contact: {} },
        valid: false,
        //ref ws inlined
        allErrors: [
          { keyword: "required", schemaPath: "#/properties/contact/anyOf/0" },
          { keyword: "required", schemaPath: "#/properties/contact/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#/properties/contact" },
        ],
      },
    ],
  },

  {
    id: "not-wrapping-nested-anyof-both-modes",
    description:
      "not{ anyOf[ string+len+anyOf[obj,num], num ] }: reduces to reject-iff-number. Predicate through 2 levels.",
    schema: {
      not: {
        anyOf: [
          {
            type: "string",
            minLength: 9,
            maxLength: 20,
            anyOf: [{ type: "object", minProperties: 9 }, { type: "number" }],
          },
          { type: "number" },
        ],
      },
    },
    samples: [
      {
        data: 5,
        valid: false,
        allErrors: [{ keyword: "not", schemaPath: "#" }],
        failFast: [{ keyword: "not", schemaPath: "#" }],
      },
      { data: "hello world!", valid: true },
      {
        data: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 },
        valid: true,
      },
    ],
  },

  {
    id: "not-oneof-of-anyofs",
    description:
      "not{ oneOf[ anyOf[...], anyOf[...] ] } - predicate through not→oneOf→anyOf (3 levels). No error may be pushed except the final 'not'.",
    schema: {
      not: {
        oneOf: [
          { anyOf: [{ type: "string" }, { type: "boolean" }] },
          { anyOf: [{ type: "number" }, { type: "null" }] },
        ],
      },
    },
    samples: [
      {
        data: "hi",
        valid: false,
        allErrors: [{ keyword: "not", schemaPath: "#" }],
        failFast: [{ keyword: "not", schemaPath: "#" }],
      },

      { data: {}, valid: true },

      {
        data: 5,
        valid: false,
        allErrors: [{ keyword: "not", schemaPath: "#" }],
        failFast: [{ keyword: "not", schemaPath: "#" }],
      },
    ],
  },

  {
    id: "oneof-inside-not-inside-anyof",
    description:
      "anyOf[ not{ oneOf[...] }, {type:integer} ] - predicate only on the not-branch, sibling branch emits normally.",
    schema: {
      anyOf: [
        { not: { oneOf: [{ type: "string" }, { const: "x" }] } },
        { type: "integer" },
      ],
    },
    samples: [
      { data: "x", valid: true },

      {
        data: "hello",
        valid: false,
        allErrors: [
          { keyword: "not", schemaPath: "#/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", dataPath: "", schemaPath: "#" },
        ],
      },

      { data: 7, valid: true },
    ],
  },

  {
    id: "ref-to-anyof-of-refs",
    description:
      "$ref whose target is anyOf of two other $refs - errorVar threads root→ref→anyOf→ref. Two hops of fold.",
    schema: {
      $ref: "#/$defs/either",
      $defs: {
        either: { anyOf: [{ $ref: "#/$defs/a" }, { $ref: "#/$defs/b" }] },
        a: {
          type: "object",
          required: ["a"],
          properties: { a: { type: "integer" } },
        },
        b: {
          type: "object",
          required: ["b"],
          properties: { b: { type: "string", minLength: 3 } },
        },
      },
    },
    samples: [
      { data: { a: 5 }, valid: true },
      { data: { b: "xyz" }, valid: true },

      {
        data: {},
        valid: false,
        // ref was inlined
        allErrors: [
          { keyword: "required", dataPath: "", schemaPath: "#/anyOf/0" },
          { keyword: "required", dataPath: "", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", dataPath: "", schemaPath: "#" },
        ],
      },

      {
        data: { b: "x" },
        valid: false,
        //ref was inlined
        allErrors: [
          { keyword: "required", schemaPath: "#/anyOf/0" },
          { keyword: "minLength", schemaPath: "#/anyOf/1/properties/b" },
          { keyword: "anyOf", dataPath: "", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "recursive-ref-under-oneof",
    description:
      "recursive tree where each node is oneOf[leaf, branch]; branch recurses. Tests fn.errors handoff + oneOf count together, deep.",
    schema: {
      $ref: "#/$defs/node",
      $defs: {
        node: {
          type: "object",
          oneOf: [
            { required: ["leaf"], properties: { leaf: { type: "integer" } } },
            {
              required: ["child"],
              properties: { child: { $ref: "#/$defs/node" } },
            },
          ],
        },
      },
    },
    samples: [
      { data: { leaf: 1 }, valid: true },
      { data: { child: { leaf: 2 } }, valid: true },
      { data: { child: { child: { leaf: 3 } } }, valid: true },

      {
        data: { leaf: 1, child: { leaf: 2 } },
        valid: false,
        allErrors: [{ keyword: "oneOf", schemaPath: "#/$defs/node" }],
      },

      {
        data: { child: { child: {} } },
        valid: false,
        allErrors: [
          { keyword: "required", schemaPath: "#/$defs/node/oneOf/0" },
          { keyword: "required", schemaPath: "#/$defs/node/oneOf/0" },
          { keyword: "required", schemaPath: "#/$defs/node/oneOf/0" },
          { keyword: "required", schemaPath: "#/$defs/node/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#/$defs/node" },
          { keyword: "oneOf", schemaPath: "#/$defs/node" },
          { keyword: "oneOf", schemaPath: "#/$defs/node" },
        ],
      },
    ],
  },

  {
    id: "if-anyof-then-oneof",
    description:
      "if{anyOf} then{oneOf} else{not} - 'if' predicate, 'then'/'else' emit normally.",
    schema: {
      if: { anyOf: [{ type: "integer" }, { type: "boolean" }] },
      then: { oneOf: [{ const: 1 }, { const: true }] },
      else: { not: { type: "string" } },
    },
    samples: [
      { data: 1, valid: true },

      { data: true, valid: true },

      {
        data: 5,
        valid: false,
        allErrors: [
          { keyword: "const", schemaPath: "#/then/oneOf/0" },
          { keyword: "const", schemaPath: "#/then/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#/then" },
        ],
      },

      {
        data: "s",
        valid: false,
        allErrors: [{ keyword: "not", schemaPath: "#/else" }],
      },

      { data: 2.5, valid: true },
    ],
  },

  {
    id: "nested-if-in-then",
    description:
      "if/then where then itself contains if/then/else - conditional nesting, extra threads through both then-blocks.",
    schema: {
      if: { type: "object", required: ["kind"] },
      then: {
        if: { properties: { kind: { const: "num" } }, required: ["kind"] },
        then: {
          required: ["value"],
          properties: { value: { type: "number" } },
        },
        else: {
          required: ["value"],
          properties: { value: { type: "string" } },
        },
      },
    },
    samples: [
      { data: { kind: "num", value: 5 }, valid: true },
      { data: { kind: "str", value: "hi" }, valid: true },

      {
        data: { kind: "num", value: "hi" },
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/then/then/properties/value" },
        ],
      },

      { data: { other: 1 }, valid: true },
    ],
  },

  {
    id: "unevaluated-props-anyof-rollback",
    description:
      "unevaluatedProperties:false with anyOf branches that evaluate different props. A failed branch must NOT leave its props marked evaluated.",
    schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      anyOf: [
        {
          properties: { a: { type: "string", maxLength: 5 } },
          required: ["a"],
        },
        { properties: { b: { type: "string" } }, required: ["b"] },
      ],
      unevaluatedProperties: false,
    },
    samples: [
      // has id + a: branch0 matches (evaluates a), branch1 fails. 'a' stays evaluated, 'id' evaluated. VALID.
      { data: { id: 1, a: "x" }, valid: true },
      // has id + b: branch0 fails (no a) and must ROLL BACK - but branch0 doesn't evaluate b anyway.
      //   branch1 matches, evaluates b. VALID.
      { data: { id: 1, b: "y" }, valid: true },

      // rollback - anyOf branch failed
      {
        data: { id: 1, a: "xxxxxx" },
        valid: false,
        allErrors: [
          { keyword: "maxLength", schemaPath: "#/anyOf/0/properties/a" },
          { keyword: "required", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#" },
          {
            keyword: "unevaluatedProperties",
            schemaPath: "#/unevaluatedProperties",
          },
        ],
      },

      {
        data: { id: 1, a: "x", c: "z" },
        valid: false,
        allErrors: [
          {
            keyword: "unevaluatedProperties",
            schemaPath: "#/unevaluatedProperties",
          },
        ],
      },

      {
        data: { id: 1 },
        valid: false,
        allErrors: [
          { keyword: "required", schemaPath: "#/anyOf/0" },
          { keyword: "required", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "unevaluated-items-contains",
    description:
      "unevaluatedItems:false + contains - items matched by contains are evaluated; others aren't.",
    schema: {
      type: "array",
      prefixItems: [{ type: "integer" }],
      contains: { type: "string" },
      unevaluatedItems: false,
    },
    samples: [
      { data: [1, "a"], valid: true },

      {
        data: [1, "a", 2],
        valid: false,
        allErrors: [
          { keyword: "unevaluatedItems", schemaPath: "#/unevaluatedItems" },
        ],
      },

      {
        data: [1],
        valid: false,
        allErrors: [{ keyword: "contains", schemaPath: "#" }],
      },
    ],
  },

  {
    id: "contains-minmax-in-not",
    description:
      "not{ contains w/ minContains:2 } - predicate over a counting keyword.",
    schema: {
      not: { type: "array", contains: { type: "integer" }, minContains: 2 },
    },
    samples: [
      {
        data: [1, 2, 3],
        valid: false,
        allErrors: [{ keyword: "not", schemaPath: "#" }],
      },

      { data: [1], valid: true },

      { data: ["a", "b"], valid: true },
    ],
  },

  {
    id: "kitchen-sink",
    description:
      "oneOf at root, one branch is allOf[ref, if/then], other is not{anyOf}. Max interaction surface.",
    schema: {
      oneOf: [
        {
          allOf: [
            { $ref: "#/$defs/positiveInt" },
            { if: { type: "integer" }, then: { maximum: 100 } },
          ],
        },
        { not: { anyOf: [{ type: "integer" }, { type: "string" }] } },
      ],
      $defs: {
        positiveInt: { type: "integer", minimum: 1 },
      },
    },
    samples: [
      { data: 50, valid: true },

      {
        data: 200,
        valid: false,
        allErrors: [
          { keyword: "maximum", schemaPath: "#/oneOf/0/allOf/1/then" },
          { keyword: "not", schemaPath: "#/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#" },
        ],
      },

      { data: true, valid: true },

      {
        data: "hi",
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/oneOf/0/allOf/0" },
          { keyword: "not", schemaPath: "#/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "anyof-sibling-keep-vs-rollback",
    description:
      "Two anyOf under allOf. First fails (kept); second fails-then-matches (rolled back). Second's mark must start after the first's kept errors.",
    schema: {
      allOf: [
        { anyOf: [{ type: "string" }, { type: "boolean" }] },
        { anyOf: [{ type: "string" }, { type: "number" }] },
      ],
    },
    samples: [
      { data: "x", valid: true },
      {
        data: 5,
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/allOf/0/anyOf/0" },
          { keyword: "type", schemaPath: "#/allOf/0/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#/allOf/0" },
        ],
        failFast: [
          { keyword: "type", schemaPath: "#/allOf/0/anyOf/0" },
          { keyword: "type", schemaPath: "#/allOf/0/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#/allOf/0" },
        ],
      },
    ],
  },

  {
    id: "anyof-late-branch-match-after-many-fails",
    description:
      "5-branch anyOf, only last matches → all prior pushes truncate back. Invalid case: all 5 fail, exact order.",
    schema: {
      anyOf: [
        { type: "string" },
        { type: "boolean" },
        { type: "null" },
        { type: "array" },
        { type: "integer" },
      ],
    },
    samples: [
      { data: 7, valid: true },
      {
        data: 2.5,
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/1" },
          { keyword: "type", schemaPath: "#/anyOf/2" },
          { keyword: "type", schemaPath: "#/anyOf/3" },
          { keyword: "type", schemaPath: "#/anyOf/4" },
          { keyword: "anyOf", schemaPath: "#" },
        ],
        failFast: [
          { keyword: "type", schemaPath: "#/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/1" },
          { keyword: "type", schemaPath: "#/anyOf/2" },
          { keyword: "type", schemaPath: "#/anyOf/3" },
          { keyword: "type", schemaPath: "#/anyOf/4" },
          { keyword: "anyOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "nested-anyof-inner-match-outer-fail",
    description:
      "anyOf[ anyOf[str,num], bool ]. Inner anyOf error nests before outer branch1, outer anyOf last.",
    schema: {
      anyOf: [
        { anyOf: [{ type: "string" }, { type: "number" }] },
        { type: "boolean" },
      ],
    },
    samples: [
      { data: "s", valid: true },
      { data: 3, valid: true },
      { data: true, valid: true },
      {
        data: null,
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/anyOf/0/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/0/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#" },
        ],
        failFast: [
          { keyword: "type", schemaPath: "#/anyOf/0/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/0/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "oneof-secondmatch-shortcircuit",
    description:
      "oneOf, branch0+branch1 both match → fail on count; branch2 (would push) must not be reached. Only oneOf error.",
    schema: {
      oneOf: [
        { type: "integer" },
        { type: "number" },
        { type: "string", minLength: 99 },
      ],
    },
    samples: [
      {
        data: 5,
        valid: false,
        allErrors: [{ keyword: "oneOf", schemaPath: "#" }],
        failFast: [{ keyword: "oneOf", schemaPath: "#" }],
      },
      { data: 2.5, valid: true },
      {
        data: "s",
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/oneOf/0" },
          { keyword: "type", schemaPath: "#/oneOf/1" },
          { keyword: "minLength", schemaPath: "#/oneOf/2" },
          { keyword: "oneOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "oneof-inside-anyof-mixed-rollback",
    description:
      "anyOf[ oneOf[int, num>=0], bool ]. data:true → oneOf fails+pushes, bool matches → rollback, valid. data:5 → oneOf count 2 fails, bool fails → invalid. data:-1.5 → full nested failure.",
    schema: {
      anyOf: [
        { oneOf: [{ type: "integer" }, { type: "number", minimum: 0 }] },
        { type: "boolean" },
      ],
    },
    samples: [
      {
        data: 5,
        valid: false,
        allErrors: [
          { keyword: "oneOf", schemaPath: "#/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#" },
        ],
      },
      { data: 2.5, valid: true },
      { data: true, valid: true },
      {
        data: -1.5,
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/anyOf/0/oneOf/0" },
          { keyword: "minimum", schemaPath: "#/anyOf/0/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#/anyOf/0" },
          { keyword: "type", schemaPath: "#/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "deep-not-anyof-oneof-anyof",
    description:
      "not{ anyOf[ oneOf[ anyOf[str,num], const5 ], bool ] } — 4-level predicate, only final 'not' may emit.",
    schema: {
      not: {
        anyOf: [
          {
            oneOf: [
              { anyOf: [{ type: "string" }, { type: "number" }] },
              { const: 5 },
            ],
          },
          { type: "boolean" },
        ],
      },
    },
    samples: [
      { data: {}, valid: true },
      {
        data: "hi",
        valid: false,
        allErrors: [{ keyword: "not", schemaPath: "#" }],
        failFast: [{ keyword: "not", schemaPath: "#" }],
      },
      { data: 5, valid: true },
      {
        data: true,
        valid: false,
        allErrors: [{ keyword: "not", schemaPath: "#" }],
        failFast: [{ keyword: "not", schemaPath: "#" }],
      },
    ],
  },

  {
    id: "if-predicate-absolute-silence",
    description:
      "if:{ anyOf[ oneOf[...], not{...} ] } — condition fails deeply, but zero condition errors may leak; only else/then emit.",
    schema: {
      if: {
        anyOf: [
          { oneOf: [{ type: "string" }, { const: "x" }] },
          { not: { type: "number" } },
        ],
      },
      then: { const: "unreachable" },
      else: { type: "boolean" },
    },
    samples: [
      {
        data: 5,
        valid: false,
        allErrors: [{ keyword: "type", schemaPath: "#/else" }],
        failFast: [{ keyword: "type", schemaPath: "#/else" }],
      },
      {
        data: true,
        valid: false,
        allErrors: [{ keyword: "const", schemaPath: "#/then" }],
      },
    ],
  },

  {
    id: "recursive-ref-anyof-deep-rollback",
    description:
      "node = anyOf[ int, {children: node[]} ]. Deep tree, one bad leaf → that node's anyOf keeps errors, siblings roll back.",
    schema: {
      $ref: "#/$defs/node",
      $defs: {
        node: {
          anyOf: [
            { type: "integer" },
            {
              type: "object",
              required: ["children"],
              properties: {
                children: { type: "array", items: { $ref: "#/$defs/node" } },
              },
            },
          ],
        },
      },
    },

    samples: [
      { data: 1, valid: true },
      { data: { children: [1, 2, 3] }, valid: true },
      { data: { children: [1, { children: [2] }, 3] }, valid: true },
      {
        data: { children: [1, { children: ["bad"] }] },
        valid: false,
        allErrors: [
          { keyword: "type", dataPath: "" },
          { keyword: "type", dataPath: "/children/1" },
          { keyword: "type", dataPath: "/children/1/children/0" },
          { keyword: "type", dataPath: "/children/1/children/0" },
          { keyword: "anyOf", dataPath: "/children/1/children/0" },
          { keyword: "anyOf", dataPath: "/children/1" },
          { keyword: "anyOf", dataPath: "" },
        ],
      },
    ],
  },
  {
    id: "nested-oneof-in-oneof",
    description:
      "oneOf[ oneOf[int, str], bool ]. Inner oneOf's count semantics nest. data:5 → inner oneOf matches (int only) → outer branch0 matches; bool fails → outer count 1 → VALID. data:true → outer branch1 matches, branch0 inner oneOf fails(0 match) → count 1 → VALID. data:2.5 → inner oneOf 0-match fail, bool fail → outer 0 → fail, full nested errors.",
    schema: {
      oneOf: [
        { oneOf: [{ type: "integer" }, { type: "string" }] },
        { type: "boolean" },
      ],
    },
    samples: [
      { data: 5, valid: true },
      { data: "s", valid: true },
      { data: true, valid: true },
      {
        data: 2.5,
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/oneOf/0/oneOf/0" },
          { keyword: "type", schemaPath: "#/oneOf/0/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#/oneOf/0" },
          { keyword: "type", schemaPath: "#/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "nested-oneof-double-inner-match",
    description:
      "oneOf[ oneOf[int, num>=0], str ]. data:5 → INNER oneOf: int match AND num>=0 match → inner count 2 → inner FAILS → outer branch0 fails; str fails → outer 0 → invalid. Verifies inner oneOf's >1 count propagates as a branch failure, and the inner oneOf error nests before outer's.",
    schema: {
      oneOf: [
        { oneOf: [{ type: "integer" }, { type: "number", minimum: 0 }] },
        { type: "string" },
      ],
    },
    samples: [
      { data: -2, valid: true }, // inner: int match, num>=0 fail → count 1 → branch0 match; str fail → outer count 1 → valid
      { data: "hi", valid: true },
      {
        data: 5,
        valid: false,
        allErrors: [
          { keyword: "oneOf", schemaPath: "#/oneOf/0" },
          { keyword: "type", schemaPath: "#/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#" },
        ],
      },
    ],
  },

  {
    id: "anyof-inside-oneof",
    description:
      "oneOf[ anyOf[int, str], bool ]. anyOf pushes into oneOf's buffer. data:5 → anyOf matches(int) → outer branch0 matches; bool fail → count 1 → VALID (anyOf's speculative errors must roll back). data:{} → anyOf both fail (keep), bool fail → outer 0 → invalid, anyOf errors nest before oneOf.",
    schema: {
      oneOf: [
        { anyOf: [{ type: "integer" }, { type: "string" }] },
        { type: "boolean" },
      ],
    },
    samples: [
      { data: 5, valid: true },
      { data: "s", valid: true },
      { data: true, valid: true },
      {
        data: {},
        valid: false,
        allErrors: [
          { keyword: "type", schemaPath: "#/oneOf/0/anyOf/0" },
          { keyword: "type", schemaPath: "#/oneOf/0/anyOf/1" },
          { keyword: "anyOf", schemaPath: "#/oneOf/0" },
          { keyword: "type", schemaPath: "#/oneOf/1" },
          { keyword: "oneOf", schemaPath: "#" },
        ],
      },
    ],
  },
];

runCorpus(corpus);
