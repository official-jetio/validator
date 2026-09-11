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
  const { code, functionName } = v.generateStandalone(schema, undefined, opts as any);
  const fn = new Function(`${code}\n;return ${functionName};`)();
  return fn as ((data: any) => any) & { errors?: any[] };
}

function projectErrors(errors: any[] | undefined) {
  return (errors ?? []).map((e) => ({
    keyword: e.keyword,
    message: e.message,
    schemaPath: e.schemaPath,
    dataPath: e.dataPath,
  }));
}

function parity(
  define: (v: JetValidator) => void,
  schema: SchemaDefinition,
  samples: any[],
  opts: Record<string, unknown> = {},
) {
  const rt = makeValidator(opts);
  define(rt);
  const runtime = rt.compile(schema, opts as any);

  const sa = makeValidator(opts);
  define(sa);
  const emitted = standalone(sa, schema, opts);

  for (const data of samples) {
    const label = `${JSON.stringify(data)} (allErrors=${!!opts.allErrors})`;
    const rResult = runtime(data);
    const eResult = emitted(data);
    expect(eResult, `return value for ${label}`).toEqual(rResult);
    expect(projectErrors(emitted.errors), `errors for ${label}`).toEqual(
      projectErrors(runtime.errors),
    );
  }

  return { runtime, emitted };
}

function parityBothModes(
  define: (v: JetValidator) => void,
  schema: SchemaDefinition,
  samples: any[],
  extra: Record<string, unknown> = {},
) {
  parity(define, schema, samples, { ...extra, allErrors: false });
  parity(define, schema, samples, { ...extra, allErrors: true });
}

describe("runtime/standalone parity - single field, both modes", () => {
  const defineMult = (v: JetValidator) =>
    v.addKeyword({
      keyword: "mult",
      type: "number",
      schemaType: "number",
      compile: (s: number) => (d: number) =>
        d % s === 0 ? true : { message: `not x${s}` },
    });

  it("agrees on nested property failure (message + schemaPath + dataPath)", () => {
    parityBothModes(
      defineMult,
      {
        type: "object",
        properties: {
          a: { type: "number", mult: 2 },
          b: { type: "number", mult: 5 },
        },
      } as SchemaDefinition,
      [
        { a: 4, b: 10 },
        { a: 4, b: 7 },
        { a: 3, b: 10 },
        { a: 3, b: 7 },
      ],
    );
  });

  it("pins the concrete error triple for a single failing field", () => {
    const { runtime, emitted } = parity(
      defineMult,
      {
        type: "object",
        properties: { b: { type: "number", mult: 5 } },
      } as SchemaDefinition,
      [{ b: 7 }],
    );

    const rt = runtime.errors![0];
    const sa = emitted.errors![0];
    expect(rt.message).toBe("not x5");
    expect(sa.message).toBe("not x5");
    expect(sa.schemaPath).toBe(rt.schemaPath);
    expect(sa.dataPath).toBe(rt.dataPath);
    expect(sa.dataPath).toContain("b");
  });

  it("agrees on array item failure (dataPath carries the index)", () => {
    parityBothModes(
      defineMult,
      {
        type: "array",
        items: { type: "number", mult: 3 },
      } as SchemaDefinition,
      [
        [3, 6, 9],
        [3, 4, 9],
        [1, 2, 3],
      ],
    );
  });

  it("agrees on deeply nested failure path", () => {
    parityBothModes(
      defineMult,
      {
        type: "object",
        properties: {
          outer: {
            type: "object",
            properties: { inner: { type: "number", mult: 4 } },
          },
        },
      } as SchemaDefinition,
      [{ outer: { inner: 8 } }, { outer: { inner: 5 } }],
    );
  });
});

describe("runtime/standalone parity - validate keyword, both modes", () => {
  const defineDiv = (v: JetValidator) =>
    v.addKeyword({
      keyword: "divisibleBy",
      type: "number",
      schemaType: "number",
      validate: (s: number, d: number) =>
        d % s !== 0 ? { message: `Must be divisible by ${s}` } : true,
    });

  it("agrees on message + keyword + paths at the root", () => {
    parityBothModes(
      defineDiv,
      { divisibleBy: 7 } as SchemaDefinition,
      [14, 10, 21, 5],
    );
  });

  it("agrees on custom error props (divisor/remainder) alongside core fields", () => {
    const defineRich = (v: JetValidator) =>
      v.addKeyword({
        keyword: "divBy",
        type: "number",
        schemaType: "number",
        validate: (s: number, d: number) =>
          d % s !== 0
            ? { message: "not divisible", divisor: s, remainder: d % s }
            : true,
      });

    const { runtime, emitted } = parity(
      defineRich,
      { divBy: 3 } as SchemaDefinition,
      [9, 7],
    );

    runtime(7);
    emitted(7);

    expect(emitted.errors![0].divisor).toBe(runtime.errors![0].divisor);
    expect(emitted.errors![0].remainder).toBe(runtime.errors![0].remainder);
  });

  it("agrees on cross-field (rootData) failure", () => {
    const defineMatch = (v: JetValidator) =>
      v.addKeyword({
        keyword: "matches",
        type: "string",
        schemaType: "string",
        validate: (field: string, d: string, _p: any, ctx: any) =>
          d === ctx.rootData[field] ? true : { message: `must match ${field}` },
      });

    parityBothModes(
      defineMatch,
      {
        type: "object",
        properties: {
          pw: { type: "string" },
          confirm: { type: "string", matches: "pw" },
        },
      } as SchemaDefinition,
      [
        { pw: "abc", confirm: "abc" },
        { pw: "abc", confirm: "xyz" },
      ],
    );
  });
});

describe("runtime/standalone parity - verbose error shape", () => {
  it("agrees on the value field in verbose mode (both error modes)", () => {
    const defineBad = (v: JetValidator) =>
      v.addKeyword({
        keyword: "bad",
        type: "number",
        schemaType: "boolean",
        validate: () => ({ message: "x" }),
      });

    for (const allErrors of [false, true]) {
      const { runtime, emitted } = parity(
        defineBad,
        { bad: true } as SchemaDefinition,
        [9],
        { verbose: true, allErrors },
      );
      runtime(9);
      emitted(9);
      expect(emitted.errors![0].value).toBe(runtime.errors![0].value);
      expect(emitted.errors![0].value).toBe(9);
    }
  });
});

describe("runtime/standalone parity - compile keyword, both modes", () => {
  const defineMultCompile = (v: JetValidator) =>
    v.addKeyword({
      keyword: "mult",
      type: "number",
      schemaType: "number",
      compile: (s: number) => (d: number) =>
        d % s === 0 ? true : { message: `not x${s}` },
    });

  it("agrees on nested property failure (message + schemaPath + dataPath)", () => {
    parityBothModes(
      defineMultCompile,
      {
        type: "object",
        properties: {
          a: { type: "number", mult: 2 },
          b: { type: "number", mult: 5 },
        },
      } as SchemaDefinition,
      [
        { a: 4, b: 10 },
        { a: 4, b: 7 },
        { a: 3, b: 10 },
        { a: 3, b: 7 },
      ],
    );
  });

  it("agrees on array item failure (dataPath carries the index)", () => {
    parityBothModes(
      defineMultCompile,
      {
        type: "array",
        items: { type: "number", mult: 3 },
      } as SchemaDefinition,
      [
        [3, 6, 9],
        [3, 4, 9],
        [1, 2, 3],
      ],
    );
  });

  it("agrees when the factory captures the schema value (per-site closures)", () => {
    const { runtime, emitted } = parity(
      defineMultCompile,
      {
        type: "object",
        properties: {
          a: { type: "number", mult: 2 },
          b: { type: "number", mult: 5 },
        },
      } as SchemaDefinition,
      [{ a: 3, b: 7 }],
      { allErrors: true },
    );

    const rtMsgs = runtime.errors!.map((e) => e.message);
    const saMsgs = emitted.errors!.map((e) => e.message);
    expect(rtMsgs).toEqual(["not x2", "not x5"]);
    expect(saMsgs).toEqual(["not x2", "not x5"]);
  });

  it("agrees on custom error props from a compile keyword", () => {
    const defineRichCompile = (v: JetValidator) =>
      v.addKeyword({
        keyword: "mult",
        type: "number",
        schemaType: "number",
        compile: (s: number) => (d: number) =>
          d % s === 0 ? true : { message: "no", divisor: s, remainder: d % s },
      });

    const { runtime, emitted } = parity(
      defineRichCompile,
      { mult: 3 } as SchemaDefinition,
      [9, 7],
    );

    runtime(7);
    emitted(7);
    expect(emitted.errors![0].divisor).toBe(runtime.errors![0].divisor);
    expect(emitted.errors![0].remainder).toBe(runtime.errors![0].remainder);
  });

  it("agrees on cross-field (rootData) failure from a compile keyword", () => {
    const defineMatchCompile = (v: JetValidator) =>
      v.addKeyword({
        keyword: "matchesField",
        type: "string",
        schemaType: "string",
        compile: (field: string) => (d: string, rootData: any) =>
          d === rootData[field] ? true : { message: `must match ${field}` },
      });

    parityBothModes(
      defineMatchCompile,
      {
        type: "object",
        properties: {
          password: { type: "string" },
          confirm: { type: "string", matchesField: "password" },
        },
        required: ["password", "confirm"],
      } as SchemaDefinition,
      [
        { password: "secret1", confirm: "secret1" },
        { password: "secret1", confirm: "nope" },
      ],
    );
  });

  it("agrees on value field in verbose mode (compile keyword)", () => {
    const defineBadCompile = (v: JetValidator) =>
      v.addKeyword({
        keyword: "bad",
        type: "number",
        schemaType: "boolean",
        compile: () => () => ({ message: "x" }),
      });

    for (const allErrors of [false, true]) {
      const { runtime, emitted } = parity(
        defineBadCompile,
        { bad: true } as SchemaDefinition,
        [9],
        { verbose: true, allErrors },
      );
      runtime(9);
      emitted(9);
      expect(emitted.errors![0].value).toBe(runtime.errors![0].value);
      expect(emitted.errors![0].value).toBe(9);
    }
  });

  it("collects compile-keyword errors in the same order across paths", () => {
    const defineTwoCompile = (v: JetValidator) => {
      v.addKeyword({
        keyword: "cA",
        type: "number",
        schemaType: "boolean",
        compile: () => () => ({ message: "A" }),
      });
      v.addKeyword({
        keyword: "cB",
        type: "number",
        schemaType: "boolean",
        compile: () => () => ({ message: "B" }),
      });
    };

    const { runtime, emitted } = parity(
      defineTwoCompile,
      { type: "number", cA: true, cB: true } as SchemaDefinition,
      [5],
      { allErrors: true },
    );

    expect(runtime.errors!.map((e) => e.message)).toEqual(["A", "B"]);
    expect(emitted.errors!.map((e) => e.message)).toEqual(["A", "B"]);
  });
});

describe("runtime/standalone parity - allErrors ordering", () => {
  const defineTwo = (v: JetValidator) => {
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
  };

  it("collects both errors in the same order across paths", () => {
    const { runtime, emitted } = parity(
      defineTwo,
      { type: "number", kA: true, kB: true } as SchemaDefinition,
      [5],
      { allErrors: true },
    );

    const rtMsgs = runtime.errors!.map((e) => e.message);
    const saMsgs = emitted.errors!.map((e) => e.message);
    expect(rtMsgs).toEqual(["A", "B"]);
    expect(saMsgs).toEqual(["A", "B"]);
  });

  it("keeps per-field ordering stable across multiple failing properties", () => {
    parity(
      defineTwo,
      {
        type: "object",
        properties: {
          x: { type: "number", kA: true, kB: true },
          y: { type: "number", kA: true, kB: true },
        },
      } as SchemaDefinition,
      [{ x: 1, y: 2 }],
      { allErrors: true },
    );
  });
});
