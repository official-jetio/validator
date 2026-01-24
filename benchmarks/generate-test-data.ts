import { writeFileSync } from 'fs';

function generateObject1000Props() {
  const valid: Record<string, any> = {};
  for (let i = 0; i < 1000; i++) {
    const mod = i % 4;
    if (mod === 0) valid[`field${i}`] = `value${i}`;
    else if (mod === 1) valid[`field${i}`] = i;
    else if (mod === 2) valid[`field${i}`] = i % 2 === 0;
    else valid[`field${i}`] = i + 100;
  }
  return valid;
}

function generateArrayData(count: number, itemGenerator: (i: number) => any) {
  return Array.from({ length: count }, (_, i) => itemGenerator(i));
}

const scaleObjectsData = {
  object1000Props: {
    valid: [generateObject1000Props()],
    invalid: [{ field0: "" }]
  }
};

const scaleArraysData = {
  array1KItems: {
    valid: [
      generateArrayData(1000, i => ({
        id: i,
        name: `name${i}`,
        value: i * 1.5,
        active: i % 2 === 0
      }))
    ],
    invalid: [
      generateArrayData(999, i => ({ id: i, name: `name${i}` }))
    ]
  },
  array10KItems: {
    valid: [
      generateArrayData(10000, i => ({
        id: i,
        value: i * 0.5
      }))
    ],
    invalid: [
      generateArrayData(9999, i => ({ id: i, value: i }))
    ]
  },
  array100KItems: {
    valid: [
      generateArrayData(100000, i => `item${i}`)
    ],
    invalid: [
      generateArrayData(100000, i => i < 50000 ? `item${i}` : "")
    ]
  },
  arrayUniqueItems1K: {
    valid: [
      generateArrayData(1000, i => ({
        id: `${i.toString().padStart(8, '0')}-1234-5678-90ab-cdef12345678`,
        value: i
      }))
    ],
    invalid: [
      [
        { id: "00000000-1234-5678-90ab-cdef12345678", value: 1 },
        { id: "00000000-1234-5678-90ab-cdef12345678", value: 2 }
      ]
    ]
  },
  arrayComplexItems: {
    valid: [
      generateArrayData(5000, i => ({
        id: i,
        email: `user${i}@example.com`,
        created: `2024-01-${(i % 28 + 1).toString().padStart(2, '0')}T${(i % 24).toString().padStart(2, '0')}:00:00Z`,
        metadata: {
          tags: [`tag${i % 10}`, `category${i % 5}`],
          score: (i % 101)
        }
      }))
    ],
    invalid: [
      [{ id: 1, email: "invalid", created: "2024-01-01T00:00:00Z" }]
    ]
  },
  arrayNestedArrays: {
    valid: [
      generateArrayData(100, () =>
        generateArrayData(10, () =>
          generateArrayData(10, i => i * 10)
        )
      )
    ],
    invalid: [
      generateArrayData(100, () =>
        generateArrayData(9, () =>
          generateArrayData(10, i => i * 10)
        )
      )
    ]
  },
  arrayMixedTypes1K: {
    valid: [
      generateArrayData(1000, i => {
        const mod = i % 4;
        if (mod === 0) return `string${i}`;
        if (mod === 1) return i;
        if (mod === 2) return i % 2 === 0;
        return { type: "object", value: i };
      })
    ],
    invalid: [
      [null, undefined, {}, []]
    ]
  }
};

const scaleNestingData = {
  nesting50Levels: {
    valid: [
      {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    level7: {
                      level8: {
                        level9: {
                          level10: {
                            level11: {
                              level12: {
                                level13: {
                                  level14: {
                                    level15: {
                                      level16: {
                                        level17: {
                                          level18: {
                                            level19: {
                                              level20: {
                                                level21: {
                                                  level22: {
                                                    level23: {
                                                      level24: {
                                                        level25: {
                                                          level26: {
                                                            level27: {
                                                              level28: {
                                                                level29: {
                                                                  level30: {
                                                                    level31: {
                                                                      level32: {
                                                                        level33: {
                                                                          level34: {
                                                                            level35: {
                                                                              level36: {
                                                                                level37: {
                                                                                  level38: {
                                                                                    level39: {
                                                                                      level40: {
                                                                                        level41: {
                                                                                          level42: {
                                                                                            level43: {
                                                                                              level44: {
                                                                                                level45: {
                                                                                                  level46: {
                                                                                                    level47: {
                                                                                                      level48: {
                                                                                                        level49: {
                                                                                                          level50: {
                                                                                                            value: "deep"
                                                                                                          }
                                                                                                        }
                                                                                                      }
                                                                                                    }
                                                                                                  }
                                                                                                }
                                                                                              }
                                                                                            }
                                                                                          }
                                                                                        }
                                                                                      }
                                                                                    }
                                                                                  }
                                                                                }
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                      }
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    ],
    invalid: [
      {
        level1: {
          level2: "invalid"
        }
      }
    ]
  },
  nesting100Levels: {
    valid: [
      {
        data: [[[[[[[[[[[[[[[[[[[[0]]]]]]]]]]]]]]]]]]]]
      }
    ],
    invalid: [
      {
        data: [[[[[[[[[["string"]]]]]]]]]]
      }
    ]
  },
  nestingAllOfChain: {
    valid: [
      {
        prop1: "test",
        prop2: 42,
        prop3: true,
        prop4: "value",
        prop5: 100,
        prop6: false,
        prop7: "data",
        prop8: 50,
        prop9: true,
        prop10: "final"
      }
    ],
    invalid: [
      {
        prop1: 123,
        prop2: "invalid"
      }
    ]
  }
};

const scaleRefsData = {
  refs100Times: {
    valid: [
      (() => {
        const obj: Record<string, any> = {};
        for (let i = 0; i < 100; i++) {
          const mod = i % 3;
          if (mod === 0) obj[`field${i}`] = `value${i}`;
          else if (mod === 1) obj[`field${i}`] = i;
          else obj[`field${i}`] = { id: `id-${i}`, value: i };
        }
        return obj;
      })()
    ],
    invalid: [
      { field0: "", field1: -1 }
    ]
  },
  refs500Times: {
    valid: [
      (() => {
        const obj: Record<string, any> = {};
        for (let i = 0; i < 500; i++) {
          obj[`item${i}`] = { id: i, name: `name${i}` };
        }
        return obj;
      })()
    ],
    invalid: [
      { item0: { name: "missing-id" } }
    ]
  },
  refs1000Times: {
    valid: [
      (() => {
        const obj: Record<string, any> = {};
        for (let i = 0; i < 1000; i++) {
          obj[`val${i}`] = `value${i}`;
        }
        return obj;
      })()
    ],
    invalid: [
      { val0: "" }
    ]
  },
  recursiveRefs: {
    valid: [
      {
        root: {
          value: 10,
          left: {
            value: 5,
            left: { value: 2 },
            right: { value: 7 }
          },
          right: {
            value: 15,
            children: [
              { value: 12 },
              { value: 18 }
            ]
          }
        }
      }
    ],
    invalid: [
      {
        root: {
          left: { value: 5 }
        }
      }
    ]
  },
  chainedRefs: {
    valid: [
      { data: "final-value" }
    ],
    invalid: [
      { data: 123 }
    ]
  },
  complexRefGraph: {
    valid: [
      {
        graph: [
          { id: "a1", refB: { id: "b1" }, refC: { id: "c1" } },
          { id: "b1", refA: { id: "a2" }, refD: { id: "d1" } },
          { id: "c1", refA: { id: "a1" }, refB: { id: "b2" }, refD: { id: "d2" } },
          { id: "d1", refB: { id: "b1" }, refC: { id: "c2" } }
        ]
      }
    ],
    invalid: [
      { graph: [{ id: 123 }] }
    ]
  }
};

const complexityCompositionData = {
  deepAllOf: {
    valid: [
      {
        prop1: "test",
        prop2: 42,
        prop3: true,
        prop4: "value",
        prop5: 100,
        prop6: false,
        prop7: "data",
        prop8: 50,
        prop9: true
      }
    ],
    invalid: [
      {
        prop1: "test",
        prop2: "invalid"
      }
    ]
  },
  deepAnyOf: {
    valid: [
      { type: "A", data: "string-value" },
      { type: "A", data: 42 },
      { type: "A", data: true },
      { type: "A", data: null },
      { type: "A", data: ["a", "b"] },
      { type: "B", value: 100 }
    ],
    invalid: [
      { type: "A", data: {} },
      { type: "B", value: "invalid" }
    ]
  },
  deepOneOf: {
    valid: [
      { variant: "v1", nested: { subtype: "s1", value: "test" } },
      { variant: "v1", nested: { subtype: "s2", value: 42 } },
      { variant: "v2", nested: { subtype: "s3", value: true } },
      { variant: "v2", nested: { subtype: "s4", value: ["a", "b"] } },
      { variant: "v3", nested: { subtype: "s5", value: {} } },
      { variant: "v3", nested: { subtype: "s6", value: null } }
    ],
    invalid: [
      { variant: "v1", nested: { subtype: "s1", value: 123 } },
      { variant: "v1", nested: { subtype: "s3", value: true } }
    ]
  },
  mixedComposition: {
    valid: [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "user",
        email: "user@example.com",
        status: "active",
        lastLogin: "2024-01-15T14:30:00Z"
      },
      {
        id: "fedcba98-7654-3210-fedc-ba9876543210",
        type: "admin",
        permissions: ["read", "write", "delete"],
        status: "inactive",
        deactivatedAt: "2024-01-10T10:00:00Z"
      }
    ],
    invalid: [
      {
        id: "invalid-uuid",
        type: "user",
        email: "user@example.com"
      }
    ]
  },
  complexNot: {
    valid: [
      { value: 10 },
      { value: 50 },
      { value: 99 }
    ],
    invalid: [
      { value: 13 },
      { value: 14 },
      { value: 21 }
    ]
  },
  multiLayeredComposition: {
    valid: [
      "testing",
      "ab",
      150,
      5
    ],
    invalid: [
      "test",
      "testvalue",
      13,
      26
    ]
  },
  wideComposition: {
    valid: [
      {
        p1: "a", p2: "b", p3: "c", p4: "d", p5: "e",
        p6: "f", p7: "g", p8: "h", p9: "i", p10: "j",
        opt1: 42,
        variant: "A"
      },
      {
        p1: "a", p2: "b", p3: "c", p4: "d", p5: "e",
        p6: "f", p7: "g", p8: "h", p9: "i", p10: "j",
        opt2: true,
        variant: "B"
      }
    ],
    invalid: [
      {
        p1: "a",
        variant: "A"
      }
    ]
  },
  recursiveComposition: {
    valid: [
      {
        tree: {
          id: "root",
          value: 100,
          type: "branch",
          children: [
            { id: "child1", value: 50, type: "leaf" },
            { id: "child2", value: 75, type: "leaf" }
          ]
        }
      }
    ],
    invalid: [
      {
        tree: {
          value: 100,
          type: "branch"
        }
      }
    ]
  }
};

console.log('Writing scale-objects.json...');
writeFileSync(
  'data/scale-objects.json',
  JSON.stringify(scaleObjectsData, null, 2)
);

console.log('Writing scale-arrays.json...');
writeFileSync(
  'data/scale-arrays.json',
  JSON.stringify(scaleArraysData, null, 2)
);

console.log('Writing scale-nesting.json...');
writeFileSync(
  'data/scale-nesting.json',
  JSON.stringify(scaleNestingData, null, 2)
);

console.log('Writing scale-refs.json...');
writeFileSync(
  'data/scale-refs.json',
  JSON.stringify(scaleRefsData, null, 2)
);

console.log('Writing complexity-composition.json...');
writeFileSync(
  'data/complexity-composition.json',
  JSON.stringify(complexityCompositionData, null, 2)
);

console.log('Done!');