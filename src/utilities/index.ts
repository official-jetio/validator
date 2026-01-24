import { JetValidator } from "../jet-validator";
import { CodeContext, KeywordDefinition } from "../types/keywords";
import { BaseType, SchemaDefinition } from "../types/schema";

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

export function escapeTemplateString(str: string): string {
  // Replace backslashes first, then other special chars, but preserve ${...}
  return str
    .replace(/\\/g, "\\\\") // Escape backslashes
    .replace(/`/g, "\\`") // Escape backticks
    .replace(/\$(?!{)/g, "\\$") // Escape $ not followed by {
    .replace(/\r/g, "\\r") // Escape carriage returns
    .replace(/\n/g, "\\n") // Escape newlines
    .replace(/\t/g, "\\t"); // Escape tabs
}

function decodePointerSegment(segment: string) {
  const uriDecoded = decodeURIComponent(segment);
  return uriDecoded.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function getSchemaAtPath(
  rootSchema: SchemaDefinition,
  path: string,
): SchemaDefinition | boolean {
  if (path === "#") return rootSchema;

  const segments = path.slice(2).split("/");
  let current: any = rootSchema;
  for (const segment of segments) {
    const decodedSegment = decodePointerSegment(segment);
    if (current && typeof current === "object") {
      current = current[decodedSegment];
    } else {
      return {};
      // throw new Error(
      //   `Cannot resolve path ${path}. Segment '${decodedSegment}' not found.`
      // );
    }
  }
  return current;
}

export function shouldApplyKeyword(
  keywordDef: KeywordDefinition,
  keywordValue: any,
): boolean {
  if (keywordDef.schemaType) {
    const schemaTypes = Array.isArray(keywordDef.schemaType)
      ? keywordDef.schemaType
      : [keywordDef.schemaType];

    const valueType = getJSONType(keywordValue);

    const hasMatchingType = schemaTypes.some((type) => {
      if (type === "number" && valueType === "integer") return true;
      return type === valueType;
    });

    if (!hasMatchingType) {
      return false;
    }
  }
  return true;
}

export function getJSONType(value: any): BaseType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "string") return "string";
  if (typeof value === "object") return "object";
  return "string";
}

export function validateKeywordValue(
  keyword: string,
  value: any,
  metaSchema: SchemaDefinition,
  jetValidator: JetValidator,
): void {
  const validator = jetValidator.compile(metaSchema);
  const result = validator(value);
  if (!result) {
    throw new Error(
      `Invalid value for keyword "${keyword}": ${JSON.stringify(
        validator.errors,
      )}`,
    );
  }
}

export function canonicalStringify(obj: any): string {
  if (obj === null) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);

  if (Array.isArray(obj)) {
    const parts: string[] = new Array(obj.length);
    for (let i = 0; i < obj.length; i++) {
      parts[i] = canonicalStringify(obj[i]);
    }
    return "[" + parts.join(",") + "]";
  }

  const keys = Object.keys(obj).sort();
  const parts: string[] = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    parts[i] = `"${key}":${canonicalStringify(obj[key])}`;
  }
  return "{" + parts.join(",") + "}";
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    const keySetB = new Set(keysB);
    for (const key of keysA) {
      if (!keySetB.has(key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}
