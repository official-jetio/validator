export function len_of(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    count++;
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const nextCode = str.charCodeAt(i + 1);
      if ((nextCode & 0xfc00) === 0xdc00) {
        i++;
      }
    }
  }
  return count;
}

type Checker = (arr: readonly unknown[]) => boolean;

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if ((a as object).constructor !== (b as object).constructor) return false;
    if (Array.isArray(a)) {
      const x = a as unknown[],
        y = b as unknown[];
      if (x.length !== y.length) return false;
      for (let i = x.length; i-- !== 0; )
        if (!deepEqual(x[i], y[i])) return false;
      return true;
    }
    const keys = Object.keys(a as object);
    if (keys.length !== Object.keys(b as object).length) return false;
    for (let i = keys.length; i-- !== 0; )
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
    for (let i = keys.length; i-- !== 0; ) {
      const k = keys[i];
      if (
        !deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        )
      )
        return false;
    }
    return true;
  }
  return a !== a && b !== b;
}

type Node = { s: string; prev: Node; d: string };
export function joinSchema(node: Node) {
  let s = "";
  while (node) {
    s = node.s + s;
    node = node.prev as any;
  }
  return s;
}
export function joinData(node: Node) {
  let s = "";
  while (node) {
    s = node.d + s;
    node = node.prev;
  }
  return s;
}
export function createUniqueChecker({
  wide = false,
}: { wide?: boolean } = {}): Checker {
  const F64 = new Float64Array(1);
  const U32 = new Uint32Array(F64.buffer);

  function hashNumber(n: number, seed: number): number {
    if (n === 0) n = 0;
    F64[0] = n;
    return (
      (Math.imul(U32[0] ^ seed, 0x27d4eb2f) ^ Math.imul(U32[1], 0x165667b1)) | 0
    );
  }
  function hashString(s: string, seed: number): number {
    let h = (0x811c9dc5 ^ seed) >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h | 0;
  }
  function hash32(v: unknown, seed: number): number {
    if (v === null) return 0x1000001 ^ seed;
    const t = typeof v;
    if (t === "string") return hashString(v as string, seed);
    if (t === "number") return hashNumber(v as number, seed) ^ 0x4e;
    if (t === "boolean") return (v ? 0x2000002 : 0x3000003) ^ seed;
    if (Array.isArray(v)) {
      let h = 0x9e3779b1 ^ seed;
      for (let i = 0; i < v.length; i++)
        h = (Math.imul(h, 31) + hash32(v[i], seed)) | 0;
      return h ^ 0x55555555;
    }
    let acc = 0;
    const keys = Object.keys(v as object);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const e =
        (Math.imul(hashString(k, seed), 0x85ebca6b) ^
          Math.imul(
            hash32((v as Record<string, unknown>)[k], seed),
            0xc2b2ae35,
          )) |
        0;
      acc = (acc + e) | 0;
    }
    return acc ^ 0xaaaaaaaa;
  }

  const key: (v: unknown) => number = wide
    ? (v) =>
        (hash32(v, 0) >>> 0) * 0x200000 + ((hash32(v, 0x9e3779b9) >>> 0) >>> 11)
    : (v) => hash32(v, 0);

  return function hasDuplicateItems(arr) {
    const buckets = new Map<number, unknown[]>();
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      const h = key(item);
      const bucket = buckets.get(h);
      if (bucket === undefined) buckets.set(h, [item]);
      else {
        for (let j = 0; j < bucket.length; j++)
          if (deepEqual(bucket[j], item)) return true;
        bucket.push(item);
      }
    }
    return false;
  };
}
