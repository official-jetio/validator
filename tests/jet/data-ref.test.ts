import { describe, it, expect } from "vitest";
import { JetValidator, SchemaDefinition } from "../../src";

function makeValidator(opts: Record<string, unknown> = {}) {
  return new JetValidator({
    allErrors: false,
    strict: false,
    $data: true,
    ...opts,
  });
}

describe("$data - relative sibling reference (1/… climb)", () => {
  const schema = {
    type: "object",
    properties: {
      limit: { type: "number" },
      value: { type: "string", maxLength: { $data: "1/limit" } },
    },
  } as SchemaDefinition;

  it("passes when the sibling-driven constraint is satisfied", () => {
    const validate = makeValidator().compile(schema);
    expect(validate({ limit: 5, value: "abcd" })).toBe(true);
    expect(validate({ limit: 5, value: "abcde" })).toBe(true);
  });

  it("fails when the sibling-driven constraint is exceeded", () => {
    const validate = makeValidator().compile(schema);
    expect(validate({ limit: 3, value: "abcd" })).toBe(false);
  });

  it("treats a missing $data target as no constraint (Ajv semantics)", () => {
    const validate = makeValidator().compile(schema);
    expect(validate({ value: "anything at all, quite long" })).toBe(true);
  });
});

describe("$data - two-level climb (2/…) across nesting", () => {
  const schema = {
    type: "object",
    properties: {
      cap: { type: "number" },
      outer: {
        type: "object",
        properties: {
          inner: { type: "string", maxLength: { $data: "2/cap" } },
        },
      },
    },
  } as SchemaDefinition;

  it("resolves the grandparent sibling and enforces it", () => {
    const validate = makeValidator().compile(schema);
    expect(validate({ cap: 4, outer: { inner: "abcd" } })).toBe(true);
    expect(validate({ cap: 2, outer: { inner: "abcd" } })).toBe(false);
  });
});

describe("$data - reference inside array items (climb to sibling of the array)", () => {
  const schema = {
    type: "object",
    properties: {
      max: { type: "number" },
      list: {
        type: "array",
        items: { type: "number", maximum: { $data: "2/max" } },
      },
    },
  } as SchemaDefinition;

  it("applies the same sibling constraint to every element", () => {
    const validate = makeValidator().compile(schema);
    expect(validate({ max: 10, list: [1, 5, 10] })).toBe(true);
    expect(validate({ max: 10, list: [1, 11, 3] })).toBe(false);
  });

  it("holds across differing array lengths", () => {
    const validate = makeValidator().compile(schema);
    expect(validate({ max: 2, list: [] })).toBe(true);
    expect(validate({ max: 2, list: [2, 2, 2, 2] })).toBe(true);
    expect(validate({ max: 2, list: [2, 3] })).toBe(false);
  });
});

describe("$data - over-climb bottoms out at root even when there's not enough levels", () => {
  const schema = {
    type: "object",
    properties: {
      rootCap: { type: "number" },
      a: {
        type: "object",
        properties: {
          b: {
            type: "object",
            properties: {
              c: { type: "string", maxLength: { $data: "5/rootCap" } },
            },
          },
        },
      },
    },
  } as SchemaDefinition;

  it("clamps an over-climb to the root and enforces the root field", () => {
    const validate = makeValidator().compile(schema);
    expect(validate({ rootCap: 3, a: { b: { c: "ab" } } })).toBe(true);
    expect(validate({ rootCap: 3, a: { b: { c: "abcd" } } })).toBe(false);
  });
});

describe("$data - pointer-encoded target keys (~1 and space)", () => {
  const slash = {
    type: "object",
    properties: {
      "a/b": { type: "number" },
      value: { type: "string", maxLength: { $data: "1/a~1b" } },
    },
  } as SchemaDefinition;

  const space = {
    type: "object",
    properties: {
      "max len": { type: "number" },
      value: { type: "string", maxLength: { $data: "1/max len" } },
    },
  } as SchemaDefinition;

  it("resolves a '/' key encoded as ~1", () => {
    const validate = makeValidator().compile(slash);
    expect(validate({ "a/b": 4, value: "abcd" })).toBe(true);
    expect(validate({ "a/b": 2, value: "abcd" })).toBe(false);
  });

  it("resolves a key containing a space", () => {
    const validate = makeValidator().compile(space);
    expect(validate({ "max len": 4, value: "abcd" })).toBe(true);
    expect(validate({ "max len": 2, value: "abcd" })).toBe(false);
  });
});

describe("$data - absolute pointer ignores current depth", () => {
  const schema = {
    type: "object",
    properties: {
      globalMax: { type: "number" },
      deep: {
        type: "object",
        properties: {
          deeper: {
            type: "object",
            properties: {
              leaf: { type: "number", maximum: { $data: "/globalMax" } },
            },
          },
        },
      },
    },
  } as SchemaDefinition;

  it("reads the root field from an arbitrarily deep position", () => {
    const validate = makeValidator().compile(schema);
    expect(validate({ globalMax: 100, deep: { deeper: { leaf: 50 } } })).toBe(
      true,
    );
    expect(validate({ globalMax: 100, deep: { deeper: { leaf: 150 } } })).toBe(
      false,
    );
  });
});

describe("$data - runtime/standalone parity for a $data schema", () => {
  const schema = {
    type: "object",
    properties: {
      limit: { type: "number" },
      value: { type: "string", maxLength: { $data: "1/limit" } },
    },
  } as SchemaDefinition;

  it("agrees on pass/fail across both compile paths", () => {
    const rt = makeValidator().compile(schema);

    const sa = makeValidator();
    const { code, functionName } = sa.generateStandalone(schema as any);
    const emitted = new Function(`${code}\n;return ${functionName};`)() as (
      d: any,
    ) => any;

    for (const data of [
      { limit: 5, value: "abcd" },
      { limit: 3, value: "abcd" },
      { limit: 4, value: "abcd" },
      { value: "no limit present" },
    ]) {
      expect(emitted(data)).toBe(rt(data));
    }
  });
});
