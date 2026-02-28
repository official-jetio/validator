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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sanitizes a reference name by replacing all non-alphanumeric characters with underscores.
 * Used to create valid JavaScript function names from schema references.
 *
 * @example
 * sanitizeRefName("https://example.com/schema#/defs/user")
 * // Returns: "https___example_com_schema__defs_user"
 */
function sanitizeRefName(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Splits a URL-like path into its base path and fragment (hash) components.
 * Handles edge cases like trailing hashes and missing fragments.
 *
 * @example
 * getPathAndHash("https://example.com/schema#/definitions/user")
 * // Returns: { path: "https://example.com/schema", hash: "#/definitions/user" }
 *
 * getPathAndHash("https://example.com/schema")
 * // Returns: { path: "https://example.com/schema", hash: undefined }
 */
function splitUrlIntoPathAndFragment(pathUrl: string): {
  path: string;
  hash?: string;
} {
  const [basePath, fragment] = pathUrl.split("#");
  let hash: string | undefined;
  if (fragment !== undefined) {
    // Handle edge case where path ends with "#" (empty fragment)
    hash = pathUrl.endsWith("#") ? "#" : "#" + fragment;
  }

  return { path: basePath, hash };
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Context object passed through schema resolution.
 * Tracks the current state during recursive schema traversal.
 */
interface ResolutionContext {
  /** Whether this is the first/root call to resolve */
  isRootResolution: boolean;
  /** Map of reference identifiers to their generated function names */
  refToFunctionName: Map<string, string>;
  /** Current JSON pointer path in the schema (e.g., "#/properties/name") */
  currentSchemaPath: string;
  /** The $id of the current schema context */
  schemaId?: string;
  /** The main/root hash for external schema resolution */
  rootHash?: string;
  /** List of all $id values defined locally in this schema */
  localSchemaIds?: string[];
}

/**
 * Extended context with required refToFunctionName map.
 * Used when we know the map is definitely initialized.
 */
interface InitializedResolutionContext extends ResolutionContext {
  refToFunctionName: Map<string, string>;
}

/**
 * Represents a registered schema identifier ($id, $anchor, or $dynamicAnchor).
 * Used to track where schemas are defined and how they can be referenced.
 */
interface SchemaIdentifierEntry {
  /** The JSON pointer path where this identifier is defined */
  schemaPath: string;
  /** The identifier value (URL, anchor name, etc.) */
  identifier: string;
  /** For anchors defined within an external schema, tracks the parent schema's $id */
  parentSchemaId?: string;
}

// ============================================================================
// SCHEMA IDENTIFIER HANDLERS
// ============================================================================

/**
 * Resolves a schema's $id to an absolute URI and registers it.
 * Handles relative $id values by resolving them against the current context's $id.
 *
 * @returns The resolved absolute $id value
 */
function resolveAndRegisterSchemaId(
  schema: any,
  currentContextId: string | undefined,
  currentPath: string,
  identifierRegistry: SchemaIdentifierEntry[],
): string {
  let resolvedId: string;

  if (schema.$id.startsWith("http")) {
    // Already absolute URL
    resolvedId = schema.$id;
  } else if (currentContextId?.startsWith("http")) {
    // Resolve relative URL against current context
    resolvedId = new URL(schema.$id, currentContextId).href;
    schema.$id = resolvedId; // Update schema with resolved value
  } else {
    // Keep as-is (local identifier)
    resolvedId = schema.$id;
  }

  identifierRegistry.push({
    schemaPath: currentPath,
    identifier: resolvedId,
  });

  return resolvedId;
}

/**
 * Registers a $anchor and its various reference forms.
 * Anchors can be referenced directly or combined with the schema's $id.
 *
 * @example
 * For schema: { "$id": "https://example.com/schema", "$anchor": "user" }
 * Registers:
 *   - "user:ANCHOR" -> currentPath
 *   - "https://example.com/schema#user:ANCHOR" -> currentPath
 */
function registerAnchor(
  schema: any,
  currentPath: string,
  currentContextId: string | undefined,
  anchorToPathMap: Record<string, string>,
  identifierRegistry: SchemaIdentifierEntry[],
): void {
  const anchorName = schema.$anchor;

  // Map anchor name to its definition path (for local resolution)
  anchorToPathMap[anchorName] = currentPath;

  if (schema.$id) {
    // Anchor is defined alongside an $id - register both forms
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
    // Anchor without $id - register with current context
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

/**
 * Registers a $dynamicAnchor and its various reference forms.
 * Dynamic anchors enable recursive schema extension patterns.
 * They are only registered once (first definition wins).
 *
 * @example
 * For schema: { "$id": "https://example.com/schema", "$dynamicAnchor": "meta" }
 * Registers:
 *   - "meta:DYNAMIC" -> currentPath
 *   - "https://example.com/schema#meta:DYNAMIC" -> currentPath
 */
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

  // Dynamic anchors are only registered once (first definition wins)
  if (alreadyRegisteredAnchors.includes(dynamicAnchorKey)) {
    return;
  }

  dynamicAnchorToPathMap[dynamicAnchorName] = currentPath;

  if (schema.$id) {
    alreadyRegisteredAnchors.push(dynamicAnchorKey);

    // Determine if this is the root schema (for parentSchemaId tracking)
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

// ============================================================================
// REFERENCE HANDLERS
// ============================================================================

/**
 * Processes a $ref and resolves it to its canonical form.
 * Handles local refs (#/...), anchor refs (#name), and external refs (http://...).
 *
 * Resolution rules:
 * - "#/definitions/x" -> Resolve relative to basePath
 * - "#anchor" -> Look up in anchorToPathMap or mark as :ANCHOR
 * - "http://..." -> Keep as absolute URL, mark anchors appropriately
 * - "relative/path" -> Resolve against currentContextId
 */
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
    // JSON Pointer reference - resolve relative to base path
    resolvedRef = basePath ? basePath + rawRef.slice(1) : rawRef;
  } else if (rawRef.startsWith("#")) {
    if (rawRef === "#") {
      // Self-reference to root
      resolvedRef = rawRef;
    } else {
      // Anchor reference - look up or mark for later resolution
      const anchorName = rawRef.slice(1);
      resolvedRef = anchorToPathMap[anchorName] || rawRef + ":ANCHOR";
    }
  } else {
    // External reference - resolve to absolute URL
    let absoluteUrl: string;

    if (rawRef.startsWith("http")) {
      absoluteUrl = rawRef;
    } else if (currentContextId?.startsWith("http")) {
      absoluteUrl = new URL(rawRef, currentContextId).href;
    } else {
      absoluteUrl = rawRef;
    }

    // Check if URL has a fragment that's an anchor (not a JSON pointer)
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

  // Track paths that contain external (non-local) references
  if (!inline) {
    if (resolvedRef.startsWith("#/")) {
      refPaths.push(resolvedRef);
    }
    refPaths.push(currentPath);
  }

  // Update schema with resolved reference and add to collection
  schema.$ref = resolvedRef;
  collectedRefs.push(resolvedRef);
}

/**
 * Processes a $dynamicRef and resolves it to its canonical form.
 * Dynamic references enable runtime resolution based on the call stack.
 */
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
    // JSON Pointer - resolve relative to base path
    resolvedDynamicRef = basePath + rawDynamicRef.slice(1);
  } else if (rawDynamicRef.startsWith("#")) {
    if (rawDynamicRef === "#") {
      // Self-reference to root
      resolvedDynamicRef = rawDynamicRef;
    } else {
      // Dynamic anchor reference
      resolvedDynamicRef = currentContextId + rawDynamicRef + ":DYNAMIC";
      collectedRefs.push(rawDynamicRef + ":DYNAMIC");
    }
  } else {
    // External dynamic reference
    let absoluteUrl: string;

    if (rawDynamicRef.startsWith("http")) {
      absoluteUrl = rawDynamicRef;
    } else {
      absoluteUrl = new URL(rawDynamicRef, currentContextId).href;
    }

    // Dynamic refs with anchors (not JSON pointers) get :DYNAMIC suffix
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

  // Track paths with external references
  if (!inline) {
    if (resolvedDynamicRef.startsWith("#/")) {
      refPaths.push(resolvedDynamicRef);
    }
    refPaths.push(currentPath);
  }

  collectedRefs.push(resolvedDynamicRef);
  schema.$dynamicRef = resolvedDynamicRef;
}

/**
 * Marks a path and all its parent paths as "containing references".
 * This is used for inlining optimization to know which schemas can't be inlined
 * because they or their parents contain references that need to be resolved.
 *
 * Stops at $defs/definitions boundaries since those are definition containers,
 * not validation schemas.
 *
 * @example
 * markPathsContainingRefs("#/properties/user/items", pathsWithRefs)
 * // Marks: "#/properties/user/items", "#/properties/user", "#/properties", "#"
 */
function markPathsContainingRefs(
  currentPath: string,
  pathsContainingRefs: Set<string>,
): void {
  const DEFINITION_KEYWORDS = new Set(["$defs", "definitions"]);

  // Always mark the current path
  pathsContainingRefs.add(currentPath);

  // Split path into segments (remove leading '#' and empty strings)
  const pathSegments = currentPath
    .slice(1)
    .split("/")
    .filter((segment) => segment);

  // Trace upwards through parent paths
  for (let i = pathSegments.length - 1; i > 0; i--) {
    // Stop if we're about to cross into a definitions container
    if (DEFINITION_KEYWORDS.has(pathSegments[i - 1])) {
      break;
    }

    const parentPath = "#/" + pathSegments.slice(0, i).join("/");
    pathsContainingRefs.add(parentPath);
  }

  // Mark root if the first segment isn't a definitions container
  if (pathSegments.length > 0 && !DEFINITION_KEYWORDS.has(pathSegments[0])) {
    pathsContainingRefs.add("#");
  }
}

// ============================================================================
// MAIN SCHEMA RESOLVER CLASS
// ============================================================================

/**
 * SchemaResolver handles the complex task of resolving JSON Schema references.
 *
 * It performs several key functions:
 * 1. Collects all $id, $anchor, $dynamicAnchor declarations
 * 2. Resolves all $ref and $dynamicRef to their target schemas
 * 3. Generates unique function names for each referenceable schema
 * 4. Optionally inlines references that don't form cycles
 * 5. Loads external schemas (sync or async)
 *
 * The resolver supports JSON Schema drafts 6, 7, 2019-09, and 2020-12.
 */
export class SchemaResolver {
  // ============================================================================
  // INSTANCE STATE
  // ============================================================================

  /**
   * Maps external schema URLs to their internal reference maps.
   * Structure: externalSchemaUrl -> (refIdentifier -> functionName)
   */
  private readonly externalSchemaRefMaps = new Map<
    string,
    Map<string, string>
  >();

  /**
   * Collection of all schemas that need to be compiled into validator functions.
   * Each entry contains the schema, its path, and the generated function name.
   */
  private readonly schemasToCompile: Array<{
    path: string;
    schema: SchemaDefinition | boolean;
    functionName: string;
  }> = [];

  rootFunctionName: string = "validate";
  /**
   * Tracks which schemas have already been added to schemasToCompile.
   * Structure: schemaUrl -> Set of paths already processed
   * Prevents duplicate compilation of the same schema.
   */
  private readonly compiledSchemaPaths: Map<string, Set<string>> = new Map();

  /**
   * Cache of fully processed external schemas.
   * Avoids re-processing the same external schema multiple times.
   */
  private processedExternalSchemas = new Map<string, SchemaDefinition>();

  /**
   * Whether the root schema has been set (used for function naming).
   * The root schema always gets the function name "validate".
   */
  private hasSetRootSchema: boolean = false;

  /**
   * All format strings encountered in the schema.
   * Used to validate that required format validators are available.
   */
  private discoveredFormats: Set<string> = new Set();

  /**
   * All custom keywords encountered in the schema.
   * Used to validate that required keyword handlers are registered.
   */
  private discoveredCustomKeywords: Set<string> = new Set();

  /**
   * Reference to the parent JetValidator instance.
   * Used for accessing registered schemas, keywords, and meta-schemas.
   */
  private jetValidator: JetValidator;

  /**
   * Validation options passed to the resolver.
   * Controls behavior like strict mode, draft version, and inlining.
   */
  private options: ValidatorOptions;

  /**
   * Counter for generating unique function names.
   * Incremented each time a new function name is generated.
   */
  private functionNameCounter: number = 0;

  /**
   * Maps schema IDs to their paths containing refs (for inlining decisions).
   * Used to determine which external refs can be safely inlined.
   */
  private schemaIdToRefPaths: Map<string, Set<string>> = new Map();

  /**
   * Tracks schemas currently being resolved to detect circular references.
   * Prevents infinite loops when schemas reference each other.
   */
  private currentlyResolvingSchemas = new Set<string>();

  /**
   * Context information needed during compilation.
   * Accumulated during resolution and passed to the compiler.
   */
  private compilationContext: {
    /** Whether any schema uses unevaluatedProperties */
    hasUnevaluatedProperties: boolean;
    /** Whether any schema uses unevaluatedItems */
    hasUnevaluatedItems: boolean;
    /** Whether any ref points to the root "validate" function */
    hasRootReference: boolean;
    /** List of all function names that are referenced */
    referencedFunctions: string[];
    /** Whether any schema uses $data references */
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

  // ============================================================================
  // CLEANUP METHODS
  // ============================================================================

  /**
   * Clears all resolution state.
   * Called after resolution is complete to free memory.
   */
  private clearResolutionState(): void {
    this.compiledSchemaPaths.forEach((set) => set.clear());
    this.compiledSchemaPaths.clear();
    this.externalSchemaRefMaps.forEach((map) => map.clear());
    this.externalSchemaRefMaps.clear();
    this.processedExternalSchemas.clear();
    this.schemaIdToRefPaths.forEach((set) => set.clear());
    this.schemaIdToRefPaths.clear();
  }

  // ============================================================================
  // REFERENCE MAP MANAGEMENT
  // ============================================================================

  /**
   * Gets or creates a reference map for storing function names for a schema.
   * The map key is determined by the schema's identity (URL, external ID, or context).
   */
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

  /**
   * Gets an existing reference map for a schema identifier.
   * Returns undefined if no map exists.
   */
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

  // ============================================================================
  // SCHEMA PATH TRACKING
  // ============================================================================

  /**
   * Updates the tracking of which schema paths have been processed.
   * Returns whether this is a new path (true) or already processed (false).
   */
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

    // Check if already processed
    if (existingUrlPaths?.has(path) || existingContextPaths?.has(path)) {
      return { isNewPath: false, existingUrlPaths, existingContextPaths };
    }

    // Add to URL-based tracking
    if (existingUrlPaths) {
      existingUrlPaths.add(path);
      additionalPaths.forEach((p) => existingUrlPaths.add(p));
    } else {
      const newSet = new Set([path, ...additionalPaths]);
      this.compiledSchemaPaths.set(schemaUrl, newSet);
    }

    // Add to context-based tracking (for cross-schema references)
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

  // ============================================================================
  // FUNCTION NAME GENERATION
  // ============================================================================

  /**
   * Generates a unique function name for a schema.
   * Format: validate_{sanitized_identifier}_{counter}
   */
  private generateFunctionName(identifier: string): string {
    const sanitized = sanitizeRefName(identifier);
    return `validate_${sanitized}_${this.functionNameCounter++}`;
  }

  /**
   * Assigns function names to all collected schema identifiers ($id, $anchor, $dynamicAnchor).
   */
  private assignFunctionNamesToIdentifiers(
    identifiers: SchemaIdentifierEntry[],
    context: InitializedResolutionContext,
  ): void {
    for (const entry of identifiers) {
      const identifier = entry.identifier;

      // Skip if already assigned
      if (context.refToFunctionName.has(identifier)) continue;

      if (entry.schemaPath === "#" && !this.hasSetRootSchema) {
        this.assignRootSchemaFunctionName(entry, context);
      } else {
        this.assignNonRootSchemaFunctionName(entry, context);
      }
    }
  }

  /**
   * Assigns function name for the root schema (always "validate" for main root schema).
   */
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

  /**
   * Assigns function name for non-root schemas.
   */
  private assignNonRootSchemaFunctionName(
    entry: SchemaIdentifierEntry,
    context: InitializedResolutionContext,
  ): void {
    const identifier = entry.identifier;
    let primaryRefMap: Map<string, string> | undefined;
    let secondaryRefMap: Map<string, string> | undefined;

    // Determine which ref maps to check based on identifier type
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

    // Look for existing function name
    let functionName =
      primaryRefMap?.get(entry.schemaPath) ??
      primaryRefMap?.get(identifier) ??
      secondaryRefMap?.get(entry.schemaPath) ??
      secondaryRefMap?.get(identifier);

    if (functionName) {
      context.refToFunctionName.set(identifier, functionName);
    } else {
      // Generate new function name
      functionName = this.generateFunctionName(identifier);

      context.refToFunctionName.set(identifier, functionName);
      context.refToFunctionName.set(entry.schemaPath, functionName);

      const refMap =
        primaryRefMap || this.getOrCreateRefMapForSchema(entry, context);
      refMap.set(identifier, functionName);
      refMap.set(entry.schemaPath, functionName);

      // Update secondary ref map for cross-schema references
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

  /**
   * Assigns function names to all collected references ($ref, $dynamicRef).
   */
  private assignFunctionNamesToReferences(
    references: string[],
    context: InitializedResolutionContext,
    identifierToPath: Record<string, string>,
  ): void {
    for (const ref of references) {
      // Normalize the reference key
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

  /**
   * Assigns function name for a local hash reference (#, #/, #anchor).
   */
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

  /**
   * Assigns function name for an external reference (http://...).
   */
  private assignExternalRefFunctionName(
    ref: string,
    context: InitializedResolutionContext,
    identifierToPath: Record<string, string>,
  ): void {
    const urlParts = splitUrlIntoPathAndFragment(ref);
    const baseUrl = urlParts.path;

    // Check if this external URL maps to a local path via $id
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

  /**
   * Assigns function name for an HTTP URL reference.
   */
  private assignHttpRefFunctionName(
    ref: string,
    urlParts: { path: string; hash?: string },
    context: InitializedResolutionContext,
  ): void {

    const baseUrl = urlParts.path;
    const fragment = urlParts.hash;
    const existingRefMap = this.externalSchemaRefMaps.get(baseUrl);

    if (existingRefMap) {
      // Handle fragment if present
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

      // Handle base URL
      if (existingRefMap.has(baseUrl)) {
        context.refToFunctionName.set(ref, existingRefMap.get(baseUrl)!);
      } else {
        const functionName = this.generateFunctionName(baseUrl);
        context.refToFunctionName.set(ref, functionName);
        existingRefMap.set(baseUrl, functionName);
        existingRefMap.set("#", functionName);
      }
    } else {
      // Create new ref map for this URL
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

  /**
   * Assigns function name for a reference that maps to a local $id path.
   */
  private assignIdentifierPathRefFunctionName(
    ref: string,
    baseUrl: string,
    localPath: string,
    context: InitializedResolutionContext,
    identifierToPath: Record<string, string>,
  ): void {
    const fragment = splitUrlIntoPathAndFragment(ref).hash ?? "";

    // Skip anchor references that aren't in the identifier map
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

  // ============================================================================
  // SCHEMA PREPROCESSING
  // ============================================================================

  /**
   * Pre-processes a schema to collect all identifiers, references, and paths.
   * This is the first pass that gathers information needed for resolution.
   */
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

    // Assign function names to all identifiers
    this.assignFunctionNamesToIdentifiers(
      identifiers,
      context as InitializedResolutionContext,
    );

    // Build identifier -> path mapping
    const identifierToPath = identifiers.reduce(
      (map: Record<string, string>, entry) => {
        if (map[entry.identifier] === undefined) {
          map[entry.identifier] = entry.schemaPath;
        }
        return map;
      },
      {},
    );

    // Assign function names to all references
    this.assignFunctionNamesToReferences(
      collectedRefs,
      context as InitializedResolutionContext,
      identifierToPath,
    );

    this.hasSetRootSchema = true;

    // Store local identifiers for later reference
    const localIdentifiers = identifiers.map((entry) => entry.identifier);
    context.localSchemaIds = localIdentifiers;

    // Initialize schemas that have identifiers
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

  // ============================================================================
  // MACRO EXPANSION
  // ============================================================================

  /**
   * Expands macro keywords in a schema.
   * Macros are custom keywords that transform into standard JSON Schema.
   */
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

      // Validate macro value if meta-schema is defined
      if (keywordDef.metaSchema) {
        validateKeywordValue(
          keyword,
          value,
          keywordDef.metaSchema,
          this.jetValidator,
        );
      }

      // Execute the macro transformation
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

      // Track keywords that this macro implements
      if (keywordDef.implements) {
        const implemented = Array.isArray(keywordDef.implements)
          ? keywordDef.implements
          : [keywordDef.implements];
        implemented.forEach((k) => implementedKeywords.add(k));
      }
    }

    // Remove implemented keywords
    for (const implKeyword of Array.from(implementedKeywords)) {
      delete expandedSchema[implKeyword];
    }

    // Recursively expand nested schemas
    expandedSchema = this.expandMacrosRecursively(expandedSchema, macroContext);

    return expandedSchema;
  }

  /**
   * Recursively expands macros in nested schema locations.
   */
  private expandMacrosRecursively(
    schema: SchemaDefinition,
    macroContext: { schemaPath: string; rootSchema: SchemaDefinition },
  ): SchemaDefinition {
    if (typeof schema !== "object" || schema === null) {
      return schema;
    }

    // Helper to expand a single nested schema
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

    // Helper to expand a map of schemas (properties, $defs, etc.)
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

    // Helper to expand an array of schemas
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

    // Expand all schema map locations
    expandSchemaMap("properties");
    expandSchemaMap("patternProperties");
    expandSchemaMap("dependentSchemas");
    expandSchemaMap("$defs");
    expandSchemaMap("definitions");

    // Handle items (can be object or array)
    if (schema.items) {
      if (Array.isArray(schema.items)) {
        expandSchemaArray("items");
      } else {
        expandNestedSchema("items", "items");
      }
    }

    // Expand array schema locations
    expandSchemaArray("prefixItems");
    for (const combiner of ["allOf", "anyOf", "oneOf"] as const) {
      expandSchemaArray(combiner);
    }

    // Expand single schema locations
    expandNestedSchema("contains", "contains");
    expandNestedSchema("not", "not");
    expandNestedSchema("if", "if");
    expandNestedSchema("then", "then");
    expandNestedSchema("additionalProperties", "additionalProperties");
    expandNestedSchema("unevaluatedProperties", "unevaluatedProperties");
    expandNestedSchema("propertyNames", "propertyNames");
    expandNestedSchema("additionalItems", "additionalItems");
    expandNestedSchema("unevaluatedItems", "unevaluatedItems");

    // Handle elseIf array (custom extension)
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

  // ============================================================================
  // PUBLIC RESOLVER METHODS
  // ============================================================================

  /**
   * Asynchronously resolves a schema, loading external schemas as needed.
   * Use this when external schemas need to be fetched over the network.
   */
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

    // Expand macros if any are registered
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

  /**
   * Synchronously resolves a schema.
   * External schemas must already be registered with the JetValidator instance.
   */
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

    // Expand macros if any are registered
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

  // ============================================================================
  // ASYNC SCHEMA RESOLUTION
  // ============================================================================

  /**
   * Resolves a schema asynchronously, handling external references.
   */
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

    // Clone schema on first call to avoid mutating the original
    let schema = (
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

    // Handle inlining if enabled
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

  // ============================================================================
  // SYNC SCHEMA RESOLUTION
  // ============================================================================

  /**
   * Resolves a schema synchronously.
   */
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

    // Clone schema on first call to avoid mutating the original
    let schema = (
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

    // Handle inlining if enabled
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
      // Process all refs without inlining=
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

  // ============================================================================
  // INLINING LOGIC
  // ============================================================================

  /**
   * Processes schema inlining for optimization.
   * Inlines references that don't form cycles to reduce function call overhead.
   */
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

        // Try to find referenced path in current schema
        let referencedPath: string | undefined;
        if (lookupKey.startsWith("#/")) {
          if (identifierToPath[urlParts.path]) {
            referencedPath =
              identifierToPath[urlParts.path] + lookupKey.slice(1);
          }
        } else {
          referencedPath = identifierToPath[lookupKey];
        }

        // Inline if the referenced path doesn't contain refs
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

        // Try external schema
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

        // Can't inline - resolve normally
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

  /**
   * Computes the lookup key for a reference during inlining.
   */
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

  // ============================================================================
  // CONTEXT INITIALIZATION
  // ============================================================================

  /**
   * Initializes the resolution context with schema identity information.
   */
  initializeResolutionContext(
    schema: SchemaDefinition,
    context: ResolutionContext,
  ): void {
    if (schema.$id) {
      context.schemaId = schema.$id;
    } else if (context.schemaId) {
      schema.$id = context.schemaId;
    }

    // Generate a random ID if none exists
    if (!context.schemaId) {
      const generatedId = Math.random().toString(36).substring(2, 8);
      context.schemaId = generatedId;
      schema.$id = generatedId;
    }
  }

  /**
   * Initializes schemas that have identifiers ($id, $anchor, etc.) by adding them to schemasToCompile.
   */
  initializeIdentifiedSchemas(
    schema: SchemaDefinition,
    identifiers: SchemaIdentifierEntry[],
    context: ResolutionContext & { schemaId: string },
    allRefs: string[],
  ): void {
    for (const entry of identifiers) {
      // Skip if this is the context's own ID
      if (
        context.schemaId === entry.identifier ||
        context.schemaId === entry.parentSchemaId
      ) {
        continue;
      }

      // Check if this identifier is actually referenced
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

      // Skip unreferenced external identifiers
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

      // Check if already processed
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
        // Already processed - just update tracking
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

      // Get the schema at this path
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

        // Update tracking sets
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

        // Add to schemas to compile
        this.schemasToCompile.push({
          path: entry.schemaPath,
          schema: schemaAtPath,
          functionName,
        });
      }
    }
  }

  // ============================================================================
  // REFERENCE SKIPPING LOGIC
  // ============================================================================

  /**
   * Determines if a reference should be skipped (already processed).
   */
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

  // ============================================================================
  // LOCAL REFERENCE RESOLUTION
  // ============================================================================

  /**
   * Resolves a local reference (within the same schema).
   */
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

    // Handle external refs that map to local paths via $id
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

  /**
   * Adds a locally resolved reference to the compilation queue.
   */
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

  // ============================================================================
  // EXTERNAL REFERENCE RESOLUTION
  // ============================================================================

  /**
   * Resolves an external reference asynchronously.
   */
  async resolveExternalSchemaAsync(
    ref: string,
    identifiers: SchemaIdentifierEntry[],
    context: ResolutionContext,
    loadSchema?: (uri: string) => Promise<SchemaDefinition> | SchemaDefinition,
  ): Promise<void> {
    const urlParts = splitUrlIntoPathAndFragment(ref);
    const baseUrl = urlParts.path;

    // Prevent circular resolution
    if (this.currentlyResolvingSchemas.has(baseUrl)) {
      return;
    }
    this.currentlyResolvingSchemas.add(baseUrl);

    let externalSchema: SchemaDefinition | undefined;
    let wasAlreadyProcessed = false;

    if (baseUrl) {
      // Check cache first
      const cachedSchema = this.processedExternalSchemas.get(baseUrl);
      if (cachedSchema) {
        externalSchema = cachedSchema;
        wasAlreadyProcessed = true;
      }

      // Try to load from registered schemas
      if (!cachedSchema) {
        let storedSchema = this.jetValidator.getSchema(baseUrl);
        if (!storedSchema) {
          storedSchema = this.jetValidator.getMetaSchema(baseUrl).metaSchema;
        }

        if (storedSchema) {
          externalSchema = storedSchema;
        } else if (loadSchema) {
          try {
            externalSchema = await loadSchema(baseUrl);
            if (this.options.addUsedSchema) {
              this.jetValidator.addSchema(externalSchema, baseUrl);
            }
          } catch (e) {
            throw e;
          }
        }
      }
    }

    if (externalSchema !== undefined) {
      // Build the initial ref map from parent identifiers
      const newRefMap = new Map<string, string>();

      for (const entry of identifiers) {
        let refMap = this.externalSchemaRefMaps.get(baseUrl) || new Map();
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

  /**
   * Resolves an external reference synchronously.
   */
  resolveExternalSchemaSync(
    ref: string,
    identifiers: SchemaIdentifierEntry[],
    context: ResolutionContext,
  ): void {
    const urlParts = splitUrlIntoPathAndFragment(ref);
    const baseUrl = urlParts.path;

    // Prevent circular resolution
    if (this.currentlyResolvingSchemas.has(baseUrl)) {
      return;
    }
    this.currentlyResolvingSchemas.add(baseUrl);

    let externalSchema: SchemaDefinition | undefined;
    let wasAlreadyProcessed = false;

    if (baseUrl) {
      // Check cache first
      const cachedSchema = this.processedExternalSchemas.get(baseUrl);
      if (cachedSchema) {
        externalSchema = cachedSchema;
        wasAlreadyProcessed = true;
      }

      // Try to load from registered schemas
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
      // Build the initial ref map from parent identifiers
      const newRefMap = new Map<string, string>();

      for (const entry of identifiers) {
        let refMap = this.externalSchemaRefMaps.get(baseUrl) || new Map();
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

  /**
   * Adds an external schema to the compilation queue.
   */
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
    // Ensure ref map exists
    let refMap = this.externalSchemaRefMaps.get(baseUrl) || new Map();
    if (!this.externalSchemaRefMaps.has(baseUrl)) {
      this.externalSchemaRefMaps.set(baseUrl, refMap);
    }

    const existingPaths = this.compiledSchemaPaths.get(baseUrl);

    // Handle JSON pointer fragments
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
      // Check if we need the root schema too
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

      // Add the fragment schema
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
      // Handle non-pointer fragments (anchors) or no fragment
      if (existingPaths?.has(baseUrl)) {
        return;
      }

      const functionName = context.refToFunctionName.get(baseUrl);
      let finalPath: string | undefined;

      // Handle anchor fragments
      if (fragment && fragment !== "#") {
        const anchorName = fragment.slice(1);
        finalPath = resolvedSchema.idPaths[anchorName];

        if (!finalPath) {
          // Try alternate anchor forms
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

      // Add root schema if no fragment or fragment points to root
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

    // Cache the processed external schema
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

  // ============================================================================
  // REFERENCE RESOLVER (FINAL PASS)
  // ============================================================================

  /**
   * Resolves a reference at a specific path, updating the schema with function names.
   * This is called after all schemas have been collected to finalize references.
   */
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

    // Skip if already has a function name assigned
    if (schema.__functionName) {
      this.compilationContext.referencedFunctions.push(schema.__functionName);
      return;
    }

    // Assign function name if this path has one
    if (refToFunctionName.has(currentPath) && currentPath !== "#") {
      schema.__functionName = refToFunctionName.get(currentPath)!;
    }

    // Process $ref
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

    // Process $dynamicRef
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

  /**
   * Finalizes a $ref by resolving it to a function name.
   */
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

    // Remove trailing hash
    if (lookupKey !== "#" && lookupKey.endsWith("#")) {
      lookupKey = lookupKey.slice(0, -1);
    }

    let functionName = refToFunctionName.get(lookupKey);

    // Try alternate anchor form
    if (!functionName && lookupKey.endsWith(":ANCHOR")) {
      functionName = refToFunctionName.get(lookupKey.slice(0, -6) + "DYNAMIC");
    }

    // Recursively resolve referenced schema if not inlined
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
    // Update schema with resolved function name
    if (functionName) {
      schema.$ref = "*" + functionName;
      this.compilationContext.referencedFunctions.push(functionName);
    }
    // Add external reference marker
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
  /**

Finalizes a $dynamicRef by resolving it to a function name.
*/
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

    // Recursively resolve referenced schema if not inlined
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

    // Update schema with resolved function name
    if (functionName) {
      this.compilationContext.referencedFunctions.push(functionName);
      schema.$dynamicRef = "*" + functionName;
    }

    if (functionName === this.rootFunctionName) {
      this.compilationContext.hasRootReference = true;
    }

    // Add dynamic anchor reference marker
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
  // ============================================================================
  // SCHEMA METADATA COLLECTION
  // ============================================================================
  /**
  Recursively collects all metadata from a schema:
  Identifiers ($id, $anchor, $dynamicAnchor)
  References ($ref, $dynamicRef)
  Paths containing references
  Formats and custom keywords
*/
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
    // Handle boolean schemas and null/undefined
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
    // Validate strict mode requirements
    this.validateStrictModeRequirements(schema, currentPath);

    // Collect custom keywords
    this.collectCustomKeywords(schema);

    // Check for $data usage
    if (
      schema.format &&
      typeof schema.format === "object" &&
      "$data" in schema.format
    ) {
      this.compilationContext.uses$Data = true;
    }

    // Handle draft 6/7 behavior: $ref removes all sibling keywords
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

    const result = {
      refs: collectedRefs,
      ids: identifiers,
      pathsWithRefs: pathsContainingRefs,
      refPaths,
    };

    // Track current context
    let contextId = currentContextId;
    let contextBasePath = basePath;
    let contextAnchorMap = anchorToPathMap;
    let contextDynamicAnchorMap = dynamicAnchorToPathMap;

    // Process $id
    if (schema.$id) {
      if (schema.$id.startsWith("#")) {
        // Convert hash-only $id to $anchor
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

    // Process $anchor
    if (schema.$anchor) {
      registerAnchor(
        schema,
        currentPath,
        contextId,
        contextAnchorMap,
        identifiers,
      );
    }

    // Process $dynamicAnchor
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

    // Process $ref
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

    // Process $dynamicRef
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

    // Collect format strings
    if (schema.format && typeof schema.format === "string") {
      this.discoveredFormats.add(schema.format);
    }

    // Recursively process nested schemas
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
  /**

Validates schema against strict mode requirements.
*/
  private validateStrictModeRequirements(
    schema: SchemaDefinition,
    currentPath: string,
  ): void {
    // Strict type checking
    const strictTypes = this.options.strictTypes;
    if ((strictTypes || this.options.strict) && !schema.type) {
      const mode = strictTypes ? "strictTypes" : "strict";
      if (this.options.strict === true || strictTypes) {
        throw new Error(
          `[${mode}] Schema path ${currentPath} is missing the type keyword`,
        );
      } else {
        console.log(
          `[${mode}] Schema path ${currentPath} is missing the type keyword`,
        );
      }
    }
    // Strict required checking
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

    // Strict schema/type checking
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
  /**

Collects custom keywords from a schema.
*/
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

  /**

Recursively collects metadata from nested schema locations.
*/
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

    // Track unevaluated keywords
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

    // Single schema locations
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

    // Array schema locations
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

    // Handle items as array (legacy tuple validation)
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

    // Handle elseIf extension
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
