import { describe, it, expect } from "vitest";
import { resolveDataPointerAtCompileTime } from "../../src/utilities/compilation";
import { AccessSegment } from "../../src/types/compiler";

const cases: [string, AccessSegment[], string, string][] = [
  // [pointer, segments, rootDataVar, expected]

  // absolute - from root (current path irrelevant, any segments)
  [
    "/",
    [
      { kind: "key", value: "user" },
      { kind: "key", value: "profile" },
    ],
    "rootData",
    "rootData",
  ],
  [
    "/foo",
    [
      { kind: "key", value: "user" },
      { kind: "key", value: "profile" },
    ],
    "rootData",
    "rootData.foo",
  ],
  [
    "/foo/bar",
    [{ kind: "key", value: "anything" }],
    "rootData",
    "rootData.foo.bar",
  ],
  [
    "/foo/0/bar",
    [{ kind: "key", value: "x" }],
    "rootData",
    "rootData.foo[0].bar",
  ],
  [
    "/foo~1bar",
    [{ kind: "key", value: "x" }],
    "rootData",
    'rootData["foo/bar"]',
  ],
  [
    "/foo~0bar",
    [{ kind: "key", value: "x" }],
    "rootData",
    'rootData["foo~bar"]',
  ],
  [
    "/weird key",
    [{ kind: "key", value: "x" }],
    "rootData",
    'rootData["weird key"]',
  ],

  // ref subschema toggles rootVar -> data
  [
    "/foo",
    [
      { kind: "key", value: "user" },
      { kind: "key", value: "profile" },
    ],
    "data",
    "data.foo",
  ],
  [
    "1/foo",
    [
      { kind: "key", value: "a" },
      { kind: "key", value: "b" },
    ],
    "data",
    "data.a.foo",
  ],

  // relative - current level (0/…)
  [
    "0/foo",
    [
      { kind: "key", value: "user" },
      { kind: "key", value: "profile" },
    ],
    "rootData",
    "rootData.user.profile.foo",
  ],
  [
    "0/foo/me/you",
    [
      { kind: "key", value: "user" },
      { kind: "key", value: "profile" },
    ],
    "rootData",
    "rootData.user.profile.foo.me.you",
  ],
  [
    "0/",
    [
      { kind: "key", value: "user" },
      { kind: "key", value: "profile" },
    ],
    "rootData",
    "rootData.user.profile",
  ],
  [
    "0/items/0",
    [{ kind: "key", value: "data" }],
    "rootData",
    "rootData.data.items[0]",
  ],
  ["0/foo", [], "rootData", "rootData.foo"],

  // relative - up levels
  [
    "1/foo",
    [
      { kind: "key", value: "user" },
      { kind: "key", value: "profile" },
    ],
    "rootData",
    "rootData.user.foo",
  ],
  [
    "1/foo",
    [
      { kind: "key", value: "a" },
      { kind: "key", value: "b" },
      { kind: "key", value: "c" },
    ],
    "rootData",
    "rootData.a.b.foo",
  ],
  [
    "2/foo",
    [
      { kind: "key", value: "user" },
      { kind: "key", value: "profile" },
    ],
    "rootData",
    "rootData.foo",
  ],

  // over-climb bottoms out at root
  [
    "5/foo",
    [
      { kind: "key", value: "a" },
      { kind: "key", value: "b" },
    ],
    "rootData",
    "rootData.foo",
  ],

  // double-digit level
  [
    "10/foo",
    [
      { kind: "key", value: "a" },
      { kind: "key", value: "b" },
      { kind: "key", value: "c" },
      { kind: "key", value: "d" },
      { kind: "key", value: "e" },
      { kind: "key", value: "f" },
      { kind: "key", value: "g" },
      { kind: "key", value: "h" },
      { kind: "key", value: "i" },
      { kind: "key", value: "j" },
      { kind: "key", value: "k" },
    ],
    "rootData",
    "rootData.a.foo",
  ],

  // dynamic in the pointer (absolute)
  ["/${key}", [{ kind: "key", value: "x" }], "rootData", "rootData[key]"],
  [
    "/items/${i}",
    [{ kind: "key", value: "x" }],
    "rootData",
    "rootData.items[i]",
  ],
  ["/${a}/${b}", [{ kind: "key", value: "x" }], "rootData", "rootData[a][b]"],
  [
    "/users/${id}/name",
    [{ kind: "key", value: "x" }],
    "rootData",
    "rootData.users[id].name",
  ],
  ["/${key}", [{ kind: "key", value: "x" }], "data", "data[key]"],

  // dynamic in the relative rest
  ["0/${k}", [{ kind: "key", value: "data" }], "rootData", "rootData.data[k]"],
  [
    "0/items/${i}/label",
    [{ kind: "key", value: "data" }],
    "rootData",
    "rootData.data.items[i].label",
  ],

  // dynamic in currentSegments
  [
    "0/x",
    [
      { kind: "dynamic", expr: "a" },
      { kind: "dynamic", expr: "b" },
    ],
    "rootData",
    "rootData[a][b].x",
  ],
  [
    "0/",
    [
      { kind: "key", value: "user" },
      { kind: "dynamic", expr: "i" },
    ],
    "rootData",
    "rootData.user[i]",
  ],
  [
    "1/foo",
    [
      { kind: "dynamic", expr: "a" },
      { kind: "key", value: "b" },
    ],
    "data",
    "data[a].foo",
  ],

  // climb keeps vs discards the dynamic segment
  [
    "1/name",
    [
      { kind: "key", value: "user" },
      { kind: "dynamic", expr: "i" },
      { kind: "key", value: "tags" },
    ],
    "rootData",
    "rootData.user[i].name",
  ],
  [
    "1/name",
    [
      { kind: "key", value: "user" },
      { kind: "dynamic", expr: "i" },
    ],
    "rootData",
    "rootData.user.name",
  ],
  [
    "2/foo",
    [
      { kind: "key", value: "a" },
      { kind: "dynamic", expr: "b" },
      { kind: "key", value: "c" },
    ],
    "rootData",
    "rootData.a.foo",
  ],

  // expression payloads passed through verbatim (dynamic expr can be any JS)
  [
    "/${obj.prop}",
    [{ kind: "key", value: "x" }],
    "rootData",
    "rootData[obj.prop]",
  ],
  ["/${arr[0]}", [{ kind: "key", value: "x" }], "rootData", "rootData[arr[0]]"],
  ["/${i + 1}", [{ kind: "key", value: "x" }], "rootData", "rootData[i + 1]"], // see note
];

describe("resolveDataPointerAtCompileTime", () => {
  it.each(cases)("%j @ %j (sub=%j) -> %j", (pointer, path, sub, expected) => {
    expect(resolveDataPointerAtCompileTime(pointer, path, sub)).toBe(expected);
  });
});
