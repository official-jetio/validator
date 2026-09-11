import { JetValidator } from "../jet-validator";
import { SchemaError } from "../types/resolver";
import { KeywordDefinition } from "../types/keywords";
import { BaseType, SchemaDefinition } from "../types/schema";

export function isDataReference(value: any): value is { $data: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "$data" in value &&
    typeof value.$data === "string"
  );
}

export function sanitizeRefName(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9]/g, "_");
}

export function splitUrlIntoPathAndFragment(pathUrl: string): {
  path: string;
  hash?: string;
} {
  const [basePath, fragment] = pathUrl.split("#");
  let hash: string | undefined;
  if (fragment !== undefined) {
    hash = pathUrl.endsWith("#") ? "#" : "#" + fragment;
  }

  return { path: basePath, hash };
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

  const segments = path.startsWith("#")
    ? path.slice(2).split("/")
    : path.slice(1).split("/");
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
export function encodePointerSegment(segment: string) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
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

export function typeChecking(value: unknown, descriptor: string): boolean {
  switch (descriptor) {
    case "any":
      return true;
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    case "any[]":
    case "schema[]":
      return Array.isArray(value);
    case "string[]":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "schema":
      return (
        typeof value === "boolean" ||
        (typeof value === "object" && value !== null && !Array.isArray(value))
      );
    case "string | string[]":
      return (
        typeof value === "string" ||
        (Array.isArray(value) && value.every((v) => typeof v === "string"))
      );
    case "schema | schema[]":
      return (
        Array.isArray(value) ||
        typeof value === "boolean" ||
        (typeof value === "object" && value !== null)
      );
    case "{if: schema, then: schema}[]":
      return (
        Array.isArray(value) &&
        value.every(
          (val) =>
            typeof val === "object" &&
            val !== null &&
            checkTypeSchema(val?.if) &&
            checkTypeSchema(val?.then),
        )
      );
    default:
      return true;
  }
}

const checkTypeSchema = (value: any) => {
  return (
    typeof value === "boolean" ||
    (typeof value === "object" && value !== null && !Array.isArray(value))
  );
};

const MAX_PER_CATEGORY = 20;

export function formatSchemaErrors(bag: SchemaError): string {
  const count =
    bag.unknownKeywords.length +
    bag.missingType.length +
    bag.strictRequired.length +
    bag.incompatibleKeywords.errors.length +
    bag.incompatibleKeywords.unknownTypes.length +
    bag.invalidKeywordTypes.length;

  if (count === 0) return "";

  const id = bag.schemaId ? ` for "${bag.schemaId}"` : "";
  const lines: string[] = [
    `Schema validation failed${id}: ${count} issue${count === 1 ? "" : "s"} found.`,
  ];
  const quote = (arr: string[]) => arr.map((x) => `"${x}"`).join(", ");

  const section = <T>(
    title: string,
    items: T[],
    render: (item: T) => string,
  ): void => {
    if (items.length === 0) return;
    lines.push("", `${title} (${items.length}):`);
    for (const it of items.slice(0, MAX_PER_CATEGORY))
      lines.push(`  • ${render(it)}`);
    const extra = items.length - Math.min(items.length, MAX_PER_CATEGORY);
    if (extra > 0) lines.push(`  … and ${extra} more`);
  };

  section(
    "Unknown types",
    bag.incompatibleKeywords.unknownTypes,
    (x) => `at ${x.path}: ${x.types.map((t) => `"${t}"`).join(", ")}`,
  );

  section(
    "Unknown keywords",
    bag.unknownKeywords,
    (x) => `[${x.mode}] "${x.keyword}" at ${x.path}`,
  );

  section(
    "Missing type",
    bag.missingType,
    (x) =>
      `[${x.mode}] "${x.keyword}" at ${x.path} requires type ${x.validTypes.map((t) => `"${t}"`).join(" or ")}`,
  );

  section(
    "Strict required",
    bag.strictRequired,
    (x) =>
      `[${x.mode}] at ${x.path}, required references ${x.required.length === 1 ? "property" : "properties"} not in "properties": ${quote(x.required)}`,
  );

  section(
    "Incompatible keywords",
    bag.incompatibleKeywords.errors,
    (x) =>
      `[${x.mode}] "${x.keyword}" at ${x.path} not compatible with type ${x.types.map((t) => `"${t}"`).join(" or ")}`,
  );

  section(
    "Invalid keyword value types",
    bag.invalidKeywordTypes,
    (x) =>
      `"${x.keyword}" at ${x.path} must be of type "${x.validType}"${x.data ? " (or a $data reference)" : ""}`,
  );

  return lines.join("\n");
}
