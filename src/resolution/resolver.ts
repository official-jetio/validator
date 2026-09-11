import type { BaseSchema, SchemaDefinition } from "../types/schema";
import {
  getSchemaAtPath,
  splitUrlIntoPathAndFragment,
  formatSchemaErrors,
} from "../utilities/resolver";
import type { ValidatorOptions } from "../types/validation";
import { JetValidator } from "../jet-validator";
import type { CompileContext, SchemaError } from "../types/resolver";
import type {
  SchemaIdentifierEntry,
  InitializedResolutionContext,
  ResolutionContext,
} from "./type";
import { collectSchemaMetadata } from "./traversal";
import { expandMacros } from "./expand_macro";

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

  private schemaErrors: SchemaError = {
    unknownKeywords: [],
    missingType: [],
    strictRequired: [],
    incompatibleKeywords: { errors: [], unknownTypes: [] },
    invalidKeywordTypes: [],
  };

  private compilationContext: CompileContext = {
    hasUnevaluatedProperties: false,
    hasUnevaluatedItems: false,
    hasRootReference: false,
    referencedFunctions: [],
    uses$Data: false,
    inliningStats: {
      totalRefs: 0,
      inlinedRefs: 0,
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
    } else if (entry.parentSchemaId?.startsWith("http")) {
      mapKey = entry.parentSchemaId;
    } else {
      mapKey = context.schemaId!;
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
    } else if (entry.parentSchemaId?.startsWith("http")) {
      return this.externalSchemaRefMaps.get(entry.parentSchemaId);
    } else if (context.schemaId) {
      return this.externalSchemaRefMaps.get(context.schemaId);
    }
    return this.externalSchemaRefMaps.get(identifier);
  }

  private generateFunctionName(identifier: string): string {
    return `validate${this.functionNameCounter++}`;
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
    } else if (entry.parentSchemaId?.startsWith("http")) {
      primaryRefMap = this.externalSchemaRefMaps.get(entry.parentSchemaId);
      if (entry.parentSchemaId !== context.schemaId)
        secondaryRefMap = this.externalSchemaRefMaps.get(context.schemaId!);
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
        (entry.parentSchemaId !== context.schemaId &&
          entry.parentSchemaId?.startsWith("http"));

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

    const id = context.schemaId!;
    const existingRefMap = this.externalSchemaRefMaps.get(id);

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
      this.externalSchemaRefMaps.set(id, newMap);
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
      context.refToFunctionName.set(localPath, functionName);
      newMap.set(ref, functionName);
      newMap.set(localPath, functionName);
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
            context.refToFunctionName.delete(entry.identifier);
            context.refToFunctionName.delete(entry.parentSchemaId);
            continue;
          }
        } else {
          context.refToFunctionName.delete(entry.schemaPath);
          context.refToFunctionName.delete(entry.identifier);
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
        if (schemaUrl !== context.schemaId)
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

      const schemaAtPath = getSchemaAtPath(schema, path);

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

  private preprocessSchema(
    rootSchema: SchemaDefinition,
    context: ResolutionContext,
  ) {
    const { collectedRefs, identifiers, pathsContainingRefs, pathsWithRef } =
      collectSchemaMetadata(
        rootSchema,
        Array.from(context.refToFunctionName.keys()),
        {
          options: this.options,
          jetValidator: this.jetValidator,
          compilationContext: this.compilationContext,
          discoveredFormats: this.discoveredFormats,
          discoveredCustomKeywords: this.discoveredCustomKeywords,
          schemaErrors: this.schemaErrors,
        },
      );

    const errs = formatSchemaErrors(this.schemaErrors);
    if (errs !== "") {
      this.schemaErrors.schemaId =
        rootSchema.$id ?? rootSchema.id ?? context.schemaId;
      throw Error(errs);
    }

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
      pathsWithRef,
    };
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
      processedSchema = expandMacros(
        schema,
        {
          schemaPath: "#",
          rootSchema: schema,
        },
        { options: this.options, jetValidator: this.jetValidator },
      );
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
      processedSchema = expandMacros(
        schema,
        {
          schemaPath: "#",
          rootSchema: schema,
        },
        { options: this.options, jetValidator: this.jetValidator },
      );
    }

    const result = this.resolveSchemaSynchronously(processedSchema, {
      isRootResolution: true,
      currentSchemaPath: "#",
      refToFunctionName: new Map(),
    }).schema;

    if (this.compilationContext.inliningStats.totalRefs > 0) {
      if (this.options.debug) this.logInliningSummary();
    }
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

    const schema = this.initializeResolutionContext(rootSchema, context);

    let identifierToPath: Record<string, string> = {};
    const collectedRefs: string[] = [];
    let pathsContainingRefs: Set<string> | undefined;
    let pathsWithRef: string[] = [];

    if (context.isRootResolution) {
      const preprocessResult = this.preprocessSchema(schema, context);

      pathsContainingRefs = preprocessResult.pathsContainingRefs;
      pathsWithRef = preprocessResult.pathsWithRef;
      identifierToPath = preprocessResult.identifierToPath;
      collectedRefs.push(...preprocessResult.collectedRefs);

      for (const ref of preprocessResult.collectedRefs) {
        if (
          this.prepareRootRef(
            ref,
            schema,
            preprocessResult.localIdentifiers,
            context as ResolutionContext & { schemaId: string },
            identifierToPath,
          )
        ) {
          await this.resolveExternalSchemaAsync(
            ref,
            preprocessResult.identifiers,
            context,
            loadSchema,
          );
        }
      }
    }

    this.finalizeResolution(
      schema,
      context,
      pathsWithRef,
      identifierToPath,
      pathsContainingRefs,
    );

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
    if (typeof rootSchema === "boolean") {
      return { schema: rootSchema, idPaths: {}, refs: [] };
    }

    // Clone schema on first call to avoid mutating the original
    const schema = this.initializeResolutionContext(rootSchema, context);

    let identifierToPath: Record<string, string> = {}; // $id/id to its path mapping
    const collectedRefs: string[] = [];
    let pathsContainingRefs: Set<string> | undefined; // paths that has $ref keyword, from where it is found up to the root
    let pathsWithRef: string[] = [];

    if (context.isRootResolution) {
      const preprocessResult = this.preprocessSchema(schema, context);

      pathsContainingRefs = preprocessResult.pathsContainingRefs;
      pathsWithRef = preprocessResult.pathsWithRef;
      identifierToPath = preprocessResult.identifierToPath;
      collectedRefs.push(...preprocessResult.collectedRefs);

      for (const ref of preprocessResult.collectedRefs) {
        if (
          this.prepareRootRef(
            ref,
            schema,
            preprocessResult.localIdentifiers,
            context as ResolutionContext & { schemaId: string },
            identifierToPath,
          )
        ) {
          this.resolveExternalSchemaSync(
            ref,
            preprocessResult.identifiers,
            context,
          );
        }
      }
    }

    this.finalizeResolution(
      schema,
      context,
      pathsWithRef,
      identifierToPath,
      pathsContainingRefs,
    );

    return {
      schema,
      idPaths: identifierToPath,
      refs: collectedRefs,
    };
  }

  initializeResolutionContext(
    rootSchema: SchemaDefinition,
    context: ResolutionContext,
  ): SchemaDefinition {
    const schema = context.isRootResolution
      ? structuredClone(rootSchema)
      : rootSchema;
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
    return schema;
  }

  private prepareRootRef(
    ref: string,
    schema: SchemaDefinition,
    localIdentifiers: string[],
    context: ResolutionContext & { schemaId: string },
    identifierToPath: Record<string, string>,
  ): boolean {
    if (ref === "#") return false;
    if (localIdentifiers.includes(ref)) return false;

    const shouldSkip = this.shouldSkipReference(ref, context, identifierToPath);
    if (shouldSkip) return false;

    const urlParts = splitUrlIntoPathAndFragment(ref);
    const isExternalRef =
      !ref.startsWith("#") && !localIdentifiers.includes(urlParts.path);

    if (isExternalRef) return true;

    if (ref.startsWith("#/") || !ref.startsWith("#")) {
      this.resolveLocalReference(schema, ref, identifierToPath, context);
    }

    return false;
  }

  private finalizeResolution(
    schema: SchemaDefinition,
    context: ResolutionContext,
    pathsWithRef: string[],
    identifierToPath: Record<string, string>,
    pathsContainingRefs?: Set<string>,
  ) {
    this.compilationContext.inliningStats.totalRefs += pathsWithRef.length;
    if (this.options.inlineRefs) {
      this.processInlining(
        schema,
        context,
        identifierToPath,
        pathsWithRef,
        pathsContainingRefs,
      );
    } else {
      for (const path of pathsWithRef) {
        this.resolveReferenceAtPath(
          getSchemaAtPath(schema, path),
          schema,
          context.refToFunctionName,
          path,
          pathsWithRef,
          identifierToPath,
          context.localSchemaIds,
          false,
        );
      }
    }
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

    const hasRefDescendant = (candidate: string): boolean =>
      Array.from(pathsContainingRefs ?? []).some(
        (p) => p !== candidate && p.startsWith(candidate + "/"),
      );

    const pruneResolvedPath = (path: string): void => {
      if (!hasRefDescendant(path)) pathsContainingRefs?.delete(path);
      const parts = path.split("/");
      for (let j = parts.length - 1; j > 0; j--) {
        const ancestor = parts.slice(0, j).join("/");
        if (hasRefDescendant(ancestor)) break;
        pathsContainingRefs?.delete(ancestor);
      }
    };

    const spliceTarget = (
      schemaAtPath: SchemaDefinition,
      refType: "$ref" | "$dynamicRef",
      targetSchema: SchemaDefinition | boolean,
    ): void => {
      delete schemaAtPath[refType];
      schemaAtPath.__inlinedRef = targetSchema;
    };

    const commitInline = (
      schemaAtPath: SchemaDefinition,
      refType: "$ref" | "$dynamicRef",
      targetSchema: SchemaDefinition | boolean,
      path: string,
      logTarget: string,
      logSuffix = "",
    ): boolean => {
      spliceTarget(schemaAtPath, refType, targetSchema);
      pruneResolvedPath(path);
      if (this.options.debug) {
        console.log(
          `[Resolver - ${context.schemaId}] Inlining ${refType} at ${path} -> ${logTarget}${logSuffix}`,
        );
      }
      this.compilationContext.inliningStats.inlinedRefs++;
      return true;
    };

    const logSkip = (
      refType: "$ref" | "$dynamicRef",
      path: string,
      logTarget: string,
      logSuffix = "",
    ): void => {
      if (this.options.debug) {
        console.log(
          `[Resolver - ${context.schemaId}] Skipping Inlining ${refType} at ${path} (${logTarget} contains refs)${logSuffix}`,
        );
      }
    };

    const referencedPathIn = (
      lookupKey: string,
      basePath: string,
      idPaths: Record<string, string>,
    ): string | undefined => {
      if (lookupKey.startsWith("#/")) {
        return idPaths[basePath]
          ? idPaths[basePath] + lookupKey.slice(1)
          : undefined;
      }
      return idPaths[lookupKey];
    };

    const processRefType = (
      refType: "$ref" | "$dynamicRef",
      schemaAtPath: SchemaDefinition,
      path: string,
    ): boolean => {
      const refValue = schemaAtPath[refType];
      if (!refValue) return false;

      if (refValue.startsWith("#/")) {
        if (pathsContainingRefs?.has(refValue)) {
          logSkip(refType, path, refValue);
          return false;
        }
        return commitInline(
          schemaAtPath,
          refType,
          getSchemaAtPath(schema, refValue),
          path,
          refValue,
        );
      }

      const urlParts = refValue.startsWith("#")
        ? { path: context.schemaId || "", hash: refValue }
        : splitUrlIntoPathAndFragment(refValue);

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
        if (lookupKey.endsWith("#")) lookupKey = lookupKey.slice(0, -1);
      }

      let referencedPath = referencedPathIn(
        lookupKey,
        urlParts.path,
        identifierToPath,
      );

      if (referencedPath && !pathsContainingRefs?.has(referencedPath)) {
        return commitInline(
          schemaAtPath,
          refType,
          getSchemaAtPath(schema, referencedPath),
          path,
          referencedPath,
        );
      } else if (referencedPath) {
        logSkip(refType, path, referencedPath);
      }

      if (!referencedPath) {
        const externalSchema = this.processedExternalSchemas.get(urlParts.path);
        if (externalSchema) {
          referencedPath = referencedPathIn(
            lookupKey,
            urlParts.path,
            externalSchema.idPaths,
          );
          if (
            referencedPath &&
            !this.schemaIdToRefPaths.get(urlParts.path)?.has(referencedPath)
          ) {
            return commitInline(
              schemaAtPath,
              refType,
              getSchemaAtPath(externalSchema, referencedPath),
              path,
              urlParts.path + referencedPath,
              " - (external schema)",
            );
          } else if (referencedPath) {
            logSkip(
              refType,
              path,
              urlParts.path + referencedPath,
              " - (external schema)",
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
    };

    if (pathsOfRefs.length > 0) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = pathsOfRefs.length - 1; i >= 0; i--) {
          const path = pathsOfRefs[i];
          const schemaAtPath = getSchemaAtPath(schema, path);
          if (typeof schemaAtPath !== "object") continue;

          let refProcessed = false;
          if (
            schemaAtPath.$ref !== undefined &&
            processRefType("$ref", schemaAtPath, path)
          ) {
            refProcessed = true;
          }
          if (
            schemaAtPath.$dynamicRef !== undefined &&
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

  private shouldSkipReference(
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
      if (urlParts.hash?.startsWith("#/")) {
        const targetPath = identifierToPath[baseUrl] + urlParts.hash.slice(1);
        return (
          existingContextPaths?.has(targetPath) ||
          existingUrlPaths?.has(ref) ||
          existingUrlPaths?.has(targetPath) ||
          false
        );
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

  private resolveLocalReference(
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

  private addLocalRefToCompile(
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

  private trackSchemaPath(
    path: string,
    schemaUrl: string,
    contextId: string,
    additionalPaths: string[] = [],
  ): {
    isNewPath: boolean;
  } {
    const existingUrlPaths = this.compiledSchemaPaths.get(schemaUrl);
    const existingContextPaths = this.compiledSchemaPaths.get(contextId);

    if (existingUrlPaths?.has(path) || existingContextPaths?.has(path)) {
      return { isNewPath: false };
    }

    if (existingUrlPaths) {
      existingUrlPaths.add(path);
      additionalPaths.forEach((p) => existingUrlPaths.add(p));
    } else {
      const newSet = new Set([path, ...additionalPaths]);
      this.compiledSchemaPaths.set(schemaUrl, newSet);
    }

    if (schemaUrl !== contextId) {
      if (existingContextPaths) {
        existingContextPaths.add(path);
        additionalPaths.forEach((p) => existingContextPaths.add(p));
      } else {
        const newSet = new Set([path, ...additionalPaths]);
        this.compiledSchemaPaths.set(contextId, newSet);
      }
    }

    return { isNewPath: true };
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
      const refMap = this.externalSchemaRefMaps.get(baseUrl) || new Map();
      if (!this.externalSchemaRefMaps.has(baseUrl)) {
        this.externalSchemaRefMaps.set(baseUrl, refMap);
      }

      for (const entry of identifiers) {
        if (
          !entry.identifier.startsWith("http") &&
          !entry.identifier.endsWith("ANCHOR")
        ) {
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

  private resolveExternalSchemaSync(
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
      const refMap = this.externalSchemaRefMaps.get(baseUrl) || new Map();
      if (!this.externalSchemaRefMaps.has(baseUrl)) {
        this.externalSchemaRefMaps.set(baseUrl, refMap);
      }
      for (const entry of identifiers) {
        if (
          !entry.identifier.startsWith("http") &&
          !entry.identifier.endsWith(":ANCHOR")
        ) {
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

  private addExternalSchemaToCompile(
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

    const existingPaths = this.compiledSchemaPaths.get(baseUrl) || new Set();
    if (!this.compiledSchemaPaths.has(baseUrl)) {
      this.compiledSchemaPaths.set(baseUrl, existingPaths);
    }

    if (
      fragment &&
      fragment !== "" &&
      fragment.startsWith("#/") &&
      typeof resolvedSchema.schema === "object"
    ) {
      if (existingPaths.has(fragment) || existingPaths.has(ref)) {
        existingPaths.add(fragment);
        existingPaths.add(ref);
        return;
      }

      if (
        resolvedSchema.refs.includes(baseUrl) ||
        resolvedSchema.refs.includes("#")
      ) {
        if (!existingPaths.has(baseUrl)) {
          const functionName = context.refToFunctionName.get(baseUrl);
          this.schemasToCompile.push({
            path: "#",
            schema: resolvedSchema.schema,
            functionName: functionName!,
          });
          existingPaths.add(baseUrl);
        }
      }

      const fragmentSchema = getSchemaAtPath(resolvedSchema.schema, fragment);
      if (!existingPaths.has(fragment) || !existingPaths.has(ref)) {
        if (typeof fragmentSchema === "object") {
          const functionName = context.refToFunctionName.get(ref);
          this.schemasToCompile.push({
            path: fragment,
            schema: fragmentSchema,
            functionName: functionName!,
          });
          existingPaths.add(fragment);
          existingPaths.add(ref);
        }
      }
    } else if (baseUrl) {
      if (existingPaths.has(baseUrl)) {
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

          if (!existingPaths.has(finalPath) && !existingPaths.has(ref)) {
            if (typeof anchorSchema === "object") {
              const anchorFunctionName = context.refToFunctionName.get(ref);

              this.schemasToCompile.push({
                path: finalPath,
                schema: anchorSchema,
                functionName: anchorFunctionName!,
              });

              existingPaths.add(finalPath);
              existingPaths.add(ref);
            }
          } else {
            if (existingPaths.has(finalPath)) existingPaths.add(ref);
            if (existingPaths.has(ref)) existingPaths.add(finalPath);
          }
        }
      }

      existingPaths.add(finalPath!);
      existingPaths.add(ref);

      if (!fragment || fragment === "#" || finalPath === "#") {
        this.schemasToCompile.push({
          path: "#",
          schema: resolvedSchema.schema,
          functionName: functionName!,
        });
        existingPaths.add(baseUrl);
      }
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

  private resolveReferenceAtPath(
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
    if (lookupKey.startsWith("#/") && functionName) {
      const schema = getSchemaAtPath(rootSchema, lookupKey);
      if (typeof schema === "object")
        this.resolveReferenceAtPath(
          schema,
          rootSchema,
          refToFunctionName,
          lookupKey,
          externalRefPaths,
          identifierToPath,
          localIdentifiers,
        );
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
}
