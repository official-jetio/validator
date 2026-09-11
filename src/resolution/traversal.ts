import { SchemaDefinition } from "../types/schema";
import {
  baseSchemaKeys,
  dataKeywords,
  encodePointerSegment,
  incompatibleKeywords,
  isDataReference,
  keywordValueTypes,
  typeChecking,
} from "../utilities";
import {
  markPathsContainingRefs,
  processDynamicReference,
  processReference,
  registerAnchor,
  registerDynamicAnchor,
  resolveAndRegisterSchemaId,
} from "./helpers";
import {
  SchemaIdentifierEntry,
  SchemaMetadataCtx,
  SchemaTraversalState,
} from "./type";

export function collectSchemaMetadata(
  schema: SchemaDefinition | boolean,
  alreadyRegisteredAnchors: string[],
  ctx: SchemaMetadataCtx,
  state: SchemaTraversalState = {
    currentPath: "#",
    basePath: "#",
    anchorToPathMap: {},
    dynamicAnchorToPathMap: {},
    collectedRefs: [],
    identifiers: [],
    pathsContainingRefs: new Set(),
    pathsWithRef: [],
  },
): {
  collectedRefs: string[];
  identifiers: SchemaIdentifierEntry[];
  pathsContainingRefs: Set<string>;
  pathsWithRef: string[];
} {
  if (typeof schema === "boolean" || schema === null || schema === undefined) {
    return {
      collectedRefs: state.collectedRefs,
      identifiers: state.identifiers,
      pathsContainingRefs: state.pathsContainingRefs,
      pathsWithRef: state.pathsWithRef,
    };
  }

  if (
    schema.$ref !== undefined &&
    (ctx.options.draft === "draft6" || ctx.options.draft === "draft7")
  ) {
    Object.keys(schema).forEach((key) => {
      if (key !== "$ref") {
        delete schema[key];
      }
    });
  }

  validateStrictModeRequirements(schema, state.currentPath, ctx);

  collectCustomKeywords(schema, state.currentPath, ctx);

  if (
    schema.format &&
    typeof schema.format === "object" &&
    "$data" in schema.format
  ) {
    ctx.compilationContext.uses$Data = true;
  }

  const result = {
    collectedRefs: state.collectedRefs,
    identifiers: state.identifiers,
    pathsContainingRefs: state.pathsContainingRefs,
    pathsWithRef: state.pathsWithRef,
  };

  if (schema.$id) {
    if (schema.$id.startsWith("#")) {
      schema.$anchor = schema.$id.slice(1);
      schema.$id = undefined;
    } else {
      state.contextId = resolveAndRegisterSchemaId(schema, state);
    }
    state.basePath = state.currentPath;
    state.anchorToPathMap = {};
  }

  if (schema.$anchor) {
    registerAnchor(schema, state);
  }

  if (schema.$dynamicAnchor) {
    registerDynamicAnchor(schema, state, alreadyRegisteredAnchors);
  }

  if (schema.$ref) {
    const currentPath = state.currentPath;
    state.pathsWithRef.push(currentPath);
    if (ctx.options.inlineRefs) {
      markPathsContainingRefs(currentPath, state.pathsContainingRefs);
    }

    processReference(schema, state);
  }

  if (schema.$dynamicRef) {
    const currentPath = state.currentPath;
    state.pathsWithRef.push(currentPath);
    if (ctx.options.inlineRefs) {
      markPathsContainingRefs(currentPath, state.pathsContainingRefs);
    }
    processDynamicReference(schema, state);
  }

  if (schema.format && typeof schema.format === "string") {
    ctx.discoveredFormats.add(schema.format);
  }

  collectNestedSchemaMetadata(schema, alreadyRegisteredAnchors, ctx, state);

  return result;
}
function validateStrictModeRequirements(
  schema: SchemaDefinition,
  currentPath: string,
  ctx: SchemaMetadataCtx,
): void {
  const typeSpecificKeywords = new Set<string>(
    Object.values(incompatibleKeywords).flat(),
  );

  const strictTypes = ctx.options.strictTypes;
  if ((strictTypes || ctx.options.strict) && !schema.type) {
    const mode = strictTypes ? "strictTypes" : "strict";

    const keywords = Object.keys(schema).filter((kw) =>
      typeSpecificKeywords.has(kw),
    );

    for (const keyword of keywords) {
      const validTypes = Object.keys(incompatibleKeywords).filter(
        (type) =>
          !incompatibleKeywords[
            type as keyof typeof incompatibleKeywords
          ].includes(keyword),
      );
      if (strictTypes === "log") {
        console.warn(
          `Schema path ${currentPath} is missing the type keyword, validTypes: ${validTypes.join(", ")}`,
        );
      } else {
        ctx.schemaErrors.missingType.push({
          path: currentPath,
          validTypes,
          mode,
          keyword,
        });
      }
    }
  }

  if (
    (ctx.options.strictRequired || ctx.options.strict) &&
    Array.isArray(schema.required)
  ) {
    const mode = ctx.options.strictRequired ? "strictRequired" : "strict";

    const required = [];
    const props = schema.properties ?? {};
    for (const requiredField of schema.required) {
      if (!(requiredField in props)) required.push(requiredField as string);
    }

    if (required.length > 0) {
      ctx.schemaErrors.strictRequired.push({
        path: currentPath,
        required,
        mode,
      });
    }
  }

  if (schema.type && (ctx.options.strictSchema || ctx.options.strict)) {
    const mode = ctx.options.strictSchema ? "strictSchema" : "strict";
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];

    const allPossibleIncompatible = new Set<string>();

    const unknownTypes: string[] = [];
    for (const type of types) {
      const incompatible = incompatibleKeywords[type];
      if (incompatible) {
        incompatible.forEach((kw) => allPossibleIncompatible.add(kw));
      } else {
        unknownTypes.push(type);
      }
    }

    if (unknownTypes.length > 0)
      ctx.schemaErrors.incompatibleKeywords.unknownTypes.push({
        path: currentPath,
        types: unknownTypes,
      });

    const knownTypes = types.filter((t) => incompatibleKeywords[t]);
    if (knownTypes.length > 0)
      for (const keyword of Array.from(allPossibleIncompatible)) {
        const incompatibleWithAll = knownTypes.every((type) =>
          incompatibleKeywords[type].includes(keyword),
        );
        if (incompatibleWithAll && schema[keyword] !== undefined) {
          ctx.schemaErrors.incompatibleKeywords.errors.push({
            mode,
            keyword,
            path: currentPath,
            types,
          });
        }
      }

    for (const keyword of Object.keys(schema)) {
      const alType =
        keywordValueTypes[keyword as keyof typeof keywordValueTypes];
      if (!alType) continue;

      const value = schema[keyword];
      if (typeChecking(value, alType)) continue;
      if (dataKeywords.includes(keyword) && isDataReference(value)) continue;

      ctx.schemaErrors.invalidKeywordTypes.push({
        path: currentPath,
        validType: alType,
        data: dataKeywords.includes(keyword),
        keyword,
      });
    }
  }
}

function collectCustomKeywords(
  schema: SchemaDefinition,
  path: string,
  ctx: SchemaMetadataCtx,
): void {
  Object.keys(schema).forEach((keyword) => {
    if (!baseSchemaKeys.has(keyword)) {
      if (ctx.jetValidator.getAllKeywords().has(keyword)) {
        ctx.discoveredCustomKeywords.add(keyword);
      } else if (ctx.options.strictSchema || ctx.options.strict) {
        const mode = ctx.options.strictSchema ? "strictSchema" : "strict";
        ctx.schemaErrors.unknownKeywords.push({
          keyword,
          mode,
          path,
        });
      }
    }
  });
}

function collectNestedSchemaMetadata(
  schema: SchemaDefinition,
  existingAnchors: string[],
  ctx: SchemaMetadataCtx,
  state: SchemaTraversalState,
): void {
  const schemaMapLocations = [
    { key: "$defs", pathSegment: "$defs" },
    { key: "definitions", pathSegment: "definitions" },
    { key: "properties", pathSegment: "properties" },
    { key: "patternProperties", pathSegment: "patternProperties" },
    { key: "dependentSchemas", pathSegment: "dependentSchemas" },
  ];
  for (const location of schemaMapLocations) {
    if (schema[location.key]) {
      Object.entries(schema[location.key]).forEach(([key, subSchema]) => {
        const subPath = `${state.currentPath}/${location.pathSegment}/${encodePointerSegment(key)}`;
        collectSchemaMetadata(
          subSchema as SchemaDefinition | boolean,
          existingAnchors,
          ctx,
          { ...state, currentPath: subPath },
        );
      });
    }
  }

  if (
    schema.unevaluatedProperties !== undefined &&
    schema.unevaluatedProperties !== true
  ) {
    ctx.compilationContext.hasUnevaluatedProperties = true;
  }
  if (
    schema.unevaluatedItems !== undefined &&
    schema.unevaluatedItems !== true
  ) {
    ctx.compilationContext.hasUnevaluatedItems = true;
  }

  const singleSchemaLocations = [
    "additionalProperties",
    "unevaluatedProperties",
    "propertyNames",
    "items",
    "additionalItems",
    "unevaluatedItems",
    "contains",
    "not",
    "if",
    "then",
    "else",
  ];

  for (const key of singleSchemaLocations) {
    if (
      schema[key] &&
      typeof schema[key] === "object" &&
      !Array.isArray(schema[key]) &&
      schema[key] !== null
    ) {
      const subPath = `${state.currentPath}/${key}`;
      collectSchemaMetadata(schema[key], existingAnchors, ctx, {
        ...state,
        currentPath: subPath,
      });
    }
  }

  const arraySchemaLocations = ["allOf", "anyOf", "oneOf", "prefixItems"];

  for (const key of arraySchemaLocations) {
    if (Array.isArray(schema[key])) {
      schema[key].forEach((subSchema: any, index: number) => {
        const subPath = `${state.currentPath}/${key}/${index}`;
        collectSchemaMetadata(subSchema, existingAnchors, ctx, {
          ...state,
          currentPath: subPath,
        });
      });
    }
  }

  if (schema.items && Array.isArray(schema.items)) {
    schema.items.forEach((item, index) => {
      const subPath = `${state.currentPath}/items/${index}`;
      collectSchemaMetadata(item, existingAnchors, ctx, {
        ...state,
        currentPath: subPath,
      });
    });
  }

  if (schema.elseIf) {
    schema.elseIf.forEach((elseIfSchema: any, index: number) => {
      ["if", "then"].forEach((condKey) => {
        if (elseIfSchema[condKey]) {
          const subPath = `${state.currentPath}/elseIf/${index}/${condKey}`;
          collectSchemaMetadata(elseIfSchema[condKey], existingAnchors, ctx, {
            ...state,
            currentPath: subPath,
          });
        }
      });
    });
  }
}
