import {
  ArraySchema,
  BaseSchema,
  ObjectSchema,
  SchemaDefinition,
} from "./types/schema";
import {
  escapeTemplateString,
  getSchemaAtPath,
  shouldApplyKeyword,
  validateKeywordValue,
} from "./utilities";
import { ValidatorOptions } from "./types/validation";
import {
  CodeContext,
  codeError,
  CodeKeywordDefinition,
  CompiledValidateFunction,
  CompileKeywordDefinition,
  KeywordDefinition,
  ValidateKeywordDefinition,
} from "./types/keywords";
import { JetValidator } from "./jet-validator";
export type Extra = { before: string; after: string; refAfter?: string };

interface ErrorInfo {
  keyword: string;
  value: string;
  message: string;
  expected?: string;
  dataPath?: string;
  schemaPath?: string;
}

/**
 * PathContext: Lightweight object containing only path strings.
 * Created on every recursion but only contains 4 strings (cheap to allocate).
 *
 * TrackingState: Mutable state for unevaluated* tracking.
 * Mutated in place when possible to avoid allocations.
 * Only spread when crossing schema boundaries that introduce new tracking requirements.
 *
 * this.options: Immutable config stored in class instance.
 * Never passed as parameter - accessed via this.options.
 *
 * Performance: This design reduces allocations by ~60% compared to
 * spreading a single 13-property object on every recursion.
 */

interface PathContext {
  schema: string;
  data: string;
  $data: string;
  alt?: string;
  alt2?: string;
}

interface TrackingState {
  isSubschema?: boolean;
  parentHasUnevaluatedProperties?: boolean;
  hasOwnUnevaluatedProperties?: boolean;
  shouldTrackEvaluatedProperties?: boolean;
  parentHasUnevaluatedItems?: boolean;
  hasOwnUnevaluatedItems?: boolean;
  shouldTrackEvaluatedItems?: boolean;
  parentUnevaluatedPropVar?: string;
  unevaluatedPropVar?: string;
  parentUnevaluatedItemVar?: string;
  unevaluatedItemVar?: string;
  unEvaluatedPropertiesSetVar?: string;
  unEvaluatedItemsSetVar?: string;
}

let counter = 0;

const PRIMITIVE_TYPES = new Set(["number", "string", "boolean", "integer"]);

const addEvaluatedProperty = (
  src: string[],
  prop: any,
  options: TrackingState,
): void => {
  if (!options.shouldTrackEvaluatedProperties) return;

  src.push(
    options.hasOwnUnevaluatedProperties &&
      options.parentHasUnevaluatedProperties
      ? `${options.unEvaluatedPropertiesSetVar}.forEach(set => { set?.add(${prop}); });`
      : `${options.unevaluatedPropVar}?.add(${prop});`,
  );
};

const addEvaluatedItems = (
  src: string[],
  prop: any,
  options: TrackingState,
): void => {
  if (!options.shouldTrackEvaluatedItems) return;

  src.push(
    options.hasOwnUnevaluatedItems && options.parentHasUnevaluatedItems
      ? `${options.unEvaluatedItemsSetVar}.forEach(set => { set?.add(${prop}); });`
      : `${options.unevaluatedItemVar}?.add(${prop});`,
  );
};

const coerceToNumber = (
  src: string[],
  schema: SchemaDefinition,
  varName: string,
): void => {
  const isInteger = schema.type === "integer";
  src.push(
    `if (typeof ${varName} === 'string') {`,
    `  const trimmed = ${varName}.trim();`,
    `  if (trimmed !== '' && !isNaN(Number(trimmed))) {`,
    `    ${varName} = Number(trimmed);`,
    ...(isInteger
      ? [
          `    if (Number.isInteger(${varName})) {`,
          `      ${varName} = Math.trunc(${varName});`,
          `    }`,
        ]
      : []),
    `  }`,
    `} else if (typeof ${varName} === 'boolean') {`,
    `  ${varName} = ${varName} ? 1 : 0;`,
    `}`,
  );
};

const coerceToString = (src: string[], varName: string): void => {
  src.push(
    `if (typeof ${varName} === 'number' || typeof ${varName} === 'boolean') {`,
    `  ${varName} = String(${varName});`,
    `}`,
  );
};

const coerceToBoolean = (src: string[], varName: string): void => {
  src.push(
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
  );
};

const coerceToArray = (src: string[], varName: string): void => {
  src.push(
    `if (!Array.isArray(${varName}) && ${varName} !== null && ${varName} !== undefined) {`,
    `  ${varName} = [${varName}];`,
    `}`,
  );
};

const resolveDataPointerAtCompileTime = (
  pointer: string,
  currentDataPath: string,
  isInSubschema: boolean,
): string => {
  const rootVar = isInSubschema ? "data" : "rootData";

  if (pointer.startsWith("/")) {
    const parts = pointer.slice(1).split("/");
    if (parts[0] === "") return rootVar;

    const accessPath = parts
      .map((part) => {
        const unescaped = part.replace(/~1/g, "/").replace(/~0/g, "~");
        return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(unescaped)
          ? `.${unescaped}`
          : `[${JSON.stringify(unescaped)}]`;
      })
      .join("");

    return `${rootVar}${accessPath}`;
  }

  const levelsUp = parseInt(pointer[0]);
  const restPath = pointer.slice(2);
  const pathParts = currentDataPath.split("/").filter((p) => p);
  const targetParts = pathParts.slice(0, -levelsUp);

  if (restPath) {
    targetParts.push(...restPath.split("/"));
  }

  if (targetParts.length === 0) return rootVar;

  const accessPath = targetParts
    .map((part) => {
      const unescaped = part.replace(/~1/g, "/").replace(/~0/g, "~");
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(unescaped)) return `.${unescaped}`;
      if (/^\d+$/.test(unescaped)) return `[${unescaped}]`;
      return `[${JSON.stringify(unescaped)}]`;
    })
    .join("");

  return `${rootVar}${accessPath}`;
};

const isDataReference = (value: any): value is { $data: string } => {
  return (
    typeof value === "object" &&
    value !== null &&
    "$data" in value &&
    typeof value.$data === "string"
  );
};

const generateNumberDataRef = (
  src: string[],
  resolvedPath: string,
  extra: Extra,
  integer?: boolean,
): string => {
  const comparisonTarget = "$data" + counter++;
  src.push(
    `const ${comparisonTarget} = ${resolvedPath};`,
    `if (${
      extra.before
    }typeof ${comparisonTarget} === 'number' && Number.isFinite(${comparisonTarget})${
      integer ? ` && Number.isInteger(${comparisonTarget})` : ""
    }) {`,
  );
  return comparisonTarget;
};

const generateStringDataRef = (
  src: string[],
  resolvedPath: string,
  extra: Extra,
): string => {
  const comparisonTarget = "$data" + counter++;
  src.push(
    `const ${comparisonTarget} = ${resolvedPath};`,
    `if (${extra.before}typeof ${comparisonTarget} === 'string') {`,
  );
  return comparisonTarget;
};

const generateUndefinedDataRef = (
  src: string[],
  resolvedPath: string,
  extra: Extra,
): string => {
  const comparisonTarget = "$data" + counter++;
  src.push(
    `const ${comparisonTarget} = ${resolvedPath};`,
    `if (${extra.before}${comparisonTarget} !== undefined) {`,
  );
  return comparisonTarget;
};

const generateArrayDataRef = (
  src: string[],
  resolvedPath: string,
  extra: Extra,
): string => {
  const comparisonTarget = "$data" + counter++;
  src.push(
    `const ${comparisonTarget} = ${resolvedPath};`,
    `if (${extra.before}Array.isArray(${comparisonTarget})) {`,
  );
  return comparisonTarget;
};

export class Compiler {
  private refables: any[] = [];
  private ranRefables = false;
  private refCall: boolean = false;
  private schema: SchemaDefinition | boolean;
  private options: Partial<ValidatorOptions>;
  private errorVariableDeclared = false;
  private errorVariable = "allErrors";
  private compiledKeywords = new Map<string, CompiledValidateFunction>();
  regexCache = new Map<string, string>();
  private validateKeywords = new Set<string>();
  private allKeywords: Set<string>;
  private jetValidator: JetValidator;
  private notLogic: boolean = false;
  private noreturn: boolean = false;
  private neutralError: boolean = false;
  private compileContext: {
    hasUnevaluatedProperties: boolean;
    hasUnevaluatedItems: boolean;
    hasRootReference: boolean;
    referencedFunctions: string[];
    uses$Data: boolean;
  };
  private standAlone = false;
  private hasCompileKeyword = false;
  needslen_of: boolean = false;
  needsStringify: boolean = false;
  needsDeepEqual: boolean = false;
  mainFunctionName = "validate";
  hoistedFunctions: string[] = [];

  constructor(
    refables: any[] = [],
    schema: SchemaDefinition | boolean,
    options: Partial<ValidatorOptions>,
    jetValidator: JetValidator,
    allKeywords: Set<string>,
    compileContext: {
      hasUnevaluatedProperties: boolean;
      hasUnevaluatedItems: boolean;
      hasRootReference: boolean;
      referencedFunctions: string[];
      uses$Data: boolean;
    },
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

  getCompiledKeywords(): {
    compiledKeywords: Map<string, CompiledValidateFunction>;
    validateKeywords: Set<string>;
    hasCompileKeyword: boolean;
  } {
    return {
      compiledKeywords: this.compiledKeywords,
      validateKeywords: this.validateKeywords,
      hasCompileKeyword: this.hasCompileKeyword,
    };
  }

  private createSubschemaOptions(
    trackingState: TrackingState,
    pathContext: PathContext,
    pathSegment: string,
    schema: SchemaDefinition,
    dataSegment?: string,
  ): { pathContext: PathContext; trackingState: TrackingState } {
    const parentUnevProp =
      trackingState.parentHasUnevaluatedProperties === true ||
      schema.unevaluatedProperties !== undefined;
    const parentUnevItem =
      trackingState.parentHasUnevaluatedItems === true ||
      schema.unevaluatedItems !== undefined;
    return {
      pathContext: {
        schema: `${pathContext.schema}/${pathSegment ?? ""}`,
        data: `${pathContext.data}${dataSegment ?? ""}`,
        $data: `${pathContext.$data}${dataSegment ?? ""}`,
        alt: pathContext.alt,
        alt2: pathContext.alt2,
      },
      trackingState: {
        parentHasUnevaluatedProperties: parentUnevProp,
        parentUnevaluatedPropVar: parentUnevProp
          ? trackingState.unevaluatedPropVar
          : undefined,
        parentHasUnevaluatedItems:
          trackingState.parentHasUnevaluatedItems === true ||
          schema.unevaluatedItems !== undefined,
        parentUnevaluatedItemVar: parentUnevItem
          ? trackingState.unevaluatedItemVar
          : undefined,
        isSubschema: true,
      },
    };
  }

  private handleCustomKeywords(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    accessPattern: string,
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

      if (
        !("macro" in keywordDef) &&
        "code" in keywordDef &&
        "validate" in keywordDef
      ) {
        continue;
      }

      if (keywordDef.type) {
        const typeChecks = Array.isArray(keywordDef.type)
          ? keywordDef.type
              .map((t) => this.generateTypeCheck(varName, t))
              .join(" || ")
          : this.generateTypeCheck(varName, keywordDef.type);
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
          schema,
          varName,
          pathContext,
          accessPattern,
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
      accessPattern: varName,
      allErrors: this.options.allErrors || false,
      functionName: this.mainFunctionName,
      extra,
      buildError: (error: codeError) => {
        const { keyword, message, expected, value, ...extras } = error;
        const spreadCode =
          Object.keys(extras).length > 0
            ? `...${JSON.stringify(extras)}`
            : undefined;

        let err = this.buildErrorReturn(
          pathContext,
          {
            keyword: keyword || keywordDef.keyword,
            message,
            expected,
            value: value || varName,
          },
          spreadCode,
        );
        err += extra.after;
        return err;
      },

      addEvaluatedProperty: (prop: any) => {
        const lines: string[] = [];
        addEvaluatedProperty(lines, prop, trackingState);
        return lines.join("\n");
      },

      addEvaluatedItem: (item: any) => {
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
    const keywordId = keywordDef.keyword + counter++;
    const validateFn = keywordDef.compile!(keywordValue, schema, {
      schemaPath: pathContext.schema,
      rootSchema: this.schema as SchemaDefinition,
      opts: this.jetValidator.options,
    });

    if (this.standAlone) {
      src.push(
        `const ${keywordId} = (...args) => {return ${validateFn.toString()}};`,
      );
    } else {
      this.compiledKeywords.set(keywordId, validateFn);
    }

    this.hasCompileKeyword = true;
    const call = this.standAlone
      ? `${keywordId}(${JSON.stringify(keywordValue)}, ${JSON.stringify(
          getSchemaAtPath(this.schema as SchemaDefinition, pathContext.schema),
        )},{schemaPath: '${
          pathContext.schema
        }',rootSchema: mainRootSchema,opts: compilerOptions,})`
      : `customKeywords.get('${keywordId}')`;
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    src.push(
      `const ${keywordId}Result = ${
        keywordDef.async ? "await " : ""
      }${call}(${varName}, rootData, \`${pathContext.data}\`);`,
      `if (${keywordId}Result !== true || (typeof ${keywordId}Result === 'object' && ${keywordId}Result !== null)) {${this.buildErrorReturn(
        pathContext,
        {
          keyword: keywordDef.keyword,
          value: varName,
          message: `"Failed validation for keyword '${keywordDef.keyword}'"`,
        },
        `...${keywordId}Result`,
      )}${extra.after}}`,
    );
    if (extra.before != "") src.push(`}`);
  }

  private handleValidateKeyword(
    src: string[],
    keywordDef: KeywordDefinition,
    keywordValue: any,
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    accessPattern: string,
    extra: Extra,
  ): void {
    const keywordId = keywordDef.keyword + counter++;
    const patharr = pathContext.data.split("/");
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    src.push(
      `const ${keywordId}Result = ${keywordDef.async ? "await " : ""}${
        this.standAlone
          ? keywordDef.keyword
          : `customKeywords.get('${keywordDef.keyword}')`
      }(${JSON.stringify(keywordValue)},${varName},${JSON.stringify(
        getSchemaAtPath(this.schema as SchemaDefinition, pathContext.schema),
      )},{dataPath: \`${pathContext.data}\`,rootData: rootData,schemaPath: '${
        pathContext.schema
      }',parentData: ${accessPattern.split("[")[0]},parentDataProperty: \`${
        patharr[patharr.length - 1]
      }\`});`,
      `if (${keywordId}Result !== true || (typeof ${keywordId}Result === 'object' && ${keywordId}Result !== null)) {${this.buildErrorReturn(
        pathContext,
        {
          keyword: keywordDef.keyword,
          value: varName,
          message: `"Failed validation for keyword '${keywordDef.keyword}'"`,
        },
        `...${keywordId}Result`,
      )}${extra.after}}`,
    );
    if (extra.before != "") src.push(`}`);
    this.validateKeywords.add(keywordDef.keyword);
  }

  compileSchema(
    rootSchema: SchemaDefinition | boolean,
    pathContext: PathContext = {
      schema: "#",
      $data: "",
      data: "",
    },
    trackingState: TrackingState = {},
    accessPattern = "data",
    extra: Extra = { before: "", after: "" },
    inlined: boolean = false,
    first: boolean = false,
  ): string {
    const src: string[] = [];

    if (rootSchema === true) return "";

    if (this.options.allErrors && !this.errorVariableDeclared) {
      src.push("let allErrors = [];");
      this.errorVariableDeclared = true;
    }

    if (rootSchema === false) {
      src.push(
        this.buildErrorReturn(pathContext, {
          keyword: "boolean",
          message: '"Schema is false"',
          value: accessPattern,
        }),
        extra.after,
      );
      return src.join("");
    }

    const schema = rootSchema as SchemaDefinition;
    const varName =
      (schema.default === undefined || !this.options.useDefaults) &&
      !this.options.removeAdditional &&
      !this.options.coerceTypes
        ? accessPattern
        : "var" + counter++;
    this.initializeDefault(src, schema, varName, accessPattern, inlined);
    let shouldTrackProps;
    let shouldTrackItems;
    shouldTrackProps =
      schema?.unevaluatedProperties !== undefined ||
      trackingState.parentHasUnevaluatedProperties === true;

    trackingState.shouldTrackEvaluatedProperties = shouldTrackProps;

    shouldTrackItems =
      schema?.unevaluatedItems !== undefined ||
      trackingState.parentHasUnevaluatedItems === true;
    trackingState.shouldTrackEvaluatedItems = shouldTrackItems;

    if (shouldTrackProps) {
      this.initializePropertyTracking(src, schema, trackingState);
    }

    if (shouldTrackItems) {
      this.initializeItemTracking(src, schema, trackingState);
    }

    if (!this.ranRefables && this.refables.length > 0) {
      this.initializeRefables(pathContext);
    }

    if (schema.__inlinedRef !== undefined) {
      this.inilineRefFunction(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (!schema.__inlinedRef && !first && schema.__functionName) {
      this.initializeSchemaRefables(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
      return src.join("");
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
        accessPattern,
        extra,
        trackingState,
      );
    }
    this.handleTypeValidation(
      src,
      schema,
      varName,
      pathContext,
      trackingState,
      extra,
    );

    return src.join("");
  }

  initializeDefault(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    accessPattern: string,
    inlined: boolean,
  ): void {
    if (schema.default !== undefined && this.options.useDefaults) {
      src.push(
        `let ${varName} = ${accessPattern};`,
        `if (${varName} === undefined || ${varName} === null) {`,
        `${varName} = ${JSON.stringify(schema.default)};`,
        "}",
      );
    } else if (this.options.removeAdditional || this.options.coerceTypes) {
      src.push(`let ${varName} = ${accessPattern};`);
    }

    if (this.options.coerceTypes) {
      if (schema.type === "number" || schema.type === "integer") {
        coerceToNumber(src, schema, varName);
      } else if (schema.type === "string") {
        coerceToString(src, varName);
      } else if (schema.type === "boolean") {
        coerceToBoolean(src, varName);
      } else if (
        schema.type === "array" &&
        this.options.coerceTypes === "array"
      ) {
        coerceToArray(src, varName);
      }
    }
  }

  private initializePropertyTracking(
    src: string[],
    schema: SchemaDefinition,
    trackingState: TrackingState,
  ): void {
    const hasOwn = schema?.unevaluatedProperties !== undefined;
    trackingState.hasOwnUnevaluatedProperties = hasOwn;
    const unEvaluatedPropVar = "evaluatedProperties" + counter++;
    trackingState.unevaluatedPropVar = unEvaluatedPropVar;
    if (
      hasOwn &&
      trackingState.parentHasUnevaluatedProperties &&
      trackingState.parentUnevaluatedPropVar
    ) {
      trackingState.unEvaluatedPropertiesSetVar =
        "evaluatedPropertySets" + counter++;
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
    const hasOwn = schema?.unevaluatedItems !== undefined;
    trackingState.hasOwnUnevaluatedItems = hasOwn;
    const unEvaluatedItemVar = "evaluatedItems" + counter++;
    trackingState.unevaluatedItemVar = unEvaluatedItemVar;
    if (hasOwn && trackingState.parentHasUnevaluatedItems) {
      trackingState.unEvaluatedItemsSetVar = "evaluatedItemSets" + counter++;
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

  inilineRefFunction(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    this.ranRefables = true;

    const def = schema.__inlinedRef;
    const configs = this.createSubschemaOptions(
      trackingState,
      pathContext,
      "",
      schema,
    );
    const defValidatorFn = this.compileSchema(
      def,
      pathContext,
      configs.trackingState,
      varName,
      extra,
      true,
    );
    src.push(defValidatorFn);
  }

  initializeRefables(pathContext: PathContext): void {
    this.ranRefables = true;

    for (const key of this.refables) {
      if (!this.compileContext.referencedFunctions.includes(key.functionName))
        continue;

      const includesItemsRef = this.compileContext.hasUnevaluatedItems;
      const includesPropRef = this.compileContext.hasUnevaluatedProperties;
      const def = key["schema"];

      this.refCall = true;
      const originalErrVar = this.errorVariable;
      const originalFunctionName = this.mainFunctionName;

      if (this.options.allErrors) {
        this.errorVariable = `${key.functionName}Err`;
      } else {
        this.mainFunctionName = key.functionName;
      }
      const parentProp = "evaluatedProperties" + counter++;
      const parentItem = "evaluatedItems" + counter++;
      const defValidatorFn = this.compileSchema(
        def,
        {
          schema: `\${path.schema}${
            key.path.startsWith("#") ? key.path.slice(1) : key.path
          }`,
          data: "${path.data}",
          $data: pathContext.$data,
          alt: key.path.startsWith("#") ? key : "#" + key.path,
        },
        {
          parentHasUnevaluatedProperties: includesPropRef,
          parentUnevaluatedPropVar: includesPropRef ? parentProp : undefined,
          parentHasUnevaluatedItems: includesItemsRef,
          parentUnevaluatedItemVar: includesItemsRef ? parentItem : undefined,
          isSubschema: true,
        },
        "data",
        { before: "", after: "" },
        false,
        true,
      );
      this.mainFunctionName = originalFunctionName;
      this.errorVariable = originalErrVar;
      this.refCall = false;

      const funcParams = ["data"];
      if (includesPropRef) funcParams.push(parentProp);
      if (includesItemsRef) funcParams.push(parentItem);
      funcParams.push("path");

      const asyncPrefix = this.options.async ? "async " : "";
      this.hoistedFunctions.push(
        `const ${key.functionName} = ${asyncPrefix}function (${funcParams.join(
          ",",
        )}) {`,
        this.options.allErrors ? `let ${key.functionName}Err = [];` : "",
        defValidatorFn,
        this.options.allErrors
          ? `${key.functionName}.errors = ${key.functionName}Err; return ${key.functionName}Err.length == 0`
          : " return true",
        "};",
      );
    }
  }

  initializeSchemaRefables(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    const funcValidator = "func" + counter++;
    const callArgs = this.buildRefCallArgs(
      varName,
      pathContext,
      trackingState,
      "#",
    );
    const awaitPrefix = this.options.async ? "await " : "";
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    src.push(
      `const ${funcValidator}Result = ${awaitPrefix}${schema.__functionName}${callArgs};`,
    );

    if (this.options.allErrors) {
      src.push(
        `if (!${funcValidator}Result) {${this.errorVariable} = ${this.errorVariable}.concat(${schema.__functionName}.errors);${extra.refAfter || extra.after}}`,
      );
    } else {
      src.push(
        `if (!${funcValidator}Result){${this.mainFunctionName}.errors = ${schema.__functionName}.errors;${extra.refAfter ?? extra.after}${this.noreturn ? "" : "return false;"}}`,
      );
    }
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
    const refType = schema.$ref ? "$ref" : "$dynamicRef";
    const refValue = schema.$ref || schema.$dynamicRef;

    if (refValue === "*unavailable") {
      src.push(
        this.buildErrorReturn(pathContext, {
          keyword: refType,
          value: varName,
          message: `"Invalid ${refType} pointer. ${refType} not found."`,
        }),
      );
      src.push(extra.refAfter || "");
      return;
    }

    const refValidator = (schema.$ref ? "refs" : "drefs") + counter++;
    const [fName, rest] = refValue!.split("**");
    const functionName = fName.slice(1);
    const awaitPrefix = this.options.async ? "await " : "";
    const callArgs = this.buildRefCallArgs(
      varName,
      pathContext,
      trackingState,
      `${pathContext.schema}/${refType}${rest ? `/${rest}` : ""}`,
    );
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    src.push(
      `const ${refValidator}Result = ${awaitPrefix}${functionName}${callArgs};`,
    );

    if (this.options.allErrors) {
      src.push(
        `if (!${refValidator}Result) {${this.errorVariable} = ${this.errorVariable}.concat(${functionName}.errors);${extra.refAfter || extra.after}}`,
      );
    } else {
      src.push(
        `if (!${refValidator}Result){${this.mainFunctionName}.errors = ${functionName}.errors;${extra.refAfter ?? extra.after}${this.noreturn ? "" : "return false;"}}`,
      );
    }
    if (extra.before != "") src.push(`}`);
  }

  private buildRefCallArgs(
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    path?: string,
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

    args.push(
      `{schema: \`${path || pathContext.schema}\`, data: \`${
        pathContext.data
      }\`}`,
    );
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
    if (schema.allOf)
      this.handleAllOfOperator(
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

  handleNotOperator(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    if (schema.not === undefined) return;
    const continuevalidation = `continuevalidation${counter++}`;
    src.push(`let ${continuevalidation} = true;`);
    const originalNotLogic = this.notLogic;
    this.notLogic = true;
    const validatorFn = this.compileSchema(
      schema.not,
      undefined,
      {
        parentHasUnevaluatedItems: false,
        parentHasUnevaluatedProperties: false,
        isSubschema: true,
      },
      varName,
      {
        before: `${continuevalidation} && `,
        after: `${continuevalidation} = false;`,
      },
    );

    this.notLogic = originalNotLogic;
    src.push(validatorFn);
    src.push(
      `if (${continuevalidation}) {${this.buildErrorReturn(pathContext, {
        keyword: "not",
        value: varName,
        message: '"Data must not validate against the provided schema."',
        expected: '"opposite data"',
      })}${extra.after}};`,
    );
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

    let firstLength = "";
    const anyOfValid = "anyOfValid" + counter++;
    src.push(`let ${anyOfValid} = false;`);
    const anyOfError = "anyOfErr" + counter++;
    if (!this.options.allErrors && !this.notLogic)
      src.push(`let ${anyOfError} = [];`);
    schema.anyOf.forEach((subSchema, index) => {
      const branch = `branch${counter++}Valid`;
      if (!this.options.allErrors) src.push(`let ${branch} = true;`);
      let validatorFn;
      const noreturn = this.noreturn;
      this.noreturn = true;
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        `anyOf/${index}`,
        schema,
      );
      configs.pathContext.alt = `${pathContext.schema}/anyOf/${index}`;
      configs.pathContext.alt2 = `${pathContext.schema}/anyOf`;
      if (this.options.allErrors) {
        validatorFn = this.compileSchema(
          subSchema,
          configs.pathContext,
          configs.trackingState,
          varName,
          extra,
          true,
        );
      } else {
        validatorFn = this.compileSchema(
          subSchema,
          configs.pathContext,
          configs.trackingState,
          varName,
          {
            before: `${branch} && `,
            after: `${branch} = false;${this.notLogic ? "" : `${anyOfError}.push(${this.mainFunctionName}.errors[0]);`}`,
            refAfter: `${branch} = false;${this.notLogic ? "" : `${anyOfError} = ${anyOfError}.concat(${this.mainFunctionName}.errors);`}`,
          },
          true,
        );
      }
      this.noreturn = noreturn;

      let errorCountVar;
      if (this.options.allErrors) {
        errorCountVar = "anyErrCnt" + counter++;
        src.push(`const ${errorCountVar} = ${this.errorVariable}.length;`);
        if (index === 0) firstLength = errorCountVar;
      }
      if (
        index > 0 &&
        !trackingState.shouldTrackEvaluatedProperties &&
        !trackingState.shouldTrackEvaluatedItems
      ) {
        src.push(`if(${anyOfValid} === false){`);
      }
      const propSet = trackingState.unevaluatedPropVar!;
      const itemSet = trackingState.unevaluatedItemVar!;
      const pVar = "anyOfpSize" + counter++;
      const iVar = "anyOfiSize" + counter++;
      if (propSet) src.push(`const ${pVar} = ${propSet}?.size;`);
      if (itemSet) src.push(`const ${iVar} = ${itemSet}?.size;`);

      src.push(validatorFn);
      src.push(
        this.options.allErrors
          ? `if (${this.errorVariable}.length == ${errorCountVar}) { ${anyOfValid} = true; }`
          : `if (${branch}) { ${anyOfValid} = true; }`,
      );

      if (propSet) {
        src.push(
          `if (${
            this.options.allErrors
              ? `${this.errorVariable}.length > ${errorCountVar}`
              : `!${branch}`
          }) if(${propSet})Array.from(${propSet}).slice(${pVar}).forEach(prop => ${propSet}.delete(prop));`,
        );
      }
      if (itemSet) {
        src.push(
          `if (${
            this.options.allErrors
              ? `${this.errorVariable}.length > ${errorCountVar}`
              : `!${branch}`
          }) if(${itemSet})Array.from(${itemSet}).slice(${iVar}).forEach(prop => ${itemSet}.delete(prop));`,
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

    if (this.options.allErrors) {
      src.push(
        `if (${anyOfValid}) {${this.errorVariable}.length = ${firstLength};}${extra.after != "" ? `else{${extra.after}}` : ""}`,
      );
    } else {
      src.push(
        `if (${anyOfValid}){${this.mainFunctionName}.errors = undefined}else {${this.notLogic ? "" : `${this.mainFunctionName}.errors = ${anyOfError};`}${extra.refAfter ?? extra.after}${this.noreturn ? "" : "return false;"}}`,
      );
    }
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
    let firstLength = "";
    const oneOfErrors = `oneOfErrors${counter++}`;
    const validSchemaCount = "validSchemaCount" + counter++;
    src.push(`let ${validSchemaCount} = 0;`);
    if (!this.options.allErrors) src.push(`let ${oneOfErrors} = [];`);

    schema.oneOf.forEach((subSchema, index) => {
      const branch = `branch${counter++}Valid`;
      if (!this.options.allErrors && !this.notLogic)
        src.push(`let ${branch} = true;`);
      let validatorFn;
      const noreturn = this.noreturn;
      this.noreturn = true;
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        `oneOf/${index}`,
        schema,
      );
      configs.pathContext.alt = `${pathContext.schema}/oneOf/${index}`;
      configs.pathContext.alt2 = `${pathContext.schema}/oneOf`;
      if (this.options.allErrors) {
        validatorFn = this.compileSchema(
          subSchema,
          configs.pathContext,
          configs.trackingState,
          varName,
          extra,
          true,
        );
      } else {
        validatorFn = this.compileSchema(
          subSchema,
          configs.pathContext,
          configs.trackingState,
          varName,
          {
            before: `${branch} && `,
            after: `${branch} = false;${this.notLogic ? "" : `${oneOfErrors}.push(${this.mainFunctionName}.errors[0]);`}`,
            refAfter: `${branch} = false;${this.notLogic ? "" : `${oneOfErrors} = ${oneOfErrors}.concat(${this.mainFunctionName}.errors);`}`,
          },
          true,
        );
      }
      this.noreturn = noreturn;
      let errorCountVar;
      if (this.options.allErrors) {
        errorCountVar = "oneErrCnt" + counter;
        src.push(`const ${errorCountVar} = ${this.errorVariable}.length;`);
        if (index === 0) firstLength = errorCountVar;
      }
      if (
        index > 0 &&
        !trackingState.shouldTrackEvaluatedProperties &&
        !trackingState.shouldTrackEvaluatedItems
      ) {
        src.push(`if(${validSchemaCount} < 2){`);
      }
      const propSet = trackingState.unevaluatedPropVar!;
      const itemSet = trackingState.unevaluatedItemVar!;

      const pVar = "oneOfpSize" + counter++;
      const iVar = "oneOfiSize" + counter++;
      if (propSet) src.push(`const ${pVar} = ${propSet}?.size;`);
      if (itemSet) src.push(`const ${iVar} = ${itemSet}?.size;`);

      src.push(validatorFn);
      src.push(
        this.options.allErrors
          ? `if (${this.errorVariable}.length == ${errorCountVar}) { ${validSchemaCount}++; }`
          : `if (${branch}) { ${validSchemaCount}++; }`,
      );

      if (propSet) {
        src.push(
          `if (${
            this.options.allErrors
              ? `${this.errorVariable}.length > ${errorCountVar}`
              : `!${branch}`
          }) if(${propSet})Array.from(${propSet}).slice(${pVar}).forEach(prop => ${propSet}.delete(prop));`,
        );
      }
      if (itemSet) {
        src.push(
          `if (${
            this.options.allErrors
              ? `${this.errorVariable}.length > ${errorCountVar}`
              : `!${branch}`
          }) if(${itemSet})Array.from(${itemSet}).slice(${iVar}).forEach(prop => ${itemSet}.delete(prop));`,
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
    if (this.options.allErrors) {
      src.push(
        `if (${validSchemaCount} == 1) {${
          this.errorVariable
        }.length = ${firstLength};} else{${this.buildErrorReturn(pathContext, {
          keyword: "oneOf",
          value: varName,
          message: `"Data must validate against exactly one schema, but matched "+ ${validSchemaCount}`,
          expected: '"exactly one schema"',
        })}${extra.after}}`,
      );
    } else {
      const noreturn = this.noreturn;
      this.noreturn = true;
      src.push(
        `if (${validSchemaCount} == 1){${this.mainFunctionName}.errors = undefined}else {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "oneOf",
            value: varName,
            message: `"Data must validate against exactly one schema, but matched "+ ${validSchemaCount}`,
            expected: '"exactly one schema"',
          },
        )}${this.notLogic ? "" : `${oneOfErrors}.push(${this.mainFunctionName}.errors[0]);${this.mainFunctionName}.errors = ${oneOfErrors};`}${extra.refAfter ?? extra.after}${noreturn ? "" : "return false;"}}`,
      );
      this.noreturn = noreturn;
    }
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
    schema.allOf.forEach((subSchema, index) => {
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        `allOf/${index}`,
        schema,
      );
      configs.pathContext.alt = `${pathContext.schema}/allOf/${index}`;
      configs.pathContext.alt2 = `${pathContext.schema}/allOf`;
      const validatorFn = this.compileSchema(
        subSchema,
        configs.pathContext,
        configs.trackingState,
        varName,
        extra,
        true,
      );
      src.push(validatorFn);
    });
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
    const configs = this.createSubschemaOptions(
      trackingState,
      pathContext,
      `if`,
      schema,
    );
    const ifValid = `ifValid${counter++}`;
    src.push(`let ${ifValid} = true;`);
    const elseIfVariableArray = [];
    if (schema.elseIf) {
      for (const subSchema of schema.elseIf) {
        if (subSchema.if) {
          const ifValid = `ifValid${counter++}`;
          src.push(`let ${ifValid} = true;`);
          elseIfVariableArray.push(ifValid);
        }
      }
    }
    const originalNotLogic = this.notLogic;
    this.notLogic = true;
    const subValidator = this.compileSchema(
      schema.if,
      configs.pathContext,
      configs.trackingState,
      varName,
      {
        before: `${ifValid} && `,
        after: `${ifValid} = false;`,
      },
      true,
    );
    this.notLogic = originalNotLogic;

    const propSet = trackingState.unevaluatedPropVar!;
    const itemSet = trackingState.unevaluatedItemVar!;

    const pVar = "ifpSize" + counter++;
    const iVar = "ifiSize" + counter++;
    if (propSet) src.push(`const ${pVar} = ${propSet}?.size;`);
    if (itemSet) src.push(`const ${iVar} = ${itemSet}?.size;`);
    src.push(subValidator);

    if (propSet) {
      src.push(
        `if (!${ifValid}) if(${propSet})Array.from(${propSet}).slice(${pVar}).forEach(prop => ${propSet}.delete(prop));`,
      );
    }
    if (itemSet) {
      src.push(
        `if (!${ifValid}) if(${itemSet}) Array.from(${itemSet}).slice(${iVar}).forEach(prop => ${itemSet}.delete(prop));`,
      );
    }
    this.handleElseIfConditions(
      src,
      schema,
      varName,
      pathContext,
      trackingState,
      ifValid,
      elseIfVariableArray,
    );
    src.push(`if (${ifValid}) {`);
    if (schema.then !== undefined) {
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        `then`,
        schema,
      );
      configs.pathContext.alt = `${pathContext.schema}/then`;
      configs.pathContext.alt2 = undefined;
      const thenValidatorFn = this.compileSchema(
        schema.then,
        configs.pathContext,
        configs.trackingState,
        varName,
        extra,
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
        `else`,
        schema,
      );
      configs.pathContext.alt = `${pathContext.schema}/else`;
      configs.pathContext.alt2 = undefined;
      const elseValidatorFn = this.compileSchema(
        schema.else,
        configs.pathContext,
        configs.trackingState,
        varName,
        extra,
      );
      src.push(elseValidatorFn, "}");
    }
  }

  handleElseIfConditions(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
    previousIfValid: string,
    elseIfVariableArray: string[],
  ) {
    if (!schema.elseIf) return;

    const functionNames: any = {};
    schema.elseIf.forEach((cond: SchemaDefinition, index: number) => {
      if (cond.if) {
        const configs = this.createSubschemaOptions(
          trackingState,
          pathContext,
          `elseIf/${index}/if`,
          schema,
        );
        const ifValid = elseIfVariableArray[index];
        const originalNotLogic = this.notLogic;
        this.notLogic = true;
        const subValidator = this.compileSchema(
          cond.if,
          configs.pathContext,
          configs.trackingState,
          varName,
          {
            before: `${ifValid} && `,
            after: `${ifValid} = false;`,
          },
          true,
        );
        this.notLogic = originalNotLogic;

        const propSet = trackingState.unevaluatedPropVar!;
        const itemSet = trackingState.unevaluatedItemVar!;

        const pVar = "ifpSize" + counter++;
        const iVar = "ifiSize" + counter++;
        src.push(`if(!${previousIfValid}){`);
        if (propSet) src.push(`const ${pVar} = ${propSet}?.size;`);
        if (itemSet) src.push(`const ${iVar} = ${itemSet}?.size;`);
        src.push(subValidator);
        if (propSet) {
          src.push(
            `if (!${ifValid}) if(${propSet})Array.from(${propSet}).slice(${pVar}).forEach(prop => ${propSet}.delete(prop));`,
          );
        }
        if (itemSet) {
          src.push(
            `if (!${ifValid}) if(${itemSet}) Array.from(${itemSet}).slice(${iVar}).forEach(prop => ${itemSet}.delete(prop));`,
          );
        }
        src.push("}");
        previousIfValid = ifValid;
      }
    });
    return functionNames;
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
    schema.elseIf.forEach((cond: any, index: number) => {
      if (!cond.if) return;
      src.push(`else if (${elseIfVariableArray[index]}) {`);

      if (cond.then) {
        const configs = this.createSubschemaOptions(
          trackingState,
          pathContext,
          `elseIf/${index}/then`,
          schema,
        );
        configs.pathContext.alt = `${pathContext.schema}/elseIf/${index}/then`;
        configs.pathContext.alt2 = undefined;
        const thenValidatorFn = this.compileSchema(
          cond.then,
          configs.pathContext,
          configs.trackingState,
          varName,
          extra,
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
    trackingState: TrackingState,
    extra: Extra,
  ): void {
    if (schema.type === "null") {
      src.push(
        `if (${extra.before}${varName} !== null) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "type",
            value: varName,
            message: '"Invalid type"',
            expected: '"null"',
          },
        )}${extra.after}}`,
      );
    }

    if (Array.isArray(schema.type)) {
      const typeChecks = schema.type
        .map((t) => this.generateTypeCheck(varName, t))
        .join(" || ");
      src.push(
        `if (${extra.before}!(${typeChecks})) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "type",
            value: varName,
            message: `"Invalid type. Must be ${schema.type.join(" or ")}"`,
            expected: JSON.stringify(schema.type.join(" or ")),
          },
        )}${extra.after}}`,
      );
    }
    const objectConditions =
      schema.required !== undefined ||
      schema.properties !== undefined ||
      schema.minProperties !== undefined ||
      schema.maxProperties !== undefined ||
      schema.dependentSchemas !== undefined ||
      schema.dependentRequired !== undefined ||
      schema.unevaluatedProperties !== undefined ||
      schema.additionalProperties !== undefined ||
      schema.patternProperties !== undefined ||
      schema.propertyNames !== undefined ||
      schema.dependencies !== undefined;
    const arrayConditions =
      schema.prefixItems !== undefined ||
      schema.items !== undefined ||
      schema.additionalItems !== undefined ||
      schema.contains !== undefined ||
      schema.unevaluatedItems !== undefined ||
      schema.minItems !== undefined ||
      schema.maxItems !== undefined ||
      schema.uniqueItems === true;
    this.handlePrimitive(src, schema, varName, pathContext, extra);

    if (
      (schema.type && schema.type === "object") ||
      (Array.isArray(schema.type) && schema.type.includes("object")) ||
      objectConditions
    ) {
      this.handleObject(
        src,
        schema as ObjectSchema,
        varName,
        pathContext,
        trackingState,
        objectConditions,
        extra,
      );
    }
    if (
      (schema.type && schema.type === "array") ||
      (Array.isArray(schema.type) && schema.type.includes("array")) ||
      arrayConditions
    ) {
      this.handleArray(
        src,
        schema as ArraySchema,
        varName,
        pathContext,
        trackingState,
        arrayConditions,
        extra,
      );
    }
  }

  private generateTypeCheck(varName: any, type: string): string {
    switch (type) {
      case "integer":
        return `(typeof ${varName} === "number" && Number.isInteger(${varName}))`;
      case "null":
        return `${varName} === null`;
      case "array":
        return `(Array.isArray(${varName}) && ${varName} !== null)`;
      case "object":
        return `(typeof ${varName} === 'object' && !Array.isArray(${varName}) && ${varName} !== null)`;
      case "number":
        return `(typeof ${varName} === "number" && Number.isFinite(${varName}))`;
      default:
        return `typeof ${varName} === "${type}"`;
    }
  }

  handlePrimitive(
    src: string[],
    schema: SchemaDefinition,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    if (typeof schema.type === "string" && PRIMITIVE_TYPES.has(schema.type)) {
      const checkType = schema.type;
      let check;
      let error;
      if (checkType === "number") {
        const strict = this.options.strict || this.options.strictNumbers;
        check = `typeof ${varName} !== "${checkType}" ${
          strict ? `|| !Number.isFinite(${varName})` : ""
        }`;
        error = `"Invalid type, must be number${
          strict
            ? ", value must be finite. NaN, Infinity or -Infinity is not allowed"
            : ""
        }"`;
      } else if (checkType === "integer") {
        check = `!Number.isInteger(${varName})`;
        error = '"Must be an integer or integer exceeds safe range"';
      } else {
        error = `"Invalid type, must be ${checkType}"`;
        check = `typeof ${varName} !== '${checkType}'`;
      }
      src.push(
        `if (${extra.before}${check}) {${this.buildErrorReturn(pathContext, {
          keyword: "type",
          value: varName,
          message: error,
          expected: JSON.stringify(schema.type),
        })}${extra.after}}`,
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
      schema.pattern !== undefined ||
      (schema.format !== undefined && this.options.validateFormats);
    if (schema.type === "string" && stringCondition) src.push("else{");
    if (schema.type !== "string" && stringCondition) {
      src.push(
        `if(${extra.before}${this.generateTypeCheck(varName, "string")}){`,
      );
    }
    if (
      !this.needslen_of &&
      (schema.minLength !== undefined || schema.maxLength !== undefined)
    )
      this.needslen_of = true;
    if (schema.minLength !== undefined) {
      this.handleMinLength(src, schema, varName, pathContext, extra);
    }

    if (schema.maxLength !== undefined) {
      this.handleMaxLength(src, schema, varName, pathContext, extra);
    }

    if (schema.pattern !== undefined) {
      this.handlePattern(src, schema, varName, pathContext, extra);
    }

    if (schema.format !== undefined && this.options.validateFormats === true) {
      this.handleFormat(src, schema, varName, pathContext, extra);
    }

    if (schema.type !== "string" && stringCondition) {
      src.push(`}`);
    }
    if (schema.type === "string" && stringCondition) src.push("}");

    if (schema.type === "number" && numberCondition) src.push("else{");
    if (schema.type !== "number" && numberCondition) {
      src.push(
        `if(${extra.before}${this.generateTypeCheck(varName, "number")}){`,
      );
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

    if (schema.type !== "number" && numberCondition) {
      src.push(`}`);
    }
    if (schema.type === "number" && numberCondition) src.push("}");

    if (schema.const !== undefined) {
      this.handleConst(src, schema, varName, pathContext, extra);
    }

    if (
      schema.enum &&
      ((Array.isArray(schema.enum) && schema.enum.length > 0) ||
        "$data" in schema.enum)
    ) {
      this.handleEnum(src, schema, varName, pathContext, extra);
    }
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
        pathContext.$data,
        this.refCall,
      );
      comparisonTarget = generateUndefinedDataRef(src, resolvedPath, extra);
    } else {
      comparisonTarget = JSON.stringify(schema.const);
    }

    if (isDataRef) {
      this.needsDeepEqual = true;
      src.push(
        `if (${extra.before}typeof ${comparisonTarget} === 'object' && ${comparisonTarget} !== null ? !deepEqual(${varName}, ${comparisonTarget}) : ${varName} !== ${comparisonTarget}) {`,
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
      this.buildErrorReturn(pathContext, {
        keyword: "const",
        value: varName,
        message: `"Value or type does not match " + ${comparisonTarget}`,
        expected: isDataRef
          ? comparisonTarget
          : typeof comparisonTarget === "boolean" ||
              typeof comparisonTarget === "number"
            ? comparisonTarget
            : JSON.stringify(comparisonTarget),
      }),
      extra.after,
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
        pathContext.$data,
        this.refCall,
      );
      comparisonTarget = generateNumberDataRef(src, resolvedPath, extra, true);
    } else {
      comparisonTarget = schema.minLength;
    }

    src.push(
      `if (${
        extra.before
      }len_of(${varName}) < ${comparisonTarget}) {${this.buildErrorReturn(
        pathContext,
        {
          keyword: "minLength",
          value: varName,
          message: `"Length of value must be at least " + ${comparisonTarget} + " characters."`,
          expected: comparisonTarget,
        },
      )}${extra.after}}`,
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
        pathContext.$data,
        this.refCall,
      );
      comparisonTarget = generateNumberDataRef(src, resolvedPath, extra, true);
    } else {
      comparisonTarget = schema.maxLength;
    }

    src.push(
      `if (${
        extra.before
      }len_of(${varName}) > ${comparisonTarget}) {${this.buildErrorReturn(
        pathContext,
        {
          keyword: "maxLength",
          value: varName,
          message: `"Length of value must be at most " + ${comparisonTarget} + " characters."`,
          expected: comparisonTarget,
        },
      )}${extra.after}}`,
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
        pathContext.$data,
        this.refCall,
      );
      comparisonTarget = generateNumberDataRef(src, resolvedPath, extra);
    } else {
      comparisonTarget = schema.minimum;
    }

    src.push(
      `if (${
        extra.before
      }${varName} < ${comparisonTarget}) {${this.buildErrorReturn(pathContext, {
        keyword: "minimum",
        value: varName,
        message: `"Value must be at least " + ${comparisonTarget}`,
        expected: comparisonTarget,
      })}${extra.after}}`,
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
        pathContext.$data,
        this.refCall,
      );
      comparisonTarget = generateNumberDataRef(src, resolvedPath, extra);
    } else {
      comparisonTarget = schema.maximum;
    }

    src.push(
      `if (${
        extra.before
      }${varName} > ${comparisonTarget}) {${this.buildErrorReturn(pathContext, {
        keyword: "maximum",
        value: varName,
        message: `"Value must be at most " + ${comparisonTarget}`,
        expected: comparisonTarget,
      })}${extra.after}}`,
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
        pathContext.$data,
        this.refCall,
      );
      comparisonTarget = generateNumberDataRef(src, resolvedPath, extra);
    } else {
      comparisonTarget = schema.exclusiveMinimum;
    }

    src.push(
      `if (${
        extra.before
      }${varName} <= ${comparisonTarget}) {${this.buildErrorReturn(
        pathContext,
        {
          keyword: "exclusiveMinimum",
          value: varName,
          message: `"Value must be at least "+(${comparisonTarget} + 1)`,
          expected: comparisonTarget,
        },
      )}${extra.after}}`,
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
        pathContext.$data,
        this.refCall,
      );
      comparisonTarget = generateNumberDataRef(src, resolvedPath, extra);
    } else {
      comparisonTarget = schema.exclusiveMaximum;
    }

    src.push(
      `if (${
        extra.before
      }${varName} >= ${comparisonTarget}) {${this.buildErrorReturn(
        pathContext,
        {
          keyword: "exclusiveMaximum",
          value: varName,
          message: `"Value must be at most "+(${comparisonTarget} - 1)`,
          expected: comparisonTarget,
        },
      )}${extra.after}}`,
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
        pathContext.$data,
        this.refCall,
      );
      comparisonTarget = generateNumberDataRef(src, resolvedPath, extra);
    } else {
      comparisonTarget = schema.multipleOf;
    }

    src.push(
      `const multipleOf = ${comparisonTarget};
      const quotient = ${varName} / multipleOf;
      const rounded = Math.round(quotient);
      const tolerance = Math.abs(quotient) * Number.EPSILON;
      if (${
        extra.before
      }multipleOf === 0 || !isFinite(quotient) || Math.abs(quotient - rounded) > tolerance) {${this.buildErrorReturn(
        pathContext,
        {
          keyword: "multipleOf",
          value: varName,
          message: `"Value must be a multiple of " + ${comparisonTarget}`,
          expected: comparisonTarget,
        },
      )}${extra.after}}`,
    );

    if (isDataRef) {
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
        pathContext.$data,
        this.refCall,
      );
      comparisonTarget = generateStringDataRef(src, resolvedPath, extra);
      src.push("try {");
      src.push(
        `if (${
          extra.before
        }!new RegExp(${comparisonTarget}, 'u').test(${varName})) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "pattern",
            value: varName,
            message: `"Value does not match the required pattern"`,
            expected: comparisonTarget,
          },
        )}${extra.after}}`,
      );
    } else {
      comparisonTarget = JSON.stringify(schema.pattern);
      let pname = this.regexCache.get(schema.pattern as string);
      if (!pname) {
        pname = "pattern" + counter++;
        this.regexCache.set(schema.pattern as string, pname);
      }
      src.push(
        `if (${
          extra.before
        }!${pname}.test(${varName})) {${this.buildErrorReturn(pathContext, {
          keyword: "pattern",
          value: varName,
          message: `"Value does not match the required pattern"`,
          expected: JSON.stringify(comparisonTarget),
        })}${extra.after}}`,
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
        pathContext.$data,
        this.refCall,
      );
      enumArrayExpr = generateArrayDataRef(src, resolvedPath, extra);
      enumCheckCloseExpr = "}";
    } else {
      if (!Array.isArray(schema.enum)) return;
      enumArrayExpr = JSON.stringify(schema.enum);
    }
    if (
      isDataRef ||
      (Array.isArray(schema.enum) &&
        schema.enum.length >= (this.options.loopEnum ?? 200))
    ) {
      this.needsStringify = true;
      src.push(
        `if (${extra.before}!${enumArrayExpr}.some(enumValue => typeof enumValue === 'object' && enumValue!== null ? canonicalStringify(${varName}) === canonicalStringify(enumValue) : enumValue === ${varName})) {`,
      );
    } else {
      const conditions = (schema.enum as any[]).map((enumValue) => {
        if (typeof enumValue === "object" && enumValue !== null) {
          this.needsStringify = true;
          return `(typeof ${varName} === 'object' && ${varName} !== null && canonicalStringify(${varName}) === canonicalStringify(${JSON.stringify(
            enumValue,
          )}))`;
        } else {
          return `${varName} === ${JSON.stringify(enumValue)}`;
        }
      });

      src.push(`if (${extra.before}!(${conditions.join(" || ")})) {`);
    }

    const expectedValue = isDataRef
      ? `${enumArrayExpr}`
      : JSON.stringify(schema.enum);

    src.push(
      this.buildErrorReturn(pathContext, {
        keyword: "enum",
        value: varName,
        message: '"Value must be one of the items listed in enum"',
        expected: expectedValue,
      }),
      extra.after,
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
        pathContext.$data,
        this.refCall,
      );
      const formatKeyVar = generateStringDataRef(src, resolvedPath, extra);

      if (this.standAlone) {
        src.push(`const formatValidator = formatValidators[${formatKeyVar}];`);
      } else {
        src.push(
          `const formatValidator = formatValidators[${formatKeyVar}].validate ?? formatValidators[${formatKeyVar}];`,
        );
      }

      src.push(
        `if (${extra.before}formatValidator && typeof ${varName} === 'string') {`,
        `  const isValid = typeof formatValidator === 'function' ? ${
          this.options.async ? "async" : ""
        }formatValidator(${varName}) : formatValidator.test(${varName});`,
        `  if (!isValid) {${this.buildErrorReturn(pathContext, {
          keyword: "format",
          value: varName,
          message: `"Failed to validate value against format "+${formatKeyVar}`,
          expected: `${formatKeyVar}`,
        })}}${extra.after}}}`,
      );
    } else {
      const data = this.jetValidator.getFormat(schema.format as string);
      if (!data) {
        throw new Error(`Format '${schema.format}' not found`);
      }

      const format =
        typeof data === "object" && "validate" in data ? data.validate : data;
      const formatType =
        typeof data === "object" &&
        !Array.isArray(data) &&
        !(data instanceof RegExp) &&
        data.type
          ? data.type
          : "string";
      const formatKey = schema.format as string;

      let testCode;
      let formatRef;

      if (typeof format === "function") {
        formatRef = this.standAlone
          ? `format_${formatKey.replace(/[^a-zA-Z0-9]/g, "_")}`
          : `formatValidators['${formatKey}']`;

        testCode =
          this.options.async && typeof data === "object" && "async" in data
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
            .map((t) => this.generateTypeCheck(varName, t))
            .join(" || ")})`
        : `typeof ${varName} === '${formatType}'`;

      src.push(
        `if (${
          extra.before
        }${typeCheck} && ${testCode}) {${this.buildErrorReturn(pathContext, {
          keyword: "format",
          value: varName,
          message: `"Failed to validate value against format ${schema.format}"`,
          expected: `"${schema.format as string}"`,
        })}${extra.after}}`,
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
    if (schema.type === "object") {
      src.push(
        `if (${
          extra.before
        }(!${varName} || typeof ${varName} != 'object' || Array.isArray(${varName}))) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "type",
            value: varName,
            message: '"Invalid type, expected object"',
            expected: '"object"',
          },
        )}${extra.after}}`,
      );
    }

    if (schema.type === "object" && condition) src.push("else{");

    if (schema.type !== "object" && condition) {
      src.push(
        `if (${extra.before}${varName} && typeof ${varName} == 'object' && !Array.isArray(${varName})) {`,
      );
    }

    if (schema.required !== undefined) {
      this.handleRequiredProperties(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
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
      schema.minProperties !== undefined ||
      schema.maxProperties !== undefined
    ) {
      this.handlePropertyConstraints(src, schema, varName, pathContext, extra);
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

    if (schema.propertyNames !== undefined) {
      this.handlePropertyNames(src, schema, varName, pathContext, extra);
    }

    if (schema.additionalProperties !== undefined) {
      this.handleAdditionalProperties(
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
    if (schema.unevaluatedProperties !== undefined) {
      this.handleUnevaluatedProperties(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (schema.type !== "object" && condition) {
      src.push(`}`);
    }
    if (schema.type === "object" && condition) src.push("}");
  }

  handleRequiredProperties(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    trackingState: TrackingState,
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
        pathContext.$data,
        this.refCall,
      );
      const requiredArrayExpr = generateArrayDataRef(src, resolvedPath, extra);
      src.push(`if (${extra.before}${requiredArrayExpr}) {`);
      src.push(`for (let i = 0; i < ${requiredArrayExpr}.length; i++) {`);
      src.push(`const prop = ${requiredArrayExpr}[i];`);
      addEvaluatedProperty(src, "prop", trackingState);

      src.push(
        `if (${
          extra.before
        }${varName}[prop] === undefined) {${this.buildErrorReturn(pathContext, {
          keyword: "required",
          value: varName,
          message: `"Missing required field: " + prop + " in data."`,
          expected: "prop",
          schemaPath: `${pathContext.schema}`,
        })}${extra.after}}`,
      );

      src.push(`}`);
      src.push(`}`);
      src.push("}");
    } else {
      const required = Array.isArray(schema.required) ? schema.required : [];
      if (required.length === 0) return;

      if (Array.isArray(schema.required)) {
        if (
          this.options.allErrors ||
          schema.required.length > this.options.loopRequired!
        ) {
          const arr = JSON.stringify(schema.required);
          const arrVar = `arr${src.length}${counter++}`;
          const iVar = `i${src.length}${counter++}`;
          src.push(`const ${arrVar} = ${arr};`);
          if (extra.before != "") src.push(`if(${extra.before} true){`);
          src.push(
            `for (let ${iVar} = 0; ${iVar} < ${arrVar}.length; ${iVar}++) {`,
          );
          src.push(`const prop = ${arrVar}[${iVar}];`);

          addEvaluatedProperty(src, "prop", trackingState);

          src.push(
            `if (${
              extra.before
            }${varName}[prop] === undefined) {${this.buildErrorReturn(
              pathContext,
              {
                keyword: "required",
                value: varName,
                message: `"Missing required field: " + prop + " in data."`,
                expected: "prop",
                schemaPath: `${pathContext.schema}`,
              },
            )}${extra.after}}`,
          );

          src.push(`}`);
          if (extra.before != "") src.push(`}`);
        } else {
          const missing = "missing" + counter++;
          src.push(`let ${missing};`);
          const stringReq = JSON.stringify(schema.required);
          src.push(
            `if(${extra.before}(${schema.required
              .map((prop) => {
                const stringified = JSON.stringify(prop);
                return `(${varName}[${stringified}] === undefined &&(${missing} = ${stringified}))`;
              })
              .join(" || ")})){${
              trackingState.shouldTrackEvaluatedProperties
                ? trackingState.hasOwnUnevaluatedProperties &&
                  trackingState.parentHasUnevaluatedProperties
                  ? `${trackingState.unEvaluatedPropertiesSetVar}.forEach(set => { set?.add(${missing}); });`
                  : `${trackingState.unevaluatedPropVar}?.add(${missing});`
                : ""
            }${this.buildErrorReturn(pathContext, {
              keyword: "required",
              value: varName,
              message: `"Missing required field: " + ${missing} + " in data"`,
              expected: missing,
              schemaPath: `${pathContext.schema}`,
            })}${extra.after}};`,
          );
          if (trackingState.shouldTrackEvaluatedProperties) {
            src.push(`for (const k of ${stringReq}){`);
            addEvaluatedProperty(src, "k", trackingState);
            src.push("}");
          }
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
    src.push(`for (const key in ${varName}) {`);

    Object.getOwnPropertyNames(schema.patternProperties).forEach((pattern) => {
      let pname = this.regexCache.get(pattern);
      if (!pname) {
        pname = "patternProp" + counter++;
        this.regexCache.set(pattern, pname);
      }
      src.push(`if (${pname}.test(key)) {`);
      addEvaluatedProperty(src, "key", trackingState);
      const parent =
        trackingState.parentHasUnevaluatedProperties ||
        trackingState.hasOwnUnevaluatedProperties;
      const patternValidation = this.compileSchema(
        schema.patternProperties![pattern],
        {
          schema: `${pathContext.schema}/patternProperties/${JSON.stringify(pattern)}`,
          data: `${pathContext.data}/\${key}`,
          $data: `${pathContext.$data}/\${key}`,
          alt: pathContext.alt,
          alt2: pathContext.alt2,
        },
        {
          isSubschema: true,
          parentHasUnevaluatedProperties: parent,
          parentUnevaluatedPropVar: parent
            ? trackingState.unevaluatedPropVar
            : undefined,
        },
        `${varName}[key]`,
        extra,
      );

      src.push(patternValidation, "}");
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
    const { allowedProperties, patternProperties } =
      this.collectAllAllowedProperties(schema);
    const explicitProps = Array.from(allowedProperties);
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    src.push(`for (const key in ${varName}) {`);

    addEvaluatedProperty(src, "key", trackingState);
    let checks = [];
    if (explicitProps.length > 0) {
      const allowedCheck = explicitProps
        .map((key) => `key === ${JSON.stringify(key)}`)
        .join(" || ");
      checks.push(allowedCheck);
    }
    if (patternProperties.length > 0) {
      const patternCheck = patternProperties
        .map((pattern) => {
          let pname = this.regexCache.get(pattern);
          if (!pname) {
            pname = "patternProp" + counter++;
            this.regexCache.set(pattern, pname);
          }
          return `${pname}.test(key)`;
        })
        .join(" || ");
      checks.push(patternCheck);
    }
    if (checks.length > 0) {
      const condition = checks.join(" || ");
      src.push(`if (${condition}) continue;`);
    }
    const additionalPropValidation = this.compileSchema(
      schema.additionalProperties!,
      {
        schema: `${pathContext.schema}/additionalProperties`,
        data: `${pathContext.data}/\${key}`,
        $data: `${pathContext.$data}/\${key}`,
        alt: pathContext.alt,
        alt2: pathContext.alt2,
      },
      {},
      `${varName}[key]`,
      extra,
    );

    src.push(additionalPropValidation, "}");
    if (extra.before != "") src.push(`}`);
  }

  handlePropertyConstraints(
    src: string[],
    schema: ObjectSchema,
    varName: string,
    pathContext: PathContext,
    extra: Extra,
  ): void {
    src.push(`const objKeys = Object.keys(${varName});`);

    if (schema.minProperties !== undefined) {
      const isDataRef =
        this.options.$data && isDataReference(schema.minProperties);
      let comparisonTarget;

      if (isDataRef && typeof schema.minProperties === "object") {
        const pointer = schema.minProperties.$data;
        const resolvedPath = resolveDataPointerAtCompileTime(
          pointer,
          pathContext.$data,
          this.refCall,
        );
        comparisonTarget = generateNumberDataRef(
          src,
          resolvedPath,
          extra,
          true,
        );
      } else {
        comparisonTarget = schema.minProperties;
      }

      src.push(
        `if (${
          extra.before
        }objKeys.length < ${comparisonTarget}) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "minProperties",
            value: "objKeys.length",
            message: `"Object must have at least " + ${comparisonTarget} + " properties."`,
            expected: comparisonTarget as string,
          },
        )}${extra.after}}`,
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
          pathContext.$data,
          this.refCall,
        );
        comparisonTarget = generateNumberDataRef(
          src,
          resolvedPath,
          extra,
          true,
        );
      } else {
        comparisonTarget = schema.maxProperties;
      }

      src.push(
        `if (${
          extra.before
        }objKeys.length > ${comparisonTarget}) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "maxProperties",
            value: "objKeys.length",
            message: `"Object must have at most " + ${comparisonTarget} + " properties."`,
            expected: comparisonTarget as string,
          },
        )}${extra.after}}`,
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
    src.push(`for (const key in ${varName}) {`);

    const propertyNameValidation = this.compileSchema(
      schema.propertyNames!,
      {
        schema: `${pathContext.schema}/propertyNames`,
        data: `${pathContext.data}/\${key}`,
        $data: `${pathContext.$data}/\${key}`,
        alt: pathContext.alt,
        alt2: pathContext.alt2,
      },
      {},
      `key`,
      extra,
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
          trackingState,
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
    trackingState: TrackingState,
    extra: Extra,
    requiredSource: "dependencies" | "dependentRequired",
  ): void {
    for (let i = 0; i < requiredFields.length; i++) {
      const field = requiredFields[i];
      const stringifiedField = JSON.stringify(field);
      addEvaluatedProperty(src, stringifiedField, trackingState);
      const currentSchemaPath = pathContext.schema;
      pathContext.schema = `${pathContext.schema}/${requiredSource}/${triggerProperty}/`;

      src.push(
        `if (${
          extra.before
        }${varName}[${stringifiedField}] === undefined) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: requiredSource,
            value: varName,
            message: `"Property (" + ${stringifiedField} + ") is required when " + ${JSON.stringify(
              triggerProperty,
            )} + " is present."`,
            dataPath: `${pathContext.data}/${field}`,
            schemaPath: `${currentSchemaPath}/${requiredSource}/${triggerProperty}`,
          },
        )}${extra.after}}`,
      );
      pathContext.schema = currentSchemaPath;
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
      `${requiredSource}/${property}`,
      rootSchema,
    );
    const depValidatorFn = this.compileSchema(
      depSchema,
      configs.pathContext,
      configs.trackingState,
      varName,
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
    const dependentSchemasProps = new Set<string>();

    if (schema.dependentSchemas !== undefined) {
      for (const key of Object.getOwnPropertyNames(schema.dependentSchemas)) {
        const depProperties =
          (schema.dependentSchemas[key] as SchemaDefinition)?.properties || {};
        for (const propName in depProperties) {
          dependentSchemasProps.add(propName);
        }
      }
    }

    if (this.options.removeAdditional) {
      const newObjName = "newObj" + counter++;
      src.push(
        `const ${newObjName} = {};`,
        `${JSON.stringify(propertyKeys)}.forEach(prop => {`,
        `if (${varName}[prop] !== undefined) {`,
        `${newObjName}[prop] = ${varName}[prop];`,
        `}`,
        `});`,
        `${varName} = ${newObjName};`,
      );
    }
    for (const key of propertyKeys) {
      const stringified = JSON.stringify(key);
      if (dependentSchemasProps.has(key)) continue;

      src.push(
        `if (${extra.before}${varName}[${stringified}] !== undefined) {`,
      );
      addEvaluatedProperty(src, stringified, trackingState);

      if (properties[key] !== undefined) {
        const configs = this.createSubschemaOptions(
          trackingState,
          pathContext,
          `properties/${key}`,
          schema,
          `/${key}`,
        );
        const propertyValidation = this.compileSchema(
          properties[key],
          configs.pathContext,
          configs.trackingState,
          `${varName}[${stringified}]`,
          extra,
        );
        src.push(propertyValidation);
      }

      src.push("}");
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
    const unName = "unevaluatedProp" + counter++;
    const evalSet = trackingState.unevaluatedPropVar!;
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    src.push(
      `const ${unName} = [];`,
      `for (const key in ${varName}) {`,
      `if (!${evalSet}.has(key)) {`,
      `${unName}.push(key);`,
      `}`,
      `}`,
    );

    if (schema.unevaluatedProperties === false) {
      src.push(
        `if (${unName}.length > 0) {${this.buildErrorReturn(pathContext, {
          keyword: "unevaluatedProperties",
          value: varName,
          message: `"Unevaluated properties: [" + ${unName} + "] in schema."`,
          expected: '"All properties to be evaluated"',
          dataPath: pathContext.data,
          schemaPath: `${pathContext.schema}/unevaluatedProperties`,
        })}${extra.after}}`,
      );
    } else if (schema.unevaluatedProperties === true) {
      if (trackingState.parentHasUnevaluatedProperties) {
        src.push(
          `for(const key in ${varName}){${trackingState.parentUnevaluatedPropVar}.add(key)}`,
        );
      }
    } else {
      const unKeyName = "unKey" + counter++;
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        ``,
        schema,
        ``,
      );
      const unpValidatorFn = this.compileSchema(
        schema.unevaluatedProperties!,
        {
          data: `${pathContext.data}/\${${unKeyName}}`,
          $data: `${pathContext.$data}/\${${unKeyName}}`,
          schema: `${pathContext.schema}/unevaluatedProperties/\${${unKeyName}}`,
          alt: pathContext.alt,
          alt2: pathContext.alt2,
        },
        configs.trackingState,
        `${varName}[${unKeyName}]`,
        extra,
      );

      src.push(`for(const ${unKeyName} of ${unName}) {`);
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
    if (schema.type === "array") {
      src.push(
        `if (${
          extra.before
        }(!Array.isArray(${varName}) || ${varName} === null)) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "type",
            value: varName,
            message: '"Invalid type, expected array"',
            expected: '"array"',
          },
        )}${extra.after}}`,
      );
    }
    if (schema.type === "array" && condition) src.push("else{");
    if (schema.type !== "array" && condition) {
      src.push(`if(${extra.before}Array.isArray(${varName})){`);
    }

    if (
      schema.minItems !== undefined ||
      schema.maxItems !== undefined ||
      schema.uniqueItems === true
    ) {
      this.handleArrayConstraints(src, schema, varName, pathContext, extra);
    }

    if (
      schema.prefixItems !== undefined ||
      schema.items !== undefined ||
      schema.additionalItems !== undefined
    ) {
      this.handleArrayItems(
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

    if (
      schema.unevaluatedItems !== undefined &&
      schema.additionalItems !== true &&
      schema.items !== true
    ) {
      this.handleUnevaluatedItems(
        src,
        schema,
        varName,
        pathContext,
        trackingState,
        extra,
      );
    }

    if (schema.type !== "array" && condition) {
      src.push(`}`);
    }
    if (schema.type === "array" && condition) src.push("}");
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
          pathContext.$data,
          this.refCall,
        );
        comparisonTarget = generateNumberDataRef(
          src,
          resolvedPath,
          extra,
          true,
        );
      } else {
        comparisonTarget = schema.minItems;
      }

      src.push(
        `if (${
          extra.before
        }${varName}.length < ${comparisonTarget}) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "minItems",
            value: `${varName}.length`,
            message: `"Array must have at least " +${comparisonTarget}+" items"`,
            expected: comparisonTarget as string,
          },
        )}${extra.after}}`,
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
          pathContext.$data,
          this.refCall,
        );
        comparisonTarget = generateNumberDataRef(
          src,
          resolvedPath,
          extra,
          true,
        );
      } else {
        comparisonTarget = schema.maxItems;
      }

      src.push(
        `if (${
          extra.before
        }${varName}.length > ${comparisonTarget}) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "maxItems",
            value: `${varName}.length`,
            message: `"Array must have at most " + ${comparisonTarget} + " items"`,
            expected: comparisonTarget as string,
          },
        )}${extra.after}}`,
      );

      if (isDataRef) {
        src.push("}");
      }
    }

    const isDataRef = this.options.$data && isDataReference(schema.uniqueItems);
    if (schema.uniqueItems === true || isDataRef) {
      let comparisonTarget;
      this.needsStringify = true;
      if (isDataRef && typeof schema.uniqueItems === "object") {
        comparisonTarget = "$data" + counter++;
        const pointer = schema.uniqueItems.$data;
        const resolvedPath = resolveDataPointerAtCompileTime(
          pointer,
          pathContext.$data,
          this.refCall,
        );
        src.push(
          `const ${comparisonTarget} = ${resolvedPath};`,
          `if (${comparisonTarget} === true) {`,
        );
      } else {
        comparisonTarget = schema.uniqueItems;
      }

      const unique = "unique" + counter++;
      if (extra.before != "" && !isDataRef)
        src.push(`if(${extra.before} true){`);
      src.push(
        `const ${unique}_uniqueValues = new Set();let ${unique}_hasDuplicates = false;for (let ${unique} = 0; ${unique} < ${varName}.length; ${unique}++) {const itemStr = typeof  ${varName}[${unique}] == 'object' ? canonicalStringify(${varName}[${unique}]) : '"'+${varName}[${unique}]+'"';if (${unique}_uniqueValues.has(itemStr)) {
        ${unique}_hasDuplicates = true;break;};${unique}_uniqueValues.add(itemStr);}if (${unique}_hasDuplicates) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "uniqueItems",
            value: varName,
            message: '"Array items must be unique"',
            expected: '"unique values"',
          },
        )}${extra.after}}`,
      );
      if (extra.before != "" && !isDataRef) src.push(`}`);
      if (isDataRef) {
        src.push("}");
      }
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
      ischema.forEach((itemSchema, index) => {
        src.push(`if (${extra.before}${varName}.length > ${index}) {`);
        addEvaluatedItems(src, index, trackingState);
        const parent =
          trackingState.hasOwnUnevaluatedItems ||
          trackingState.parentHasUnevaluatedItems;
        const itemValidation = this.compileSchema(
          itemSchema,
          {
            schema: `${pathContext.schema}/${
              schema.prefixItems !== undefined ? "prefixItems" : "items"
            }/${index}`,
            alt: `${pathContext.schema}/${
              schema.prefixItems !== undefined ? "prefixItems" : "items"
            }/${index}`,
            alt2: `${pathContext.schema}/${
              schema.prefixItems !== undefined ? "prefixItems" : "items"
            }`,
            data: `${pathContext.data}/${index}`,
            $data: `${pathContext.$data}/${index}`,
          },
          {
            isSubschema: true,
            parentHasUnevaluatedItems: parent,
            parentUnevaluatedItemVar: parent
              ? trackingState.unevaluatedItemVar
              : undefined,
          },
          `${varName}[${index}]`,
          extra,
        );
        src.push(itemValidation, "}");
      });
    }

    if (Array.isArray(schema.items)) {
      if (schema.additionalItems === false) {
        src.push(
          `if (${extra.before}${varName}.length > ${
            schema.items.length
          }) {${this.buildErrorReturn(pathContext, {
            keyword: "additionalItems",
            value: `${varName}.length`,
            message: `"Array has too many items. Expected at most ${schema.items.length}"`,
            expected: schema.items.length as any as string,
          })}${extra.after}}`,
        );
      } else if (
        schema.additionalItems &&
        typeof schema.additionalItems === "object"
      ) {
        const itemValidator = "i" + counter++;
        src.push(
          `for (let ${itemValidator} = ${schema.items.length}; ${itemValidator} < ${varName}.length; ${itemValidator}++) {`,
        );
        addEvaluatedItems(src, itemValidator, trackingState);

        const additionalValidation = this.compileSchema(
          schema.additionalItems,
          {
            schema: `${pathContext.schema}/additionalItems/\${${itemValidator}}`,
            data: `${pathContext.data}/\${${itemValidator}}`,
            $data: `${pathContext.$data}/\${${itemValidator}}`,
            alt: pathContext.alt,
            alt2: pathContext.alt2,
          },
          {},
          `${varName}[${itemValidator}]`,
          extra,
        );
        src.push(additionalValidation, "}");
      } else if (
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

    if (
      !Array.isArray(schema.items) &&
      schema.items !== undefined &&
      schema.items !== true
    ) {
      const itemValidator = "i" + counter++;
      src.push(`const len${itemValidator} = ${varName}.length;`);

      if (schema.prefixItems !== undefined && schema.prefixItems.length > 0) {
        if (schema.items === false) {
          src.push(
            `if (${extra.before}len${itemValidator} > ${
              schema.prefixItems.length
            }) {${this.buildErrorReturn(pathContext, {
              keyword: "items",
              value: `${varName}.length`,
              message: `"Array has too many items. Expected at most ${schema.prefixItems.length}."`,
              expected: String(schema.prefixItems.length),
            })}${extra.after}}`,
          );
        } else {
          if (extra.before != "") src.push(`if(${extra.before} true){`);
          src.push(
            `for (let ${itemValidator} = ${schema.prefixItems.length}; ${itemValidator} < len${itemValidator}; ${itemValidator}++) {`,
          );
        }
      } else {
        if (extra.before != "") src.push(`if(${extra.before} true){`);
        src.push(
          `for (let ${itemValidator} = 0; ${itemValidator} < len${itemValidator}; ${itemValidator}++) {`,
        );
      }

      addEvaluatedItems(src, itemValidator, trackingState);

      if (
        schema.prefixItems === undefined ||
        schema.prefixItems.length < 1 ||
        (schema.items !== undefined && typeof schema.items !== "boolean")
      ) {
        const itemValidation = this.compileSchema(
          schema.items as BaseSchema,
          {
            schema: `${pathContext.schema}/items`,
            data: `${pathContext.data}/\${${itemValidator}}`,
            $data: `${pathContext.$data}/\${${itemValidator}}`,
            alt: pathContext.alt,
            alt2: pathContext.alt2,
          },
          {},
          `${varName}[${itemValidator}]`,
          extra,
        );
        src.push(itemValidation, "};");
      }
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
    const containsValid = "containsValid" + counter++;
    const containsCount = "containsCount" + counter++;
    const conValid = `conValid${counter++}`;
    const i = "i" + counter++;
    const originalNotLogic = this.notLogic;
    this.notLogic = true;
    const containsValidation = this.compileSchema(
      schema.contains!,
      undefined,
      undefined,
      `${varName}[${i}]`,
      {
        before: `${conValid} && `,
        after: `${conValid} = false;`,
      },
    );
    this.notLogic = originalNotLogic;

    const hasMinMax =
      schema.maxContains !== undefined || schema.minContains !== undefined;

    src.push(
      hasMinMax ? `let ${containsCount} = 0;` : `let ${containsValid} = false;`,
    );

    src.push(
      `for (let ${i} = 0; ${i} < ${varName}.length; ${i}++) {`,
      `let ${conValid} = true;`,
      containsValidation,
      `if (${conValid}) {`,
    );

    addEvaluatedItems(src, i, trackingState);

    if (hasMinMax) {
      src.push(`${containsCount}++;`);
      if (schema.maxContains !== undefined) {
        src.push(`if (${containsCount} > ${schema.maxContains}) break;`);
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
      if (schema.minContains === undefined) schema.minItems = 0;
      if (schema.minContains !== undefined) {
        const isDataRef =
          this.options.$data && isDataReference(schema.minContains);
        let comparisonTarget;

        if (isDataRef && typeof schema.minContains === "object") {
          const pointer = schema.minContains.$data;
          const resolvedPath = resolveDataPointerAtCompileTime(
            pointer,
            pathContext.$data,
            this.refCall,
          );
          comparisonTarget = generateNumberDataRef(
            src,
            resolvedPath,
            extra,
            true,
          );
        } else {
          comparisonTarget = schema.minContains;
        }

        src.push(
          `if (${extra.before}${containsCount} < ${
            comparisonTarget ?? 1
          }) {${this.buildErrorReturn(pathContext, {
            keyword: "minContains",
            value: varName,
            message: `"Array must contain at least " + ${comparisonTarget} + " item matching the schema."`,
            expected: comparisonTarget as string,
          })}${extra.after}}`,
        );
      }

      if (schema.maxContains !== undefined) {
        const isDataRef =
          this.options.$data && isDataReference(schema.maxContains);
        let comparisonTarget;

        if (isDataRef && typeof schema.maxContains === "object") {
          const pointer = schema.maxContains.$data;
          const resolvedPath = resolveDataPointerAtCompileTime(
            pointer,
            pathContext.$data,
            this.refCall,
          );
          comparisonTarget = generateNumberDataRef(
            src,
            resolvedPath,
            extra,
            true,
          );
        } else {
          comparisonTarget = schema.maxContains;
        }

        const condition =
          schema.minContains === 0
            ? `${containsCount} > ${comparisonTarget}`
            : `(${containsCount} > ${comparisonTarget} || ${varName}.length < 1)`;

        src.push(
          `if (${extra.before}${condition}) {${this.buildErrorReturn(
            pathContext,
            {
              keyword: "maxContains",
              value: varName,
              message: `"Array must contain at most " + ${comparisonTarget} + " item matching the schema."`,
              expected: comparisonTarget as string,
            },
          )}${extra.after}}`,
        );
      }
    } else {
      src.push(
        `if (${extra.before}!${containsValid}) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "contains",
            value: varName,
            message:
              '"Array must contain at least one item matching the schema"',
          },
        )}${extra.after}}`,
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
    const unName = "unevaluatedItn" + counter++;
    const evalSet = trackingState.unevaluatedItemVar!;
    if (extra.before != "") src.push(`if(${extra.before} true){`);
    src.push(
      `const ${unName} = [];`,
      `for (let i = 0; i < ${varName}.length; i++) {`,
      `if (!${evalSet}.has(i)) {`,
      `${unName}.push(i);`,
      `}`,
      `}`,
    );

    if (schema.unevaluatedItems === false) {
      src.push(
        `if (${extra.before}${unName}.length > 0) {${this.buildErrorReturn(
          pathContext,
          {
            keyword: "unevaluatedItems",
            value: varName,
            message: `"Unevaluated items: [" + ${unName} + "] in schema, in array."`,
            expected: '"All items to be evaluated"',
            dataPath: pathContext.data,
            schemaPath: `${pathContext.schema}/unevaluatedItems`,
          },
        )}${extra.after}}`,
      );
    } else if (schema.unevaluatedItems === true) {
      if (trackingState.parentHasUnevaluatedItems) {
        src.push(
          `${varName}.forEach((_, index) => ${trackingState.parentUnevaluatedItemVar}.add(index));`,
        );
      }
    } else {
      const unKeyName = "unKey" + counter++;
      const configs = this.createSubschemaOptions(
        trackingState,
        pathContext,
        ``,
        schema,
        ``,
      );
      const unpValidatorFn = this.compileSchema(
        schema.unevaluatedItems!,
        {
          data: `${pathContext.data}/\${${unKeyName}}`,
          $data: `${pathContext.$data}/\${${unKeyName}}`,
          schema: `${pathContext.schema}/unevaluatedItems/\${${unKeyName}}`,
          alt: pathContext.alt,
          alt2: pathContext.alt2,
        },
        configs.trackingState,
        `${varName}[${unKeyName}]`,
        extra,
      );

      src.push(`for(const ${unKeyName} of ${unName}) {`, unpValidatorFn);

      if (trackingState.parentHasUnevaluatedProperties) {
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
    spreads?: string,
  ): string {
    if (this.notLogic) return "";
    if (this.neutralError) return "return false;";
    let result = this.options.allErrors
      ? `${this.errorVariable}.push({`
      : `${this.mainFunctionName}.errors = [{`;

    const escapedDataPath = escapeTemplateString(
      error.dataPath || pathContext.data || "/",
    );
    const escapedSchemaPath = escapeTemplateString(
      error.schemaPath ?? pathContext.schema,
    );

    result += `dataPath: \`${escapedDataPath}\`,`;
    result += `schemaPath: \`${escapedSchemaPath}\`,`;
    result += `keyword: "${error.keyword}",`;

    if (this.options.verbose) {
      result += `value: ${error.value},`;
      if (error.expected) {
        result += `expected: ${error.expected},`;
      }
    }

    let errorMessage;
    if (this.options.errorMessage && typeof this.schema !== "boolean") {
      let schemaAtPath = getSchemaAtPath(this.schema, pathContext.schema);

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
      if (pathContext.alt && !errorMessage) {
        schemaAtPath = getSchemaAtPath(this.schema, pathContext.alt);
        if (
          typeof schemaAtPath === "object" &&
          "errorMessage" in schemaAtPath
        ) {
          let presentAtPath = schemaAtPath.errorMessage;
          if (typeof schemaAtPath.errorMessage === "object") {
            const errorPath =
              "#" + pathContext.schema.replace(pathContext.alt, "");
            presentAtPath = getSchemaAtPath(
              schemaAtPath.errorMessage,
              errorPath,
            ) as any;
          }

          if (typeof presentAtPath === "string") {
            errorMessage = presentAtPath;
          } else if (typeof presentAtPath === "object") {
            errorMessage = presentAtPath[error.keyword];
            if (!errorMessage) errorMessage = presentAtPath["_jetError"];
          }
        }
      }

      if (this.schema.errorMessage && !errorMessage) {
        const rootErrorMessage = this.schema.errorMessage;
        if (typeof rootErrorMessage === "string") {
          errorMessage = rootErrorMessage;
        } else if (typeof rootErrorMessage === "object") {
          let errorAtPath = getSchemaAtPath(
            rootErrorMessage,
            pathContext.schema,
          );
          if (
            typeof errorAtPath === "object" &&
            Object.keys(errorAtPath).length === 0 &&
            pathContext.alt
          ) {
            errorAtPath = getSchemaAtPath(rootErrorMessage, pathContext.alt);
          }

          if (
            typeof errorAtPath === "object" &&
            Object.keys(errorAtPath).length === 0 &&
            pathContext.alt2
          ) {
            errorAtPath = getSchemaAtPath(rootErrorMessage, pathContext.alt2);
          }
          if (typeof errorAtPath === "string") {
            errorMessage = errorAtPath;
          } else if (typeof errorAtPath === "object") {
            errorMessage = errorAtPath[error.keyword];
            if (!errorMessage) errorMessage = errorAtPath["_jetError"];
          }
        }
      }
    }

    result += `message: ${JSON.stringify(errorMessage) || error.message}`;

    if (spreads) {
      result += `,${spreads}`;
    }

    result += "}";

    if (this.options.allErrors) {
      result += ");";
    } else {
      result += "];";
      if (!this.noreturn) result += "return false;";
    }

    return result;
  }
}
