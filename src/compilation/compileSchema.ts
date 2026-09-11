import {
  ArraySchema,
  BaseSchema,
  ObjectSchema,
  SchemaDefinition,
} from "../types/schema";
import {
  encodePointerSegment,
  escapeTemplateString,
  getSchemaAtPath,
  isDataReference,
  shouldApplyKeyword,
  validateKeywordValue,
} from "../utilities/resolver";
import { ValidatorOptions } from "../types/validation";
import {
  CodeContext,
  KeywordValidationError,
  CodeKeywordDefinition,
  CompiledValidateFunction,
  CompileKeywordDefinition,
  KeywordDefinition,
  ValidateKeywordDefinition,
} from "../types/keywords";
import { JetValidator } from "../jet-validator";
import {
  addEvaluatedItems,
  addEvaluatedProperty,
  coerceToArray,
  coerceToBoolean,
  coerceToNumber,
  coerceToString,
  generateArrayDataRef,
  generateNumberDataRef,
  generateStringDataRef,
  generateTypeCheck,
  generateUndefinedDataRef,
  PRIMITIVE_TYPES,
  resolveDataPointerAtCompileTime,
  shouldTrackProperties,
  shouldTrackItems,
  renderSegmentPath,
  toAccessor,
} from "../utilities/compilation";
import {
  TrackingState,
  PathContext,
  Extra,
  ErrorInfo,
  AccessSegment,
} from "../types/compiler";
import { CompileContext } from "../types";

const nonValidationKeys: string[] = [
  "$schema",
  "deprecated",
  "$id",
  "id",
  "title",
  "description",
  "examples",
  "$comment",
  "default",
  "readOnly",
  "writeOnly",
  "$defs",
  "definitions",
  "$dynamicAnchor",
  "$anchor",
  "$vocabulary",
  "allFormats",
  "errorMessage",
];

function canSkip(schema: SchemaDefinition | boolean): boolean {
  if (typeof schema === "boolean") {
    return schema === true;
  }
  return Object.keys(schema).every((key) => nonValidationKeys.includes(key));
}

export class Compiler {
  private counter: number = 0;
  private refables: any[] = [];
  private ranRefables = false;
  private schema: SchemaDefinition | boolean;
  private options: Partial<ValidatorOptions>;
  private errorVariableDeclared = false;

  private compiledKeywords = new Map<string, CompiledValidateFunction>();
  private emittedKeywordFactories = new Set<string>();
  private validateKeywords = new Set<string>();
  private keywordSafeNames = new Map<string, string>();
  hoistedKeywords: string[] = [];
  private cachedValidateSchema: Map<string, SchemaDefinition> = new Map();

  private allKeywords: Set<string>;

  regexCache = new Map<string, string>();
  private jetValidator: JetValidator;
  private compileContext: CompileContext;
  private standAlone = false;
  private hasCompileKeyword = false;
  needslen_of: boolean = false;
  needsUniqueChecker: boolean = false;
  needsDeepEqual: boolean = false;
  hoistedFunctions: string[] = [];

  constructor(
    refables: any[] = [],
    schema: SchemaDefinition | boolean,
    options: Partial<ValidatorOptions>,
    jetValidator: JetValidator,
    allKeywords: Set<string>,
    compileContext: CompileContext,
    standalone: boolean = false,
  ) {
    this.refables = refables;
    this.schema = schema;
    this.options = options;
    this.jetValidator = jetValidator;
    this.allKeywords = allKeywords;
    this.compileContext = compileContext;
    this.standAlone = standalone;
  }

  private safeKeywordName(keyword: string, save: boolean = true): string {
    if (save) {
      const existing = this.keywordSafeNames.get(keyword);
      if (existing) return existing;
    }

    const base = "kw_" + keyword.replace(/[^a-zA-Z0-9_$]/g, "_");
    if (!save) return base;
    let name = base;
    let n = 0;
    const taken = new Set(this.keywordSafeNames.values());
    while (taken.has(name)) name = `${base}_${n++}`;

    this.keywordSafeNames.set(keyword, name);
    return name;
  }

  getCompiledKeywords() {
    return {
      compiledKeywords: this.compiledKeywords,
      validateKeywords: this.validateKeywords,
      hasCompileKeyword: this.hasCompileKeyword,
      keywordSafeNames: this.keywordSafeNames,
      cachedValidateSchema: this.cachedValidateSchema,
    };
  }

  private createSubschemaOptions(
    trackingState: TrackingState,
    pathContext: PathContext,
    pathSegment: string,
    schema: SchemaDefinition,
    acsP: string,
  ): { pathContext: PathContext; trackingState: TrackingState } {
    const parentUnevProp = shouldTrackProperties(schema, trackingState);
    const parentUnevItem = shouldTrackItems(schema, trackingState);

    return {
      pathContext: {
        ...pathContext,
        schema: `${pathContext.schema}${pathSegment}`,
        accessPattern: pathContext.accessPattern,
      },
      trackingState: {
        parentHasUnevaluatedProperties: parentUnevProp,
        parentUnevaluatedPropVar: parentUnevProp
          ? trackingState.unevaluatedPropVar
          : undefined,
        parentHasUnevaluatedItems: parentUnevItem,
        parentUnevaluatedItemVar: parentUnevItem
          ? trackingState.unevaluatedItemVar
          : undefined,
      },
    };
  }

  private handleCustomKeywords(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
    trackingState: TrackingState,
  ): void {
    for (const [key, value] of Object.entries(schema)) {
      const keywordDef = this.jetValidator.getKeyword(key);

      if (!keywordDef || !shouldApplyKeyword(keywordDef, value)) continue;

      if (keywordDef.metaSchema) {
        validateKeywordValue(
          key,
          value,
          keywordDef.metaSchema,
          this.jetValidator,
        );
      }

      if (keywordDef.type) {
        const typeChecks = Array.isArray(keywordDef.type)
          ? keywordDef.type
              .map((t) => generateTypeCheck(varName, t))
              .join(" || ")
          : generateTypeCheck(varName, keywordDef.type);
        src.push(`if ((${typeChecks})) {`);
      }

      if ((keywordDef as CodeKeywordDefinition).code) {
        this.handleCodeKeyword(
          src,
          keywordDef,
          value,
          schema,
          varName,
          pathContext,
          trackingState,
          extra,
        );
      } else if ((keywordDef as CompileKeywordDefinition).compile) {
        this.handleCompileKeyword(
          src,
          keywordDef,
          value,
          schema,
          varName,
          pathContext,
          extra,
        );
      } else if ((keywordDef as ValidateKeywordDefinition).validate) {
        this.handleValidateKeyword(
          src,
          keywordDef,
          value,
          varName,
          pathContext,
          extra,
        );
      }

      if (keywordDef.type) {
        src.push("}");
      }
    }
  }

  private handleCodeKeyword(
    src: string[],
    keywordDef: CodeKeywordDefinition,
    keywordValue: any,
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    const codeContext: CodeContext = {
      dataVar: varName,
      dataPath: pathContext.data,
      schemaPath: pathContext.schema,
      fullAccess: Object.freeze(pathContext.fullAccess),
      rootDataVar: pathContext.rootDataVar,
      allErrors: this.options.allErrors ?? false,
      functionName: extra.functionName,
      errorVariable: this.options.allErrors ? extra.errorVar : undefined,
      resolveDataPointer: (pointer: string) =>
        resolveDataPointerAtCompileTime(
          pointer,
          pathContext.fullAccess,
          pathContext.rootDataVar,
        ),
      buildError: (error: KeywordValidationError) => {
        const { keyword, message, expected, value, ...extras } = error;
        const spreadCode =
          Object.keys(extras).length > 0
            ? `...${JSON.stringify(extras)}`
            : undefined;

        const err = this.buildErrorReturn(
          pathContext,
          {
            keyword: keyword || keywordDef.keyword,
            message: JSON.stringify(message),
            expected,
            value: value !== undefined ? value : varName,
          },
          extra,
          spreadCode,
        );
        return err;
      },

      addEvaluatedProperty: (prop: string) => {
        const lines: string[] = [];
        addEvaluatedProperty(lines, JSON.stringify(prop), trackingState);
        return lines.join("\n");
      },

      addEvaluatedItem: (item: number) => {
        const lines: string[] = [];
        addEvaluatedItems(lines, item, trackingState);
        return lines.join("\n");
      },
    };
    const generatedCode = keywordDef.code!(keywordValue, schema, codeContext);

    if (typeof generatedCode !== "string") {
      throw new Error(
        `code keyword '${keywordDef.keyword}' must return a string`,
      );
    }
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    src.push(generatedCode);
    if (extra.before != "") src.push(`}`);
  }

  private handleCompileKeyword(
    src: string[],
    keywordDef: CompileKeywordDefinition,
    keywordValue: any,
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const kId = this.safeKeywordName(
      keywordDef.keyword + this.counter++,
      false,
    );
    const schemaPath = pathContext.schema.startsWith("#")
      ? pathContext.schema
      : "#" + pathContext.schema;

    if (this.standAlone) {
      const factoryName = this.safeKeywordName(keywordDef.keyword);

      if (!this.emittedKeywordFactories.has(factoryName)) {
        this.hoistedKeywords.push(
          `const ${factoryName} = ${keywordDef.compile!.toString()};`,
        );
        this.emittedKeywordFactories.add(factoryName);
      }

      const schemaVar = kId + "schema";
      const schemaAtPath = getSchemaAtPath(
        this.schema as SchemaDefinition,
        schemaPath,
      );

      this.cachedValidateSchema.set(
        schemaVar,
        schemaAtPath as SchemaDefinition,
      );
      const context = `{schemaPath: ${JSON.stringify(schemaPath)}, rootSchema: mainRootSchema, opts: compilerOptions}`;
      let hfunction = `const ${kId} = ${factoryName}(`;
      hfunction += [JSON.stringify(keywordValue), schemaVar, context].join(
        ", ",
      );
      hfunction += ");";

      this.hoistedKeywords.push(hfunction);
    } else {
      const validateFn = keywordDef.compile!(keywordValue, schema, {
        schemaPath,
        rootSchema: this.schema as SchemaDefinition,
        opts: this.jetValidator.options,
      });
      this.compiledKeywords.set(kId, validateFn);
    }

    this.hasCompileKeyword = true;

    if (extra.before != "") src.push(`if(${extra.before} true){`);
    const kidRes = `${kId}Res`;
    const prefix = keywordDef.async ? "await " : "";

    src.push(
      `const ${kidRes} = ${prefix}${kId}(${varName}, ${pathContext.rootDataVar}, \`${pathContext.data}\`);`,
      `if (${kidRes} !== true) {`,
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: keywordDef.keyword,
          value: varName,
          message: `"Failed validation for keyword '${keywordDef.keyword}'"`,
        },
        extra,
        `...(typeof ${kidRes} === 'object' && ${kidRes} !== null ? ${kidRes} : {})`,
      )}}`,
    );
    if (extra.before != "") src.push(`}`);
  }

  private handleValidateKeyword(
    src: string[],
    keywordDef: KeywordDefinition,
    keywordValue: any,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const schemaPath = pathContext.schema.startsWith("#")
      ? pathContext.schema
      : "#" + pathContext.schema;

    const segs = pathContext.fullAccess;
    const last = segs[segs.length - 1];

    const parentData =
      segs.length === 0
        ? pathContext.rootDataVar
        : pathContext.rootDataVar + segs.slice(0, -1).map(toAccessor).join("");

    const parentDataProperty =
      last === undefined
        ? "undefined"
        : last.kind === "dynamic"
          ? last.expr
          : last.kind === "index"
            ? last.value
            : JSON.stringify(last.value);

    const kId = this.safeKeywordName(keywordDef.keyword);
    const uid = this.counter++;
    const resVar = `${kId}Res${uid}`;

    const schemaValue = JSON.stringify(keywordValue);

    const schemaVar = `${kId}schema${uid}`;
    const schemaAtPath = getSchemaAtPath(
      this.schema as SchemaDefinition,
      pathContext.schema,
    );
    this.cachedValidateSchema.set(schemaVar, schemaAtPath as SchemaDefinition);

    const contextArg = [
      `dataPath: \`${pathContext.data}\``,
      `rootData: ${pathContext.rootDataVar}`,
      `schemaPath: ${JSON.stringify(schemaPath)}`,
      `parentData: ${parentData}`,
      `parentDataProperty: ${parentDataProperty}`,
    ].join(", ");

    const prefix = keywordDef.async ? "await " : "";
    const args = [schemaValue, varName, schemaVar, `{${contextArg}}`].join(
      ", ",
    );

    if (extra.before != "") src.push(`if(${extra.before} true){`);
    src.push(
      `const ${resVar} = ${prefix}${kId}(${args});`,
      `if (${resVar} !== true) {`,
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: keywordDef.keyword,
          value: varName,
          message: `"Failed validation for keyword '${keywordDef.keyword}'"`,
        },
        extra,
        `...(typeof ${resVar} === 'object' && ${resVar} !== null ? ${resVar} : {})`,
      )}}`,
    );
    if (extra.before != "") src.push(`}`);

    this.validateKeywords.add(keywordDef.keyword);
  }

  compileSchema(
    rootSchema: SchemaDefinition | boolean,
    pathContext: PathContext = {
      schema: "#",
      data: "",
      fullAccess: [],
      rootDataVar: "rootData",
      accessPattern: "rootData",
    },
    trackingState: TrackingState = {},
    extra: Extra,
  ): string {
    if (canSkip(rootSchema)) return "";

    if (typeof rootSchema === "object") {
      const keys = Object.keys(rootSchema);
      const keysLen = keys.length;
      if (keysLen === 0) return "";
      if (
        keysLen === 1 &&
        (keys.includes("$id") || keys.includes("id") || keys.includes("schema"))
      )
        return "";
    }

    const src: string[] = [];

    if (!this.errorVariableDeclared) {
      if (this.options.allErrors) src.push("let allErrors = null;");
      this.errorVariableDeclared = true;
    }

    if (rootSchema === false) {
      src.push(
        this.buildErrorReturn(
          pathContext,
          {
            keyword: "boolean",
            message: '"schema is false"',
            value: pathContext.accessPattern,
          },
          extra,
        ),
      );
      return src.join("");
    }

    const schema = rootSchema as SchemaDefinition;
    const varName =
      pathContext.accessPattern === "rootData" || extra.inlined
        ? pathContext.accessPattern
        : "jv" + this.counter++;

    this.initializeVariable(
      src,
      schema,
      varName,
      pathContext.accessPattern,
      extra.inlined ?? false,
    );

    const sTProps = shouldTrackProperties(schema, trackingState);
    trackingState.shouldTrackEvaluatedProperties = sTProps;

    const sTItems = shouldTrackItems(schema, trackingState);
    trackingState.shouldTrackEvaluatedItems = sTItems;

    if (sTProps) {
      this.initializePropertyTracking(src, schema, trackingState);
    }

    if (sTItems) {
      this.initializeItemTracking(src, schema, trackingState);
    }

    if (!this.ranRefables && this.refables.length > 0) {
      this.initializeSchemaRefs();
    }

    if (!extra.first && schema.__functionName) {
      this.initializeReffedPath(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
      return src.join("");
    }

    const { arrayCondition, objectCondition } = this.handleTypeValidation(
      src,
      schema,
      varName,
      pathContext,
      extra,
    );

    if (schema.type === "object" || objectCondition) {
      this.handleObject(
        src,
        schema as ObjectSchema,
        varName,
        pathContext,
        trackingState,
        objectCondition,
        extra,
      );
    }

    if (schema.type === "array" || arrayCondition) {
      this.handleArray(
        src,
        schema as ArraySchema,
        varName,
        pathContext,
        trackingState,
        arrayCondition,
        extra,
      );
    }

    if (schema.__inlinedRef !== undefined) {
      this.inlineRefFunction(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (schema.$ref || schema.$dynamicRef) {
      this.handleReference(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (schema.not || schema.anyOf || schema.allOf || schema.oneOf) {
      this.handleLogicalOperators(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (schema.if !== undefined) {
      this.handleConditionalLogic(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }
    if (this.allKeywords.size > 0) {
      this.handleCustomKeywords(
        src,
        schema,
        varName,
        pathContext,
        extra,
        trackingState,
      );
    }

    if (
      schema.unevaluatedProperties !== undefined &&
      schema.additionalProperties === undefined
    ) {
      src.push(
        `if (${extra.before}${varName} && typeof ${varName} === 'object' && !Array.isArray(${varName})) {`,
      );
      this.handleUnevaluatedProperties(
        src,
        schema as ObjectSchema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
      src.push(`}`);
    }

    if (
      schema.unevaluatedItems !== undefined &&
      (schema.items === undefined ||
        (Array.isArray(schema.items) && schema.additionalItems === undefined))
    ) {
      src.push(`if(${extra.before}Array.isArray(${varName})){`);
      this.handleUnevaluatedItems(
        src,
        schema as ArraySchema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
      src.push(`}`);
    }

    return src.join("");
  }

  private initializeVariable(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    accessPattern: string,
    inlined: boolean,
  ): void {
    if (this.options.coerceTypes) {
      const unwrap = this.options.coerceTypes === "array";
      if (schema.type === "number" || schema.type === "integer") {
        coerceToNumber(src, accessPattern, unwrap);
      } else if (schema.type === "string") {
        coerceToString(src, accessPattern, unwrap);
      } else if (schema.type === "boolean") {
        coerceToBoolean(src, accessPattern, unwrap);
      } else if (
        schema.type === "array" &&
        this.options.coerceTypes === "array"
      ) {
        coerceToArray(src, accessPattern);
      }
    }

    if (varName !== "rootData" && varName !== "data" && !inlined)
      src.push(`var ${varName} = ${accessPattern};`);
  }

  private initializePropertyTracking(
    src: string[],
    schema: SchemaDefinition,
    trackingState: TrackingState,
  ): void {
    const hasOwn = shouldTrackProperties(schema, trackingState, true);
    trackingState.hasOwnUnevaluatedProperties = hasOwn;

    const unEvaluatedPropVar = "eP" + this.counter++;
    trackingState.unevaluatedPropVar = unEvaluatedPropVar;

    if (
      hasOwn &&
      trackingState.parentHasUnevaluatedProperties &&
      trackingState.parentUnevaluatedPropVar
    ) {
      trackingState.unEvaluatedPropertiesSetVar = "ePSets" + this.counter++;
      src.push(
        `const ${unEvaluatedPropVar} = new Set();`,
        `const ${trackingState.unEvaluatedPropertiesSetVar} = [${trackingState.parentUnevaluatedPropVar}, ${unEvaluatedPropVar}];`,
      );
    } else if (hasOwn) {
      src.push(`const ${unEvaluatedPropVar} = new Set();`);
    } else if (
      trackingState.parentHasUnevaluatedProperties &&
      trackingState.parentUnevaluatedPropVar
    ) {
      trackingState.unevaluatedPropVar = trackingState.parentUnevaluatedPropVar;
    }
  }

  private initializeItemTracking(
    src: string[],
    schema: SchemaDefinition,
    trackingState: TrackingState,
  ): void {
    const hasOwn = shouldTrackItems(schema, trackingState, true);
    trackingState.hasOwnUnevaluatedItems = hasOwn;

    const unEvaluatedItemVar = "eI" + this.counter++;
    trackingState.unevaluatedItemVar = unEvaluatedItemVar;

    if (hasOwn && trackingState.parentHasUnevaluatedItems) {
      trackingState.unEvaluatedItemsSetVar = "eISets" + this.counter++;
      src.push(
        `const ${unEvaluatedItemVar} = new Set();`,
        `const ${trackingState.unEvaluatedItemsSetVar} = [${trackingState.parentUnevaluatedItemVar}, ${unEvaluatedItemVar}];`,
      );
    } else if (hasOwn) {
      src.push(`const ${unEvaluatedItemVar} = new Set();`);
    } else if (
      trackingState.parentHasUnevaluatedItems &&
      trackingState.parentUnevaluatedItemVar
    ) {
      trackingState.unevaluatedItemVar = trackingState.parentUnevaluatedItemVar;
    }
  }

  initializeSchemaRefs(): void {
    this.ranRefables = true;

    for (const key of this.refables) {
      if (!this.compileContext.referencedFunctions.includes(key.functionName))
        continue;

      const includesItemsRef = this.compileContext.hasUnevaluatedItems;
      const includesPropRef = this.compileContext.hasUnevaluatedProperties;

      const def = key["schema"];

      const parentProp = "eP" + this.counter++;
      const parentItem = "eI" + this.counter++;

      let path;
      if (this.options.verbose === true || this.options.verbose === "path") {
        path = key.path.startsWith("#") ? key.path.slice(1) : key.path;
      } else {
        path = !key.path.startsWith("#") ? "#" + key.path : key.path;
      }

      const errorVar = `${key.functionName}Err`;
      const defValidatorFn = this.compileSchema(
        def,
        {
          schema: path,
          data: "",
          rootDataVar: "data",
          fullAccess: [],
          accessPattern: "data",
        },
        {
          parentHasUnevaluatedProperties: includesPropRef,
          parentUnevaluatedPropVar: includesPropRef ? parentProp : undefined,
          parentHasUnevaluatedItems: includesItemsRef,
          parentUnevaluatedItemVar: includesItemsRef ? parentItem : undefined,
        },
        {
          after: "",
          predicate: false,
          before: "",
          noreturn: false,
          refAfter: "",
          errorVar: errorVar,
          functionName: key.functionName,
          first: true,
        },
      );

      const funcParams = ["data"];
      if (includesPropRef) funcParams.push(parentProp);
      if (includesItemsRef) funcParams.push(parentItem);
      funcParams.push("path");

      const asyncPrefix = this.options.async ? "async " : "";
      this.hoistedFunctions.push(
        `${asyncPrefix}function ${key.functionName}(${funcParams.join(",")}) {`,
        this.options.allErrors ? `var ${errorVar} = null;` : "",
        defValidatorFn,
        this.options.allErrors
          ? `${key.functionName}.errors = ${errorVar}; return ${errorVar} === null || ${errorVar}.length === 0`
          : " return true",
        "};",
      );
    }
  }

  inlineRefFunction(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    const def = schema.__inlinedRef;
    const configs = this.createSubschemaOptions(
      trackingState,
      pathContext,
      "",
      schema,
      varName,
    );
    const defValidatorFn = this.compileSchema(
      def,
      configs.pathContext,
      configs.trackingState,
      { ...extra, inlined: true },
    );
    src.push(defValidatorFn);
  }

  initializeReffedPath(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    const funcValidator = "func" + this.counter++;

    let p;
    if (
      pathContext.rootDataVar === "data" ||
      this.compileContext.hasRootReference
    ) {
      p = {
        s: "",
        prev: "path",
        d: pathContext.data,
      };
    } else {
      p = { s: "#", prev: "null", d: pathContext.data };
    }
    const callArgs = this.buildRefCallArgs(varName, trackingState, p);
    const fn = schema.__functionName;

    if (extra.before != "") src.push(`if(${extra.before} true){`);

    const awaitPrefix = this.options.async ? "await " : "";
    src.push(`const ${funcValidator}Result = ${awaitPrefix}${fn}${callArgs};`);

    let body: string;
    if (extra.predicate) {
      body = extra.after;
    } else if (this.options.allErrors || extra.noreturn) {
      body = `${extra.after}if(${fn}.errors){if(${extra.errorVar} === null)${extra.errorVar}=${fn}.errors;else for(const e of ${fn}.errors)${extra.errorVar}.push(e);}`;
    } else {
      body = `${extra.functionName}.errors = ${fn}.errors;return false;`;
    }

    src.push(`if (!${funcValidator}Result){${body}}`);

    if (extra.before != "") src.push(`}`);
  }

  handleReference(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): string | void {
    const refTypes: ("$ref" | "$dynamicRef")[] = [];
    if (schema.$ref) refTypes.push("$ref");
    if (schema.$dynamicRef) refTypes.push("$dynamicRef");

    for (const refType of refTypes) {
      const refValue = schema[refType];

      if (refValue === "*unavailable") {
        src.push(
          this.buildErrorReturn(
            pathContext,
            {
              keyword: refType,
              value: varName,
              message: `"Invalid ${refType} pointer. ${refType} not found."`,
            },
            extra,
          ),
        );
        continue;
      }

      const refValidator =
        (refType === "$ref" ? "refs" : "drefs") + this.counter++;

      const [fName, rest] = refValue!.split("**");
      const functionName = fName.slice(1);

      const p = {
        s: `${pathContext.schema}/${refType}${rest ? `/${rest}` : ""}`,
        d: pathContext.data,
        prev:
          pathContext.rootDataVar === "data" ||
          this.compileContext.hasRootReference
            ? "path"
            : "null",
      };

      const callArgs = this.buildRefCallArgs(varName, trackingState, p);
      const awaitPrefix = this.options.async ? "await " : "";

      if (extra.before != "") src.push(`if(${extra.before} true){`);
      src.push(
        `const ${refValidator}Result = ${awaitPrefix}${functionName}${callArgs};`,
      );

      let body: string;
      if (extra.predicate) {
        body = extra.after;
      } else if (this.options.allErrors || extra.noreturn) {
        body = `${extra.after}if(${functionName}.errors){if(${extra.errorVar}===null)${extra.errorVar}=${functionName}.errors;else for(const e of ${functionName}.errors)${extra.errorVar}.push(e);}`;
      } else {
        body = `${extra.functionName}.errors = ${functionName}.errors;return false;`;
      }

      src.push(`if (!${refValidator}Result){${body}}`);

      if (extra.before != "") src.push(`}`);
    }
  }

  private buildRefCallArgs(
    varName: string,
    trackingState: TrackingState,
    path: {
      s: string;
      d: string;
      prev: string;
    },
  ): string {
    const args = [varName];
    const includesItemsRef = this.compileContext.hasUnevaluatedItems;
    const includesPropRef = this.compileContext.hasUnevaluatedProperties;

    if (includesPropRef) {
      args.push(trackingState.unevaluatedPropVar || "undefined");
    }
    if (includesItemsRef) {
      args.push(trackingState.unevaluatedItemVar || "undefined");
    }
    if (this.options.verbose === true || this.options.verbose === "path") {
      args.push(`{s: "${path.s}", prev: ${path.prev}, d: \`${path.d}\`}`);
    } else {
      args.push(`{prev: ${path.prev}, d: \`${path.d}\`}`);
    }

    return `(${args.join(", ")})`;
  }

  handleLogicalOperators(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    if (schema.allOf)
      this.handleAllOfOperator(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    if (schema.not)
      this.handleNotOperator(src, schema, varName, pathContext, extra);
    if (schema.anyOf)
      this.handleAnyOfOperator(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    if (schema.oneOf)
      this.handleOneOfOperator(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
  }

  handleAllOfOperator(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    if (!schema.allOf) return;
    if (extra.before !== "") src.push(`if(${extra.before} true){`);
    schema.allOf.forEach((subSchema, index) => {
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        `/allOf/${index}`,
        schema,
        varName,
      );
      configs.pathContext.mapping = `/allOf/${index}`;
      const validatorFn = this.compileSchema(
        subSchema,
        configs.pathContext,
        configs.trackingState,
        { ...extra, inlined: true },
      );
      src.push(validatorFn);
    });
    if (extra.before !== "") src.push("}");
  }

  handleNotOperator(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    if (schema.not === undefined) return;
    if (extra.before !== "") src.push(`if(${extra.before} true){`);

    const cv = `notv${this.counter++}`;
    src.push(`var ${cv} = true;`);
    const validatorFn = this.compileSchema(
      schema.not,
      { ...pathContext, accessPattern: varName },
      {},
      {
        before: `${cv} && `,
        after: `${cv} = false;`,
        predicate: true,
        functionName: extra.functionName,
        errorVar: extra.errorVar,
        inlined: false,
      },
    );

    src.push(validatorFn);

    src.push(
      `if (${cv}) {`,
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: "not",
          value: varName,
          message: '"must not match the schema"',
          expected: '"opposite data"',
        },
        extra,
      )}};`,
    );
    if (extra.before !== "") src.push("}");
  }

  handleAnyOfOperator(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    if (!schema.anyOf) return;
    if (extra.before !== "") src.push(`if(${extra.before} true){`);

    const aV = "aV" + this.counter++;
    src.push(`var ${aV} = false;`);

    let aE;
    if (this.options.allErrors || extra.noreturn) aE = extra.errorVar;
    else {
      aE = "aE" + this.counter++;
      src.push(`var ${aE} = null;`);
    }

    const fLen = `fl` + this.counter++;
    if (!extra.predicate) src.push(`const ${fLen} = ${aE} ? ${aE}.length : 0;`);

    const allErrors = this.options.allErrors;
    schema.anyOf.forEach((subSchema, index) => {
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        `/anyOf/${index}`,
        schema,
        varName,
      );
      configs.pathContext.mapping = `/anyOf/${index}`;

      const branch = `abv${this.counter++}`;
      const validatorFn = this.compileSchema(
        subSchema,
        configs.pathContext,
        configs.trackingState,
        {
          before: !allErrors ? `${branch} && ` : "",
          after: `${branch} = false;`,
          predicate: extra.predicate,
          noreturn: true,
          errorVar: aE,
          functionName: extra.functionName,
          inlined: true,
        },
      );

      if (
        index > 0 &&
        !trackingState.shouldTrackEvaluatedProperties &&
        !trackingState.shouldTrackEvaluatedItems
      ) {
        src.push(`if(${aV} === false){`);
      }

      src.push(`var ${branch} = true;`);

      const propSet = trackingState.unevaluatedPropVar;
      const itemSet = trackingState.unevaluatedItemVar;
      const pVar = "apS" + this.counter++;
      const iVar = "aiS" + this.counter++;
      if (propSet) src.push(`const ${pVar} = ${propSet}?.size;`);
      if (itemSet) src.push(`const ${iVar} = ${itemSet}?.size;`);

      src.push(validatorFn);
      src.push(`if (${branch}) { ${aV} = true; }`);

      if (propSet) {
        src.push(
          `if (!${branch}) if(${propSet})Array.from(${propSet}).slice(${pVar}).forEach(prop => ${propSet}.delete(prop));`,
        );
      }
      if (itemSet) {
        src.push(
          `if (!${branch}) if(${itemSet})Array.from(${itemSet}).slice(${iVar}).forEach(prop => ${itemSet}.delete(prop));`,
        );
      }

      if (
        index > 0 &&
        !trackingState.shouldTrackEvaluatedProperties &&
        !trackingState.shouldTrackEvaluatedItems
      ) {
        src.push("};");
      }
    });

    const collecting = this.options.allErrors || extra.noreturn;
    const error = this.buildErrorReturn(
      pathContext,
      {
        keyword: "anyOf",
        value: varName,
        message: `"must match at least one schema"`,
        expected: '"any schema match"',
      },
      { ...extra, errorVar: aE, noreturn: true },
    );

    let body: string;
    if (extra.predicate || collecting) {
      body = error;
    } else {
      body = `${error}${extra.functionName}.errors = ${aE};return false;`;
    }

    src.push(`if(!${aV}){${body}}`);

    if (!extra.predicate) {
      src.push(`else if (${aE} && ${fLen} !== ${aE}.length) {`);
      src.push(`if(${fLen}) ${aE}.length = ${fLen};`);
      src.push(`else ${aE} = null;`);
      src.push("}");
    }

    if (extra.before !== "") src.push("}");
  }

  handleOneOfOperator(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    if (!schema.oneOf) return;
    if (extra.before !== "") src.push(`if(${extra.before} true){`);

    const vC = "vC" + this.counter++;
    src.push(`var ${vC} = 0;`);

    let oE;
    if (this.options.allErrors || extra.noreturn) oE = extra.errorVar;
    else {
      oE = "oE" + this.counter++;
      src.push(`var ${oE} = null;`);
    }

    const fLen = `fl` + this.counter++;
    if (!extra.predicate) src.push(`const ${fLen} = ${oE} ? ${oE}.length : 0;`);

    const allErrors = this.options.allErrors;
    schema.oneOf.forEach((subSchema, index) => {
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        `/oneOf/${index}`,
        schema,
        varName,
      );
      configs.pathContext.mapping = `/oneOf/${index}`;

      const branch = `bv${this.counter++}`;
      const validatorFn = this.compileSchema(
        subSchema,
        configs.pathContext,
        configs.trackingState,
        {
          before: !allErrors ? `${branch} && ` : "",
          after: `${branch} = false;`,
          predicate: extra.predicate,
          noreturn: true,
          errorVar: oE,
          functionName: extra.functionName,
          inlined: true,
        },
      );

      if (
        index > 0 &&
        !trackingState.shouldTrackEvaluatedProperties &&
        !trackingState.shouldTrackEvaluatedItems
      ) {
        src.push(`if(${vC} < 2){`);
      }

      src.push(`var ${branch} = true;`);

      const propSet = trackingState.unevaluatedPropVar;
      const itemSet = trackingState.unevaluatedItemVar;
      const pVar = "opS" + this.counter++;
      const iVar = "oiS" + this.counter++;
      if (propSet) src.push(`const ${pVar} = ${propSet}?.size;`);
      if (itemSet) src.push(`const ${iVar} = ${itemSet}?.size;`);

      src.push(validatorFn);
      src.push(`if (${branch}) { ${vC}++; }`);

      if (propSet) {
        src.push(
          `if (!${branch}) if(${propSet})Array.from(${propSet}).slice(${pVar}).forEach(prop => ${propSet}.delete(prop));`,
        );
      }
      if (itemSet) {
        src.push(
          `if (!${branch}) if(${itemSet})Array.from(${itemSet}).slice(${iVar}).forEach(prop => ${itemSet}.delete(prop));`,
        );
      }

      if (
        index > 0 &&
        !trackingState.shouldTrackEvaluatedProperties &&
        !trackingState.shouldTrackEvaluatedItems
      ) {
        src.push(`}`);
      }
    });

    const collecting = this.options.allErrors || extra.noreturn;
    const error = this.buildErrorReturn(
      pathContext,
      {
        keyword: "oneOf",
        value: varName,
        message: `"must match exactly one schema"`,
        expected: '"one schema match"',
      },
      { ...extra, errorVar: oE, noreturn: true },
    );

    let body: string;
    if (extra.predicate || collecting) {
      body = error;
    } else {
      body = `${error}${extra.functionName}.errors = ${oE};return false;`;
    }
    src.push(`if (${vC} != 1) {${body}}`);
    if (!extra.predicate) {
      src.push(`else if (${oE} && ${fLen} !== ${oE}.length) {`);
      src.push(`if(${fLen}) ${oE}.length = ${fLen};`);
      src.push(`else ${oE} = null;`);
      src.push("}");
    }

    if (extra.before !== "") src.push("}");
  }

  handleConditionalLogic(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    if (schema.if === undefined) return;

    if (extra.before !== "") src.push(`if(${extra.before} true){`);
    const configs = this.createSubschemaOptions(
      trackingState,
      pathContext,
      `/if`,
      schema,
      varName,
    );

    const ifV = `ifV${this.counter++}`;
    src.push(`var ${ifV} = true;`);

    const elseIfVariableArray = [];
    if (schema.elseIf) {
      for (const subSchema of schema.elseIf) {
        if (subSchema.if) {
          const ifV = `ifV${this.counter++}`;
          src.push(`var ${ifV} = true;`);
          elseIfVariableArray.push(ifV);
        }
      }
    }

    const subValidator = this.compileSchema(
      schema.if,
      configs.pathContext,
      configs.trackingState,
      {
        before: `${ifV} && `,
        after: `${ifV} = false;`,
        predicate: true,
        refAfter: "",
        errorVar: extra.errorVar,
        functionName: extra.functionName,
        inlined: false,
      },
    );

    const propSet = trackingState.unevaluatedPropVar;
    const itemSet = trackingState.unevaluatedItemVar;

    const pVar = "ifpSize" + this.counter++;
    const iVar = "ifiSize" + this.counter++;
    if (propSet) src.push(`const ${pVar} = ${propSet}?.size;`);
    if (itemSet) src.push(`const ${iVar} = ${itemSet}?.size;`);
    src.push(subValidator);

    if (propSet) {
      src.push(
        `if (!${ifV}) if(${propSet})Array.from(${propSet}).slice(${pVar}).forEach(prop => ${propSet}.delete(prop));`,
      );
    }
    if (itemSet) {
      src.push(
        `if (!${ifV}) if(${itemSet}) Array.from(${itemSet}).slice(${iVar}).forEach(prop => ${itemSet}.delete(prop));`,
      );
    }
    this.handleElseIfConditions(
      src,
      schema,
      varName,
      pathContext,
      trackingState,
      extra,
      ifV,
      elseIfVariableArray,
    );

    src.push(`if (${ifV}) {`);
    if (schema.then !== undefined) {
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        `/then`,
        schema,
        varName,
      );
      configs.pathContext.mapping = `/then`;
      const thenValidatorFn = this.compileSchema(
        schema.then,
        configs.pathContext,
        configs.trackingState,
        { ...extra, inlined: false },
      );
      src.push(thenValidatorFn);
    }
    src.push("}");

    this.handleElseIfThen(
      src,
      schema,
      varName,
      pathContext,
      trackingState,
      elseIfVariableArray,
      extra,
    );

    if (schema.else !== undefined) {
      src.push("else {");
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        `/else`,
        schema,
        varName,
      );
      configs.pathContext.mapping = "/else";
      const elseValidatorFn = this.compileSchema(
        schema.else,
        configs.pathContext,
        configs.trackingState,
        { ...extra, inlined: false },
      );
      src.push(elseValidatorFn, "}");
    }

    if (extra.before !== "") src.push("}");
  }

  handleElseIfConditions(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
    previousIfValid: string,
    elseIfVariableArray: string[],
  ) {
    if (!schema.elseIf) return;
    let k = 0;
    schema.elseIf.forEach((cond: SchemaDefinition, index: number) => {
      if (cond.if) {
        const configs = this.createSubschemaOptions(
          trackingState,
          pathContext,
          `/elseIf/${index}/if`,
          schema,
          varName,
        );
        const ifV = elseIfVariableArray[k++];

        const subValidator = this.compileSchema(
          cond.if,
          configs.pathContext,
          configs.trackingState,
          {
            before: `${ifV} && `,
            after: `${ifV} = false;`,
            predicate: true,
            refAfter: "",
            errorVar: extra.errorVar,
            functionName: extra.functionName,
            inlined: false,
          },
        );

        const propSet = trackingState.unevaluatedPropVar;
        const itemSet = trackingState.unevaluatedItemVar;

        const pVar = "ifpSize" + this.counter++;
        const iVar = "ifiSize" + this.counter++;

        src.push(`if(!${previousIfValid}){`);

        if (propSet) src.push(`const ${pVar} = ${propSet}?.size;`);
        if (itemSet) src.push(`const ${iVar} = ${itemSet}?.size;`);
        src.push(subValidator);
        if (propSet) {
          src.push(
            `if (!${ifV}) if(${propSet})Array.from(${propSet}).slice(${pVar}).forEach(prop => ${propSet}.delete(prop));`,
          );
        }
        if (itemSet) {
          src.push(
            `if (!${ifV}) if(${itemSet}) Array.from(${itemSet}).slice(${iVar}).forEach(prop => ${itemSet}.delete(prop));`,
          );
        }
        src.push("}");
        previousIfValid = ifV;
      }
    });
  }

  handleElseIfThen(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    elseIfVariableArray: any,
    extra: Extra,
  ): void {
    if (!schema.elseIf) return;

    let k = 0;
    schema.elseIf.forEach((cond: any, index: number) => {
      if (!cond.if) return;
      src.push(`else if (${elseIfVariableArray[k++]}) {`);

      if (cond.then) {
        const configs = this.createSubschemaOptions(
          trackingState,
          pathContext,
          `/elseIf/${index}/then`,
          schema,
          varName,
        );

        configs.pathContext.mapping = `/elseIf/${index}/then`;

        const thenValidatorFn = this.compileSchema(
          cond.then,
          configs.pathContext,
          configs.trackingState,
          { ...extra, inlined: false },
        );

        src.push(thenValidatorFn);
      }

      src.push("}");
    });
  }

  handleTypeValidation(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): { arrayCondition: boolean; objectCondition: boolean } {
    if (schema.type === "null") {
      src.push(
        `if (${extra.before}${varName} !== null) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "type",
            value: varName,
            message: '"invalid type"',
            expected: '"null"',
          },
          extra,
        )}`,
        `}`,
      );
    }

    if (Array.isArray(schema.type)) {
      const typeChecks = schema.type
        .map((t) => generateTypeCheck(varName, t))
        .join(" || ");

      src.push(
        `if (${extra.before}!(${typeChecks})) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "type",
            value: varName,
            message: `"invalid type"`,
            expected: JSON.stringify(schema.type.join(" or ")),
          },
          extra,
        )}`,
        `}`,
      );
    }

    const objectRequired =
      schema.required !== undefined ||
      schema.properties !== undefined ||
      schema.minProperties !== undefined ||
      schema.maxProperties !== undefined ||
      schema.dependentSchemas !== undefined ||
      schema.dependentRequired !== undefined ||
      schema.additionalProperties !== undefined ||
      schema.patternProperties !== undefined ||
      schema.propertyNames !== undefined ||
      schema.dependencies !== undefined;

    const arrayRequired =
      schema.prefixItems !== undefined ||
      schema.items !== undefined ||
      schema.additionalItems !== undefined ||
      schema.contains !== undefined ||
      schema.minItems !== undefined ||
      schema.maxItems !== undefined ||
      schema.uniqueItems === true;

    this.handlePrimitive(src, schema, varName, pathContext, extra);

    const objectCondition = objectRequired;
    const arrayCondition = arrayRequired;

    return { arrayCondition, objectCondition };
  }

  handlePrimitive(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    if (extra.before !== "") src.push(`if (${extra.before}true){`);
    if (typeof schema.type === "string" && PRIMITIVE_TYPES.has(schema.type)) {
      const checkType = schema.type;

      let check;
      let error;

      if (checkType === "number") {
        const strict = this.options.strict || this.options.strictNumbers;

        check = `${strict ? "(" : ""}typeof ${varName} !== "${checkType}"`;
        if (strict) check += ` || !Number.isFinite(${varName}))`;

        error = `"must be number`;
        if (strict)
          error +=
            ", value must be finite. NaN, Infinity or -Infinity is not allowed";

        error += '"';
      } else if (checkType === "integer") {
        check = `!Number.isInteger(${varName})`;
        error = '"must be integer"';
      } else {
        error = `"must be ${checkType}"`;
        check = `typeof ${varName} !== '${checkType}'`;
      }

      src.push(
        `if (${check}) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "type",
            value: varName,
            message: error,
            expected: JSON.stringify(schema.type),
          },
          extra,
        )}`,
        `}`,
      );
    }

    const numberCondition =
      schema.minimum !== undefined ||
      schema.maximum !== undefined ||
      schema.exclusiveMaximum !== undefined ||
      schema.exclusiveMinimum !== undefined ||
      schema.multipleOf !== undefined;

    const stringCondition =
      schema.minLength !== undefined ||
      schema.maxLength !== undefined ||
      schema.pattern !== undefined;

    if (
      !this.needslen_of &&
      (schema.minLength !== undefined || schema.maxLength !== undefined)
    )
      this.needslen_of = true;

    if (schema.type === "string" && stringCondition) src.push("else{");
    if (schema.type !== "string" && stringCondition) {
      src.push(`if(${generateTypeCheck(varName, "string")}){`);
    }

    if (schema.minLength !== undefined) {
      this.handleMinLength(src, schema, varName, pathContext, extra);
    }

    if (schema.maxLength !== undefined) {
      this.handleMaxLength(src, schema, varName, pathContext, extra);
    }

    if (schema.pattern !== undefined) {
      this.handlePattern(src, schema, varName, pathContext, extra);
    }

    if (stringCondition) src.push("}");

    if (schema.type === "number" && numberCondition) src.push("else{");
    if (schema.type !== "number" && numberCondition) {
      src.push(`if(${generateTypeCheck(varName, "number")}){`);
    }

    if (schema.minimum !== undefined) {
      this.handleMinimum(src, schema, varName, pathContext, extra);
    }

    if (schema.maximum !== undefined) {
      this.handleMaximum(src, schema, varName, pathContext, extra);
    }

    if (schema.exclusiveMinimum !== undefined) {
      this.handleExclusiveMinimum(src, schema, varName, pathContext, extra);
    }

    if (schema.exclusiveMaximum !== undefined) {
      this.handleExclusiveMaximum(src, schema, varName, pathContext, extra);
    }

    if (schema.multipleOf !== undefined) {
      this.handleMultipleOf(src, schema, varName, pathContext, extra);
    }

    if (numberCondition) src.push("}");

    if (schema.const !== undefined) {
      this.handleConst(src, schema, varName, pathContext, extra);
    }

    if (schema.enum !== undefined) {
      this.handleEnum(src, schema, varName, pathContext, extra);
    }

    if (schema.format !== undefined && this.options.validateFormats === true) {
      this.handleFormat(src, schema, varName, pathContext, extra);
    }
    if (extra.before !== "") src.push("}");
  }

  private handleConst(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef = this.options.$data && isDataReference(schema.const);

    let comparisonTarget;
    if (isDataRef && typeof schema.const === "object") {
      const pointer = schema.const.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );
      comparisonTarget = generateUndefinedDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );
    } else {
      comparisonTarget = JSON.stringify(schema.const);
    }

    if (isDataRef) {
      this.needsDeepEqual = true;
      src.push(
        `if (${extra.before}(typeof ${comparisonTarget} === 'object' && ${comparisonTarget} !== null ? !deepEqual(${varName}, ${comparisonTarget}) : ${varName} !== ${comparisonTarget})) {`,
      );
    } else {
      const constValue = schema.const;

      if (typeof constValue === "object" && constValue !== null) {
        this.needsDeepEqual = true;
        src.push(
          `if (${extra.before}!deepEqual(${varName}, ${comparisonTarget})) {`,
        );
      } else {
        src.push(`if (${extra.before}${varName} !== ${comparisonTarget}) {`);
      }
    }
    src.push(
      this.buildErrorReturn(
        pathContext,
        {
          keyword: "const",
          value: varName,
          message: `"must be equal to " + ${comparisonTarget}`,
          expected: isDataRef
            ? comparisonTarget
            : typeof schema.const === "boolean" ||
                typeof schema.const === "number"
              ? (schema.const as any)
              : comparisonTarget,
        },
        extra,
      ),
      "}",
    );

    if (isDataRef) {
      src.push("}");
    }
  }

  private handleMinLength(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef = this.options.$data && isDataReference(schema.minLength);
    let comparisonTarget: any;

    if (isDataRef && typeof schema.minLength === "object") {
      const pointer = schema.minLength.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );
      comparisonTarget = generateNumberDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
        true,
      );
    } else {
      comparisonTarget = schema.minLength;
    }

    src.push(
      `if (${extra.before}len_of(${varName}) < ${comparisonTarget}) {`,
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: "minLength",
          value: varName,
          message: `"must have at least " + ${comparisonTarget} + " characters."`,
          expected: comparisonTarget,
        },
        extra,
      )}`,
      `}`,
    );

    if (isDataRef) {
      src.push("}");
    }
  }

  private handleMaxLength(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef = this.options.$data && isDataReference(schema.maxLength);
    let comparisonTarget: any;

    if (isDataRef && typeof schema.maxLength === "object") {
      const pointer = schema.maxLength.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );

      comparisonTarget = generateNumberDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
        true,
      );
    } else {
      comparisonTarget = schema.maxLength;
    }

    src.push(
      `if (${extra.before}len_of(${varName}) > ${comparisonTarget}) {`,
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: "maxLength",
          value: varName,
          message: `"must have at most " + ${comparisonTarget} + " characters."`,
          expected: comparisonTarget,
        },
        extra,
      )}`,
      `}`,
    );
    if (isDataRef) {
      src.push("}");
    }
  }

  private handleMinimum(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef = this.options.$data && isDataReference(schema.minimum);
    let comparisonTarget: any;

    if (isDataRef && typeof schema.minimum === "object") {
      const pointer = schema.minimum.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );
      comparisonTarget = generateNumberDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );
    } else {
      comparisonTarget = schema.minimum;
    }

    src.push(
      `if (${extra.before}${varName} < ${comparisonTarget}) {`,
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: "minimum",
          value: varName,
          message: `"must be >= " + ${comparisonTarget}`,
          expected: comparisonTarget,
        },
        extra,
      )}`,
      `}`,
    );

    if (isDataRef) {
      src.push("}");
    }
  }

  private handleMaximum(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef = this.options.$data && isDataReference(schema.maximum);
    let comparisonTarget: any;

    if (isDataRef && typeof schema.maximum === "object") {
      const pointer = schema.maximum.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );
      comparisonTarget = generateNumberDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );
    } else {
      comparisonTarget = schema.maximum;
    }

    src.push(
      `if (${extra.before}${varName} > ${comparisonTarget}) {`,
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: "maximum",
          value: varName,
          message: `"must be <= " + ${comparisonTarget}`,
          expected: comparisonTarget,
        },
        extra,
      )}`,
      `}`,
    );

    if (isDataRef) {
      src.push("}");
    }
  }

  private handleExclusiveMinimum(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef =
      this.options.$data && isDataReference(schema.exclusiveMinimum);
    let comparisonTarget: any;

    if (isDataRef && typeof schema.exclusiveMinimum === "object") {
      const pointer = schema.exclusiveMinimum.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );
      comparisonTarget = generateNumberDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );
    } else {
      comparisonTarget = schema.exclusiveMinimum;
    }

    src.push(
      `if (${extra.before}${varName} <= ${comparisonTarget}) {`,
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: "exclusiveMinimum",
          value: varName,
          message: `"must be > " + ${comparisonTarget}`,
          expected: comparisonTarget,
        },
        extra,
      )}`,
      `}`,
    );

    if (isDataRef) {
      src.push("}");
    }
  }

  private handleExclusiveMaximum(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef =
      this.options.$data && isDataReference(schema.exclusiveMaximum);
    let comparisonTarget: any;

    if (isDataRef && typeof schema.exclusiveMaximum === "object") {
      const pointer = schema.exclusiveMaximum.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );
      comparisonTarget = generateNumberDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );
    } else {
      comparisonTarget = schema.exclusiveMaximum;
    }

    src.push(
      `if (${extra.before}${varName} >= ${comparisonTarget}) {`,
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: "exclusiveMaximum",
          value: varName,
          message: `"must be < " + ${comparisonTarget}`,
          expected: comparisonTarget,
        },
        extra,
      )}`,
      `}`,
    );

    if (isDataRef) {
      src.push("}");
    }
  }

  handleMultipleOf(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef = this.options.$data && isDataReference(schema.multipleOf);
    let comparisonTarget: any;

    if (isDataRef && typeof schema.multipleOf === "object") {
      const pointer = schema.multipleOf.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );
      comparisonTarget = generateNumberDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );
    } else {
      comparisonTarget = schema.multipleOf;
    }

    const multipleOfVar = "multipleOf" + this.counter++;
    const quotientVar = "quotient" + this.counter++;
    const roundedVar = "rounded" + this.counter++;
    const toleranceVar = "tolerance" + this.counter++;

    if (!isDataRef && extra.before) src.push(`if(${extra.before}true){`);

    if (this.options.strictNumbers || this.options.strict)
      src.push(
        `const ${multipleOfVar} = ${comparisonTarget};
        const ${quotientVar} = ${varName} / ${multipleOfVar};
        const ${roundedVar} = Math.round(${quotientVar});
        const ${toleranceVar} = Math.abs(${quotientVar}) * Number.EPSILON;
        if (${multipleOfVar} === 0 || !isFinite(${quotientVar}) || Math.abs(${quotientVar} - ${roundedVar}) > ${toleranceVar}) {`,
      );
    else
      src.push(
        `if (${comparisonTarget} === 0 || (${varName} / ${comparisonTarget}) % 1 !== 0) {`,
      );

    src.push(
      `${this.buildErrorReturn(
        pathContext,
        {
          keyword: "multipleOf",
          value: varName,
          message: `"must be a multiple of " + ${comparisonTarget}`,
          expected: comparisonTarget,
        },
        extra,
      )}`,
      `}`,
    );

    if (isDataRef || extra.before) {
      src.push("}");
    }
  }

  handlePattern(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef = this.options.$data && isDataReference(schema.pattern);
    let comparisonTarget: any;

    if (isDataRef && typeof schema.pattern === "object") {
      const pointer = schema.pattern.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );

      comparisonTarget = generateStringDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );

      src.push("try {");
      src.push(
        `if (!new RegExp(${comparisonTarget}, 'u').test(${varName})) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "pattern",
            value: varName,
            message: `"must match pattern " + ${comparisonTarget}`,
            expected: comparisonTarget,
          },
          extra,
        )}`,
        `}`,
      );
    } else {
      comparisonTarget = JSON.stringify(schema.pattern);
      let pname = this.regexCache.get(schema.pattern as string);
      if (!pname) {
        pname = "pt" + this.counter++;
        this.regexCache.set(schema.pattern as string, pname);
      }
      src.push(
        `if (${extra.before}!${pname}.test(${varName})) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "pattern",
            value: varName,
            message: JSON.stringify(`must match pattern ${schema.pattern}`),
            expected: comparisonTarget,
          },
          extra,
        )}`,
        `}`,
      );
    }

    if (isDataRef) {
      src.push("} catch (e) {}", "}");
    }
  }

  handleEnum(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    if (Array.isArray(schema.enum) && schema.enum.length < 1) {
      if (extra.before != "") src.push(`if(${extra.before} true){`);
      src.push(
        this.buildErrorReturn(
          pathContext,
          {
            keyword: "enum",
            value: varName,
            message: '"must be one of the allowed values"',
            expected: "[]",
          },
          extra,
        ),
      );
      if (extra.before != "") src.push("}");
      return;
    }
    const isDataRef = this.options.$data && isDataReference(schema.enum);
    let enumArrayExpr: string;
    let enumCheckCloseExpr = "";

    if (
      isDataRef &&
      typeof schema.enum === "object" &&
      !Array.isArray(schema.enum)
    ) {
      const pointer = schema.enum.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );
      enumArrayExpr = generateArrayDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );
      enumCheckCloseExpr = "}";
    } else {
      if (!Array.isArray(schema.enum)) return;
      enumArrayExpr = JSON.stringify(schema.enum);
    }
    const expectedValue = isDataRef
      ? `${enumArrayExpr}`
      : JSON.stringify(schema.enum);

    if (
      isDataRef ||
      (Array.isArray(schema.enum) &&
        schema.enum.length >= (this.options.loopEnum ?? 200))
    ) {
      this.needsDeepEqual = true;
      src.push(
        `if (${extra.before}!${enumArrayExpr}.some(enumValue => typeof enumValue === 'object' && enumValue!== null ? deepEqual(${varName}, enumValue) : enumValue === ${varName})) {`,
      );
    } else {
      const conditions = (schema.enum as any[]).map((enumValue) => {
        if (typeof enumValue === "object" && enumValue !== null) {
          this.needsDeepEqual = true;
          return `(typeof ${varName} === 'object' && ${varName} !== null && deepEqual(${varName},${JSON.stringify(
            enumValue,
          )}))`;
        } else {
          return `${varName} === ${JSON.stringify(enumValue)}`;
        }
      });

      src.push(`if (${extra.before}!(${conditions.join(" || ")})) {`);
    }

    src.push(
      this.buildErrorReturn(
        pathContext,
        {
          keyword: "enum",
          value: varName,
          message: '"must be one of the allowed values"',
          expected: expectedValue,
        },
        extra,
      ),
      "}",
    );

    if (isDataRef) {
      src.push(enumCheckCloseExpr);
    }
  }

  handleFormat(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef = this.options.$data && isDataReference(schema.format);

    if (isDataRef && typeof schema.format === "object") {
      const pointer = schema.format.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );
      const formatKeyVar = generateStringDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );

      if (this.standAlone) {
        src.push(`const formatValidator = formatValidators[${formatKeyVar}];`);
      } else {
        src.push(
          `const formatValidator = formatValidators[${formatKeyVar}]?.validate ?? formatValidators[${formatKeyVar}];`,
        );
      }
      const isValid = "isV" + this.counter++;
      src.push(
        `if (formatValidator) {`,
        `  const ${isValid} = typeof formatValidator === 'function'`,
        `    ? ${this.options.async ? "await " : ""}formatValidator(${varName})`,
        `    : formatValidator.test(${varName});`,
        `  if (!${isValid}) {`,
        this.buildErrorReturn(
          pathContext,
          {
            keyword: "format",
            value: varName,
            message: `"must match format "+${formatKeyVar}`,
            expected: `${formatKeyVar}`,
          },
          extra,
        ),
        `  }`,
        `}}`,
      );
    } else {
      const data = this.jetValidator.getFormat(schema.format as string);
      if (!data) {
        console.warn(`Format '${schema.format}' not found will be ignored`);
        return;
      }

      const format =
        typeof data === "object" && "validate" in data ? data.validate : data;
      const formatType =
        typeof data === "object" && !(data instanceof RegExp) && data.type
          ? data.type
          : "string";

      const formatKey = schema.format as string;

      let testCode;
      let formatRef;

      if (typeof format === "function") {
        formatRef = this.standAlone
          ? `format_${formatKey.replace(/[^a-zA-Z0-9]/g, "_")}`
          : `formatValidators['${formatKey}']`;

        const cond =
          this.options.async &&
          typeof data === "object" &&
          "async" in data &&
          data.async == true;

        testCode = cond
          ? `!(await ${formatRef}(${varName}))`
          : `!${formatRef}(${varName})`;
      } else if (format instanceof RegExp) {
        formatRef = this.standAlone
          ? `format_${formatKey.replace(/[^a-zA-Z0-9]/g, "_")}`
          : `formatValidators['${formatKey}']`;

        testCode = `!${formatRef}.test(${varName})`;
      }

      const typeCheck = Array.isArray(formatType)
        ? `(${formatType
            .map((t) => generateTypeCheck(varName, t))
            .join(" || ")})`
        : `typeof ${varName} === '${formatType}'`;

      src.push(
        `if (${extra.before}${typeCheck} && ${testCode}) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "format",
            value: varName,
            message: `"must match format ${schema.format}"`,
            expected: `"${schema.format as string}"`,
          },
          extra,
        )}`,
        `}`,
      );
    }
  }

  handleObject(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    condition: boolean,
    extra: Extra,
  ): void {
    if (extra.before !== "") src.push(`if(${extra.before} true){`);

    if (schema.type === "object") {
      src.push(
        `if (!${varName} || typeof ${varName} !== 'object' || Array.isArray(${varName})) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "type",
            value: varName,
            message: '"invalid type"',
            expected: '"object"',
          },
          extra,
        )}`,
        `}`,
      );
    }

    if (schema.type === "object" && condition) src.push("else{");

    if (schema.type !== "object" && condition) {
      src.push(
        `if (${varName} && typeof ${varName} === 'object' && !Array.isArray(${varName})) {`,
      );
    }

    if (
      this.options.useDefaults &&
      Object.keys(schema.properties ?? {}).length > 0
    )
      this.handlePropertiesDefault(src, schema, pathContext, extra, varName);

    if (this.options.removeAdditional) {
      this.handleRemoveAdditional(src, schema, varName);
    }

    if (
      schema.minProperties !== undefined ||
      schema.maxProperties !== undefined
    ) {
      this.handlePropertyConstraints(src, schema, varName, pathContext, extra);
    }

    if (schema.required !== undefined) {
      this.handleRequiredProperties(src, schema, varName, pathContext, extra);
    }

    if (typeof schema.additionalProperties == "boolean") {
      this.handleAdditionalProperties(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (schema.propertyNames !== undefined) {
      this.handlePropertyNames(src, schema, varName, pathContext, extra);
    }

    if (schema.properties !== undefined && schema.properties !== null) {
      const propertyKeys = Object.keys(schema.properties);
      if (propertyKeys.length > 0) {
        this.handleObjectProperties(
          src,
          schema,
          varName,
          pathContext,
          trackingState,
          propertyKeys,
          extra,
        );
      }
    }

    if (
      schema.dependentSchemas !== undefined ||
      schema.dependentRequired !== undefined ||
      schema.dependencies !== undefined
    ) {
      this.handleDependentSchemas(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (schema.patternProperties !== undefined) {
      this.handlePatternProperties(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (
      schema.additionalProperties !== undefined &&
      typeof schema.additionalProperties != "boolean"
    ) {
      this.handleAdditionalProperties(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (condition) {
      src.push(`}`);
    }

    if (extra.before !== "") src.push(`}`);
  }

  handleRemoveAdditional(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
  ) {
    const mode = this.options.removeAdditional;

    const fires =
      mode === true
        ? schema.additionalProperties === false
        : mode === "all" &&
          (schema.additionalProperties !== undefined ||
            Object.keys(schema.properties ?? {}).length > 0);

    if (!fires) return;

    const { allowedProperties, patternProperties } =
      this.collectAllAllowedProperties(schema);

    const key = "key" + this.counter++;
    const checks: string[] = [];

    const explicitProps = Array.from(allowedProperties);
    if (explicitProps.length > 0) {
      checks.push(
        explicitProps
          .map((keyItem) => `${key} === ${JSON.stringify(keyItem)}`)
          .join(" || "),
      );
    }

    if (patternProperties.length > 0) {
      checks.push(
        patternProperties
          .map((pattern) => {
            let pname = this.regexCache.get(pattern);
            if (!pname) {
              pname = "patternProp" + this.counter++;
              this.regexCache.set(pattern, pname);
            }
            return `${pname}.test(${key})`;
          })
          .join(" || "),
      );
    }

    if (checks.length > 0) {
      src.push(
        `for (const ${key} in ${varName}) {`,
        `if (!(${checks.join(" || ")})) {`,
        `delete ${varName}[${key}];`,
        `}`,
        `}`,
      );
    } else {
      src.push(
        `for (const ${key} in ${varName}) { delete ${varName}[${key}]; }`,
      );
    }
  }

  handlePropertiesDefault(
    src: string[],
    schema: SchemaDefinition,
    pathContext: PathContext,
    extra: Extra,
    varName: string,
  ) {
    for (const [key, sub] of Object.entries(schema.properties!)) {
      if (typeof sub !== "object" || sub === null) continue;
      if ((sub as SchemaDefinition).default === undefined) continue;

      if (extra.predicate || extra.noreturn) {
        throw new Error(
          `"default" for "${key}" at ${pathContext.schema} is inside a oneOf/anyOf/not/if/contains` +
            `. Applying it would change which branch matches.`,
        );
      }

      const acc = `${varName}[${JSON.stringify(key)}]`;
      const cond =
        this.options.useDefaults === "empty"
          ? `${acc} === undefined || ${acc} === null || ${acc} === ""`
          : `${acc} === undefined`;

      src.push(
        `if (${cond}) { ${acc} = ${JSON.stringify((sub as SchemaDefinition).default)}; }`,
      );
    }
  }

  handleRequiredProperties(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const isDataRef = this.options.$data && isDataReference(schema.required);

    if (
      isDataRef &&
      typeof schema.required === "object" &&
      !Array.isArray(schema.required)
    ) {
      const pointer = schema.required.$data;
      const resolvedPath = resolveDataPointerAtCompileTime(
        pointer,
        pathContext.fullAccess,
        pathContext.rootDataVar,
      );

      const requiredVar = generateArrayDataRef(
        src,
        resolvedPath,
        extra,
        this.counter++,
      );
      const i = "i" + this.counter++;
      const prop = "prop" + this.counter++;

      src.push(`for (let ${i} = 0; ${i} < ${requiredVar}.length; ${i}++) {`);
      src.push(`const ${prop} = ${requiredVar}[${i}];`);

      src.push(
        `if (${extra.before}${varName}[${prop}] === undefined) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "required",
            value: varName,
            message: `"missing required field: " + ${prop}`,
            expected: `${prop}`,
            schemaPath: `${pathContext.schema}`,
          },
          extra,
        )}`,
        (extra.predicate || extra.noreturn) && !this.options.allErrors
          ? "break;"
          : "",
        `}`,
      );

      src.push(`}`);
      src.push(`}`);
    } else {
      const required = Array.isArray(schema.required) ? schema.required : [];
      if (required.length === 0) return;

      if (Array.isArray(schema.required)) {
        if (
          this.options.allErrors ||
          schema.required.length > this.options.loopRequired!
        ) {
          if (schema.required.length > this.options.loopRequired!) {
            if (extra.before != "") src.push(`if(${extra.before} true){`);

            const arr = JSON.stringify(schema.required);
            const arrVar = `arr${this.counter++}`;
            const iVar = `i${this.counter++}`;
            src.push(`const ${arrVar} = ${arr};`);

            src.push(
              `for (let ${iVar} = 0; ${iVar} < ${arrVar}.length; ${iVar}++) {`,
            );
            const prop = "prop" + this.counter++;
            src.push(`const ${prop} = ${arrVar}[${iVar}];`);
            src.push(
              `if (${varName}[${prop}] === undefined) {`,
              `${this.buildErrorReturn(
                pathContext,
                {
                  keyword: "required",
                  value: varName,
                  message: `"missing required field: " + ${prop}`,
                  expected: `${prop}`,
                  schemaPath: `${pathContext.schema}`,
                },
                extra,
              )}`,
              (extra.predicate || extra.noreturn) && !this.options.allErrors
                ? "break;"
                : "",
              "}",
            );

            src.push(`}`);
            if (extra.before != "") src.push(`}`);
          } else {
            for (const req of schema.required) {
              const missing = JSON.stringify(req);
              src.push(
                `if(${extra.before}${varName}[${missing}] === undefined){`,
                `${this.buildErrorReturn(
                  pathContext,
                  {
                    keyword: "required",
                    value: varName,
                    message: JSON.stringify("missing required field: " + req),
                    expected: missing,
                    schemaPath: `${pathContext.schema}`,
                  },
                  extra,
                )}`,
                `}`,
              );
            }
          }
        } else {
          const missing = "missing" + this.counter++;
          src.push(`var ${missing};`);

          const condition = schema.required
            .map((prop) => {
              const stringified = JSON.stringify(prop);
              return `(${varName}[${stringified}] === undefined &&(${missing} = ${stringified}))`;
            })
            .join(" || ");

          src.push(
            `if(${extra.before}(${condition})){`,
            `${this.buildErrorReturn(
              pathContext,
              {
                keyword: "required",
                value: varName,
                message: `"missing required field: " + ${missing}`,
                expected: missing,
                schemaPath: `${pathContext.schema}`,
              },
              extra,
            )}`,
            `}`,
          );
        }
      }
    }
  }

  collectAllAllowedProperties(schema: SchemaDefinition | boolean): {
    allowedProperties: Set<string>;
    patternProperties: string[];
  } {
    const allowedProperties = new Set<string>();
    const patternProperties: string[] = [];

    if (typeof schema === "boolean") {
      return { allowedProperties, patternProperties };
    }

    if (schema.properties !== undefined) {
      Object.keys(schema.properties).forEach((prop) =>
        allowedProperties.add(prop),
      );
    }

    if (schema.patternProperties !== undefined) {
      Object.keys(schema.patternProperties).forEach((pattern) => {
        patternProperties.push(pattern);
      });
    }

    return { allowedProperties, patternProperties };
  }

  handlePatternProperties(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    if (extra.before != "") src.push(`if(${extra.before} true){`);

    const key = "key" + this.counter++;
    src.push(`for (const ${key} in ${varName}) {`);

    if (
      extra.before &&
      !this.options.allErrors &&
      (extra.noreturn || extra.predicate) &&
      !trackingState.parentHasUnevaluatedProperties
    )
      src.push(`if (!(${extra.before} true))break;`);

    Object.getOwnPropertyNames(schema.patternProperties).forEach((pattern) => {
      let pname = this.regexCache.get(pattern);

      if (!pname) {
        pname = "patternProp" + this.counter++;
        this.regexCache.set(pattern, pname);
      }
      src.push(`if (${pname}.test(${key})) {`);

      const newSeg: AccessSegment = { kind: "dynamic", expr: key };

      const patternValidation = this.compileSchema(
        schema.patternProperties![pattern],
        {
          rootDataVar: pathContext.rootDataVar,
          schema: `${pathContext.schema}/patternProperties/` + pattern,
          data: pathContext.data + renderSegmentPath(newSeg),
          fullAccess: [...pathContext.fullAccess, newSeg],
          accessPattern: `${varName}[${key}]`,
          mapping: `/patternProperties/` + pattern,
        },
        {},
        { ...extra, inlined: false },
      );

      src.push(patternValidation);
      addEvaluatedProperty(src, key, trackingState);
      src.push("}");
    });

    src.push("}");
    if (extra.before != "") src.push(`}`);
  }

  handleAdditionalProperties(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    const removalCovers =
      this.options.removeAdditional === "all" ||
      (this.options.removeAdditional === true &&
        schema.additionalProperties === false);

    if (removalCovers && !trackingState.parentHasUnevaluatedProperties) return;

    if (
      !trackingState.parentHasUnevaluatedProperties &&
      schema.additionalProperties === true
    )
      return;

    const { allowedProperties, patternProperties } =
      this.collectAllAllowedProperties(schema);

    const explicitProps = Array.from(allowedProperties);

    const checks = [];

    const key = "key" + this.counter++;

    if (explicitProps.length > 0) {
      const allowedCheck = explicitProps
        .map((keyItem) => `${key} === ${JSON.stringify(keyItem)}`)
        .join(" || ");
      checks.push(allowedCheck);
    }

    if (patternProperties.length > 0) {
      const patternCheck = patternProperties
        .map((pattern) => {
          let pname = this.regexCache.get(pattern);
          if (!pname) {
            pname = "patternProp" + this.counter++;
            this.regexCache.set(pattern, pname);
          }
          return `${pname}.test(${key})`;
        })
        .join(" || ");
      checks.push(patternCheck);
    }

    if (schema.additionalProperties === false) {
      if (extra.before != "") src.push(`if(${extra.before} true){`);

      src.push(`for (const ${key} in ${varName}) {`);

      if (checks.length > 0) {
        src.push(`if (${checks.join(" || ")}) continue;`);
      }

      const newSeg: AccessSegment = { kind: "dynamic", expr: key };
      src.push(
        this.buildErrorReturn(
          {
            ...pathContext,
            schema: `${pathContext.schema}/additionalProperties`,
            data: pathContext.data + renderSegmentPath(newSeg),
            mapping: "/additionalProperties",
          },
          {
            keyword: "additionalProperties",
            value: `${varName}[${key}]`,
            message: `"property " + ${key} + " is not allowed"`,
            expected: '"no additional properties"',
          },
          extra,
        ),
        (extra.predicate || extra.noreturn) && !this.options.allErrors
          ? "break;"
          : "",
        `}`,
      );

      if (extra.before != "") src.push(`}`);
      return;
    }

    if (extra.before != "") src.push(`if(${extra.before} true){`);

    src.push(`for (const ${key} in ${varName}) {`);

    if (
      extra.before &&
      !this.options.allErrors &&
      (extra.noreturn || extra.predicate) &&
      !trackingState.parentHasUnevaluatedProperties
    )
      src.push(`if (!(${extra.before} true))break;`);

    if (checks.length > 0) {
      const condition = checks.join(" || ");
      src.push(`if (${condition}) continue;`);
    }

    const newSeg: AccessSegment = { kind: "dynamic", expr: key };
    const additionalPropValidation = this.compileSchema(
      schema.additionalProperties!,
      {
        rootDataVar: pathContext.rootDataVar,
        schema: `${pathContext.schema}/additionalProperties`,
        data: pathContext.data + renderSegmentPath(newSeg),
        fullAccess: [...pathContext.fullAccess, newSeg],
        accessPattern: `${varName}[${key}]`,
        mapping: "/additionalProperties",
      },
      {},
      { ...extra, inlined: false },
    );

    src.push(additionalPropValidation);

    if (trackingState.parentHasUnevaluatedProperties)
      src.push(
        extra.before
          ? `if (${extra.before} true) ${trackingState.parentUnevaluatedPropVar}.add(${key})`
          : `${trackingState.parentUnevaluatedPropVar}.add(${key})`,
      );

    src.push("}");
    if (extra.before != "") src.push(`}`);
  }

  handlePropertyConstraints(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    const objKeys = "objKeys" + this.counter++;
    src.push(`const ${objKeys} = Object.keys(${varName});`);

    if (schema.minProperties !== undefined) {
      const isDataRef =
        this.options.$data && isDataReference(schema.minProperties);
      let comparisonTarget;

      if (isDataRef && typeof schema.minProperties === "object") {
        const pointer = schema.minProperties.$data;
        const resolvedPath = resolveDataPointerAtCompileTime(
          pointer,
          pathContext.fullAccess,
          pathContext.rootDataVar,
        );
        comparisonTarget = generateNumberDataRef(
          src,
          resolvedPath,
          extra,
          this.counter++,
          true,
        );
      } else {
        comparisonTarget = schema.minProperties;
      }

      src.push(
        `if (${extra.before}${objKeys}.length < ${comparisonTarget}) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "minProperties",
            value: `${objKeys}.length`,
            message: `"must have at least " + ${comparisonTarget} + " properties."`,
            expected: comparisonTarget as string,
          },
          extra,
        )}`,
        `}`,
      );

      if (isDataRef) {
        src.push("}");
      }
    }

    if (schema.maxProperties !== undefined) {
      const isDataRef =
        this.options.$data && isDataReference(schema.maxProperties);
      let comparisonTarget;

      if (isDataRef && typeof schema.maxProperties === "object") {
        const pointer = schema.maxProperties.$data;
        const resolvedPath = resolveDataPointerAtCompileTime(
          pointer,
          pathContext.fullAccess,
          pathContext.rootDataVar,
        );
        comparisonTarget = generateNumberDataRef(
          src,
          resolvedPath,
          extra,
          this.counter++,
          true,
        );
      } else {
        comparisonTarget = schema.maxProperties;
      }

      src.push(
        `if (${extra.before}${objKeys}.length > ${comparisonTarget}) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "maxProperties",
            value: `${objKeys}.length`,
            message: `"must have at most " + ${comparisonTarget} + " properties."`,
            expected: comparisonTarget as string,
          },
          extra,
        )}`,
        `}`,
      );

      if (isDataRef) {
        src.push("}");
      }
    }
  }

  handlePropertyNames(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    const key = "key" + this.counter++;
    src.push(`for (const ${key} in ${varName}) {`);

    if (
      extra.before &&
      !this.options.allErrors &&
      (extra.noreturn || extra.predicate)
    )
      src.push(`if (!(${extra.before} true))break;`);

    const newSeg: AccessSegment = { kind: "dynamic", expr: key };
    const propertyNameValidation = this.compileSchema(
      schema.propertyNames!,
      {
        rootDataVar: pathContext.rootDataVar,
        schema: `${pathContext.schema}/propertyNames`,
        data: pathContext.data + renderSegmentPath(newSeg),
        fullAccess: [...pathContext.fullAccess, newSeg],
        accessPattern: key,
        mapping: `/propertyNames`,
      },
      {},
      { ...extra, inlined: true },
    );

    src.push(propertyNameValidation, "}");
    if (extra.before != "") src.push(`}`);
  }

  handleDependentSchemas(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    type DependencyEntry = {
      required?: string[];
      requiredSource?: "dependencies" | "dependentRequired";
      schema?: any;
      schemaSource?: "dependencies" | "dependentSchemas";
    };

    const dependencyMap = new Map<string, DependencyEntry>();

    if (schema.dependencies !== undefined) {
      for (const property of Object.getOwnPropertyNames(schema.dependencies)) {
        const dep = schema.dependencies[property];
        if (Array.isArray(dep)) {
          dependencyMap.set(property, {
            required: dep,
            requiredSource: "dependencies",
          });
        } else {
          dependencyMap.set(property, {
            schema: dep,
            schemaSource: "dependencies",
          });
        }
      }
    }

    if (schema.dependentRequired !== undefined) {
      for (const property of Object.getOwnPropertyNames(
        schema.dependentRequired,
      )) {
        const existing = dependencyMap.get(property) || {};
        dependencyMap.set(property, {
          ...existing,
          required: schema.dependentRequired[property],
          requiredSource: "dependentRequired",
        });
      }
    }

    if (schema.dependentSchemas !== undefined) {
      for (const property of Object.getOwnPropertyNames(
        schema.dependentSchemas,
      )) {
        const existing = dependencyMap.get(property) || {};
        dependencyMap.set(property, {
          ...existing,
          schema: schema.dependentSchemas[property],
          schemaSource: "dependentSchemas",
        });
      }
    }

    for (const [property, dependency] of dependencyMap) {
      const stringifiedProperty = JSON.stringify(property);
      src.push(
        `if (${extra.before}${varName}[${stringifiedProperty}] !== undefined) {`,
      );

      if (dependency.required) {
        this.handleRequiredFields(
          src,
          dependency.required,
          property,
          varName,
          pathContext,
          extra,
          dependency.requiredSource as any,
        );
      }

      if (dependency.schema !== undefined) {
        this.handleDependentSchema(
          src,
          dependency.schema,
          schema,
          property,
          varName,
          pathContext,
          trackingState,
          extra,
          dependency.schemaSource as any,
        );
      }

      src.push("}");
    }
  }

  private handleRequiredFields(
    src: string[],
    requiredFields: string[],
    triggerProperty: string,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
    requiredSource: "dependencies" | "dependentRequired",
  ): void {
    for (let i = 0; i < requiredFields.length; i++) {
      const field = requiredFields[i];
      const stringifiedField = JSON.stringify(field);

      const schema =
        `${pathContext.schema}/${requiredSource}/` +
        encodePointerSegment(triggerProperty);

      const mapping = `/${requiredSource}/${triggerProperty}/${field}`;

      src.push(
        `if (${extra.before}${varName}[${stringifiedField}] === undefined) {`,
        `${this.buildErrorReturn(
          { ...pathContext, schema, mapping },
          {
            keyword: requiredSource,
            value: varName,
            message: `"must have property (" + ${stringifiedField} + ") when " + ${JSON.stringify(
              triggerProperty,
            )} + " is present."`,
          },
          extra,
        )}`,
        `}`,
      );
    }
  }

  private handleDependentSchema(
    src: string[],
    depSchema: any,
    rootSchema: SchemaDefinition,
    property: string,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
    requiredSource: "dependencies" | "dependentSchemas",
  ): void {
    const configs = this.createSubschemaOptions(
      trackingState,
      pathContext,
      `/${requiredSource}/` + encodePointerSegment(property),
      rootSchema,
      varName,
    );

    configs.pathContext.mapping = `/${requiredSource}/` + property;
    const depValidatorFn = this.compileSchema(
      depSchema,
      configs.pathContext,
      configs.trackingState,
      extra,
    );

    src.push(depValidatorFn);
  }

  handleObjectProperties(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    propertyKeys: string[],
    extra: Extra,
  ): void {
    const properties = schema.properties || {};

    for (const key of propertyKeys) {
      const stringified = JSON.stringify(key);

      if (properties[key] !== undefined) {
        if (canSkip(properties[key])) {
          src.push(
            `if (${extra.before}${varName}[${stringified}] !== undefined) {`,
          );
          addEvaluatedProperty(src, stringified, trackingState);
          src.push("}");
          continue;
        }

        src.push(
          `if (${extra.before}${varName}[${stringified}] !== undefined) {`,
        );

        const newSeg: AccessSegment = { kind: "key", value: key };
        const encodedKey = encodePointerSegment(key);
        const propertyValidation = this.compileSchema(
          properties[key],
          {
            rootDataVar: pathContext.rootDataVar,
            schema: `${pathContext.schema}/properties/` + encodedKey,
            data: pathContext.data + renderSegmentPath(newSeg),
            fullAccess: [...pathContext.fullAccess, newSeg],
            accessPattern: `${varName}[${stringified}]`,
            mapping: `/properties/` + encodedKey,
          },
          {},
          { ...extra, inlined: false },
        );

        src.push(propertyValidation);
        addEvaluatedProperty(src, stringified, trackingState);

        src.push("}");
      }
    }
  }

  handleUnevaluatedProperties(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    const unName = "unP" + this.counter++;
    const evalSet = trackingState.unevaluatedPropVar!;

    if (schema.unevaluatedProperties === true) {
      if (trackingState.parentHasUnevaluatedProperties) {
        const key = "key" + this.counter++;
        src.push(
          extra.before != "" ? `if(${extra.before} true){` : "",
          `for(const ${key} in ${varName}){${trackingState.parentUnevaluatedPropVar}.add(${key})}`,
          extra.before != "" ? `}` : "",
        );
      }
      return;
    }

    if (extra.before != "") src.push(`if(${extra.before} true){`);
    const key = "key" + this.counter++;
    src.push(
      `const ${unName} = [];`,
      `for (const ${key} in ${varName}) {`,
      `if (!${evalSet}.has(${key})) {`,
      `${unName}.push(${key});`,
      `}`,
      `}`,
    );

    if (schema.unevaluatedProperties === false) {
      src.push(
        `if (${unName}.length > 0) {`,
        `${this.buildErrorReturn(
          {
            ...pathContext,
            schema: `${pathContext.schema}/unevaluatedProperties`,
            mapping: "/unevaluatedProperties",
          },
          {
            keyword: "unevaluatedProperties",
            value: varName,
            message: `"Unevaluated properties: " + ${unName} + " in schema."`,
            expected: '"All properties to be evaluated"',
          },
          extra,
        )}}`,
      );
    } else {
      const unKeyName = "unKey" + this.counter++;

      const newSeg: AccessSegment = { kind: "dynamic", expr: unKeyName };
      const unpValidatorFn = this.compileSchema(
        schema.unevaluatedProperties!,
        {
          rootDataVar: pathContext.rootDataVar,
          data: pathContext.data + renderSegmentPath(newSeg),
          fullAccess: [...pathContext.fullAccess, newSeg],
          accessPattern: `${varName}[${unKeyName}]`,
          schema: `${pathContext.schema}/unevaluatedProperties`,
          mapping: "/unevaluatedProperties",
        },
        {},
        extra,
      );

      src.push(`for(const ${unKeyName} of ${unName}) {`);

      if (
        extra.before &&
        !this.options.allErrors &&
        (extra.noreturn || extra.predicate) &&
        !trackingState.parentHasUnevaluatedProperties
      )
        src.push(`if (!(${extra.before} true))break;`);

      src.push(unpValidatorFn);

      if (trackingState.parentHasUnevaluatedProperties) {
        src.push(
          `${trackingState.parentUnevaluatedPropVar}.add(${unKeyName});`,
        );
      }

      src.push("}");
    }
    if (extra.before != "") src.push(`}`);
  }

  handleArray(
    src: string[],
    schema: ArraySchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    condition: boolean,
    extra: Extra,
  ): void {
    if (extra.before !== "") src.push(`if(${extra.before} true){`);
    if (schema.type === "array") {
      src.push(
        `if (!Array.isArray(${varName})) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "type",
            value: varName,
            message: '"invalid type"',
            expected: '"array"',
          },
          extra,
        )}`,
        `}`,
      );
    }
    if (schema.type === "array" && condition) src.push("else{");
    if (schema.type !== "array" && condition) {
      src.push(`if(Array.isArray(${varName})){`);
    }

    const tuple =
      schema.prefixItems ??
      (Array.isArray(schema.items) ? schema.items : undefined);
    if (tuple && this.options.useDefaults)
      this.handleArrayDefaults(src, pathContext, extra, varName, tuple);

    if (
      schema.minItems !== undefined ||
      schema.maxItems !== undefined ||
      schema.uniqueItems === true ||
      isDataReference(schema.uniqueItems)
    ) {
      this.handleArrayConstraints(src, schema, varName, pathContext, extra);
    }

    if (
      typeof schema.items === "boolean" ||
      (Array.isArray(schema.items) &&
        typeof schema.additionalItems === "boolean")
    ) {
      this.handleAdditionalItems(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (schema.prefixItems !== undefined || Array.isArray(schema.items)) {
      this.handleArrayItems(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (
      (typeof schema.items === "object" &&
        !Array.isArray(schema.items) &&
        schema.items !== null) ||
      (Array.isArray(schema.items) &&
        typeof schema.additionalItems === "object")
    ) {
      this.handleAdditionalItems(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (schema.contains !== undefined) {
      this.handleArrayContains(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (condition) {
      src.push(`}`);
    }
    if (extra.before !== "") src.push(`}`);
  }

  handleArrayDefaults(
    src: string[],
    pathContext: PathContext,
    extra: Extra,
    varName: string,
    tuple: (SchemaDefinition | boolean)[],
  ) {
    for (let i = 0; i < tuple.length; i++) {
      const sub = tuple[i];
      if (typeof sub !== "object" || sub === null) continue;
      if (sub.default === undefined) continue;

      if (extra.predicate || extra.noreturn) {
        throw new Error(
          `"default" for item ${i} at ${pathContext.schema} is inside a ` +
            `conditional applicator.`,
        );
      }

      const acc = `${varName}[${i}]`;
      if (this.options.useDefaults === "empty") {
        src.push(
          `if (${acc} === undefined || ${acc} === null || ${acc} === "") { ${acc} = ${JSON.stringify((sub as SchemaDefinition).default)}; }`,
        );
      } else {
        src.push(
          `if (${acc} === undefined) { ${acc} = ${JSON.stringify((sub as SchemaDefinition).default)}; }`,
        );
      }
    }
  }

  handleArrayConstraints(
    src: string[],
    schema: ArraySchema,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    if (schema.minItems !== undefined) {
      const isDataRef = this.options.$data && isDataReference(schema.minItems);
      let comparisonTarget;

      if (isDataRef && typeof schema.minItems === "object") {
        const pointer = schema.minItems.$data;
        const resolvedPath = resolveDataPointerAtCompileTime(
          pointer,
          pathContext.fullAccess,
          pathContext.rootDataVar,
        );
        comparisonTarget = generateNumberDataRef(
          src,
          resolvedPath,
          extra,
          this.counter++,
          true,
        );
      } else {
        comparisonTarget = schema.minItems;
      }

      src.push(
        `if (${extra.before}${varName}.length < ${comparisonTarget}) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "minItems",
            value: `${varName}.length`,
            message: `"must have at least " +${comparisonTarget}+" items"`,
            expected: comparisonTarget as string,
          },
          extra,
        )}`,
        `}`,
      );

      if (isDataRef) {
        src.push("}");
      }
    }

    if (schema.maxItems !== undefined) {
      const isDataRef = this.options.$data && isDataReference(schema.maxItems);
      let comparisonTarget;

      if (isDataRef && typeof schema.maxItems === "object") {
        const pointer = schema.maxItems.$data;
        const resolvedPath = resolveDataPointerAtCompileTime(
          pointer,
          pathContext.fullAccess,
          pathContext.rootDataVar,
        );
        comparisonTarget = generateNumberDataRef(
          src,
          resolvedPath,
          extra,
          this.counter++,
          true,
        );
      } else {
        comparisonTarget = schema.maxItems;
      }

      src.push(
        `if (${extra.before}${varName}.length > ${comparisonTarget}) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "maxItems",
            value: `${varName}.length`,
            message: `"must have at most " + ${comparisonTarget} + " items"`,
            expected: comparisonTarget as string,
          },
          extra,
        )}`,
        `}`,
      );

      if (isDataRef) {
        src.push("}");
      }
    }

    const isDataRef = this.options.$data && isDataReference(schema.uniqueItems);
    if (schema.uniqueItems === true || isDataRef) {
      let comparisonTarget;
      this.needsUniqueChecker = true;
      this.needsDeepEqual = true;
      if (isDataRef && typeof schema.uniqueItems === "object") {
        comparisonTarget = "$data" + this.counter++;
        const pointer = schema.uniqueItems.$data;
        const resolvedPath = resolveDataPointerAtCompileTime(
          pointer,
          pathContext.fullAccess,
          pathContext.rootDataVar,
        );
        src.push(
          `const ${comparisonTarget} = ${resolvedPath};`,
          `if (${extra.before} ${comparisonTarget} === true) {`,
        );
      } else {
        comparisonTarget = schema.uniqueItems;
      }

      if (extra.before != "" && !isDataRef)
        src.push(`if(${extra.before} true){`);

      src.push(
        `if (hasDuplicateItems(${varName})) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "uniqueItems",
            value: varName,
            message: '"items must be unique"',
            expected: '"unique values"',
          },
          extra,
        )}`,
        `}`,
      );

      if (extra.before != "" || isDataRef) {
        src.push("}");
      }
    }
  }

  handleAdditionalItems(
    src: string[],
    schema: ArraySchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    if (Array.isArray(schema.items)) {
      if (schema.additionalItems === false) {
        src.push(
          `if (${extra.before}${varName}.length > ${schema.items.length}) {`,
          `${this.buildErrorReturn(
            {
              ...pathContext,
              mapping: "/additionalItems",
              schema: `${pathContext.schema}/additionalItems`,
            },
            {
              keyword: "additionalItems",
              value: `${varName}.length`,
              message: `"Expected at most ${schema.items.length} items"`,
              expected: schema.items.length as any as string,
            },
            extra,
          )}`,
          `}`,
        );
      }
      if (
        schema.additionalItems === true &&
        trackingState.parentHasUnevaluatedItems
      ) {
        src.push(
          `${varName}.forEach((_, index) => ${trackingState.parentUnevaluatedItemVar}.add(index));`,
        );
      }
    }

    if (schema.items === true && trackingState.parentHasUnevaluatedItems) {
      src.push(
        `${varName}.forEach((_, index) => ${trackingState.parentUnevaluatedItemVar}.add(index));`,
      );
    }

    if (schema.items === false) {
      const itemValidator = "i" + this.counter++;
      src.push(`const len${itemValidator} = ${varName}.length;`);
      src.push(
        `if (${extra.before}len${itemValidator} > ${
          schema?.prefixItems?.length ?? 0
        }) {`,
        `${this.buildErrorReturn(
          {
            ...pathContext,
            mapping: "/items",
            schema: `${pathContext.schema}/items`,
          },
          {
            keyword: "items",
            value: `${varName}.length`,
            message: `"Expected at most ${schema?.prefixItems?.length ?? 0} items"`,
            expected: String(schema?.prefixItems?.length ?? 0),
          },
          extra,
        )}`,
        `}`,
      );
    }

    if (!Array.isArray(schema.items) && typeof schema.items == "object") {
      const itemValidator = "i" + this.counter++;
      src.push(`const len${itemValidator} = ${varName}.length;`);

      if (extra.before != "") src.push(`if(${extra.before} true){`);

      if (schema.prefixItems !== undefined && schema.prefixItems.length > 0) {
        src.push(
          `for (let ${itemValidator} = ${schema.prefixItems.length}; ${itemValidator} < len${itemValidator}; ${itemValidator}++) {`,
        );
      } else {
        src.push(
          `for (let ${itemValidator} = 0; ${itemValidator} < len${itemValidator}; ${itemValidator}++) {`,
        );
      }

      if (
        extra.before &&
        !this.options.allErrors &&
        (extra.noreturn || extra.predicate) &&
        !trackingState.parentHasUnevaluatedItems
      )
        src.push(`if (!(${extra.before} true)) break;`);

      const newSeg: AccessSegment = { kind: "dynamic", expr: itemValidator };
      const itemValidation = this.compileSchema(
        schema.items as BaseSchema,
        {
          rootDataVar: pathContext.rootDataVar,
          schema: `${pathContext.schema}/items`,
          data: pathContext.data + renderSegmentPath(newSeg),
          fullAccess: [...pathContext.fullAccess, newSeg],
          accessPattern: `${varName}[${itemValidator}]`,
          mapping: "/items",
        },
        {},
        { ...extra, inlined: false },
      );

      src.push(itemValidation);

      if (trackingState.parentHasUnevaluatedItems)
        src.push(
          extra.before
            ? `if (${extra.before} true) ${trackingState.parentUnevaluatedItemVar}.add(${itemValidator})`
            : `${trackingState.parentUnevaluatedItemVar}.add(${itemValidator})`,
        );

      src.push("};");

      if (extra.before != "") src.push(`}`);
    }

    if (
      Array.isArray(schema.items) &&
      typeof schema.additionalItems === "object"
    ) {
      const itemValidator = "i" + this.counter++;
      if (extra.before != "") src.push(`if(${extra.before} true){`);
      src.push(
        `for (let ${itemValidator} = ${schema.items.length}; ${itemValidator} < ${varName}.length; ${itemValidator}++) {`,
      );

      if (
        extra.before &&
        !this.options.allErrors &&
        (extra.noreturn || extra.predicate) &&
        !trackingState.parentHasUnevaluatedItems
      )
        src.push(`if (!(${extra.before} true))break;`);

      const newSeg: AccessSegment = { kind: "dynamic", expr: itemValidator };
      const additionalValidation = this.compileSchema(
        schema.additionalItems,
        {
          rootDataVar: pathContext.rootDataVar,
          schema: `${pathContext.schema}/additionalItems`,
          data: pathContext.data + renderSegmentPath(newSeg),
          fullAccess: [...pathContext.fullAccess, newSeg],
          accessPattern: `${varName}[${itemValidator}]`,
          mapping: "/additionalItems",
        },
        {},
        { ...extra, inlined: false },
      );

      src.push(additionalValidation);

      if (trackingState.parentHasUnevaluatedItems)
        src.push(
          extra.before
            ? `if (${extra.before} true) ${trackingState.parentUnevaluatedItemVar}.add(${itemValidator})`
            : `${trackingState.parentUnevaluatedItemVar}.add(${itemValidator})`,
        );

      src.push(`}`);
      if (extra.before != "") src.push(`}`);
    }
  }

  handleArrayItems(
    src: string[],
    schema: ArraySchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    const ischema =
      schema.prefixItems ||
      (Array.isArray(schema.items) ? schema.items : undefined);

    if (ischema && ischema.length > 0) {
      if (extra.before != "") src.push(`if (${extra.before} true) {`);

      ischema.forEach((itemSchema, index) => {
        src.push(`if (${varName}.length > ${index}) {`);

        const newSeg: AccessSegment = { kind: "index", value: index };
        const itemValidation = this.compileSchema(
          itemSchema,
          {
            rootDataVar: pathContext.rootDataVar,
            schema: `${pathContext.schema}/${
              schema.prefixItems !== undefined ? "prefixItems" : "items"
            }/${index}`,
            mapping: `/${
              schema.prefixItems !== undefined ? "prefixItems" : "items"
            }/${index}`,
            data: pathContext.data + renderSegmentPath(newSeg),
            fullAccess: [...pathContext.fullAccess, newSeg],
            accessPattern: `${varName}[${index}]`,
          },
          {},
          { ...extra, inlined: false },
        );

        src.push(itemValidation);
        addEvaluatedItems(src, index, trackingState);

        src.push("}");
      });

      if (extra.before != "") src.push(`}`);
    }
  }

  handleArrayContains(
    src: string[],
    schema: ArraySchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    const containsValid = "cV" + this.counter++;
    const containsCount = "cC" + this.counter++;
    const conValid = `bV${this.counter++}`;
    const i = "i" + this.counter++;
    const containsValidation = this.compileSchema(
      schema.contains!,
      { ...pathContext, accessPattern: `${varName}[${i}]` },
      undefined,
      {
        before: `${conValid} && `,
        after: `${conValid} = false;`,
        predicate: true,
        refAfter: "",
        errorVar: extra.errorVar,
        functionName: extra.functionName,
        inlined: false,
      },
    );

    const hasMinMax =
      schema.maxContains !== undefined || schema.minContains !== undefined;

    let maxVar: string | undefined | number;
    const maxIsData =
      schema.maxContains !== undefined &&
      this.options.$data &&
      isDataReference(schema.maxContains);

    if (schema.maxContains !== undefined) {
      if (maxIsData && typeof schema.maxContains === "object") {
        const resolvedPath = resolveDataPointerAtCompileTime(
          schema.maxContains.$data,
          pathContext.fullAccess,
          pathContext.rootDataVar,
        );
        maxVar = "maxC" + this.counter++;
        src.push(
          `var ${maxVar} = ${resolvedPath};`,
          `if (typeof ${maxVar} !== 'number' || !Number.isInteger(${maxVar})) ${maxVar} = Infinity;`,
        );
      } else {
        maxVar = schema.maxContains as number;
      }
    }

    src.push(
      hasMinMax ? `var ${containsCount} = 0;` : `var ${containsValid} = false;`,
    );

    src.push(
      `for (let ${i} = 0; ${i} < ${varName}.length; ${i}++) {`,
      `var ${conValid} = true;`,
      containsValidation,
      `if (${conValid}) {`,
    );
    addEvaluatedItems(src, i, trackingState);

    if (hasMinMax) {
      src.push(`${containsCount}++;`);
      if (maxVar !== undefined && !trackingState.shouldTrackEvaluatedItems) {
        if (maxIsData) {
          const minIsData =
            schema.minContains !== undefined &&
            this.options.$data &&
            isDataReference(schema.minContains);

          const minFloor =
            schema.minContains === undefined
              ? 1
              : minIsData
                ? undefined
                : (schema.minContains as number);
          let breakCond = `${containsCount} > ${maxVar}`;
          if (maxIsData && minFloor !== undefined && minFloor > 0) {
            breakCond += ` || (${maxVar} === Infinity && ${containsCount} >= ${minFloor})`;
          }
          src.push(`if (${breakCond}) break;`);
        }
      }
    } else {
      src.push(`${containsValid} = true;`);
      if (
        !trackingState.shouldTrackEvaluatedProperties &&
        !trackingState.shouldTrackEvaluatedItems
      ) {
        src.push("break;");
      }
    }
    src.push("}", "}");

    if (hasMinMax) {
      if (schema.minContains !== undefined) {
        const isDataRef =
          this.options.$data && isDataReference(schema.minContains);
        let comparisonTarget;

        if (isDataRef && typeof schema.minContains === "object") {
          const pointer = schema.minContains.$data;
          const resolvedPath = resolveDataPointerAtCompileTime(
            pointer,
            pathContext.fullAccess,
            pathContext.rootDataVar,
          );
          comparisonTarget = generateNumberDataRef(
            src,
            resolvedPath,
            extra,
            this.counter++,
            true,
          );
        } else {
          comparisonTarget = schema.minContains;
        }

        src.push(
          `if (${extra.before}${containsCount} < ${comparisonTarget ?? 1}) {`,
          `${this.buildErrorReturn(
            pathContext,
            {
              keyword: "minContains",
              value: varName,
              message: `"must contain at least " + ${comparisonTarget} + " item matching the schema."`,
              expected: comparisonTarget as string,
            },
            extra,
          )}`,
          `}`,
        );

        if (isDataRef) src.push("}");
      }

      if (schema.maxContains !== undefined) {
        src.push(
          `if (${extra.before}${containsCount} > ${maxVar}) {`,
          `${this.buildErrorReturn(
            pathContext,
            {
              keyword: "maxContains",
              value: varName,
              message: `"must contain at most " + ${maxVar} + " item matching the schema."`,
              expected: maxVar as string,
            },
            extra,
          )}`,
          `}`,
        );
      }
    }
    if (schema.minContains === undefined) {
      const existsCheck = hasMinMax
        ? `${containsCount} < 1`
        : `!${containsValid}`;
      src.push(
        `if (${extra.before}${existsCheck}) {`,
        `${this.buildErrorReturn(
          pathContext,
          {
            keyword: "contains",
            value: varName,
            message: '"must contain at least one item matching the schema"',
          },
          extra,
        )}`,
        `}`,
      );
    }
  }

  handleUnevaluatedItems(
    src: string[],
    schema: ArraySchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    if (schema.unevaluatedItems === true) {
      if (trackingState.parentHasUnevaluatedItems) {
        src.push(
          `${varName}.forEach((_, index) => ${trackingState.parentUnevaluatedItemVar}.add(index));`,
        );
      }
      return;
    }
    const unName = "unItn" + this.counter++;
    const evalSet = trackingState.unevaluatedItemVar!;
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    const i = "i" + this.counter++;
    src.push(
      `const ${unName} = [];`,
      `for (let ${i} = 0; ${i} < ${varName}.length; ${i}++) {`,
      `if (!${evalSet}.has(${i})) {`,
      `${unName}.push(${i});`,
      `}`,
      `}`,
    );

    if (schema.unevaluatedItems === false) {
      src.push(
        `if (${unName}.length > 0) {`,
        `${this.buildErrorReturn(
          {
            ...pathContext,
            mapping: "/unevaluatedItems",
            schema: `${pathContext.schema}/unevaluatedItems`,
          },
          {
            keyword: "unevaluatedItems",
            value: varName,
            message: `"Unevaluated items: [" + ${unName} + "] in array."`,
            expected: '"All items to be evaluated"',
          },
          extra,
        )}}`,
      );
    } else {
      const unKeyName = "unKey" + this.counter++;

      const newSeg: AccessSegment = { kind: "dynamic", expr: unKeyName };
      const unpValidatorFn = this.compileSchema(
        schema.unevaluatedItems!,
        {
          rootDataVar: pathContext.rootDataVar,
          data: pathContext.data + renderSegmentPath(newSeg),

          fullAccess: [...pathContext.fullAccess, newSeg],
          accessPattern: `${varName}[${unKeyName}]`,
          schema: `${pathContext.schema}/unevaluatedItems`,
          mapping: "/unevaluatedItems",
        },
        {},
        { ...extra, inlined: false },
      );

      src.push(`for(const ${unKeyName} of ${unName}) {`);
      if (
        extra.before &&
        !this.options.allErrors &&
        (extra.noreturn || extra.predicate) &&
        !trackingState.parentHasUnevaluatedItems
      )
        src.push(`if (!(${extra.before} true))break;`);

      src.push(unpValidatorFn);

      if (trackingState.parentHasUnevaluatedItems) {
        src.push(
          `${trackingState.parentUnevaluatedItemVar}.add(${unKeyName});`,
        );
      }
      src.push("}");
    }
    if (extra.before != "") src.push(`}`);
  }

  buildErrorReturn(
    pathContext: PathContext,
    error: ErrorInfo,
    extra: Extra,
    spreads?: string,
    test?: boolean,
  ): string {
    let result = extra.after;
    if (extra.predicate) return result;

    if (!test) {
      if (this.options.allErrors || extra.noreturn) {
        result += `${extra.errorVar} ??= [];`;
        result += `${extra.errorVar}.push({`;
      } else result += `${extra.functionName}.errors = [{`;
    } else {
      result += `{`;
    }

    const escapedSchemaPath = escapeTemplateString(
      error.schemaPath ?? pathContext.schema,
    );

    if (
      pathContext.rootDataVar === "data" ||
      this.compileContext.hasRootReference
    ) {
      result += `dataPath: joinData(path) + \`${pathContext.data}\`,`;
    } else {
      result += `dataPath: \`${pathContext.data ?? ""}\`,`;
    }

    if (
      (pathContext.rootDataVar === "data" ||
        this.compileContext.hasRootReference) &&
      (this.options.verbose === true || this.options.verbose === "path")
    ) {
      result += `schemaPath: joinSchema(path) + \`${escapedSchemaPath}\`,`;
    } else {
      result += `schemaPath: \`${escapedSchemaPath}\`,`;
    }

    result += `keyword: "${error.keyword}",`;

    if (error.expected !== undefined) {
      result += `expected: ${error.expected},`;
    }
    if (this.options.verbose === true || this.options.verbose === "value") {
      result += `value: ${error.value},`;
    }

    let errorMessage;
    if (this.options.errorMessage && typeof this.schema !== "boolean") {
      const schemaAtPath = getSchemaAtPath(this.schema, pathContext.schema);

      if (
        schemaAtPath &&
        typeof schemaAtPath === "object" &&
        "errorMessage" in schemaAtPath
      ) {
        if (typeof schemaAtPath.errorMessage === "string") {
          errorMessage = schemaAtPath.errorMessage;
        } else if (typeof schemaAtPath.errorMessage === "object") {
          errorMessage = schemaAtPath.errorMessage[error.keyword];
          if (!errorMessage)
            errorMessage = schemaAtPath.errorMessage["_jetError"];
        }
      }

      if (
        (!errorMessage || typeof errorMessage === "object") &&
        pathContext.mapping
      ) {
        const mapSplit = pathContext.mapping.split("/");
        let deduction;
        if (mapSplit.length > 3) {
          const lastSlash = mapSplit[mapSplit.length - 1];
          deduction = 1 + lastSlash.length;
        } else {
          deduction = 0;
        }
        const fPath = pathContext.schema.slice(
          0,
          -(pathContext.mapping.length - deduction),
        );
        const schemaAtPath = getSchemaAtPath(this.schema, fPath);

        if (
          schemaAtPath &&
          typeof schemaAtPath === "object" &&
          "errorMessage" in schemaAtPath
        ) {
          if (typeof schemaAtPath.errorMessage === "string") {
            errorMessage = schemaAtPath.errorMessage;
          } else if (typeof schemaAtPath.errorMessage === "object") {
            errorMessage = schemaAtPath.errorMessage[error.keyword];

            if (!errorMessage || typeof errorMessage === "object") {
              const errAtPath = getSchemaAtPath(
                schemaAtPath.errorMessage,
                "#" + pathContext.mapping,
              );

              errorMessage = errAtPath;
              if (typeof errorMessage === "object") {
                errorMessage = errorMessage[error.keyword];
              }

              if (!errorMessage && deduction > 0) {
                const errorAtPath = getSchemaAtPath(
                  schemaAtPath.errorMessage,
                  "#" + pathContext.mapping.slice(0, -deduction),
                );

                errorMessage = errorAtPath;
                if (typeof errorMessage === "object") {
                  errorMessage = errorMessage[error.keyword];
                  if (!errorMessage && typeof errorAtPath === "object")
                    errorMessage = errorAtPath["_jetError"];
                }
              }

              if (!errorMessage && typeof errAtPath === "object")
                errorMessage = errAtPath["_jetError"];
            }
            if (errorMessage && typeof errorMessage === "object")
              errorMessage = undefined;
          }
        }
      }

      if (this.schema.errorMessage && !errorMessage) {
        const rootErrorMessage = this.schema.errorMessage;
        if (typeof rootErrorMessage === "string") {
          errorMessage = rootErrorMessage;
        } else if (typeof rootErrorMessage === "object") {
          const errorAtPath = getSchemaAtPath(
            rootErrorMessage,
            pathContext.schema,
          );

          if (typeof errorAtPath === "string") {
            errorMessage = errorAtPath;
          } else if (typeof errorAtPath === "object") {
            errorMessage = errorAtPath[error.keyword];
            if (!errorMessage) errorMessage = errorAtPath["_jetError"];
          }
        }
      }
    }

    const finalMessage =
      typeof errorMessage === "string"
        ? JSON.stringify(errorMessage)
        : error.message;
    result += `message: ${finalMessage}`;

    if (spreads) {
      result += `,${spreads}`;
    }

    result += "}";
    if (test) return result;

    if (this.options.allErrors || extra.noreturn) result += `);`;
    else result += `]; return false;`;

    return result;
  }
}
