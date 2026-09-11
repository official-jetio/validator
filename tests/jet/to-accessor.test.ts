import { describe, it, expect } from "vitest";
import { toAccessor } from "../../src/utilities/compilation";

describe("toAccessor - runtime ${…} placeholders", () => {
  it("unwraps a simple placeholder to a bracket accessor on the live variable", () => {
    expect(toAccessor({ kind: "dynamic", expr: "key0" })).toBe("[key0]");
    expect(toAccessor({ kind: "dynamic", expr: "i" })).toBe("[i]");
  });

  it("passes a placeholder's inner expression through verbatim", () => {
    expect(toAccessor({ kind: "dynamic", expr: "obj.prop" })).toBe(
      "[obj.prop]",
    );
    expect(toAccessor({ kind: "dynamic", expr: "arr[0]" })).toBe("[arr[0]]");
  });
});

// describe("toAccessor - pointer-encoded tokens", () => {
//   it("decodes ~1 to '/' and quotes the resulting key", () => {
//     expect(toAccessor({ kind: "key", value: "a~1b" })).toBe('["a/b"]');
//   });

//   it("decodes ~0 to '~' and quotes the resulting key", () => {
//     expect(toAccessor({ kind: "key", value: "a~0b" })).toBe('["a~b"]');
//   });
// });

describe("toAccessor - identifiers vs indices vs quoted keys", () => {
  it("emits dot access for valid identifiers", () => {
    expect(toAccessor({ kind: "key", value: "foo" })).toBe(".foo");
    expect(toAccessor({ kind: "key", value: "fooBar" })).toBe(".fooBar");
    expect(toAccessor({ kind: "key", value: "_x" })).toBe("._x");
    expect(toAccessor({ kind: "key", value: "$x" })).toBe(".$x");
  });

  it("emits unquoted bracket access for pure numeric indices", () => {
    expect(toAccessor({ kind: "index", value: 0 })).toBe("[0]");
    expect(toAccessor({ kind: "index", value: 42 })).toBe("[42]");
  });

  it("emits quoted bracket access for keys that are neither identifiers nor indices", () => {
    expect(toAccessor({ kind: "key", value: "a-b" })).toBe('["a-b"]');
    expect(toAccessor({ kind: "key", value: "weird key" })).toBe(
      '["weird key"]',
    );

    expect(toAccessor({ kind: "key", value: "123abc" })).toBe('["123abc"]');
  });
});
