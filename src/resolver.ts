import { BaseSchema, SchemaDefinition } from "./types/schema";
import {
  getSchemaAtPath,
  shouldApplyKeyword,
  validateKeywordValue,
} from "./utilities";
import { ValidatorOptions } from "./types/validation";
import { JetValidator } from "./jet-validator";
import { MacroKeywordDefinition } from "./types/keywords";
import { incompatibleKeywords, baseSchemaKeys } from "./utilities/schema";

function sanitizeRefName(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9]/g, "_");
}

function splitUrlIntoPathAndFragment(pathUrl: string): {
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

interface ResolutionContext {
  isRootResolution: boolean;
  refToFunctionName: Map<string, string>;
  currentSchemaPath: string;
  schemaId?: string;
  rootHash?: string;
  localSchemaIds?: string[];
}

interface InitializedResolutionContext extends ResolutionContext {
  refToFunctionName: Map<string, string>;
}

interface SchemaIdentifierEntry {
  schemaPath: string;
  identifier: string;
  parentSchemaId?: string;
}

function resolveAndRegisterSchemaId(
  schema: any,
  currentContextId: string | undefined,
  currentPath: string,
  identifierRegistry: SchemaIdentifierEntry[],
): string {
  let resolvedId: string;

  if (schema.$id.startsWith("http")) {
    resolvedId = schema.$id;
  } else if (currentContextId?.startsWith("http")) {
    resolvedId = new URL(schema.$id, currentContextId).href;
    schema.$id = resolvedId;
  } else {
    resolvedId = schema.$id;
  }

  identifierRegistry.push({
    schemaPath: currentPath,
    identifier: resolvedId,
  });

  return resolvedId;
}

function registerAnchor(
  schema: any,
  currentPath: string,
  currentContextId: string | undefined,
  anchorToPathMap: Record<string, string>,
  identifierRegistry: SchemaIdentifierEntry[],
): void {
  const anchorName = schema.$anchor;
  anchorToPathMap[anchorName] = currentPath;

  if (schema.$id) {
    identifierRegistry.push(
      {
        schemaPath: currentPath,
        identifier: anchorName + ":ANCHOR",
        parentSchemaId: schema.$id,
      },
      {
        schemaPath: currentPath,
        identifier: schema.$id + "#" + anchorName + ":ANCHOR",
        parentSchemaId: schema.$id,
      },
    );
  } else {
    identifierRegistry.push({
      schemaPath: currentPath,
      identifier: anchorName + ":ANCHOR",
    });

    if (currentContextId) {
      identifierRegistry.push({
        schemaPath: currentPath,
        identifier: currentContextId + "#" + anchorName + ":ANCHOR",
      });
    }
  }
}

function registerDynamicAnchor(
  schema: any,
  currentPath: string,
  basePath: string,
  currentContextId: string | undefined,
  dynamicAnchorToPathMap: Record<string, string>,
  identifierRegistry: SchemaIdentifierEntry[],
  alreadyRegisteredAnchors: string[],
): void {
  const dynamicAnchorName = schema.$dynamicAnchor;
  const dynamicAnchorKey = dynamicAnchorName + ":DYNAMIC";

  if (alreadyRegisteredAnchors.includes(dynamicAnchorKey)) {
    return;
  }

  dynamicAnchorToPathMap[dynamicAnchorName] = currentPath;

  if (schema.$id) {
    alreadyRegisteredAnchors.push(dynamicAnchorKey);
    const isRootSchema = basePath === "#";

    identifierRegistry.push(
      {
        schemaPath: currentPath,
        identifier: schema.$id + "#" + dynamicAnchorKey,
        parentSchemaId: isRootSchema ? schema.$id : undefined,
      },
      {
        schemaPath: currentPath,
        identifier: dynamicAnchorKey,
        parentSchemaId: isRootSchema ? schema.$id : undefined,
      },
    );
  } else {
    identifierRegistry.push(
      {
        schemaPath: currentPath,
        identifier: dynamicAnchorKey,
      },
      {
        schemaPath: currentPath,
        identifier: currentContextId + "#" + dynamicAnchorKey,
      },
    );
  }
}

function processReference(
  schema: any,
  basePath: string,
  anchorToPathMap: Record<string, string>,
  currentContextId: string | undefined,
  collectedRefs: string[],
  currentPath: string,
  refPaths: string[],
  inline: boolean | undefined,
): void {
  const rawRef = schema.$ref;
  let resolvedRef: string;

  if (rawRef.startsWith("#/")) {
    resolvedRef = basePath ? basePath + rawRef.slice(1) : rawRef;
  } else if (rawRef.startsWith("#")) {
    if (rawRef === "#") {
      resolvedRef = rawRef;
    } else {
      const anchorName = rawRef.slice(1);
      resolvedRef = anchorToPathMap[anchorName] || rawRef + ":ANCHOR";
    }
  } else {
    let absoluteUrl: string;

    if (rawRef.startsWith("http")) {
      absoluteUrl = rawRef;
    } else if (currentContextId?.startsWith("http")) {
      absoluteUrl = new URL(rawRef, currentContextId).href;
    } else {
      absoluteUrl = rawRef;
    }

    if (absoluteUrl.includes("#")) {
      const urlParts = splitUrlIntoPathAndFragment(absoluteUrl);
      const isAnchorFragment =
        urlParts.hash &&
        urlParts.hash !== "#" &&
        !urlParts.hash.startsWith("#/");
      resolvedRef = isAnchorFragment ? absoluteUrl + ":ANCHOR" : absoluteUrl;
    } else {
      resolvedRef = absoluteUrl;
    }
  }

  if (!inline) {
    if (resolvedRef.startsWith("#/")) {
      refPaths.push(resolvedRef);
    }
    refPaths.push(currentPath);
  }

  schema.$ref = resolvedRef;
  collectedRefs.push(resolvedRef);
}

function processDynamicReference(
  schema: any,
  basePath: string,
  currentPath: string,
  currentContextId: string | undefined,
  collectedRefs: string[],
  refPaths: string[],
  inline: boolean | undefined,
): void {
  const rawDynamicRef = schema.$dynamicRef;
  let resolvedDynamicRef: string;

  if (rawDynamicRef.startsWith("#/")) {
    resolvedDynamicRef = basePath + rawDynamicRef.slice(1);
  } else if (rawDynamicRef.startsWith("#")) {
    if (rawDynamicRef === "#") {
      resolvedDynamicRef = rawDynamicRef;
    } else {
      resolvedDynamicRef = currentContextId + rawDynamicRef + ":DYNAMIC";
      collectedRefs.push(rawDynamicRef + ":DYNAMIC");
    }
  } else {
    let absoluteUrl: string;

    if (rawDynamicRef.startsWith("http")) {
      absoluteUrl = rawDynamicRef;
    } else {
      absoluteUrl = new URL(rawDynamicRef, currentContextId).href;
    }

    if (absoluteUrl.includes("#")) {
      const urlParts = splitUrlIntoPathAndFragment(absoluteUrl);

      const hasAnchorFragment =
        urlParts.hash &&
        urlParts.hash !== "#" &&
        !urlParts.hash.startsWith("#/");
      resolvedDynamicRef = hasAnchorFragment
        ? absoluteUrl + ":DYNAMIC"
        : absoluteUrl;
    } else {
      resolvedDynamicRef = absoluteUrl;
    }
  }

  if (!inline) {
    if (resolvedDynamicRef.startsWith("#/")) {
      refPaths.push(resolvedDynamicRef);
    }
    refPaths.push(currentPath);
  }

  collectedRefs.push(resolvedDynamicRef);
  schema.$dynamicRef = resolvedDynamicRef;
}

function markPathsContainingRefs(
  currentPath: string,
  pathsContainingRefs: Set<string>,
): void {
  const DEFINITION_KEYWORDS = new Set(["$defs", "definitions"]);
  pathsContainingRefs.add(currentPath);

  const pathSegments = currentPath
    .slice(1)
    .split("/")
    .filter((segment) => segment);

  for (let i = pathSegments.length - 1; i > 0; i--) {
    if (DEFINITION_KEYWORDS.has(pathSegments[i - 1])) {
      break;
    }
    const parentPath = "#/" + pathSegments.slice(0, i).join("/");
    pathsContainingRefs.add(parentPath);
  }

  if (pathSegments.length > 0 && !DEFINITION_KEYWORDS.has(pathSegments[0])) {
    pathsContainingRefs.add("#");
  }
}

export class SchemaResolver {
  private readonly externalSchemaRefMaps = new Map<
    string,
    Map<string, string>
  >();

  private readonly schemasToCompile: Array<{
    path: string;
    schema: SchemaDefinition | boolean;
    functionName: string;
  }> = [];

  rootFunctionName: string = "validate";
  private readonly compiledSchemaPaths: Map<string, Set<string>> = new Map();

  private processedExternalSchemas = new Map<string, SchemaDefinition>();

  private hasSetRootSchema: boolean = false;

  private discoveredFormats: Set<string> = new Set();

  private discoveredCustomKeywords: Set<string> = new Set();

  private jetValidator: JetValidator;

  private options: ValidatorOptions;

  private functionNameCounter: number = 0;

  private schemaIdToRefPaths: Map<string, Set<string>> = new Map();

  private currentlyResolvingSchemas = new Set<string>();

  private compilationContext: {
    hasUnevaluatedProperties: boolean;
    hasUnevaluatedItems: boolean;
    hasRootReference: boolean;
    referencedFunctions: string[];
    uses$Data: boolean;
    inliningStats: {
      totalRefs: number;
      inlinedRefs: number;
      functionRefs: number;
    };
  } = {
    hasUnevaluatedProperties: false,
    hasUnevaluatedItems: false,
    hasRootReference: false,
    referencedFunctions: [],
    uses$Data: false,
    inliningStats: {
      totalRefs: 0,
      inlinedRefs: 0,
      functionRefs: 0,
    },
  };

  constructor(jetValidator: JetValidator, options: ValidatorOptions) {
    this.jetValidator = jetValidator;
    this.options = options;
  }

  private clearResolutionState(): void {
    this.compiledSchemaPaths.forEach((set) => set.clear());
    this.compiledSchemaPaths.clear();
    this.externalSchemaRefMaps.forEach((map) => map.clear());
    this.externalSchemaRefMaps.clear();
    this.processedExternalSchemas.clear();
    this.schemaIdToRefPaths.forEach((set) => set.clear());
    this.schemaIdToRefPaths.clear();
  }

  private getOrCreateRefMapForSchema(
    entry: SchemaIdentifierEntry,
    context: InitializedResolutionContext,
  ): Map<string, string> {
    const identifier = entry.identifier;
    let mapKey: string;

    if (identifier.startsWith("http")) {
      mapKey = identifier;
    } else if (entry.parentSchemaId) {
      mapKey = entry.parentSchemaId;
    } else if (context.schemaId?.startsWith("http")) {
      mapKey = context.schemaId;
    } else {
      mapKey = identifier;
    }

    let refMap = this.externalSchemaRefMaps.get(mapKey);
    if (!refMap) {
      refMap = new Map();
      this.externalSchemaRefMaps.set(mapKey, refMap);
    }
    return refMap;
  }

  private getRefMapForIdentifier(
    entry: SchemaIdentifierEntry,
    context: InitializedResolutionContext,
  ): Map<string, string> | undefined {
    const identifier = entry.identifier;

    if (identifier.startsWith("http")) {
      return this.externalSchemaRefMaps.get(identifier);
    } else if (entry.parentSchemaId) {
      return this.externalSchemaRefMaps.get(entry.parentSchemaId);
    } else if (context.schemaId?.startsWith("http")) {
      return this.externalSchemaRefMaps.get(context.schemaId);
    }
    return this.externalSchemaRefMaps.get(identifier);
  }

  private trackSchemaPath(
    path: string,
    schemaUrl: string,
    contextId: string,
    additionalPaths: string[] = [],
  ): {
    isNewPath: boolean;
    existingUrlPaths?: Set<string>;
    existingContextPaths?: Set<string>;
  } {
    const existingUrlPaths = this.compiledSchemaPaths.get(schemaUrl);
    const existingContextPaths = this.compiledSchemaPaths.get(contextId);

    if (existingUrlPaths?.has(path) || existingContextPaths?.has(path)) {
      return { isNewPath: false, existingUrlPaths, existingContextPaths };
    }

    if (existingUrlPaths) {
      existingUrlPaths.add(path);
      additionalPaths.forEach((p) => existingUrlPaths.add(p));
    } else {
      const newSet = new Set([path, ...additionalPaths]);
      this.compiledSchemaPaths.set(schemaUrl, newSet);
    }

    if (path.startsWith("http") || schemaUrl !== contextId) {
      if (existingContextPaths) {
        existingContextPaths.add(path);
        additionalPaths.forEach((p) => existingContextPaths.add(p));
      } else {
        const newSet = new Set([path, ...additionalPaths]);
        this.compiledSchemaPaths.set(contextId, newSet);
      }
    }

    return { isNewPath: true, existingUrlPaths, existingContextPaths };
  }

  private generateFunctionName(identifier: string): string {
    const sanitized = sanitizeRefName(identifier);
    return `validate_${sanitized}_${this.functionNameCounter++}`;
  }

  private assignFunctionNamesToIdentifiers(
    identifiers: SchemaIdentifierEntry[],
    context: InitializedResolutionContext,
  ): void {
    for (const entry of identifiers) {
      const identifier = entry.identifier;

      if (context.refToFunctionName.has(identifier)) continue;

      if (entry.schemaPath === "#" && !this.hasSetRootSchema) {
        this.assignRootSchemaFunctionName(entry, context);
      } else {
        this.assignNonRootSchemaFunctionName(entry, context);
      }
    }
  }

  private assignRootSchemaFunctionName(
    entry: SchemaIdentifierEntry,
    context: InitializedResolutionContext,
  ): void {
    const existingRefMap = this.getRefMapForIdentifier(entry, context);
    const functionName =
      existingRefMap?.get(entry.schemaPath) ??
      existingRefMap?.get(entry.identifier) ??
      this.rootFunctionName;

    context.refToFunctionName.set(entry.identifier, functionName);
    context.refToFunctionName.set(entry.schemaPath, functionName);

    const refMap =
      existingRefMap || this.getOrCreateRefMapForSchema(entry, context);
    refMap.set(entry.identifier, functionName);
    refMap.set(entry.schemaPath, functionName);
  }

  private assignNonRootSchemaFunctionName(
    entry: SchemaIdentifierEntry,
    context: InitializedResolutionContext,
  ): void {
    const identifier = entry.identifier;
    let primaryRefMap: Map<string, string> | undefined;
    let secondaryRefMap: Map<string, string> | undefined;

    if (identifier.startsWith("http")) {
      primaryRefMap = this.externalSchemaRefMaps.get(identifier.split("#")[0]);
      secondaryRefMap = this.externalSchemaRefMaps.get(context.schemaId!);
    } else if (entry.parentSchemaId) {
      primaryRefMap = this.externalSchemaRefMaps.get(entry.parentSchemaId);
      if (entry.parentSchemaId.startsWith("https")) {
        secondaryRefMap = this.externalSchemaRefMaps.get(context.schemaId!);
      }
    } else {
      primaryRefMap = this.externalSchemaRefMaps.get(context.schemaId!);
    }

    let functionName =
      primaryRefMap?.get(entry.schemaPath) ??
      primaryRefMap?.get(identifier) ??
      secondaryRefMap?.get(entry.schemaPath) ??
      secondaryRefMap?.get(identifier);

    if (functionName) {
      context.refToFunctionName.set(identifier, functionName);
    } else {
      functionName = this.generateFunctionName(identifier);

      context.refToFunctionName.set(identifier, functionName);
      context.refToFunctionName.set(entry.schemaPath, functionName);

      const refMap =
        primaryRefMap || this.getOrCreateRefMapForSchema(entry, context);
      refMap.set(identifier, functionName);
      refMap.set(entry.schemaPath, functionName);

      const needsSecondaryUpdate =
        identifier.startsWith("http") ||
        entry.parentSchemaId?.startsWith("https");

      if (needsSecondaryUpdate) {
        if (secondaryRefMap) {
          secondaryRefMap.set(identifier, functionName);
          secondaryRefMap.set(entry.schemaPath, functionName);
        } else {
          const newMap = new Map<string, string>();
          this.externalSchemaRefMaps.set(context.schemaId!, newMap);
          newMap.set(identifier, functionName);
          newMap.set(entry.schemaPath, functionName);
        }
      }
    }
  }

  private assignFunctionNamesToReferences(
    references: string[],
    context: InitializedResolutionContext,
    identifierToPath: Record<string, string>,
  ): void {
    for (const ref of references) {
      const refKey = ref.startsWith("#/")
        ? ref
        : ref.startsWith("#") && ref !== "#"
          ? ref.slice(1)
          : ref;

      if (context.refToFunctionName.has(refKey)) continue;

      if (ref.startsWith("#")) {
        this.assignHashRefFunctionName(ref, context);
      } else {
        this.assignExternalRefFunctionName(ref, context, identifierToPath);
      }
    }
  }

  private assignHashRefFunctionName(
    ref: string,
    context: InitializedResolutionContext,
  ): void {
    if (ref === "#" && !this.hasSetRootSchema) {
      context.refToFunctionName.set(ref, this.rootFunctionName);
      return;
    }

    if (!context.schemaId) {
      const functionName = this.generateFunctionName(ref);
      context.refToFunctionName.set(ref, functionName);
      return;
    }

    const urlParts = splitUrlIntoPathAndFragment(context.schemaId);
    const existingRefMap = this.externalSchemaRefMaps.get(urlParts.path);

    if (existingRefMap) {
      const existingFunction = existingRefMap.get(ref);
      if (existingFunction) {
        context.refToFunctionName.set(ref, existingFunction);
      } else {
        const functionName = this.generateFunctionName(ref);
        existingRefMap.set(ref, functionName);
        context.refToFunctionName.set(ref, functionName);
      }
    } else {
      const newMap = new Map<string, string>();
      const functionName = this.generateFunctionName(ref);
      newMap.set(ref, functionName);
      context.refToFunctionName.set(ref, functionName);
      this.externalSchemaRefMaps.set(urlParts.path, newMap);
    }
  }

  private assignExternalRefFunctionName(
    ref: string,
    context: InitializedResolutionContext,
    identifierToPath: Record<string, string>,
  ): void {
    const urlParts = splitUrlIntoPathAndFragment(ref);
    const baseUrl = urlParts.path;

    let localPath: string | undefined;
    if (identifierToPath[baseUrl]) {
      const fragment = urlParts.hash ?? "";
      localPath =
        identifierToPath[baseUrl] +
        (fragment.startsWith("#/") ? fragment.slice(1) : "");
    }

    if (localPath === undefined) {
      this.assignHttpRefFunctionName(ref, urlParts, context);
    } else {
      this.assignIdentifierPathRefFunctionName(
        ref,
        baseUrl,
        localPath,
        context,
        identifierToPath,
      );
    }
  }

  private assignHttpRefFunctionName(
    ref: string,
    urlParts: { path: string; hash?: string },
    context: InitializedResolutionContext,
  ): void {
    const baseUrl = urlParts.path;
    const fragment = urlParts.hash;
    const existingRefMap = this.externalSchemaRefMaps.get(baseUrl);

    if (existingRefMap) {
      if (fragment) {
        const existingFragmentFunction = existingRefMap.get(fragment);
        if (existingFragmentFunction) {
          context.refToFunctionName.set(ref, existingFragmentFunction);
        } else {
          const functionName = this.generateFunctionName(fragment);
          context.refToFunctionName.set(ref, functionName);

          if (fragment.startsWith("#/")) {
            existingRefMap.set(fragment, functionName);
          } else {
            existingRefMap.set(fragment.slice(1), functionName);
          }
          existingRefMap.set(ref, functionName);
        }
      }

      if (existingRefMap.has(baseUrl)) {
        context.refToFunctionName.set(ref, existingRefMap.get(baseUrl)!);
      } else {
        const functionName = this.generateFunctionName(baseUrl);
        context.refToFunctionName.set(ref, functionName);
        existingRefMap.set(baseUrl, functionName);
        existingRefMap.set("#", functionName);
      }
    } else {
      const newMap = new Map<string, string>();
      this.externalSchemaRefMaps.set(baseUrl, newMap);

      if (fragment) {
        const functionName = this.generateFunctionName(fragment);
        context.refToFunctionName.set(ref, functionName);

        if (fragment.startsWith("#/")) {
          newMap.set(fragment, functionName);
        } else {
          newMap.set(fragment.slice(1), functionName);
        }
        newMap.set(ref, functionName);
      }

      const baseFunctionName = this.generateFunctionName(baseUrl);
      context.refToFunctionName.set(baseUrl, baseFunctionName);
      newMap.set(baseUrl, baseFunctionName);
      newMap.set("#", baseFunctionName);
    }
  }

  private assignIdentifierPathRefFunctionName(
    ref: string,
    baseUrl: string,
    localPath: string,
    context: InitializedResolutionContext,
    identifierToPath: Record<string, string>,
  ): void {
    const fragment = splitUrlIntoPathAndFragment(ref).hash ?? "";

    if (fragment && !fragment.startsWith("#/")) {
      if (!identifierToPath[ref]) {
        return;
      } else {
        const functionName = context.refToFunctionName.get(ref)!;
        context.refToFunctionName.set(ref, functionName);
      }
    }

    const existingRefMap = this.externalSchemaRefMaps.get(baseUrl);

    if (existingRefMap) {
      const existingFunction = existingRefMap.get(localPath);
      if (existingFunction) {
        context.refToFunctionName.set(ref, existingFunction);
        context.refToFunctionName.set(localPath, existingFunction);
      } else {
        const functionName = this.generateFunctionName(localPath);
        context.refToFunctionName.set(ref, functionName);
        context.refToFunctionName.set(localPath, functionName);
        existingRefMap.set(localPath, functionName);
        existingRefMap.set(ref, functionName);
      }
    } else {
      const newMap = new Map<string, string>();
      this.externalSchemaRefMaps.set(baseUrl, newMap);
      const functionName = this.generateFunctionName(localPath);
      context.refToFunctionName.set(ref, functionName);
      newMap.set(ref, functionName);
      newMap.set(localPath, functionName);
    }
  }

  private preprocessSchema(
    rootSchema: SchemaDefinition,
    context: ResolutionContext,
  ) {
    const {
      refs: collectedRefs,
      ids: identifiers,
      pathsWithRefs: pathsContainingRefs,
      refPaths: pathsOfRefs,
    } = this.collectSchemaMetadata(
      rootSchema,
      Array.from(context.refToFunctionName.keys()),
    );

    this.assignFunctionNamesToIdentifiers(
      identifiers,
      context as InitializedResolutionContext,
    );

    const identifierToPath = identifiers.reduce(
      (map: Record<string, string>, entry) => {
        if (map[entry.identifier] === undefined) {
          map[entry.identifier] = entry.schemaPath;
        }
        return map;
      },
      {},
    );

    this.assignFunctionNamesToReferences(
      collectedRefs,
      context as InitializedResolutionContext,
      identifierToPath,
    );

    this.hasSetRootSchema = true;

    const localIdentifiers = identifiers.map((entry) => entry.identifier);
    context.localSchemaIds = localIdentifiers;

    this.initializeIdentifiedSchemas(
      rootSchema,
      identifiers,
      context as ResolutionContext & { schemaId: string },
      collectedRefs,
    );

    return {
      collectedRefs,
      localIdentifiers,
      identifiers,
      identifierToPath,
      pathsContainingRefs,
      pathsOfRefs,
    };
  }

  private expandMacros(
    schema: SchemaDefinition,
    macroContext: {
      schemaPath: string;
      rootSchema: SchemaDefinition;
    },
  ): SchemaDefinition {
    if (typeof schema !== "object" || schema === null) {
      return schema;
    }

    let expandedSchema = schema;
    const implementedKeywords = new Set<string>();

    for (const [keyword, value] of Object.entries(schema)) {
      const keywordDef = this.jetValidator.getKeyword(
        keyword,
      ) as MacroKeywordDefinition;

      if (!keywordDef?.macro) continue;
      if (!shouldApplyKeyword(keywordDef, value)) continue;

      if (keywordDef.metaSchema) {
        validateKeywordValue(
          keyword,
          value,
          keywordDef.metaSchema,
          this.jetValidator,
        );
      }

      const macroResult = keywordDef.macro(value, schema, {
        schemaPath: `${macroContext.schemaPath}/${keyword}`,
        rootSchema: macroContext.rootSchema,
        opts: { ...this.options },
      });

      if (typeof macroResult === "object" && macroResult !== null) {
        Object.assign(expandedSchema, macroResult);
      } else {
        expandedSchema = macroResult as any;
        break;
      }

      delete expandedSchema[keyword];

      if (keywordDef.implements) {
        const implemented = Array.isArray(keywordDef.implements)
          ? keywordDef.implements
          : [keywordDef.implements];
        implemented.forEach((k) => implementedKeywords.add(k));
      }
    }

    for (const implKeyword of Array.from(implementedKeywords)) {
      delete expandedSchema[implKeyword];
    }

    expandedSchema = this.expandMacrosRecursively(expandedSchema, macroContext);
    return expandedSchema;
  }

  private expandMacrosRecursively(
    schema: SchemaDefinition,
    macroContext: { schemaPath: string; rootSchema: SchemaDefinition },
  ): SchemaDefinition {
    if (typeof schema !== "object" || schema === null) {
      return schema;
    }

    const expandNestedSchema = (
      key: keyof SchemaDefinition,
      pathSegment: string,
    ) => {
      if (
        schema[key] &&
        typeof schema[key] === "object" &&
        !Array.isArray(schema[key])
      ) {
        schema[key] = this.expandMacros(schema[key] as SchemaDefinition, {
          schemaPath: `${macroContext.schemaPath}/${pathSegment}`,
          rootSchema: macroContext.rootSchema,
        });
      }
    };

    const expandSchemaMap = (
      key:
        | "properties"
        | "patternProperties"
        | "dependentSchemas"
        | "$defs"
        | "definitions",
    ) => {
      if (schema[key]) {
        for (const [propKey, propSchema] of Object.entries(
          schema[key] as Record<string, SchemaDefinition>,
        )) {
          if (typeof propSchema === "object" && propSchema !== null) {
            schema[key]![propKey] = this.expandMacros(propSchema, {
              schemaPath: `${macroContext.schemaPath}/${key}/${propKey}`,
              rootSchema: macroContext.rootSchema,
            });
          }
        }
      }
    };

    const expandSchemaArray = (
      key: "allOf" | "anyOf" | "oneOf" | "prefixItems" | "items",
      pathSegment?: string,
    ) => {
      if (schema[key] && Array.isArray(schema[key])) {
        schema[key] = (schema[key] as SchemaDefinition[]).map((subSchema, i) =>
          typeof subSchema === "object" && subSchema !== null
            ? this.expandMacros(subSchema, {
                schemaPath: `${macroContext.schemaPath}/${
                  pathSegment ?? key
                }/${i}`,
                rootSchema: macroContext.rootSchema,
              })
            : subSchema,
        );
      }
    };

    expandSchemaMap("properties");
    expandSchemaMap("patternProperties");
    expandSchemaMap("dependentSchemas");
    expandSchemaMap("$defs");
    expandSchemaMap("definitions");

    if (schema.items) {
      if (Array.isArray(schema.items)) {
        expandSchemaArray("items");
      } else {
        expandNestedSchema("items", "items");
      }
    }

    expandSchemaArray("prefixItems");
    for (const combiner of ["allOf", "anyOf", "oneOf"] as const) {
      expandSchemaArray(combiner);
    }

    expandNestedSchema("contains", "contains");
    expandNestedSchema("not", "not");
    expandNestedSchema("if", "if");
    expandNestedSchema("then", "then");
    expandNestedSchema("additionalProperties", "additionalProperties");
    expandNestedSchema("unevaluatedProperties", "unevaluatedProperties");
    expandNestedSchema("propertyNames", "propertyNames");
    expandNestedSchema("additionalItems", "additionalItems");
    expandNestedSchema("unevaluatedItems", "unevaluatedItems");

    if (schema.elseIf && Array.isArray(schema.elseIf)) {
      schema.elseIf = schema.elseIf.map((elseIfItem, i) => {
        const expandedElseIf: any = {};

        if (elseIfItem.if && typeof elseIfItem.if === "object") {
          expandedElseIf.if = this.expandMacros(
            elseIfItem.if as SchemaDefinition,
            {
              schemaPath: `${macroContext.schemaPath}/elseIf/${i}/if`,
              rootSchema: macroContext.rootSchema,
            },
          );
        }

        if (elseIfItem.then && typeof elseIfItem.then === "object") {
          expandedElseIf.then = this.expandMacros(
            elseIfItem.then as SchemaDefinition,
            {
              schemaPath: `${macroContext.schemaPath}/elseIf/${i}/then`,
              rootSchema: macroContext.rootSchema,
            },
          );
        }

        return expandedElseIf;
      });
    }

    expandNestedSchema("else", "else");
    return schema;
  }

  private logInliningSummary(): void {
    const total = this.compilationContext.inliningStats.totalRefs;
    const inlined = this.compilationContext.inliningStats.inlinedRefs;
    const skipped =
      this.compilationContext.inliningStats.totalRefs -
      this.compilationContext.inliningStats.inlinedRefs;
    const rate = ((inlined / total) * 100).toFixed(1);

    console.log(`\n[Resolver] Inlining Summary:`);
    console.log(`  Total references: ${total}`);
    console.log(`  Inlined: ${inlined} (${rate}%)`);
    console.log(`  Skipped: ${skipped} (contain circular)`);
    console.log(`  Function calls saved: ~${inlined}`);
  }

  async resolveAsync(
    schema: SchemaDefinition | boolean,
    loadSchema?: (uri: string) => Promise<SchemaDefinition> | SchemaDefinition,
  ) {
    if (typeof schema === "boolean") {
      return {
        schema,
        refables: this.schemasToCompile,
        allFormats: this.discoveredFormats,
        keywords: this.discoveredCustomKeywords,
        compileContext: this.compilationContext,
      };
    }

    let processedSchema = schema;

    if (this.jetValidator.hasMacroKeywords()) {
      processedSchema = this.expandMacros(schema, {
        schemaPath: "#",
        rootSchema: schema,
      });
    }

    const result = await this.resolveSchemaAsync(
      processedSchema,
      {
        isRootResolution: true,
        currentSchemaPath: "#",
        refToFunctionName: new Map(),
      },
      loadSchema,
    );
    if (
      this.options.debug &&
      this.compilationContext.inliningStats.totalRefs > 0
    )
      this.logInliningSummary();
    this.clearResolutionState();

    return {
      schema: result.schema,
      refables: this.schemasToCompile,
      allFormats: this.discoveredFormats,
      keywords: this.discoveredCustomKeywords,
      compileContext: this.compilationContext,
    };
  }

  resolveSync(schema: SchemaDefinition | boolean) {
    if (typeof schema === "boolean") {
      return {
        schema,
        refables: this.schemasToCompile,
        allFormats: this.discoveredFormats,
        keywords: this.discoveredCustomKeywords,
        compileContext: this.compilationContext,
      };
    }

    let processedSchema = schema;

    if (this.jetValidator.hasMacroKeywords()) {
      processedSchema = this.expandMacros(schema, {
        schemaPath: "#",
        rootSchema: schema,
      });
    }

    const result = this.resolveSchemaSynchronously(processedSchema, {
      isRootResolution: true,
      currentSchemaPath: "#",
      refToFunctionName: new Map(),
    }).schema;
    if (
      this.options.debug &&
      this.compilationContext.inliningStats.totalRefs > 0
    )
      this.logInliningSummary();
    this.clearResolutionState();

    return {
      schema: result,
      refables: this.schemasToCompile,
      allFormats: this.discoveredFormats,
      keywords: this.discoveredCustomKeywords,
      compileContext: this.compilationContext,
    };
  }

  private async resolveSchemaAsync(
    rootSchema: SchemaDefinition | boolean,
    context: ResolutionContext = {
      isRootResolution: false,
      refToFunctionName: new Map<string, string>(),
      currentSchemaPath: "#",
    },
    loadSchema?: (uri: string) => Promise<SchemaDefinition> | SchemaDefinition,
  ): Promise<{
    schema: SchemaDefinition | boolean;
    idPaths: Record<string, string>;
    refs: string[];
  }> {
    if (rootSchema === true || rootSchema === false) {
      return { schema: rootSchema, idPaths: {}, refs: [] };
    }

    const schema = (
      context.isRootResolution ? structuredClone(rootSchema) : rootSchema
    ) as SchemaDefinition;

    this.initializeResolutionContext(schema, context);

    let identifierToPath: Record<string, string> = {};
    const collectedRefs: string[] = [];
    let pathsContainingRefs: Set<string> | undefined;
    let pathsOfRefs: string[] = [];

    if (context.isRootResolution) {
      const preprocessResult = this.preprocessSchema(schema, context);

      pathsContainingRefs = preprocessResult.pathsContainingRefs;
      pathsOfRefs = preprocessResult.pathsOfRefs;
      identifierToPath = preprocessResult.identifierToPath;
      collectedRefs.push(...preprocessResult.collectedRefs);

      for (const ref of preprocessResult.collectedRefs) {
        if (ref === "#") continue;
        if (preprocessResult.localIdentifiers.includes(ref)) continue;

        const shouldSkip = this.shouldSkipReference(
          ref,
          context as ResolutionContext & { schemaId: string },
          identifierToPath,
        );
        if (shouldSkip) continue;

        const urlParts = splitUrlIntoPathAndFragment(ref);
        const isExternalRef =
          !ref.startsWith("#") &&
          !preprocessResult.localIdentifiers.includes(urlParts.path);
        if (isExternalRef) {
          await this.resolveExternalSchemaAsync(
            ref,
            preprocessResult.identifiers,
            context,
            loadSchema,
          );
        } else if (ref.startsWith("#/") || !ref.startsWith("#")) {
          this.resolveLocalReference(
            schema,
            ref,
            identifierToPath,
            context as ResolutionContext & { schemaId: string },
          );
        }
      }
    }

    if (this.options.inlineRefs) {
      this.compilationContext.inliningStats.totalRefs += pathsOfRefs.length;
      this.processInlining(
        schema,
        context,
        identifierToPath,
        pathsOfRefs,
        pathsContainingRefs,
      );
    } else {
      for (const path of pathsOfRefs) {
        this.resolveReferenceAtPath(
          getSchemaAtPath(schema, path),
          schema,
          context.refToFunctionName,
          path,
          pathsOfRefs,
          identifierToPath,
          context.localSchemaIds,
          false,
        );
      }
    }

    return {
      schema,
      idPaths: identifierToPath,
      refs: collectedRefs,
    };
  }

  private resolveSchemaSynchronously(
    rootSchema: SchemaDefinition | boolean,
    context: ResolutionContext = {
      isRootResolution: false,
      refToFunctionName: new Map<string, string>(),
      currentSchemaPath: "#",
    },
  ): {
    schema: SchemaDefinition | boolean;
    idPaths: Record<string, string>;
    refs: string[];
  } {
    if (rootSchema === true || rootSchema === false) {
      return { schema: rootSchema, idPaths: {}, refs: [] };
    }

    const schema = (
      context.isRootResolution ? structuredClone(rootSchema) : rootSchema
    ) as SchemaDefinition;

    this.initializeResolutionContext(schema, context);

    let identifierToPath: Record<string, string> = {};
    const collectedRefs: string[] = [];
    let pathsContainingRefs: Set<string> | undefined;
    let pathsOfRefs: string[] = [];

    if (context.isRootResolution) {
      const preprocessResult = this.preprocessSchema(schema, context);

      pathsContainingRefs = preprocessResult.pathsContainingRefs;
      pathsOfRefs = preprocessResult.pathsOfRefs;
      identifierToPath = preprocessResult.identifierToPath;
      collectedRefs.push(...preprocessResult.collectedRefs);

      for (const ref of preprocessResult.collectedRefs) {
        if (ref === "#") continue;
        if (preprocessResult.localIdentifiers.includes(ref)) continue;

        const shouldSkip = this.shouldSkipReference(
          ref,
          context as ResolutionContext & { schemaId: string },
          identifierToPath,
        );
        if (shouldSkip) continue;

        const urlParts = splitUrlIntoPathAndFragment(ref);
        const isExternalRef =
          !ref.startsWith("#") &&
          !preprocessResult.localIdentifiers.includes(urlParts.path);

        if (isExternalRef) {
          this.resolveExternalSchemaSync(
            ref,
            preprocessResult.identifiers,
            context,
          );
        } else if (ref.startsWith("#/") || !ref.startsWith("#")) {
          this.resolveLocalReference(
            schema,
            ref,
            identifierToPath,
            context as ResolutionContext & { schemaId: string },
          );
        }
      }
    }

    if (this.options.inlineRefs) {
      this.compilationContext.inliningStats.totalRefs += pathsOfRefs.length;
      this.processInlining(
        schema,
        context,
        identifierToPath,
        pathsOfRefs,
        pathsContainingRefs,
      );
    } else {
      for (const path of pathsOfRefs) {
        this.resolveReferenceAtPath(
          getSchemaAtPath(schema, path),
          schema,
          context.refToFunctionName,
          path,
          pathsOfRefs,
          identifierToPath,
          context.localSchemaIds,
          false,
        );
      }
    }

    return {
      schema,
      idPaths: identifierToPath,
      refs: collectedRefs,
    };
  }

  private processInlining(
    schema: SchemaDefinition,
    context: ResolutionContext,
    identifierToPath: Record<string, string>,
    pathsOfRefs: string[],
    pathsContainingRefs?: Set<string>,
  ): void {
    if (context.isRootResolution && context.schemaId) {
      if (!pathsContainingRefs) pathsContainingRefs = new Set();
      this.schemaIdToRefPaths.set(context.schemaId, pathsContainingRefs);
    }
    const processRefType = (
      refType: "$ref" | "$dynamicRef",
      schemaAtPath: SchemaDefinition,
      path: string,
    ): boolean => {
      const refValue = schemaAtPath[refType];
      if (!refValue) return false;

      if (refValue.startsWith("#/")) {
        const skipInline = pathsContainingRefs?.has(refValue);

        if (skipInline) {
          if (this.options.debug) {
            console.log(
              `[Resolver - ${context.schemaId}] Skipping Inlining ${refType} at ${path} (${refValue} contains refs)`,
            );
          }
          return false;
        }

        delete schemaAtPath[refType];
        const objectKeys = Object.keys(schemaAtPath).length;
        const targetSchema = getSchemaAtPath(schema, refValue);
        if (objectKeys === 0) {
          if (typeof targetSchema === "object") {
            Object.assign(schemaAtPath, targetSchema);
          } else {
            schemaAtPath.__inlinedRef = targetSchema;
          }
        } else if (objectKeys === 1 && "$id" in schemaAtPath) {
          if (typeof targetSchema === "object") {
            const previousId = schemaAtPath.$id;
            Object.assign(schemaAtPath, targetSchema);
            schemaAtPath.$id = previousId;
          } else {
            schemaAtPath.__inlinedRef = targetSchema;
          }
        } else {
          schemaAtPath.__inlinedRef = targetSchema;
        }
        pathsContainingRefs?.delete(path);

        const pathParts = path.split("/");
        for (let j = pathParts.length - 1; j > 0; j--) {
          const currentPath = pathParts.slice(0, j).join("/");
          const childRefsCount = Array.from(pathsContainingRefs || []).filter(
            (p) => p.startsWith(currentPath),
          ).length;
          if (childRefsCount === 1) {
            pathsContainingRefs?.delete(currentPath);
          } else {
            break;
          }
        }

        if (this.options.debug) {
          console.log(
            `[Resolver - ${context.schemaId}] Inlining ${refType} at ${path} -> ${refValue}`,
          );
        }

        this.compilationContext.inliningStats.inlinedRefs++;
        return true;
      } else {
        let urlParts: { path: string; hash?: string };
        if (refValue.startsWith("#")) {
          urlParts = { path: context.schemaId || "", hash: refValue };
        } else {
          urlParts = splitUrlIntoPathAndFragment(refValue);
        }
        let lookupKey = this.computeLookupKey(
          refValue,
          urlParts,
          refType,
          context,
        );

        if (lookupKey && lookupKey !== "#") {
          if (lookupKey.startsWith("#") && !lookupKey.startsWith("#/")) {
            lookupKey = lookupKey.slice(1);
          }
          if (lookupKey.endsWith("#")) {
            lookupKey = lookupKey.slice(0, -1);
          }
        }

        let referencedPath: string | undefined;
        if (lookupKey.startsWith("#/")) {
          if (identifierToPath[urlParts.path]) {
            referencedPath =
              identifierToPath[urlParts.path] + lookupKey.slice(1);
          }
        } else {
          referencedPath = identifierToPath[lookupKey];
        }

        if (referencedPath && !pathsContainingRefs?.has(referencedPath)) {
          const targetSchema = getSchemaAtPath(schema, referencedPath);
          delete schemaAtPath[refType];
          const objectKeys = Object.keys(schemaAtPath).length;
          if (objectKeys === 0) {
            if (typeof targetSchema === "object") {
              Object.assign(schemaAtPath, targetSchema);
            } else {
              schemaAtPath.__inlinedRef = targetSchema;
            }
          } else if (objectKeys === 1 && "$id" in schemaAtPath) {
            if (typeof targetSchema === "object") {
              const previousId = schemaAtPath.$id;
              Object.assign(schemaAtPath, targetSchema);
              schemaAtPath.$id = previousId;
            } else {
              schemaAtPath.__inlinedRef = targetSchema;
            }
          } else {
            schemaAtPath.__inlinedRef = targetSchema;
          }
          pathsContainingRefs?.delete(path);

          const pathParts = path.split("/");
          for (let j = pathParts.length - 1; j > 0; j--) {
            const currentPath = pathParts.slice(0, j).join("/");
            const childRefsCount = Array.from(pathsContainingRefs || []).filter(
              (p) => p.startsWith(currentPath),
            ).length;
            if (childRefsCount === 1) {
              pathsContainingRefs?.delete(currentPath);
            } else {
              break;
            }
          }

          if (this.options.debug) {
            console.log(
              `[Resolver - ${context.schemaId}] Inlining ${refType} at ${path} -> ${referencedPath}`,
            );
          }

          this.compilationContext.inliningStats.inlinedRefs++;
          return true;
        } else if (referencedPath && this.options.debug) {
          console.log(
            `[Resolver - ${context.schemaId}] Skipping Inlining ${refType} at ${path} (${referencedPath} contains refs)`,
          );
        }

        if (!referencedPath) {
          const externalSchema = this.processedExternalSchemas.get(
            urlParts.path,
          );

          if (externalSchema) {
            if (lookupKey.startsWith("#/")) {
              if (externalSchema.idPaths[urlParts.path]) {
                referencedPath =
                  externalSchema.idPaths[urlParts.path] + lookupKey.slice(1);
              }
            } else {
              referencedPath = externalSchema.idPaths[lookupKey];
            }

            if (
              referencedPath &&
              !this.schemaIdToRefPaths.get(urlParts.path)?.has(referencedPath)
            ) {
              const targetSchema = getSchemaAtPath(
                externalSchema,
                referencedPath,
              );
              delete schemaAtPath[refType];
              const objectKeys = Object.keys(schemaAtPath).length;
              if (objectKeys === 0) {
                if (typeof targetSchema === "object") {
                  Object.assign(schemaAtPath, targetSchema);
                } else {
                  schemaAtPath.__inlinedRef = targetSchema;
                }
              } else if (objectKeys === 1 && "$id" in schemaAtPath) {
                if (typeof targetSchema === "object") {
                  const previousId = schemaAtPath.$id;
                  Object.assign(schemaAtPath, targetSchema);
                  schemaAtPath.$id = previousId;
                } else {
                  schemaAtPath.__inlinedRef = targetSchema;
                }
              } else {
                schemaAtPath.__inlinedRef = targetSchema;
              }
              pathsContainingRefs?.delete(path);
              const pathParts = path.split("/");
              for (let j = pathParts.length - 1; j > 0; j--) {
                const currentPath = pathParts.slice(0, j).join("/");
                const childRefsCount = Array.from(
                  pathsContainingRefs || [],
                ).filter((p) => p.startsWith(currentPath)).length;
                if (childRefsCount === 1) {
                  pathsContainingRefs?.delete(currentPath);
                } else {
                  break;
                }
              }

              if (this.options.debug) {
                console.log(
                  `[Resolver] Inlining ${refType} at ${path} -> ${urlParts.path + referencedPath} - (external schema)`,
                );
              }

              this.compilationContext.inliningStats.inlinedRefs++;
              return true;
            } else if (referencedPath && this.options.debug) {
              console.log(
                `[Resolver - ${context.schemaId}] Skipping Inlining ${refType} at ${path} (${urlParts.path + referencedPath} contains refs) - (external schema)`,
              );
            }
          }
        }

        this.resolveReferenceAtPath(
          schemaAtPath,
          schema,
          context.refToFunctionName,
          path,
          pathsOfRefs,
          identifierToPath,
          context.localSchemaIds,
          false,
        );
        return false;
      }
    };
    if (pathsOfRefs.length > 0) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = pathsOfRefs.length - 1; i >= 0; i--) {
          const path = pathsOfRefs[i];
          const schemaAtPath = getSchemaAtPath(schema, path);
          if (typeof schemaAtPath !== "object") continue;
          const hasRef = schemaAtPath.$ref !== undefined;
          const hasDynamicRef = schemaAtPath.$dynamicRef !== undefined;
          let refProcessed = false;
          if (hasRef && processRefType("$ref", schemaAtPath, path)) {
            refProcessed = true;
          }
          if (
            hasDynamicRef &&
            processRefType("$dynamicRef", schemaAtPath, path)
          ) {
            refProcessed = true;
          }
          if (refProcessed) {
            pathsOfRefs.splice(i, 1);
            changed = true;
          }
        }
      }
    }

    for (const path of pathsOfRefs) {
      this.resolveReferenceAtPath(
        getSchemaAtPath(schema, path),
        schema,
        context.refToFunctionName,
        path,
        pathsOfRefs,
        identifierToPath,
        context.localSchemaIds,
        false,
      );
    }
  }

  private computeLookupKey(
    refValue: string,
    urlParts: { path: string; hash?: string },
    refType: "$ref" | "$dynamicRef",
    context: ResolutionContext,
  ): string {
    if (urlParts.hash?.startsWith("#/")) {
      return urlParts.hash;
    }

    if (refType === "$dynamicRef" && refValue.endsWith("DYNAMIC")) {
      if (!refValue.startsWith("#") && refValue.includes("#")) {
        const hasFunction = context.refToFunctionName.get(refValue);
        if (hasFunction) {
          let lookupKey = urlParts.hash?.slice(1);
          let functionName = context.refToFunctionName.get(lookupKey!);

          if (functionName) return lookupKey!;

          lookupKey = refValue;
          functionName = context.refToFunctionName.get(refValue);
          if (functionName) return lookupKey;

          lookupKey = refValue.slice(0, -7) + "ANCHOR";
          functionName = context.refToFunctionName.get(lookupKey);
          if (functionName) return lookupKey;
        }

        let lookupKey = urlParts.hash?.slice(1).slice(0, -7) + "ANCHOR";
        if (context.refToFunctionName.get(lookupKey)) return lookupKey;

        const hashRef = urlParts.hash || "";
        if (context.refToFunctionName.get(hashRef)) return hashRef;

        lookupKey = hashRef.slice(0, -7) + "ANCHOR";
        if (context.refToFunctionName.get(lookupKey)) return lookupKey;

        return hashRef;
      }
    }

    return refValue;
  }

  initializeResolutionContext(
    schema: SchemaDefinition,
    context: ResolutionContext,
  ): void {
    if (schema.$id) {
      context.schemaId = schema.$id;
    } else if (context.schemaId) {
      schema.$id = context.schemaId;
    }

    if (!context.schemaId) {
      const generatedId = Math.random().toString(36).substring(2, 8);
      context.schemaId = generatedId;
      schema.$id = generatedId;
    }
  }

  initializeIdentifiedSchemas(
    schema: SchemaDefinition,
    identifiers: SchemaIdentifierEntry[],
    context: ResolutionContext & { schemaId: string },
    allRefs: string[],
  ): void {
    for (const entry of identifiers) {
      if (
        context.schemaId === entry.identifier ||
        context.schemaId === entry.parentSchemaId
      ) {
        continue;
      }

      let isReferenced: boolean;
      if (entry.identifier.endsWith("ANCHOR")) {
        isReferenced =
          allRefs.includes(entry.identifier) ||
          allRefs.includes("#" + entry.identifier) ||
          allRefs.includes("#" + entry.identifier.slice(0, -6) + "DYNAMIC") ||
          allRefs.includes(entry.identifier.slice(0, -6) + "DYNAMIC") ||
          allRefs.includes(entry.schemaPath);
      } else if (entry.identifier.endsWith("DYNAMIC")) {
        isReferenced =
          allRefs.includes(entry.identifier) ||
          allRefs.includes("#" + entry.identifier) ||
          allRefs.includes("#" + entry.identifier.slice(0, -7) + "ANCHOR") ||
          allRefs.includes(entry.identifier.slice(0, -7) + "ANCHOR") ||
          allRefs.includes(entry.schemaPath);
      } else {
        isReferenced =
          allRefs.includes(entry.identifier) ||
          allRefs.includes(entry.schemaPath);
      }

      if (!isReferenced && entry.identifier.startsWith("http")) {
        if (entry.parentSchemaId) {
          if (!allRefs.includes(entry.parentSchemaId)) {
            context.refToFunctionName.delete(entry.schemaPath);
            continue;
          }
        } else {
          context.refToFunctionName.delete(entry.schemaPath);
          continue;
        }
      }

      const path = entry.schemaPath;
      let schemaUrl: string;

      if (entry.identifier.startsWith("http") || entry.parentSchemaId) {
        schemaUrl = entry.identifier.startsWith("http")
          ? splitUrlIntoPathAndFragment(entry.identifier).path
          : entry.parentSchemaId!;
      } else {
        schemaUrl = context.schemaId;
      }

      const existingUrlPaths = this.compiledSchemaPaths.get(schemaUrl);
      const existingContextPaths = this.compiledSchemaPaths.get(
        context.schemaId,
      );

      if (
        existingUrlPaths?.has(path) ||
        existingUrlPaths?.has(entry.identifier) ||
        existingContextPaths?.has(path) ||
        existingContextPaths?.has(entry.identifier)
      ) {
        const additionalPaths = [entry.identifier];
        if (entry.parentSchemaId) additionalPaths.push(entry.parentSchemaId);

        if (existingUrlPaths?.has(path)) {
          additionalPaths.forEach((p) => existingUrlPaths?.add(p));
        }
        if (existingContextPaths?.has(path)) {
          additionalPaths.forEach((p) => existingContextPaths?.add(p));
        }

        const functionName =
          context.refToFunctionName.get(path) ||
          context.refToFunctionName.get(entry.identifier);
        if (functionName) {
          context.refToFunctionName.set(path, functionName);
          if (!context.refToFunctionName.has(entry.identifier)) {
            context.refToFunctionName.set(entry.identifier, functionName);
          }
        }
        continue;
      }

      let schemaAtPath: SchemaDefinition | boolean | undefined;
      if (path.startsWith("#")) {
        schemaAtPath = getSchemaAtPath(schema, path);
      }

      if (schemaAtPath === undefined) {
        context.refToFunctionName.delete(entry.identifier);
      } else {
        const functionName =
          context.refToFunctionName.get(entry.schemaPath) ||
          context.refToFunctionName.get(entry.identifier)!;

        const pathsToTrack = [path, entry.identifier];
        if (entry.parentSchemaId) pathsToTrack.push(entry.parentSchemaId);

        if (existingUrlPaths) {
          if (existingUrlPaths.has(path)) continue;
          pathsToTrack.forEach((p) => existingUrlPaths.add(p));
        } else {
          this.compiledSchemaPaths.set(schemaUrl, new Set(pathsToTrack));
        }

        if (entry.identifier.startsWith("http")) {
          if (existingContextPaths) {
            if (existingContextPaths.has(path)) continue;
            pathsToTrack.forEach((p) => existingContextPaths.add(p));
          } else {
            this.compiledSchemaPaths.set(
              context.schemaId,
              new Set(pathsToTrack),
            );
          }
        }

        this.schemasToCompile.push({
          path: entry.schemaPath,
          schema: schemaAtPath,
          functionName,
        });
      }
    }
  }

  shouldSkipReference(
    ref: string,
    context: ResolutionContext & { schemaId: string },
    identifierToPath: Record<string, string>,
  ): boolean {
    let urlParts: { path: string; hash?: string };
    let baseUrl: string;

    if (ref.startsWith("http")) {
      urlParts = splitUrlIntoPathAndFragment(ref);
      baseUrl = urlParts.path;
    } else {
      urlParts = splitUrlIntoPathAndFragment(context.schemaId);
      baseUrl = urlParts.path;
      const refHash = splitUrlIntoPathAndFragment(ref).hash;
      if (refHash) {
        urlParts.hash = refHash;
      }
    }

    const existingUrlPaths = this.compiledSchemaPaths.get(baseUrl);
    const existingContextPaths = this.compiledSchemaPaths.get(context.schemaId);

    if (!existingUrlPaths && !existingContextPaths) return false;

    if (identifierToPath[baseUrl]) {
      if (urlParts.hash) {
        if (urlParts.hash.startsWith("#/")) {
          const targetPath = identifierToPath[baseUrl] + urlParts.hash.slice(1);
          return (
            existingContextPaths?.has(targetPath) ||
            existingUrlPaths?.has(ref) ||
            existingUrlPaths?.has(targetPath) ||
            false
          );
        } else {
          return (
            existingUrlPaths?.has(ref) ||
            existingContextPaths?.has(ref) ||
            false
          );
        }
      } else {
        return (
          existingUrlPaths?.has(ref) || existingContextPaths?.has(ref) || false
        );
      }
    } else {
      if (existingUrlPaths) {
        if (urlParts.hash) {
          return (
            existingUrlPaths.has(urlParts.hash) || existingUrlPaths.has(ref)
          );
        } else {
          return existingUrlPaths.has(baseUrl);
        }
      }
    }

    return false;
  }

  resolveLocalReference(
    schema: SchemaDefinition,
    ref: string,
    identifierToPath: Record<string, string>,
    context: ResolutionContext & { schemaId: string },
  ): void {
    let schemaAtPath: SchemaDefinition | boolean | undefined;

    if (ref.startsWith("#/")) {
      schemaAtPath = getSchemaAtPath(schema, ref);
    }

    if (!ref.startsWith("#") && schemaAtPath === undefined) {
      const urlParts = splitUrlIntoPathAndFragment(ref);
      const baseUrl = urlParts.path;
      const fragment = urlParts.hash?.startsWith("#/")
        ? urlParts.hash
        : undefined;

      if (identifierToPath[baseUrl] && fragment) {
        schemaAtPath = getSchemaAtPath(
          schema,
          identifierToPath[baseUrl] + fragment.slice(1),
        );
      } else {
        return;
      }
    }

    if (schemaAtPath !== undefined) {
      this.addLocalRefToCompile(ref, schemaAtPath, context, identifierToPath);
    }
  }

  addLocalRefToCompile(
    ref: string,
    schemaAtPath: boolean | BaseSchema,
    context: ResolutionContext & { schemaId: string },
    identifierToPath: Record<string, string>,
  ): void {
    let urlParts: { path: string; hash?: string };
    let baseUrl: string;

    if (ref.startsWith("http")) {
      urlParts = splitUrlIntoPathAndFragment(ref);
      baseUrl = urlParts.path;
    } else {
      urlParts = splitUrlIntoPathAndFragment(context.schemaId);
      baseUrl = urlParts.path;
      urlParts.hash = splitUrlIntoPathAndFragment(ref).hash;
    }

    let resolvedPath: string | undefined;
    const additionalPaths: string[] = [];

    if (urlParts.hash?.startsWith("#/")) {
      resolvedPath = identifierToPath[baseUrl] + urlParts.hash.slice(1);
      additionalPaths.push(resolvedPath);
    }

    const trackingResult = this.trackSchemaPath(
      ref,
      baseUrl,
      context.schemaId,
      additionalPaths,
    );

    if (!trackingResult.isNewPath) return;

    this.schemasToCompile.push({
      path: resolvedPath ?? identifierToPath[ref],
      schema: schemaAtPath,
      functionName: context.refToFunctionName.get(ref)!,
    });
  }

  async resolveExternalSchemaAsync(
    ref: string,
    identifiers: SchemaIdentifierEntry[],
    context: ResolutionContext,
    loadSchema?: (uri: string) => Promise<SchemaDefinition> | SchemaDefinition,
  ): Promise<void> {
    const urlParts = splitUrlIntoPathAndFragment(ref);
    const baseUrl = urlParts.path;

    if (this.currentlyResolvingSchemas.has(baseUrl)) {
      return;
    }
    this.currentlyResolvingSchemas.add(baseUrl);

    let externalSchema: SchemaDefinition | undefined;
    let wasAlreadyProcessed = false;

    if (baseUrl) {
      const cachedSchema = this.processedExternalSchemas.get(baseUrl);
      if (cachedSchema) {
        externalSchema = cachedSchema;
        wasAlreadyProcessed = true;
      }

      if (!cachedSchema) {
        let storedSchema = this.jetValidator.getSchema(baseUrl);
        if (!storedSchema) {
          storedSchema = this.jetValidator.getMetaSchema(baseUrl).metaSchema;
        }

        if (storedSchema) {
          externalSchema = storedSchema;
        } else if (loadSchema) {
          externalSchema = await loadSchema(baseUrl);
          if (this.options.addUsedSchema) {
            this.jetValidator.addSchema(externalSchema, baseUrl);
          }
        }
      }
    }

    if (externalSchema !== undefined) {
      const newRefMap = new Map<string, string>();

      for (const entry of identifiers) {
        const refMap = this.externalSchemaRefMaps.get(baseUrl) || new Map();
        if (!this.externalSchemaRefMaps.has(baseUrl)) {
          this.externalSchemaRefMaps.set(baseUrl, refMap);
        }

        if (!entry.identifier.startsWith("http")) {
          const functionName = context.refToFunctionName.get(
            entry.identifier ?? entry.schemaPath ?? entry.parentSchemaId,
          );
          refMap.set(entry.identifier, functionName);
          newRefMap.set(entry.identifier, functionName!);
        }
      }

      let resolvedExternalSchema: {
        schema: SchemaDefinition | boolean;
        idPaths: Record<string, string>;
        refs: string[];
      };

      if (wasAlreadyProcessed) {
        resolvedExternalSchema = {
          schema: externalSchema,
          refs: [],
          idPaths: externalSchema.idPaths,
        };
      } else {
        resolvedExternalSchema = await this.resolveSchemaAsync(
          externalSchema,
          {
            isRootResolution: true,
            refToFunctionName: newRefMap,
            currentSchemaPath: baseUrl,
            schemaId: baseUrl,
            rootHash: baseUrl,
          },
          loadSchema,
        );
      }

      this.addExternalSchemaToCompile(ref, resolvedExternalSchema, context);
    }
    this.currentlyResolvingSchemas.delete(baseUrl);
  }

  resolveExternalSchemaSync(
    ref: string,
    identifiers: SchemaIdentifierEntry[],
    context: ResolutionContext,
  ): void {
    const urlParts = splitUrlIntoPathAndFragment(ref);
    const baseUrl = urlParts.path;

    if (this.currentlyResolvingSchemas.has(baseUrl)) {
      return;
    }
    this.currentlyResolvingSchemas.add(baseUrl);

    let externalSchema: SchemaDefinition | undefined;
    let wasAlreadyProcessed = false;

    if (baseUrl) {
      const cachedSchema = this.processedExternalSchemas.get(baseUrl);
      if (cachedSchema) {
        externalSchema = cachedSchema;
        wasAlreadyProcessed = true;
      }

      if (!cachedSchema) {
        let storedSchema = this.jetValidator.getSchema(baseUrl);
        if (!storedSchema) {
          storedSchema = this.jetValidator.getMetaSchema(baseUrl).metaSchema;
        }

        if (storedSchema) {
          externalSchema = storedSchema;
        }
      }
    }

    if (externalSchema !== undefined) {
      const newRefMap = new Map<string, string>();

      for (const entry of identifiers) {
        const refMap = this.externalSchemaRefMaps.get(baseUrl) || new Map();
        if (!this.externalSchemaRefMaps.has(baseUrl)) {
          this.externalSchemaRefMaps.set(baseUrl, refMap);
        }

        if (!entry.identifier.startsWith("http")) {
          const functionName = context.refToFunctionName.get(
            entry.identifier ?? entry.schemaPath ?? entry.parentSchemaId,
          );
          refMap.set(entry.identifier, functionName);
          newRefMap.set(entry.identifier, functionName!);
        }
      }

      let resolvedExternalSchema: {
        schema: SchemaDefinition | boolean;
        idPaths: Record<string, string>;
        refs: string[];
      };

      if (wasAlreadyProcessed) {
        resolvedExternalSchema = {
          schema: externalSchema,
          refs: [],
          idPaths: externalSchema.idPaths,
        };
      } else {
        resolvedExternalSchema = this.resolveSchemaSynchronously(
          externalSchema,
          {
            isRootResolution: true,
            refToFunctionName: newRefMap,
            currentSchemaPath: baseUrl,
            schemaId: baseUrl,
            rootHash: baseUrl,
          },
        );
      }

      this.addExternalSchemaToCompile(ref, resolvedExternalSchema, context);
    }
    this.currentlyResolvingSchemas.delete(baseUrl);
  }

  addExternalSchemaToCompile(
    ref: string,
    resolvedSchema: {
      schema: SchemaDefinition | boolean;
      idPaths: Record<string, string>;
      refs: string[];
    },
    context: ResolutionContext,
  ): void {
    const urlParts = splitUrlIntoPathAndFragment(ref);
    const baseUrl = urlParts.path;
    const fragment = urlParts.hash;

    const refMap = this.externalSchemaRefMaps.get(baseUrl) || new Map();
    if (!this.externalSchemaRefMaps.has(baseUrl)) {
      this.externalSchemaRefMaps.set(baseUrl, refMap);
    }

    const existingPaths = this.compiledSchemaPaths.get(baseUrl);

    if (
      fragment &&
      fragment !== "" &&
      fragment.startsWith("#/") &&
      typeof resolvedSchema.schema === "object"
    ) {
      if (existingPaths?.has(fragment) || existingPaths?.has(ref)) {
        existingPaths.add(fragment);
        existingPaths.add(ref);
        return;
      }

      if (
        resolvedSchema.refs.includes(baseUrl) ||
        resolvedSchema.refs.includes("#")
      ) {
        if (!existingPaths?.has(baseUrl)) {
          const functionName = context.refToFunctionName.get(baseUrl);
          this.schemasToCompile.push({
            path: "#",
            schema: resolvedSchema.schema,
            functionName: functionName!,
          });

          if (existingPaths) {
            existingPaths.add(baseUrl);
          } else {
            this.compiledSchemaPaths.set(baseUrl, new Set([baseUrl]));
          }
        }
      }

      const fragmentSchema = getSchemaAtPath(resolvedSchema.schema, fragment);
      if (!existingPaths?.has(fragment) || !existingPaths?.has(ref)) {
        if (typeof fragmentSchema === "object") {
          const functionName = context.refToFunctionName.get(ref);
          this.schemasToCompile.push({
            path: fragment,
            schema: fragmentSchema,
            functionName: functionName!,
          });

          const currentSet = this.compiledSchemaPaths.get(baseUrl) || new Set();
          currentSet.add(fragment);
          currentSet.add(ref);
          this.compiledSchemaPaths.set(baseUrl, currentSet);
        }
      }
    } else if (baseUrl) {
      if (existingPaths?.has(baseUrl)) {
        return;
      }

      const functionName = context.refToFunctionName.get(baseUrl);
      let finalPath: string | undefined;

      if (fragment && fragment !== "#") {
        const anchorName = fragment.slice(1);
        finalPath = resolvedSchema.idPaths[anchorName];

        if (!finalPath) {
          finalPath = anchorName.endsWith("DYNAMIC")
            ? resolvedSchema.idPaths[anchorName.slice(0, -7) + "ANCHOR"]
            : resolvedSchema.idPaths[anchorName.slice(0, -6) + "DYNAMIC"];
        }

        if (
          finalPath &&
          finalPath !== "#" &&
          typeof resolvedSchema.schema === "object"
        ) {
          const anchorSchema = getSchemaAtPath(
            resolvedSchema.schema,
            finalPath,
          );

          if (existingPaths) {
            if (!existingPaths.has(finalPath) && !existingPaths.has(ref)) {
              if (typeof anchorSchema === "object") {
                const anchorFunctionName = context.refToFunctionName.get(ref);

                this.schemasToCompile.push({
                  path: finalPath,
                  schema: anchorSchema,
                  functionName: anchorFunctionName!,
                });

                const currentSet =
                  this.compiledSchemaPaths.get(baseUrl) || new Set();
                currentSet.add(finalPath);
                currentSet.add(ref);
                this.compiledSchemaPaths.set(baseUrl, currentSet);
              }
            } else {
              if (existingPaths.has(finalPath)) existingPaths.add(ref);
              if (existingPaths.has(ref)) existingPaths.add(finalPath);
            }
          }
        }
      }

      const currentSet = existingPaths || new Set<string>();
      currentSet.add(finalPath!);
      currentSet.add(ref);

      if (!fragment || fragment === "#" || finalPath === "#") {
        this.schemasToCompile.push({
          path: "#",
          schema: resolvedSchema.schema,
          functionName: functionName!,
        });
        currentSet.add(baseUrl);
      }

      this.compiledSchemaPaths.set(baseUrl, currentSet);
    }

    if (
      !this.processedExternalSchemas.has(baseUrl) &&
      typeof resolvedSchema.schema === "object"
    ) {
      resolvedSchema.schema["idPaths"] = resolvedSchema.idPaths;
      this.processedExternalSchemas.set(
        baseUrl,
        resolvedSchema.schema as SchemaDefinition,
      );
    }
  }

  resolveReferenceAtPath(
    targetSchema: SchemaDefinition | boolean,
    rootSchema: SchemaDefinition,
    refToFunctionName: Map<string, string>,
    currentPath: string,
    externalRefPaths: string[],
    identifierToPath: Record<string, string>,
    localIdentifiers?: string[],
    isInlined = true,
  ): void {
    if (targetSchema === true || targetSchema === false) {
      return;
    }

    const schema = targetSchema as SchemaDefinition;

    if (!refToFunctionName) {
      throw new Error("refToFunctionName is required");
    }

    if (!schema || typeof schema !== "object") {
      return;
    }

    if (schema.__functionName) {
      this.compilationContext.referencedFunctions.push(schema.__functionName);
      return;
    }

    if (refToFunctionName.has(currentPath) && currentPath !== "#") {
      schema.__functionName = refToFunctionName.get(currentPath)!;
    }

    if (schema.$ref && !schema.$ref.startsWith("*")) {
      this.finalizeRef(
        schema,
        rootSchema,
        refToFunctionName,
        externalRefPaths,
        identifierToPath,
        localIdentifiers,
        isInlined,
      );
    }

    if (schema.$dynamicRef && !schema.$dynamicRef.startsWith("*")) {
      this.finalizeDynamicRef(
        schema,
        rootSchema,
        refToFunctionName,
        externalRefPaths,
        identifierToPath,
        localIdentifiers,
        isInlined,
      );
    }
  }

  private finalizeRef(
    schema: SchemaDefinition,
    rootSchema: SchemaDefinition,
    refToFunctionName: Map<string, string>,
    externalRefPaths: string[],
    identifierToPath: Record<string, string>,
    localIdentifiers?: string[],
    isInlined = true,
  ): void {
    const rawRef = schema.$ref!;
    let lookupKey: string;

    if (rawRef === "#") {
      lookupKey = rawRef;
    } else if (rawRef.startsWith("http") || rawRef.startsWith("#/")) {
      lookupKey = rawRef;
    } else if (rawRef.startsWith("#")) {
      lookupKey = rawRef.slice(1);
    } else {
      lookupKey = rawRef;
    }

    if (lookupKey !== "#" && lookupKey.endsWith("#")) {
      lookupKey = lookupKey.slice(0, -1);
    }

    let functionName = refToFunctionName.get(lookupKey);

    if (!functionName && lookupKey.endsWith(":ANCHOR")) {
      functionName = refToFunctionName.get(lookupKey.slice(0, -6) + "DYNAMIC");
    }

    if (!isInlined && lookupKey && !lookupKey.startsWith("#/")) {
      const normalizedKey = lookupKey.startsWith("#")
        ? lookupKey.slice(1)
        : lookupKey;
      const urlParts = splitUrlIntoPathAndFragment(normalizedKey);
      const identifier =
        urlParts.path +
        (urlParts.hash &&
        !urlParts.hash.startsWith("#/") &&
        urlParts.hash !== "#"
          ? urlParts.hash
          : "");
      const targetPath = identifierToPath[identifier];
      if (targetPath !== undefined) {
        let schemaAtPath: SchemaDefinition | boolean | undefined;
        let finalPath: string;
        if (urlParts.hash && urlParts.hash.startsWith("#/")) {
          finalPath = targetPath + urlParts.hash.slice(1);
          schemaAtPath = getSchemaAtPath(rootSchema, finalPath);
        } else {
          finalPath = targetPath;
          schemaAtPath = getSchemaAtPath(rootSchema, targetPath);
        }
        if (typeof schemaAtPath === "object") {
          this.resolveReferenceAtPath(
            schemaAtPath,
            rootSchema,
            refToFunctionName,
            finalPath,
            externalRefPaths,
            identifierToPath,
            localIdentifiers,
          );
        }
      }
    }

    if (functionName) {
      schema.$ref = "*" + functionName;
      this.compilationContext.referencedFunctions.push(functionName);
    }

    if (lookupKey && !lookupKey.startsWith("#/")) {
      if (!lookupKey.startsWith("#")) {
        schema.$ref = schema.$ref + "**" + lookupKey;
      } else {
        schema.$ref = schema.$ref + "**#" + lookupKey.split("#")[1];
      }
    }

    if (functionName === this.rootFunctionName) {
      this.compilationContext.hasRootReference = true;
    }

    if (!functionName) {
      schema.$ref = "*unavailable";
    }
  }
  private finalizeDynamicRef(
    schema: SchemaDefinition,
    rootSchema: SchemaDefinition,
    refToFunctionName: Map<string, string>,
    externalRefPaths: string[],
    identifierToPath: Record<string, string>,
    localIdentifiers?: string[],
    isInlined = true,
  ): void {
    const rawDynamicRef = schema.$dynamicRef!;
    let lookupKey: string | undefined;
    let functionName: string | undefined;
    if (rawDynamicRef === "#") {
      lookupKey = rawDynamicRef;
    } else if (rawDynamicRef.endsWith("DYNAMIC")) {
      if (!rawDynamicRef.startsWith("#") && rawDynamicRef.includes("#")) {
        lookupKey = rawDynamicRef;
        const hasDirectFunction = refToFunctionName.get(lookupKey);

        if (hasDirectFunction) {
          lookupKey = splitUrlIntoPathAndFragment(rawDynamicRef).hash!.slice(1);
          functionName = refToFunctionName.get(lookupKey);

          if (!functionName) {
            functionName = refToFunctionName.get(rawDynamicRef);
            if (!functionName) {
              functionName = refToFunctionName.get(
                rawDynamicRef.slice(0, -7) + "ANCHOR",
              );
            }
          } else {
            lookupKey = "#" + lookupKey;
          }
        }

        if (!functionName) {
          functionName = refToFunctionName.get(
            lookupKey.slice(0, -7) + "ANCHOR",
          );
        }

        if (!functionName) {
          lookupKey = splitUrlIntoPathAndFragment(rawDynamicRef).hash!.slice(1);
          functionName = refToFunctionName.get(lookupKey);
          if (!functionName) {
            functionName = refToFunctionName.get(
              lookupKey.slice(0, -7) + "ANCHOR",
            );
          }
          lookupKey = "#" + lookupKey;
        }
      }
    } else {
      lookupKey = rawDynamicRef;
      functionName = refToFunctionName.get(lookupKey);
      if (!functionName) {
        functionName = refToFunctionName.get(lookupKey.slice(0, -7) + "ANCHOR");
      }
    }

    if (!isInlined && lookupKey && !lookupKey.startsWith("#/")) {
      const normalizedKey = lookupKey.startsWith("#")
        ? lookupKey.slice(1)
        : lookupKey;
      const urlParts = splitUrlIntoPathAndFragment(normalizedKey);
      const identifier =
        urlParts.path +
        (urlParts.hash &&
        !urlParts.hash.startsWith("#/") &&
        urlParts.hash !== "#"
          ? urlParts.hash
          : "");

      const targetPath = identifierToPath[identifier];
      if (targetPath !== undefined) {
        let schemaAtPath: SchemaDefinition | boolean | undefined;
        let finalPath: string;

        if (urlParts.hash && urlParts.hash.startsWith("#/")) {
          finalPath = targetPath + urlParts.hash.slice(1);
          schemaAtPath = getSchemaAtPath(rootSchema, finalPath);
        } else {
          finalPath = targetPath;
          schemaAtPath = getSchemaAtPath(rootSchema, targetPath);
        }

        if (typeof schemaAtPath === "object") {
          this.resolveReferenceAtPath(
            schemaAtPath,
            rootSchema,
            refToFunctionName,
            finalPath,
            externalRefPaths,
            identifierToPath,
            localIdentifiers,
          );
        }
      }
    }

    if (functionName) {
      this.compilationContext.referencedFunctions.push(functionName);
      schema.$dynamicRef = "*" + functionName;
    }

    if (functionName === this.rootFunctionName) {
      this.compilationContext.hasRootReference = true;
    }

    if (lookupKey && !lookupKey.startsWith("#/")) {
      if (
        localIdentifiers?.includes(lookupKey) ||
        localIdentifiers?.includes(splitUrlIntoPathAndFragment(lookupKey).path)
      ) {
        let finalLookupKey: string;
        if (lookupKey.startsWith("#")) {
          finalLookupKey = lookupKey;
        } else {
          finalLookupKey = lookupKey.split("#")[1];
        }
        schema.$dynamicRef =
          schema.$dynamicRef +
          "**" +
          (finalLookupKey.endsWith("ANCHOR")
            ? finalLookupKey.slice(0, -7)
            : finalLookupKey.slice(0, -8));
      } else {
        schema.$dynamicRef =
          schema.$dynamicRef +
          "**" +
          (lookupKey.endsWith("ANCHOR")
            ? lookupKey.slice(0, -7)
            : lookupKey.slice(0, -8));
      }
    }

    if (!functionName) {
      schema.$dynamicRef = "*unavailable";
    }
  }

  private collectSchemaMetadata(
    schema: SchemaDefinition | boolean,
    existingAnchors: string[],
    currentPath: string = "#",
    basePath: string = "#",
    anchorToPathMap: Record<string, string> = {},
    dynamicAnchorToPathMap: Record<string, string> = {},
    collectedRefs: string[] = [],
    identifiers: SchemaIdentifierEntry[] = [],
    pathsContainingRefs: Set<string> = new Set(),
    refPaths: string[] = [],
    currentContextId?: string,
  ): {
    refs: string[];
    ids: SchemaIdentifierEntry[];
    pathsWithRefs: Set<string>;
    refPaths: string[];
  } {
    if (
      typeof schema === "boolean" ||
      schema === null ||
      schema === undefined
    ) {
      return {
        refs: collectedRefs,
        ids: identifiers,
        pathsWithRefs: pathsContainingRefs,
        refPaths,
      };
    }

    if (
      schema.$ref !== undefined &&
      (this.options.draft === "draft6" || this.options.draft === "draft7")
    ) {
      Object.keys(schema).forEach((key) => {
        if (key !== "$ref") {
          delete schema[key];
        }
      });
    }

    this.validateStrictModeRequirements(schema, currentPath);

    this.collectCustomKeywords(schema);

    if (
      schema.format &&
      typeof schema.format === "object" &&
      "$data" in schema.format
    ) {
      this.compilationContext.uses$Data = true;
    }

    const result = {
      refs: collectedRefs,
      ids: identifiers,
      pathsWithRefs: pathsContainingRefs,
      refPaths,
    };

    let contextId = currentContextId;
    let contextBasePath = basePath;
    let contextAnchorMap = anchorToPathMap;
    const contextDynamicAnchorMap = dynamicAnchorToPathMap;

    if (schema.$id) {
      if (schema.$id.startsWith("#")) {
        schema.$anchor = schema.$id.slice(1);
        schema.$id = undefined;
      } else {
        contextId = resolveAndRegisterSchemaId(
          schema,
          contextId,
          currentPath,
          identifiers,
        );
      }
      contextBasePath = currentPath;
      contextAnchorMap = {};
    }

    if (schema.$anchor) {
      registerAnchor(
        schema,
        currentPath,
        contextId,
        contextAnchorMap,
        identifiers,
      );
    }

    if (schema.$dynamicAnchor) {
      registerDynamicAnchor(
        schema,
        currentPath,
        contextBasePath,
        contextId,
        contextDynamicAnchorMap,
        identifiers,
        existingAnchors,
      );
    }

    if (schema.$ref) {
      if (this.options.inlineRefs) {
        markPathsContainingRefs(currentPath, pathsContainingRefs);
        refPaths.push(currentPath);
      }

      processReference(
        schema,
        contextBasePath,
        contextAnchorMap,
        contextId,
        collectedRefs,
        currentPath,
        refPaths,
        this.options.inlineRefs,
      );
    }

    if (schema.$dynamicRef) {
      if (this.options.inlineRefs) {
        markPathsContainingRefs(currentPath, pathsContainingRefs);
        refPaths.push(currentPath);
      }
      processDynamicReference(
        schema,
        contextBasePath,
        currentPath,
        contextId,
        collectedRefs,
        refPaths,
        this.options.inlineRefs,
      );
    }

    if (schema.format && typeof schema.format === "string") {
      this.discoveredFormats.add(schema.format);
    }

    this.collectNestedSchemaMetadata(
      schema,
      existingAnchors,
      currentPath,
      contextBasePath,
      contextAnchorMap,
      contextDynamicAnchorMap,
      collectedRefs,
      identifiers,
      pathsContainingRefs,
      refPaths,
      contextId,
    );

    return result;
  }
  private validateStrictModeRequirements(
    schema: SchemaDefinition,
    currentPath: string,
  ): void {
    const typeSpecificKeywords = new Set<string>(
      Object.values(incompatibleKeywords).flat(),
    );

    const strictTypes = this.options.strictTypes;
    if ((strictTypes || this.options.strict) && !schema.type) {
      const keyword = Object.keys(schema).find((kw) =>
        typeSpecificKeywords.has(kw),
      );

      if (keyword) {
        const mode = strictTypes ? "strictTypes" : "strict";
        const validTypes = Object.keys(incompatibleKeywords).filter(
          (type) =>
            !incompatibleKeywords[
              type as keyof typeof incompatibleKeywords
            ].includes(keyword),
        );

        throw new Error(
          `[${mode}] Schema path ${currentPath} is missing type "${validTypes.join(
            '" or "',
          )}" for keyword "${keyword}"`,
        );
      }
    }

    if (
      (this.options.strictRequired || this.options.strict) &&
      Array.isArray(schema.required)
    ) {
      const mode = this.options.strictRequired ? "strictRequired" : "strict";

      if (!schema.properties) {
        throw Error(`[${mode}] Missing properties for required fields`);
      }
      for (const requiredField of schema.required) {
        if (!(requiredField in schema.properties)) {
          throw Error(
            `[${mode}] Required field "${String(
              requiredField,
            )}" is not defined in properties`,
          );
        }
      }
    }

    if (schema.type && (this.options.strictSchema || this.options.strict)) {
      const mode = this.options.strictSchema ? "strictSchema" : "strict";
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];

      const allPossibleIncompatible = new Set<string>();
      for (const type of types) {
        const incompatible = incompatibleKeywords[type];
        if (incompatible) {
          incompatible.forEach((kw) => allPossibleIncompatible.add(kw));
        } else {
          throw Error(`[${mode}] Unknown type ${type}`);
        }
      }

      for (const keyword of Array.from(allPossibleIncompatible)) {
        const incompatibleWithAll = types.every((type) =>
          incompatibleKeywords[type]?.includes(keyword),
        );

        if (incompatibleWithAll && schema[keyword] !== undefined) {
          throw Error(
            `[${mode}] Keyword "${keyword}" is incompatible with ${
              types.length > 1 ? "all types" : "type"
            } "${types.join(", ")}"`,
          );
        }
      }
    }
  }
  private collectCustomKeywords(schema: SchemaDefinition): void {
    Object.keys(schema).forEach((keyword) => {
      if (!baseSchemaKeys.has(keyword)) {
        if (this.jetValidator.getAllKeywords().has(keyword)) {
          this.discoveredCustomKeywords.add(keyword);
        } else if (this.options.strictSchema || this.options.strict) {
          const mode = this.options.strictSchema ? "strictSchema" : "strict";
          throw new Error(`[${mode}] Unknown keyword: ${keyword}`);
        }
      }
    });
  }

  private collectNestedSchemaMetadata(
    schema: SchemaDefinition,
    existingAnchors: string[],
    currentPath: string,
    basePath: string,
    anchorToPathMap: Record<string, string>,
    dynamicAnchorToPathMap: Record<string, string>,
    collectedRefs: string[],
    identifiers: SchemaIdentifierEntry[],
    pathsContainingRefs: Set<string>,
    refPaths: string[],
    contextId?: string,
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
          const subPath = `${currentPath}/${location.pathSegment}/${key}`;
          this.collectSchemaMetadata(
            subSchema as SchemaDefinition | boolean,
            existingAnchors,
            subPath,
            basePath,
            anchorToPathMap,
            dynamicAnchorToPathMap,
            collectedRefs,
            identifiers,
            pathsContainingRefs,
            refPaths,
            contextId,
          );
        });
      }
    }

    if (
      schema.unevaluatedProperties !== undefined &&
      schema.unevaluatedProperties !== true
    ) {
      this.compilationContext.hasUnevaluatedProperties = true;
    }
    if (
      schema.unevaluatedItems !== undefined &&
      schema.unevaluatedItems !== true
    ) {
      this.compilationContext.hasUnevaluatedItems = true;
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
        const subPath = `${currentPath}/${key}`;
        this.collectSchemaMetadata(
          schema[key],
          existingAnchors,
          subPath,
          basePath,
          anchorToPathMap,
          dynamicAnchorToPathMap,
          collectedRefs,
          identifiers,
          pathsContainingRefs,
          refPaths,
          contextId,
        );
      }
    }

    const arraySchemaLocations = ["allOf", "anyOf", "oneOf", "prefixItems"];

    for (const key of arraySchemaLocations) {
      if (Array.isArray(schema[key])) {
        schema[key].forEach((subSchema: any, index: number) => {
          const subPath = `${currentPath}/${key}/${index}`;
          this.collectSchemaMetadata(
            subSchema,
            existingAnchors,
            subPath,
            basePath,
            anchorToPathMap,
            dynamicAnchorToPathMap,
            collectedRefs,
            identifiers,
            pathsContainingRefs,
            refPaths,
            contextId,
          );
        });
      }
    }

    if (schema.items && Array.isArray(schema.items)) {
      schema.items.forEach((item, index) => {
        const subPath = `${currentPath}/items/${index}`;
        this.collectSchemaMetadata(
          item,
          existingAnchors,
          subPath,
          basePath,
          anchorToPathMap,
          dynamicAnchorToPathMap,
          collectedRefs,
          identifiers,
          pathsContainingRefs,
          refPaths,
          contextId,
        );
      });
    }

    if (schema.elseIf) {
      schema.elseIf.forEach((elseIfSchema: any, index: number) => {
        ["if", "then"].forEach((condKey) => {
          if (elseIfSchema[condKey]) {
            const subPath = `${currentPath}/elseIf/${index}/${condKey}`;
            this.collectSchemaMetadata(
              elseIfSchema[condKey],
              existingAnchors,
              subPath,
              basePath,
              anchorToPathMap,
              dynamicAnchorToPathMap,
              collectedRefs,
              identifiers,
              pathsContainingRefs,
              refPaths,
              contextId,
            );
          }
        });
      });
    }
  }
}
