import { describe, it, expect } from "vitest";
import { SchemaResolver } from "../../src/resolution/resolver";
import { JetValidator } from "../../src/jet-validator";
import { CompileContext, SchemaDefinition } from "../../src";

const resolve = (schema: any) =>
  new SchemaResolver(new JetValidator(), {
    inlineRefs: true,
  }).resolveSync(structuredClone(schema)) as {
    schema: Required<SchemaDefinition>;
    refables: {
      path: string;
      schema: Required<SchemaDefinition>;
      functionName: string;
    }[];
    allFormats: Set<string>;
    keywords: Set<string>;
    compileContext: CompileContext;
  };

const stats = (r: any) => r.compileContext.inliningStats;

const isFunctionRef = (node: any) =>
  typeof node?.$ref === "string" && node.$ref.startsWith("*");

const wasInlined = (node: any) =>
  node != null &&
  !("$ref" in node) &&
  ("__inlinedRef" in node || Object.keys(node).length > 0);

const isAcyclic = (schema: any) => {
  expect(() => JSON.stringify(schema)).not.toThrow();
};

describe("resolver / inlining - self-cycle with siblings (the original repro)", () => {
  const contact = {
    type: "object",
    properties: {
      primaryEmail: { type: "string", format: "email", minLength: 5 },
      backupEmail: {
        maxLength: 90,
        $ref: "#/properties/primaryEmail",
        properties: { b: { $ref: "#/properties/backupEmail" } },
      },
      lastEmail: { $ref: "#/properties/backupEmail" },
    },
    required: ["primaryEmail"],
  };

  it("produces an acyclic (stringifiable) schema", () => {
    isAcyclic(resolve(contact).schema);
  });

  it("inlines only the clean acyclic ref, routes the two cyclic ones to functions", () => {
    expect(stats(resolve(contact)).inlinedRefs).toBe(1);
    expect(stats(resolve(contact)).totalRefs).toBe(3);
  });

  it("keeps the self-referential ref (properties.b -> backupEmail) as a function call", () => {
    const { schema } = resolve(contact);
    expect(
      isFunctionRef((schema.properties.backupEmail as any).properties.b),
    ).toBe(true);
  });

  it("keeps the ref into the cyclic subtree (lastEmail -> backupEmail) as a function call", () => {
    const { schema } = resolve(contact);
    expect(isFunctionRef(schema.properties.lastEmail)).toBe(true);
  });
});

describe("resolver / inlining - mutual cycle a<->b", () => {
  const mutual = {
    type: "object",
    properties: {
      a: { $ref: "#/properties/b", maxLength: 5 },
      b: { $ref: "#/properties/a", minLength: 2 },
    },
  };

  it("inlines neither side of a mutual cycle", () => {
    const r = resolve(mutual);
    isAcyclic(r.schema);
    expect(stats(r).inlinedRefs).toBe(0);
    expect(isFunctionRef(r.schema.properties.a)).toBe(true);
    expect(isFunctionRef(r.schema.properties.b)).toBe(true);
  });
});

describe("resolver / inlining - three-node cycle a->b->c->a", () => {
  const threeNode = {
    type: "object",
    properties: {
      a: { $ref: "#/properties/b" },
      b: { $ref: "#/properties/c" },
      c: { $ref: "#/properties/a" },
    },
  };

  it("inlines none of the 3 cyclic $refs", () => {
    const r = resolve(threeNode);
    isAcyclic(r.schema);
    expect(stats(r).inlinedRefs).toBe(0);
    expect(isFunctionRef(r.schema.properties.a)).toBe(true);
    expect(isFunctionRef(r.schema.properties.b)).toBe(true);
    expect(isFunctionRef(r.schema.properties.c)).toBe(true);
  });
});

describe("resolver / inlining - cyclic $defs node isolated from clean sibling", () => {
  const defs = {
    type: "object",
    $defs: {
      node: {
        type: "object",
        properties: { next: { $ref: "#/$defs/node" }, val: { type: "string" } },
      },
      leaf: { type: "string", minLength: 1 },
    },
    properties: {
      tree: { $ref: "#/$defs/node" }, // into the cyclic def -> function
      name: { $ref: "#/$defs/leaf" }, // into the clean def   -> inline
    },
  };

  it("inlines the clean $defs leaf but not the cyclic $defs node", () => {
    const r = resolve(defs);
    isAcyclic(r.schema);
    expect(stats(r).inlinedRefs).toBe(1); // only name -> leaf
    expect(wasInlined(r.schema.properties.name)).toBe(true);
    expect(isFunctionRef(r.schema.properties.tree)).toBe(true);
    expect(isFunctionRef((r.schema.$defs.node as any).properties.next)).toBe(
      true,
    );
  });

  it("does not corrupt the clean leaf when a cyclic sibling exists in the same $defs", () => {
    const { schema } = resolve(defs);
    expect(schema.properties.name).not.toHaveProperty("$ref");
  });
});

describe("resolver / inlining - (clean + dirty paths - Don't mark an inlined ref as resolved until it has no descendants)", () => {
  const diamond = {
    type: "object",
    properties: {
      shared: { type: "string" },
      x: { $ref: "#/properties/shared" }, // clean -> inline
      y: {
        $ref: "#/properties/shared", // shared is clean -> inline, but y stays dirty via z
        properties: { z: { $ref: "#/properties/y" } }, // self-cycle -> function
      },
      w: { $ref: "#/properties/y" }, // y is dirty forever -> function
    },
  };

  it("inlines clean refs, routes refs to/within the cyclic node to functions", () => {
    const r = resolve(diamond);
    isAcyclic(r.schema);
    expect(stats(r).inlinedRefs).toBe(2);
    expect(isFunctionRef((r.schema.properties as any).y.properties.z)).toBe(
      true,
    );
    expect(isFunctionRef(r.schema.properties.w)).toBe(true);
  });
});

describe("resolver / inlining - prefix-sibling names (the +'/' boundary guard)", () => {
  const prefix = {
    type: "object",
    properties: {
      user: { $ref: "#/properties/userProfile" },
      userProfile: { type: "string" },
      userProfileExtra: { $ref: "#/properties/user" },
    },
  };

  it("treats prefix-sibling names as unrelated and resolves cleanly", () => {
    const r = resolve(prefix);
    isAcyclic(r.schema);
    expect(wasInlined(r.schema.properties.user)).toBe(true);
  });
});

describe("resolver / inlining - deeply nested cycle", () => {
  const deep = {
    type: "object",
    properties: {
      a: {
        type: "object",
        properties: { x: { properties: { y: { $ref: "#/properties/a" } } } },
      },
      b: { $ref: "#/properties/a" },
    },
  };

  it("detects a cycle nested several levels deep and inlines nothing into it", () => {
    const r = resolve(deep);
    isAcyclic(r.schema);
    expect(stats(r).inlinedRefs).toBe(0);
    expect(
      isFunctionRef((r.schema.properties as any).a.properties.x.properties.y),
    ).toBe(true);
    expect(isFunctionRef(r.schema.properties.b)).toBe(true);
  });
});

describe("resolver / inlining - all-clean (no false cycle detection)", () => {
  const clean = {
    type: "object",
    $defs: { s: { type: "string" } },
    properties: {
      p: { $ref: "#/$defs/s" },
      q: { $ref: "#/$defs/s" },
    },
  };

  it("inlines every ref when there are no cycles at all", () => {
    const r = resolve(clean);
    isAcyclic(r.schema);
    expect(stats(r).inlinedRefs).toBe(2);
    expect(wasInlined(r.schema.properties.p)).toBe(true);
    expect(wasInlined(r.schema.properties.q)).toBe(true);
  });
});

describe("resolver / inlining - inlining off leaves refs as function calls", () => {
  const contact = {
    type: "object",
    properties: {
      primaryEmail: { type: "string" },
      backupEmail: { $ref: "#/properties/primaryEmail" },
    },
  };

  it("does not inline anything when inlineRefs is false", () => {
    const r = new SchemaResolver(new JetValidator(), {
      inlineRefs: false,
    } as any).resolveSync(structuredClone(contact) as any);
    isAcyclic(r.schema);
    expect(isFunctionRef((r.schema as any).properties.backupEmail)).toBe(true);
  });
});
