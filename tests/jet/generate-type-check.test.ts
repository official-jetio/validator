import { describe, it, expect } from "vitest";
import { generateTypeCheck } from "../../src/utilities/compilation";

describe("generateTypeCheck - composite types get null/array guards", () => {
  it("integer checks number AND Number.isInteger", () => {
    expect(generateTypeCheck("x", "integer")).toBe(
      '(typeof x === "number" && Number.isInteger(x))',
    );
  });

  it("number checks number AND Number.isFinite (excludes NaN/Infinity)", () => {
    expect(generateTypeCheck("x", "number")).toBe(
      '(typeof x === "number" && Number.isFinite(x))',
    );
  });

  it("array checks Array.isArray and non-null", () => {
    expect(generateTypeCheck("x", "array")).toBe("(Array.isArray(x))");
  });

  it("object excludes arrays and null", () => {
    expect(generateTypeCheck("x", "object")).toBe(
      '(x !== null && typeof x === "object" && !Array.isArray(x))',
    );
  });
});

describe("generateTypeCheck - simple types", () => {
  it("null is a strict identity check", () => {
    expect(generateTypeCheck("x", "null")).toBe("x === null");
  });

  it("string / boolean fall through to a plain typeof", () => {
    expect(generateTypeCheck("x", "string")).toBe('typeof x === "string"');
    expect(generateTypeCheck("x", "boolean")).toBe('typeof x === "boolean"');
  });
});

describe("generateTypeCheck - varName is interpolated everywhere", () => {
  it("uses the provided variable name consistently", () => {
    expect(generateTypeCheck("jv3", "integer")).toBe(
      '(typeof jv3 === "number" && Number.isInteger(jv3))',
    );
    expect(generateTypeCheck("data[key0]", "array")).toBe(
      "(Array.isArray(data[key0]))",
    );
  });
});
