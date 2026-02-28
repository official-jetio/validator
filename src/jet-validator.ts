import { Compiler } from "./compileSchema";
import { FAST_FORMAT_VALIDATORS, FULL_FORMAT_VALIDATORS } from "./formats";
import { SchemaResolver } from "./resolver";
import { SchemaDefinition } from "./types/schema";
import {
  ErrorAttachedValidatorFn,
  ValidationResult,
  ValidatorOptions,
} from "./types/validation";
import {
  CodeKeywordDefinition,
  CompiledValidateFunction,
  CompileKeywordDefinition,
  KeywordDefinition,
  MacroKeywordDefinition,
  ValidateFunction,
  ValidateKeywordDefinition,
} from "./types/keywords";
import { FormatDefinition } from "./types/format";
import { canonicalStringify, deepEqual, len_of } from "./utilities";
import { baseSchemaKeys } from "./utilities/schema";

export class JetValidator {
  private schemas: Record<string, SchemaDefinition> = {};
  private metaSchemas: Record<string, SchemaDefinition> = {};
  private customKeywords: Map<string, KeywordDefinition> = new Map();
  private formatValidators: Record<string, FormatDefinition>;
  private hasMacros: boolean = false;
  private compilationCache: Map<object | string, ErrorAttachedValidatorFn>;
  options: Required<ValidatorOptions>;
  private counter: number = 0;
  private aliases: Record<string, string> = {
    "draft-06": "https://json-schema.org/draft-06/schema",
    "draft-07": "https://json-schema.org/draft-07/schema",
    "draft/2019-09": "https://json-schema.org/draft/2019-09/schema",
    "draft/2020-12": "https://json-schema.org/draft/2020-12/schema",
  };
  constructor(options: ValidatorOptions = {}) {
    this.options = {
      allErrors: options.allErrors ?? false,
      inlineRefs: options.inlineRefs ?? true,
      overwrittenFormats: options.overwrittenFormats ?? [],
      verbose: options.verbose ?? false,
      debug: options.debug ?? false,
      logFunction: options.logFunction ?? false,
      strict: options.strict ?? true,
      metaSchema: options.metaSchema ?? "",
      draft: options.draft ?? "draft2019-09",
      validateFormats: options.validateFormats ?? true,
      formatMode: options.formatMode ?? "full",
      loopEnum: options.loopEnum ?? 200,
      loopRequired: options.loopRequired ?? 200,
      formats: options.formats ?? [],
      loadSchema:
        options.loadSchema ??
        (() => {
          throw new Error("loadSchema not provided");
        }),
      allowFormatOverride: options.allowFormatOverride ?? false,
      $data: options.$data ?? false,
      removeAdditional: options.removeAdditional ?? false,
      useDefaults: options.useDefaults ?? false,
      coerceTypes: options.coerceTypes ?? false,
      cache: options.cache ?? true,
      strictSchema: options.strictSchema ?? false,
      strictNumbers: options.strictNumbers ?? false,
      strictRequired: options.strictRequired ?? false,
      strictTypes: options.strictTypes ?? false,
      async: options.async ?? false,
      validateSchema: options.validateSchema ?? false,
      addUsedSchema: options.addUsedSchema ?? true,
      errorMessage: options.errorMessage ?? false,
    };
    if (this.options.formatMode !== false) {
      this.formatValidators =
        this.options.formatMode === "full"
          ? { ...FULL_FORMAT_VALIDATORS }
          : { ...FAST_FORMAT_VALIDATORS };
    } else {
      this.formatValidators = {};
    }
    this.compilationCache = new Map();
  }

  //#region
  addFormat(
    key: string,
    validator: FormatDefinition,
    options?: { override?: boolean },
  ): void {
    const shouldOverride =
      options?.override ?? this.options.allowFormatOverride;
    if (!shouldOverride && key in this.formatValidators)
      throw Error(
        `Format "${key}" is already registered, call removeFormat("${key}") before Attempting to add.`,
      );
    this.formatValidators[key] = validator;
  }

  removeFormat(key: string): void {
    if (!(key in this.formatValidators)) {
      throw new Error(`Format "${key}" is not registered.`);
    }
    delete this.formatValidators[key];
  }

  getFormat(format: string): FormatDefinition | undefined {
    return this.formatValidators[format];
  }

  testFormat(value: string, format: string): boolean | Promise<boolean> {
    const validator = this.formatValidators[format];
    if (!validator) return true;

    if (validator instanceof RegExp) {
      return validator.test(value);
    } else if (typeof validator === "function") {
      return validator(value);
    } else {
      const validate = validator.validate;
      if (validate instanceof RegExp) {
        return validate.test(value);
      } else {
        return validate(value);
      }
    }
  }

  isFormatRegistered(key: string): boolean {
    return key in this.formatValidators;
  }

  getRegisteredFormats(): string[] {
    return Object.keys(this.formatValidators);
  }

  validateFormat(value: string, format: string): any {
    const isValid = this.testFormat(value, format);
    return isValid
      ? { valid: true }
      : {
          valid: false,
          errors: { message: `Failed to validate format '${format}'` },
        };
  }

  getAllFormats(): Record<string, FormatDefinition> {
    return { ...this.formatValidators };
  }
  //#endregion

  //#region
  addKeyword(
    definition:
      | MacroKeywordDefinition
      | CompileKeywordDefinition
      | ValidateKeywordDefinition
      | CodeKeywordDefinition,
  ): this {
    if (baseSchemaKeys.has(definition.keyword)) {
      throw new Error(
        `Keyword "${definition.keyword}" is a predefined keyword and cannot be registered.`,
      );
    }
    this.validateKeywordDefinition(definition);
    this.customKeywords.set(definition.keyword, definition);
    if ("macro" in definition) {
      this.hasMacros = true;
    }
    return this;
  }

  removeKeyword(keyword: string): this {
    this.customKeywords.delete(keyword);
    this.hasMacros = false;
    for (const def of this.customKeywords.values()) {
      if ("macro" in def) {
        this.hasMacros = true;
        break;
      }
    }

    return this;
  }

  hasMacroKeywords(): boolean {
    return this.hasMacros;
  }

  getKeyword(
    keyword: string,
  ):
    | MacroKeywordDefinition
    | CompileKeywordDefinition
    | ValidateKeywordDefinition
    | CodeKeywordDefinition
    | undefined {
    return this.customKeywords.get(keyword);
  }

  private validateKeywordDefinition(
    def:
      | MacroKeywordDefinition
      | CompileKeywordDefinition
      | ValidateKeywordDefinition
      | CodeKeywordDefinition,
  ): void {
    const approaches: any[] = [];
    if ("macro" in def && (def as any).macro)
      approaches.push((def as any).macro);
    if ("compile" in def && (def as any).compile)
      approaches.push((def as any).compile);
    if ("validate" in def && (def as any).validate)
      approaches.push((def as any).validate);
    if ("code" in def && (def as any).code) approaches.push((def as any).code);

    if (approaches.length === 0) {
      throw new Error(
        `Keyword "${def.keyword}" must have at least one of: macro, compile, validate, or code`,
      );
    }

    if (approaches.length > 1) {
      throw new Error(
        `Keyword "${def.keyword}" can only have ONE of: macro, compile, validate, or code`,
      );
    }

    if ((def as any).schemaType) {
      const validTypes = [
        "string",
        "number",
        "boolean",
        "array",
        "object",
        "null",
      ];
      const types = Array.isArray((def as any).schemaType)
        ? (def as any).schemaType
        : [(def as any).schemaType];

      for (const type of types) {
        if (!validTypes.includes(type)) {
          throw new Error(
            `Invalid schemaType "${type}" for keyword "${def.keyword}"`,
          );
        }
      }
    }

    if ((def as any).type) {
      const validTypes = [
        "string",
        "number",
        "integer",
        "boolean",
        "array",
        "object",
        "null",
      ];
      const types = Array.isArray((def as any).type)
        ? (def as any).type
        : [(def as any).type];

      for (const type of types) {
        if (!validTypes.includes(type)) {
          throw new Error(
            `Invalid type "${type}" for keyword "${def.keyword}"`,
          );
        }
      }
    }

    if ((def as any).metaSchema) {
      if (
        typeof (def as any).metaSchema !== "object" ||
        (def as any).metaSchema === null
      ) {
        throw new Error(
          `metaSchema for keyword "${def.keyword}" must be an object`,
        );
      }
    }
  }

  isKeywordAdded(key: string): boolean {
    return this.customKeywords.has(key);
  }

  getAddedKeywords(): string[] {
    return Object.keys(this.customKeywords);
  }

  clearKeywords(): void {
    this.customKeywords.clear();
  }

  getAllKeywords(): Map<string, KeywordDefinition> {
    return this.customKeywords;
  }

  //#endregion

  //#region
  addSchema(schema: SchemaDefinition, id?: string): void {
    const key = id || schema.$id;
    if (!key)
      throw Error("Attempting to register a schema that has no defined id.");
    schema.$id = key;
    this.schemas[key] = structuredClone(schema);
  }

  getSchema(key: string): SchemaDefinition | undefined {
    return structuredClone(this.schemas[key]);
  }

  getCompiledSchema(key: string, config?: ValidatorOptions): Function {
    if (this.schemas[key] !== undefined) {
      return this.compile(this.schemas[key], config);
    } else {
      throw Error(`Schema ${key} not found in registry.`);
    }
  }

  async getCompiledSchemaAsync(
    key: string,
    config?: ValidatorOptions,
  ): Promise<Function> {
    if (this.schemas[key] !== undefined) {
      return await this.compileAsync(this.schemas[key], config);
    } else {
      throw Error(`Schema ${key} not found in registry.`);
    }
  }

  isSchemaAdded(key: string): boolean {
    return key in this.schemas;
  }

  getAddedSchemas(): string[] {
    return Object.keys(this.schemas);
  }

  removeSchema(pattern?: string | RegExp | object): void {
    if (pattern === undefined) {
      this.schemas = {};
      if (this.options.cache) {
        this.compilationCache.clear();
      }
      return;
    }
    if (typeof pattern === "string") {
      if (!(pattern in this.schemas)) {
        throw new Error(`Schema "${pattern}" is not registered.`);
      }
      delete this.schemas[pattern];
      if (this.options.cache) {
        this.compilationCache.delete(pattern);
      }
      return;
    }
    if (pattern instanceof RegExp) {
      const keys = Object.keys(this.schemas);
      let removed = 0;

      for (const key of keys) {
        if (pattern.test(key)) {
          delete this.schemas[key];
          if (this.options.cache) {
            this.compilationCache.delete(key);
          }
          removed++;
        }
      }

      if (removed === 0) {
        console.warn(`No schemas matched pattern: ${pattern}`);
      }
      return;
    }
    if (typeof pattern === "object") {
      const keys = Object.keys(this.schemas);
      let found = false;

      for (const key of keys) {
        if (this.schemas[key] === pattern) {
          delete this.schemas[key];
          if (this.options.cache) {
            this.compilationCache.delete(key);
          }
          found = true;
          break;
        }
      }

      if (!found) {
        throw new Error("Schema object not found in registry");
      }
      return;
    }

    throw new Error("Invalid pattern type for removeSchema");
  }

  clearSchemas(): void {
    this.schemas = {};
  }

  getAllSchemas(): Record<string, SchemaDefinition> {
    return { ...this.schemas };
  }
  //#endregion

  //#region
  validate(
    schema: object | boolean | string,
    data: any,
    config?: ValidatorOptions,
  ): ValidationResult {
    let finalSchema;
    if (typeof schema === "object" || typeof schema === "boolean") {
      finalSchema = schema;
    } else {
      finalSchema = this.schemas[schema];
    }
    if (finalSchema !== undefined) {
      let validator;
      if (typeof finalSchema !== "boolean") {
        const func =
          typeof schema === "string"
            ? this.compilationCache.get(schema)
            : this.compilationCache.get(
                (finalSchema as SchemaDefinition).$id ?? finalSchema,
              );
        if (func) validator = func;
      }
      if (!validator) {
        validator = this.compile(finalSchema, config);
      }
      const valid = validator(data);
      return { valid, errors: validator.errors };
    } else {
      throw Error(`Schema ${schema} was not found in registry.`);
    }
  }

  async validateAsync(
    schema: object | boolean | string,
    data: any,
    config?: ValidatorOptions,
  ): Promise<ValidationResult> {
    let finalSchema;
    if (typeof schema === "object" || typeof schema === "boolean") {
      finalSchema = schema;
    } else {
      finalSchema = this.schemas[schema];
    }
    if (finalSchema !== undefined) {
      let validator;
      if (typeof finalSchema !== "boolean") {
        const func =
          typeof schema === "string"
            ? this.compilationCache.get(schema)
            : this.compilationCache.get(
                (finalSchema as SchemaDefinition).$id ?? finalSchema,
              );
        if (func) validator = func;
      }
      if (!validator) {
        validator = await this.compileAsync(finalSchema, config);
      }
      const valid = await validator(data);
      return { valid, errors: validator.errors };
    } else {
      throw Error(`Schema ${schema} was not found in registry.`);
    }
  }

  //#endregion

  //#region
  getMetaSchema(
    $schema?: string,
    options?: ValidatorOptions,
  ): { metaSchema: object | undefined; metaSchemaId: string } {
    let metaSchemaId: string | undefined = options?.metaSchema;

    if (!metaSchemaId && $schema) {
      metaSchemaId = $schema;
    }

    if (!metaSchemaId) {
      metaSchemaId =
        this.options.metaSchema || "https://json-schema.org/draft-07/schema";
    }

    const finalId = this.aliases[metaSchemaId] ?? metaSchemaId;
    let metaSchema = this.metaSchemas[finalId];
    if (!metaSchema) {
      if (options?.strictSchema) {
        throw new Error(
          `Meta-schema "${metaSchemaId}" is not loaded.\n` +
            `Load it using: loadDraft07(jetValidator) or loadAllMetaSchemas(jetValidator)\n` +
            `Or disable validation: new JetValidator({ validateSchema: false })`,
        );
      }
    }
    return { metaSchema, metaSchemaId };
  }

  validateSchemaSync(
    schema: SchemaDefinition,
    options?: ValidatorOptions,
  ): { valid: boolean; errors: any } {
    const { metaSchema } = this.getMetaSchema(schema.$schema, options);
    if (!metaSchema)
      return { valid: false, errors: [{ message: "metaSchema not found" }] };
    const validator = this.compile(metaSchema, {
      ...options,
      logFunction: true,
      validateSchema: false,
    });
    const result = validator(schema);

    if (!result && options?.strictSchema) {
      console.log(validator.errors);
      throw Error();
    }
    if (!result) validator.errors[0]["metaSchemaError"] = true;

    return { valid: result, errors: validator.errors };
  }

  async validateSchemaAsync(
    schema: SchemaDefinition,
    options?: ValidatorOptions,
  ): Promise<{ valid: boolean; errors: any }> {
    let metaSchema;
    let { metaSchema: mSchema, metaSchemaId } = this.getMetaSchema(
      schema.$schema,
      options,
    );
    if (mSchema) {
      metaSchema = mSchema;
    } else {
      metaSchema = await this.options.loadSchema(metaSchemaId);
    }
    const validator = await this.compileAsync(metaSchema, {
      ...options,
      validateSchema: false,
      async: true,
    });
    const result = await validator(schema);

    if (!result && options?.strictSchema) {
      console.log(validator.errors);
      throw Error();
    }
    if (!result) validator.errors[0]["metaSchemaError"] = true;
    return { valid: result, errors: validator.errors };
  }

  addMetaSchema(schema: SchemaDefinition, key?: string): this {
    let Key = key || schema.$id;

    if (!Key) {
      throw new Error("Meta-schema must have an $id or explicit key");
    }
    const schemaKey = this.aliases[Key] ?? Key;
    if (!(schemaKey in this.metaSchemas)) {
      this.metaSchemas[schemaKey] = structuredClone(schema);
    }

    return this;
  }
  //#endregion
  clearRegistries(): void {
    this.schemas = {};
    this.formatValidators = {};
    this.clearKeywords();
    if (this.options.cache) {
      this.compilationCache.clear();
    }
  }

  private compileResolved(
    resolvedSchema: SchemaDefinition | boolean,
    mainSchema: SchemaDefinition | boolean,
    refables: any[],
    allFormats: Set<string>,
    allKeywords: Set<string>,
    config: ValidatorOptions,
    compileContext: {
      hasUnevaluatedProperties: boolean;
      hasUnevaluatedItems: boolean;
      hasRootReference: boolean;
      referencedFunctions: string[];
      uses$Data: boolean;
    },
  ): ErrorAttachedValidatorFn {
    const includesItemsRef = compileContext.hasUnevaluatedItems;
    const includesPropRef = compileContext.hasUnevaluatedProperties;
    const fconfig = {
      ...config,
    };
    const has$Data = compileContext.uses$Data;
    if (typeof resolvedSchema === "boolean") fconfig.allErrors = false;
    const compiler = new Compiler(
      refables,
      mainSchema,
      fconfig,
      this,
      allKeywords,
      compileContext,
      false,
    );
    let source;
    if (compileContext.hasRootReference) {
      source = compiler.compileSchema(
        resolvedSchema,
        {
          schema: `\${path.schema}`,
          data: "${path.data}",
          $data: "",
        },
        {
          parentHasUnevaluatedProperties: includesPropRef,
          parentUnevaluatedPropVar: includesPropRef
            ? "evaluatedProperties"
            : undefined,
          parentHasUnevaluatedItems: includesItemsRef,
          parentUnevaluatedItemVar: includesItemsRef
            ? "evaluatedItems"
            : undefined,
          isSubschema: true,
        },
        "rootData",
      );
    } else {
      source = compiler.compileSchema(
        resolvedSchema,
        undefined,
        undefined,
        "rootData",
      );
    }
    const keywords = compiler.getCompiledKeywords();
    const formatValidators: Record<string, any> = {};
    const customKeywords = new Map<
      string,
      CompiledValidateFunction | ValidateFunction
    >(keywords.compiledKeywords);
    for (const keywordDef of keywords.validateKeywords) {
      const validate = (
        this.customKeywords.get(keywordDef) as ValidateKeywordDefinition
      )?.validate;
      if (validate) customKeywords.set(keywordDef, validate);
    }

    const asyncPrefix = config.async ? "async " : "";
    let functionDeclaration = "validate(rootData";
    if (compileContext.hasRootReference) {
      if (includesItemsRef || includesPropRef) {
        if (includesPropRef)
          functionDeclaration = functionDeclaration + ",evaluatedProperties";
        if (includesItemsRef)
          functionDeclaration = functionDeclaration + ",evaluatedItems";
      }
    }
    if (compileContext.hasRootReference)
      functionDeclaration = functionDeclaration + ",path";
    functionDeclaration = functionDeclaration + ")";
    const finalSource = `
    ${compiler.hoistedFunctions.join("")}
    ${asyncPrefix}function ${functionDeclaration}{${
      compileContext.hasRootReference
        ? 'if (!path) {path = { schema: "#", data: "" };}'
        : ""
    }${source}${
      fconfig.allErrors
        ? `validate.errors = allErrors; return allErrors.length == 0`
        : "return true"
    };} return validate;
    `;
    if (config.logFunction) {
      console.log(finalSource);
    }

    const regexParams: string[] = [];
    const regexArgs: RegExp[] = [];

    if (compiler.regexCache.size > 0) {
      for (const [key, value] of compiler.regexCache.entries()) {
        regexParams.push(value);
        regexArgs.push(new RegExp(key));
      }
    }
    if (typeof resolvedSchema !== "boolean") {
      if (has$Data) {
        const formatKeys =
          Array.isArray(fconfig.formats) && fconfig.formats.length > 0
            ? fconfig.formats
            : Object.keys(this.formatValidators);

        for (const validatorKey of formatKeys) {
          const validator = this.formatValidators[validatorKey];
          if (validator) {
            if (
              typeof validator === "function" ||
              validator instanceof RegExp
            ) {
              formatValidators[validatorKey] = validator;
            } else {
              formatValidators[validatorKey] = validator.validate;
            }
          }
        }
      } else if (allFormats.size > 0) {
        for (const validatorKey of allFormats) {
          const validator = this.formatValidators[validatorKey];
          if (validator) {
            if (
              typeof validator === "function" ||
              validator instanceof RegExp
            ) {
              formatValidators[validatorKey] = validator;
            } else {
              formatValidators[validatorKey] = validator.validate;
            }
          }
        }
      }
    }
    const validatorKeys = Object.keys(formatValidators);
    const validatorValues = Object.values(formatValidators);

    return new Function(
      "formatValidators",
      "deepEqual",
      "canonicalStringify",
      "customKeywords",
      "len_of",
      ...regexParams,
      finalSource,
    )(
      formatValidators,
      deepEqual,
      canonicalStringify,
      customKeywords,
      len_of,
      ...regexArgs,
    ) as ErrorAttachedValidatorFn;
  }

  compile(
    fschema: object | boolean,
    config?: ValidatorOptions,
  ): ErrorAttachedValidatorFn {
    const schema =
      typeof fschema === "boolean" ? fschema : (fschema as SchemaDefinition);

    const finalConfig = {
      ...this.options,
      ...config,
    };

    if (
      typeof schema === "object" &&
      finalConfig.validateSchema &&
      (finalConfig.metaSchema || schema.$schema)
    ) {
      const result = this.validateSchemaSync(schema, {
        metaSchema: finalConfig?.metaSchema,
      });
      if (!result.valid) {
        const validator = (data: any) => result.valid;
        (validator as any).errors = result.errors || [];
        return validator as ErrorAttachedValidatorFn;
      }
    }
    if (finalConfig.cache && typeof schema !== "boolean") {
      if (
        this.compilationCache.has(schema?.$id!) ||
        this.compilationCache.has(schema)
      ) {
        return (this.compilationCache.get(schema?.$id!) ??
          this.compilationCache.get(schema))!;
      }
    }

    const resolver = new SchemaResolver(this, finalConfig);
    const resolved = resolver.resolveSync(schema);
    console.log(resolved.schema)
    const validator = this.compileResolved(
      resolved.schema,
      schema,
      resolved.refables,
      resolved.allFormats,
      resolved.keywords,
      finalConfig,
      resolved.compileContext,
    );

    if (finalConfig.cache && typeof schema === "object" && schema !== null) {
      const schem = schema as { $id?: string; id?: string };
      this.compilationCache.set(schem.$id ?? schem.id ?? schema, validator);
    }
    return validator;
  }

  async compileAsync(
    fschema: SchemaDefinition | boolean,
    config?: ValidatorOptions,
  ): Promise<ErrorAttachedValidatorFn> {
    const schema =
      typeof fschema === "boolean" ? fschema : (fschema as SchemaDefinition);
    const finalConfig = {
      ...this.options,
      ...config,
    };
    if (
      typeof schema === "object" &&
      finalConfig.validateSchema &&
      (finalConfig.metaSchema || schema.$schema)
    ) {
      const result = await this.validateSchemaAsync(schema, {
        metaSchema: finalConfig?.metaSchema,
      });
      if (!result.valid) {
        const validator = (data: any) => result.valid;
        (validator as any).errors = result.errors || [];
        return validator as ErrorAttachedValidatorFn;
      }
    }

    if (finalConfig.cache && typeof schema !== "boolean") {
      if (
        this.compilationCache.has(schema?.$id!) ||
        this.compilationCache.has(schema)
      ) {
        return (this.compilationCache.get(schema?.$id!) ??
          this.compilationCache.get(schema))!;
      }
    }

    const resolver = new SchemaResolver(this, finalConfig);
    const resolved = await resolver.resolveAsync(
      schema,
      finalConfig.loadSchema,
    );
    const validator = this.compileResolved(
      resolved.schema,
      schema,
      resolved.refables,
      resolved.allFormats,
      resolved.keywords,
      finalConfig,
      resolved.compileContext,
    );
    if (finalConfig.cache && typeof schema === "object") {
      this.compilationCache.set(schema, validator);
    }

    return validator;
  }

  logErrors(errors: any, indent = 0) {
    const spacer = "  ".repeat(indent); // Create indentation

    if (Array.isArray(errors)) {
      // If the input is an array (like subErrors), iterate through each error
      errors.forEach((err) => this.logErrors(err, indent));
    } else if (errors && typeof errors === "object") {
      // If the input is a single error object
      console.log(
        `${spacer}❌ Validation Failed: ${errors.message || "Unknown error"}`,
      );
      if (errors.dataPath) {
        console.log(`${spacer}   - Data Path: ${errors.dataPath}`);
      }
      if (errors.schemaPath) {
        console.log(`${spacer}   - Schema Path: ${errors.schemaPath}`);
      }
      if (errors.rule) {
        console.log(`${spacer}   - Rule: ${errors.rule}`);
      }
      if (errors.expected) {
        console.log(`${spacer}   - Expected: ${errors.expected}`);
      }
      if (errors.subErrors) {
        console.log(`${spacer}   - Sub-errors:`);
        this.logErrors(errors.subErrors, indent + 1); // Recursive call for nested errors
      }
    }
  }

  getFieldFromPath(dataPath: string): string {
    if (!dataPath || dataPath === "/") return "";
    const segments = dataPath.split("/").filter(Boolean);
    return segments[segments.length - 1];
  }

  getFullFieldPath(dataPath: string): string {
    if (!dataPath || dataPath === "/") return "";
    return dataPath
      .slice(1)
      .replace(/\/(\d+)/g, "[$1]")
      .replace(/\//g, ".");
  }
  getFieldErrors(errors: any[]): Record<string, string[]> {
    const byField: Record<string, string[]> = {};

    for (const error of errors) {
      const field = error.dataPath || "/";
      if (!byField[field]) byField[field] = [];
      byField[field].push(error.message);
    }

    return byField;
  }

  errorsText(
    errors: any[],
    options?: { separator?: string; dataVar?: string },
  ): string {
    const sep = options?.separator ?? ", ";
    const dataVar = options?.dataVar ?? "data";

    return errors
      .map((e) => {
        const path = e.dataPath || "/";
        const fullPath =
          path === "/" ? dataVar : `${dataVar}${path.replace(/\//g, ".")}`;
        return `${fullPath}: ${e.message}`;
      })
      .join(sep);
  }

  generateStandalone(
    schema: object,
    sconfig?: ValidatorOptions,
  ): {
    code: string;
    functionName: string;
    formatSetup?: string;
    imports: string[];
  } {
    const code: string[] = [];
    const formatImports: string[] = [];
    const config = { ...this.options, ...sconfig };
    let generatedFunctionName;
    if (this.counter === 0) {
      generatedFunctionName = "validate" + this.counter;
    } else {
      generatedFunctionName = "validate" + this.counter++;
    }
    const resolver = new SchemaResolver(this, config);
    resolver.rootFunctionName = generatedFunctionName;
    const resolved = resolver.resolveSync(schema);
    const includesItemsRef = resolved.compileContext.hasUnevaluatedItems;
    const includesPropRef = resolved.compileContext.hasUnevaluatedProperties;
    const has$Data = resolved.compileContext.uses$Data;

    const compiler = new Compiler(
      resolved.refables,
      schema,
      { ...config },
      this,
      resolved.keywords,
      resolved.compileContext,
    );
    compiler.mainFunctionName = generatedFunctionName;
    let source;
    if (resolved.compileContext.hasRootReference) {
      source = compiler.compileSchema(
        resolved.schema,
        {
          schema: `\${path.schema}`,
          data: "${path.data}",
          $data: "",
        },
        {
          parentHasUnevaluatedProperties: includesPropRef,
          parentUnevaluatedPropVar: includesPropRef
            ? "evaluatedProperties"
            : undefined,
          parentHasUnevaluatedItems: includesItemsRef,
          parentUnevaluatedItemVar: includesItemsRef
            ? "evaluatedItems"
            : undefined,
          isSubschema: true,
        },
        "rootData",
      );
    } else {
      source = compiler.compileSchema(
        resolved.schema,
        undefined,
        undefined,
        "rootData",
      );
    }

    const keywords = compiler.getCompiledKeywords();

    if (keywords.hasCompileKeyword) {
      code.push(`const compilerOptions = ${JSON.stringify(config)};\n`);
      code.push(`const mainRootSchema = ${JSON.stringify(schema)};\n`);
    }
    const inlinedFormats = new Set<string>();
    if (has$Data) {
      this.inlineAllConfiguredFormats(code, config, inlinedFormats);
      this.createFormatObject(code, config, inlinedFormats);
    } else if (resolved.allFormats.size > 0) {
      this.inlineUsedFormats(
        code,
        resolved.allFormats,
        config,
        formatImports,
        inlinedFormats,
      );
    }

    for (const keywordDef of keywords.validateKeywords) {
      const validate = (
        this.customKeywords.get(keywordDef) as ValidateKeywordDefinition
      )?.validate;
      if (validate) {
        code.push(`const ${keywordDef} = ${validate.toString()};\n`);
      }
    }
    if (compiler.needslen_of) code.push(len_of.toString() + ";");
    if (compiler.needsStringify) code.push(canonicalStringify.toString() + ";");
    if (compiler.needsDeepEqual) code.push(deepEqual.toString() + ";");
    const asyncPrefix = config.async ? "async " : "";
    let functionDeclaration = "validate(rootData";

    if (resolved.compileContext.hasRootReference) {
      if (includesItemsRef || includesPropRef) {
        if (includesPropRef) functionDeclaration += ",evaluatedProperties";
        if (includesItemsRef) functionDeclaration += ",evaluatedItems";
      }
      functionDeclaration += ",path";
    }
    functionDeclaration += ")";
    let regexDeclaration = "";
    if (compiler.regexCache.size > 0) {
      for (const [key, value] of compiler.regexCache.entries()) {
        regexDeclaration =
          regexDeclaration +
          `const ${value} = new RegExp(${JSON.stringify(key)});\n`;
      }
    }
    code.push(compiler.hoistedFunctions.join(""));
    const finalSource = `
      ${asyncPrefix}function ${functionDeclaration} {
      ${regexDeclaration}${
        resolved.compileContext.hasRootReference
          ? '\n  if (!path) { path = { schema: "#", data: "" }; }'
          : ""
      }
      ${source}
      ${
        this.options.allErrors
          ? `validate.errors = allErrors; return allErrors.length == 0`
          : " return true"
      }
    }
`;
    code.push(finalSource);
    let formatSetup: string | undefined;
    if (formatImports.length > 0) {
      formatSetup = this.generateFormatSetup(formatImports);
    }

    return {
      code: code.join("\n"),
      functionName: generatedFunctionName,
      formatSetup,
      imports: formatImports,
    };
  }

  private inlineUsedFormats(
    code: string[],
    usedFormats: Set<string>,
    config: ValidatorOptions,
    formatImports: string[],
    inlinedFormats: Set<string>,
  ): void {
    const overwrittenFormats = config.overwrittenFormats || [];

    code.push("// Format validators\n");
    for (const formatName of usedFormats) {
      if (inlinedFormats.has(formatName)) continue;

      const validator = this.formatValidators[formatName];

      if (!validator) {
        formatImports.push(formatName);
        continue;
      }

      const isOverwritten = overwrittenFormats.includes(formatName);
      if (typeof validator === "function" || validator instanceof RegExp) {
        this.resolveFormats(
          validator,
          code,
          formatName,
          inlinedFormats,
          isOverwritten,
          formatImports,
        );
      } else if (typeof validator === "object" && "validate" in validator) {
        this.resolveFormats(
          validator.validate,
          code,
          formatName,
          inlinedFormats,
          isOverwritten,
          formatImports,
        );
      }
    }

    code.push("\n");
  }

  private resolveFormats(
    validator: RegExp | ((value: any) => boolean | Promise<boolean>),
    code: string[],
    formatName: string,
    inlinedFormats: Set<string>,
    isOverwritten: boolean,
    formatImports: string[],
  ) {
    if (validator instanceof RegExp) {
      const safeName = this.getSafeFormatName(formatName);
      code.push(
        `const ${safeName} = new RegExp(${JSON.stringify(validator.source)}, '${
          validator.flags
        }');\n`,
      );
      inlinedFormats.add(formatName);
    } else if (typeof validator === "function") {
      if (isOverwritten) {
        const fnString = validator.toString();
        if (this.isSelfContained(fnString)) {
          code.push(
            `const ${this.getSafeFormatName(formatName)} = ${fnString};\n`,
          );
          inlinedFormats.add(formatName);
        } else {
          formatImports.push(formatName);
        }
      } else {
        const needsExternalDeps = this.formatNeedsExternalDeps(formatName);

        if (needsExternalDeps) {
          this.inlineFormatWithDeps(code, formatName, inlinedFormats);
        } else {
          if (validator.name) {
            code.push(`${validator.toString()};\n`);
          } else {
            code.push(
              `const ${this.getSafeFormatName(
                formatName,
              )} = ${validator.toString()};\n`,
            );
          }

          inlinedFormats.add(formatName);
        }
      }
    }
  }

  private inlineAllConfiguredFormats(
    code: string[],
    config: ValidatorOptions,
    inlinedFormats: Set<string>,
  ): void {
    const configuredFormats = config.formats ?? [];

    code.push("// Format validators (all configured for $data support)\n");

    if (configuredFormats?.length > 0) {
      for (const formatName of configuredFormats) {
        if (inlinedFormats.has(formatName)) continue;

        const validator = this.formatValidators[formatName];
        if (validator) {
          if (validator instanceof RegExp || typeof validator === "function") {
            this.resolve$DataFormat(
              validator,
              formatName,
              inlinedFormats,
              code,
            );
          } else if (typeof validator === "object" && "validate" in validator) {
            this.resolve$DataFormat(
              validator.validate,
              formatName,
              inlinedFormats,
              code,
            );
          }
        }
      }
    } else if (config.formatMode === "fast" || config.formatMode === "full") {
      const validators = this.formatValidators;

      for (const [formatName, validator] of Object.entries(validators)) {
        if (inlinedFormats.has(formatName)) continue;

        if (validator instanceof RegExp || typeof validator === "function") {
          this.resolve$DataFormat(validator, formatName, inlinedFormats, code);
        } else if (typeof validator === "object" && "validate" in validator) {
          this.resolve$DataFormat(
            validator.validate,
            formatName,
            inlinedFormats,
            code,
          );
        }
      }
    }

    code.push("\n");
  }
  private resolve$DataFormat(
    validator: RegExp | ((value: any) => boolean | Promise<boolean>),
    formatName: string,
    inlinedFormats: Set<string>,
    code: string[],
  ) {
    if (validator instanceof RegExp) {
      const safeName = this.getSafeFormatName(formatName);
      code.push(
        `const ${safeName} = new RegExp(${JSON.stringify(validator.source)}, '${
          validator.flags
        }');\n`,
      );
      inlinedFormats.add(formatName);
    } else if (typeof validator === "function") {
      this.inlineFormatWithDeps(code, formatName, inlinedFormats);
    }
  }

  private createFormatObject(
    code: string[],
    config: ValidatorOptions,
    inlinedFormats: Set<string>,
  ): void {
    code.push("// Format object for $data access\n");
    code.push("const formatValidators = {\n");

    const formatsToMap: string[] = [];

    if (config.formats && config.formats.length > 0) {
      formatsToMap.push(...config.formats);
    } else if (config.formatMode === "fast" || config.formatMode === "full") {
      const validators =
        config.formatMode === "fast"
          ? FAST_FORMAT_VALIDATORS
          : FULL_FORMAT_VALIDATORS;
      formatsToMap.push(...Object.keys(validators));
    }

    for (const formatName of formatsToMap) {
      if (inlinedFormats.has(formatName)) {
        const safeName = this.getSafeFormatName(formatName);
        code.push(`  "${formatName}": ${safeName},\n`);
      }
    }

    code.push("};\n\n");
  }

  private getSafeFormatName(formatName: string): string {
    return "format_" + formatName.replace(/[^a-zA-Z0-9]/g, "_");
  }

  private formatNeedsExternalDeps(formatName: string): boolean {
    const formatsWithDeps = new Set(["date-time", "iso-date-time", "time"]);

    return formatsWithDeps.has(formatName);
  }

  private inlineFormatWithDeps(
    code: string[],
    formatName: string,
    inlinedFormats: Set<string>,
  ): void {
    const validator = this.formatValidators[formatName];
    if (!validator || typeof validator !== "function") return;

    if (inlinedFormats.has(formatName)) return;

    switch (formatName) {
      case "date-time":
        code.push(`// date-time format with dependencies\n`);
        if (!inlinedFormats.has("date")) {
          code.push(this.serializeFormatFunction("date"));
          inlinedFormats.add("date");
        }
        if (!inlinedFormats.has("time")) {
          code.push(this.serializeFormatFunction("time"));
          inlinedFormats.add("time");
        }
        code.push(`${validator.toString()};\n`);
        inlinedFormats.add(formatName);
        break;

      case "iso-date-time":
        code.push(`// iso-date-time format with dependencies\n`);
        if (!inlinedFormats.has("date")) {
          code.push(this.serializeFormatFunction("date"));
          inlinedFormats.add("date");
        }
        if (!inlinedFormats.has("iso-time")) {
          code.push(this.serializeFormatFunction("iso-time"));
          inlinedFormats.add("iso-time");
        }
        code.push(`${validator.toString()};\n`);
        inlinedFormats.add(formatName);
        break;

      case "time":
        code.push(`// time format with dependencies\n`);
        code.push(`${validator.toString()};\n`);
        inlinedFormats.add(formatName);
        break;

      default:
        code.push(`${validator.toString()};\n`);
        inlinedFormats.add(formatName);
    }
  }

  private serializeFormatFunction(formatName: string): string {
    const validator = this.formatValidators[formatName];

    if (!validator) return "";

    if (validator instanceof RegExp) {
      const safeName = this.getSafeFormatName(formatName);
      return `const ${safeName} = new RegExp(${JSON.stringify(
        validator.source,
      )}, '${validator.flags}');\n`;
    }

    if (typeof validator === "function") {
      return `${validator.toString()};\n`;
    }

    return "";
  }

  private isSelfContained(fnString: string): boolean {
    const externalPatterns = [/\bimport\s+/, /\brequire\(/, /\bfetch\(/];

    return !externalPatterns.some((pattern) => pattern.test(fnString));
  }

  private generateFormatSetup(formatImports: string[]): string {
    const lines = [
      "// Format validators that need to be provided",
      "// Import these and pass them to the validator\n",
      "const formatValidators = {",
    ];

    for (const format of formatImports) {
      lines.push(`  ${format}: /* import your ${format} validator */,`);
    }

    lines.push("};\n");

    return lines.join("\n");
  }
}
