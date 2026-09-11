import { SchemaDefinition } from "..";
import { TrackingState, Extra, AccessSegment } from "../types/compiler";

function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function renderSegmentPath(seg: AccessSegment): string {
  switch (seg.kind) {
    case "key":
      return "/" + escapePointerToken(seg.value);
    case "index":
      return "/" + seg.value;
    case "dynamic":
      return "/${" + seg.expr + "}";
  }
}

export function renderSegmentAccess(seg: AccessSegment): string {
  switch (seg.kind) {
    case "key":
      return "[" + JSON.stringify(seg.value) + "]";
    case "index":
      return "[" + seg.value + "]";
    case "dynamic":
      return "[" + seg.expr + "]";
  }
}

export function generateTypeCheck(varName: any, type: string): string {
  switch (type) {
    case "integer":
      return `(typeof ${varName} === "number" && Number.isInteger(${varName}))`;
    case "null":
      return `${varName} === null`;
    case "array":
      return `(Array.isArray(${varName}))`;
    case "object":
      return `(${varName} !== null && typeof ${varName} === "object" && !Array.isArray(${varName}))`;
    case "number":
      return `(typeof ${varName} === "number" && Number.isFinite(${varName}))`;
    default:
      return `typeof ${varName} === "${type}"`;
  }
}

export const PRIMITIVE_TYPES = new Set([
  "number",
  "string",
  "boolean",
  "integer",
]);

export function shouldTrackProperties(
  schema: SchemaDefinition,
  trackingState: TrackingState,
  hasOwn: boolean = false,
) {
  if (hasOwn)
    return (
      schema.unevaluatedProperties !== undefined &&
      schema.additionalProperties === undefined
    );
  return (
    trackingState.parentHasUnevaluatedProperties === true ||
    (schema.unevaluatedProperties !== undefined &&
      schema.additionalProperties === undefined)
  );
}

export function shouldTrackItems(
  schema: SchemaDefinition,
  trackingState: TrackingState,
  hasOwn: boolean = false,
) {
  if (hasOwn)
    return (
      schema.unevaluatedItems !== undefined &&
      (schema.items === undefined ||
        (Array.isArray(schema.items) && schema.additionalItems === undefined))
    );
  return (
    trackingState.parentHasUnevaluatedItems === true ||
    (schema.unevaluatedItems !== undefined &&
      (schema.items === undefined ||
        (Array.isArray(schema.items) && schema.additionalItems === undefined)))
  );
}

export function addEvaluatedProperty(
  src: string[],
  prop: any,
  options: TrackingState,
): void {
  if (!options.shouldTrackEvaluatedProperties) return;

  src.push(
    options.hasOwnUnevaluatedProperties &&
      options.parentHasUnevaluatedProperties
      ? `${options.unEvaluatedPropertiesSetVar}.forEach(set => { set?.add(${prop}); });`
      : `${options.unevaluatedPropVar}?.add(${prop});`,
  );
}

export function addEvaluatedItems(
  src: string[],
  prop: any,
  options: TrackingState,
): void {
  if (!options.shouldTrackEvaluatedItems) return;

  src.push(
    options.hasOwnUnevaluatedItems && options.parentHasUnevaluatedItems
      ? `${options.unEvaluatedItemsSetVar}.forEach(set => { set?.add(${prop}); });`
      : `${options.unevaluatedItemVar}?.add(${prop});`,
  );
}

function unwrapSingle(varName: string): string {
  return `if (Array.isArray(${varName}) && ${varName}.length === 1) { ${varName} = ${varName}[0]; }`;
}

export function coerceToNumber(
  src: string[],
  varName: string,
  unwrap = false,
): void {
  if (unwrap) src.push(unwrapSingle(varName));
  src.push(
    `if (typeof ${varName} !== 'number'){`,
    `if (typeof ${varName} === 'string') {`,
    `  const trimmed = ${varName}.trim();`,
    `  if (trimmed !== '' && !isNaN(Number(trimmed))) {`,
    `    ${varName} = Number(trimmed);`,
    `  }`,
    `} else if (typeof ${varName} === 'boolean') {`,
    `  ${varName} = ${varName} ? 1 : 0;`,
    `}`,
    `}`,
  );
}

export function coerceToString(
  src: string[],
  varName: string,
  unwrap = false,
): void {
  if (unwrap) src.push(unwrapSingle(varName));
  src.push(
    `if (typeof ${varName} !== 'string'){`,
    `if (typeof ${varName} === 'number' || typeof ${varName} === 'boolean') {`,
    `  ${varName} = String(${varName});`,
    `}`,
    `}`,
  );
}

export function coerceToBoolean(
  src: string[],
  varName: string,
  unwrap = false,
): void {
  if (unwrap) src.push(unwrapSingle(varName));
  src.push(
    `if (typeof ${varName} !== 'boolean'){`,
    `if (typeof ${varName} === 'string') {`,
    `  const lower = ${varName}.toLowerCase();`,
    `  if (lower === 'true' || lower === '1') {`,
    `    ${varName} = true;`,
    `  } else if (lower === 'false' || lower === '0' || lower === '') {`,
    `    ${varName} = false;`,
    `  }`,
    `} else if (typeof ${varName} === 'number') {`,
    `  ${varName} = ${varName} !== 0;`,
    `}`,
    `}`,
  );
}

export function coerceToArray(src: string[], varName: string): void {
  src.push(
    `if (!Array.isArray(${varName}) && ${varName} !== undefined) {`,
    `  ${varName} = [${varName}];`,
    `}`,
  );
}

const IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const INDEX = /^\d+$/;

export function toAccessor(seg: AccessSegment): string {
  if (seg.kind === "index") return `[${seg.value}]`;
  if (seg.kind === "dynamic") return `[${seg.expr}]`;

  return IDENT.test(seg.value)
    ? `.${seg.value}`
    : `[${JSON.stringify(seg.value)}]`;
}

function parsePointerTail(ptr: string): AccessSegment[] {
  if (ptr === "") return [];
  return ptr.split("/").map((tok) => {
    if (tok.startsWith("${") && tok.endsWith("}")) {
      return { kind: "dynamic", expr: tok.slice(2, -1) };
    }
    const key = tok.replace(/~1/g, "/").replace(/~0/g, "~");
    return /^\d+$/.test(tok)
      ? { kind: "index", value: Number(key) }
      : { kind: "key", value: key };
  });
}

export function resolveDataPointerAtCompileTime(
  pointer: string,
  currentSegments: AccessSegment[],
  rootVar: string,
): string {
  let segments: AccessSegment[];

  if (pointer.startsWith("/")) {
    segments = parsePointerTail(pointer.slice(1));
  } else {
    const slash = pointer.indexOf("/");
    const levelsUp = parseInt(
      slash === -1 ? pointer : pointer.slice(0, slash),
      10,
    );
    const rest = slash === -1 ? "" : pointer.slice(slash + 1);
    const base =
      levelsUp === 0
        ? [...currentSegments]
        : currentSegments.slice(
            0,
            Math.max(0, currentSegments.length - levelsUp),
          );
    segments = base.concat(parsePointerTail(rest));
  }

  return segments.length === 0
    ? rootVar
    : rootVar + segments.map(toAccessor).join("");
}

export function generateNumberDataRef(
  src: string[],
  resolvedPath: string,
  extra: Extra,
  counter: number,
  integer?: boolean,
): string {
  const comparisonTarget = "$data" + counter;
  src.push(
    `const ${comparisonTarget} = ${resolvedPath};`,
    `if (${
      extra.before
    }typeof ${comparisonTarget} === 'number' && Number.isFinite(${comparisonTarget})${
      integer ? ` && Number.isInteger(${comparisonTarget})` : ""
    }) {`,
  );
  return comparisonTarget;
}

export function generateStringDataRef(
  src: string[],
  resolvedPath: string,
  extra: Extra,
  counter: number,
): string {
  const comparisonTarget = "$data" + counter;
  src.push(
    `const ${comparisonTarget} = ${resolvedPath};`,
    `if (${extra.before}typeof ${comparisonTarget} === 'string') {`,
  );
  return comparisonTarget;
}

export function generateUndefinedDataRef(
  src: string[],
  resolvedPath: string,
  extra: Extra,
  counter: number,
): string {
  const comparisonTarget = "$data" + counter;
  src.push(
    `const ${comparisonTarget} = ${resolvedPath};`,
    `if (${extra.before}${comparisonTarget} !== undefined) {`,
  );
  return comparisonTarget;
}

export function generateArrayDataRef(
  src: string[],
  resolvedPath: string,
  extra: Extra,
  counter: number,
): string {
  const comparisonTarget = "$data" + counter;
  src.push(
    `const ${comparisonTarget} = ${resolvedPath};`,
    `if (${extra.before}Array.isArray(${comparisonTarget})) {`,
  );
  return comparisonTarget;
}
