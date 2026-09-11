import {
  FAST_FORMAT_VALIDATORS,
  FULL_FORMAT_VALIDATORS,
} from "./utilities/formats";
import { SchemaDefinition } from "./types/schema";
import {
  ErrorAttachedValidatorFn,
  ValidationError,
  ValidationResult,
  ValidatorOptions,
} from "./types/validation";
import {
  CodeKeywordDefinition,
  CompileKeywordDefinition,
  KeywordDefinition,
  MacroKeywordDefinition,
  ValidateKeywordDefinition,
} from "./types/keywords";
import { FormatDefinition } from "./types/format";

import { baseSchemaKeys, incompatibleKeywords } from "./utilities/schema";
import { Compilation } from "./compilation/compilation";
const validTypes = Object.keys(incompatibleKeywords);

export const aliases: Record<string, string> = {
  "draft-06": "https://json-schema.org/draft-06/schema",
  "draft-07": "https://json-schema.org/draft-07/schema",
  "draft/2019-09": "https://json-schema.org/draft/2019-09/schema",
  "draft/2020-12": "https://json-schema.org/draft/2020-12/schema",
};

type KeywordDef =
  | MacroKeywordDefinition
  | CompileKeywordDefinition
  | ValidateKeywordDefinition
  | CodeKeywordDefinition;

export class JetValidator {
  private schemas: Record<string, SchemaDefinition> = {};
  private metaSchemas: Record<string, SchemaDefinition> = {};
  private customKeywords: Map<string, KeywordDefinition> = new Map();
  private formatValidators: Record<string, FormatDefinition>;
  private hasMacros: boolean = false;
  private compilation: Compilation;
  options: Required<ValidatorOptions>;
  private counter: number = 0;
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

    this.formatValidators = this.initFormatValidators();
    this.compilation = new Compilation(this);
  }

  private initFormatValidators(): Record<string, FormatDefinition> {
    if (this.options.formatMode === false) return {};
    return this.options.formatMode === "full"
      ? { ...FULL_FORMAT_VALIDATORS }
      : { ...FAST_FORMAT_VALIDATORS };
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
      return validate instanceof RegExp
        ? validate.test(value)
        : validate(value);
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
  addKeyword(definition: KeywordDef): this {
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

  getKeyword(keyword: string): KeywordDef | undefined {
    return this.customKeywords.get(keyword);
  }

  private validateKeywordDefinition(def: KeywordDef): void {
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
    return [...this.customKeywords.keys()];
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
    const key = id || schema.$id || schema.id;
    if (!key)
      throw Error("Attempting to register a schema that has no defined id.");
    schema.$id = key;
    this.schemas[key] = structuredClone(schema);
  }

  getSchema(key: string): SchemaDefinition | undefined {
    return structuredClone(this.schemas[key]);
  }

  getCompiledSchema(
    key: string,
    config?: ValidatorOptions,
  ): ErrorAttachedValidatorFn {
    const schema = this.schemas[key];
    if (schema === undefined) {
      throw Error(`Schema ${key} not found in registry.`);
    }
    return this.compile(schema, config);
  }

  async getCompiledSchemaAsync(
    key: string,
    config?: ValidatorOptions,
  ): Promise<ErrorAttachedValidatorFn> {
    const schema = this.schemas[key];
    if (schema === undefined) {
      throw Error(`Schema ${key} not found in registry.`);
    }
    return this.compileAsync(schema, config);
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
        this.compilation.clearCache();
      }
      return;
    }
    if (typeof pattern === "string") {
      if (!(pattern in this.schemas)) {
        throw new Error(`Schema "${pattern}" is not registered.`);
      }
      delete this.schemas[pattern];
      if (this.options.cache) {
        this.compilation.deleteCacheKey(pattern);
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
            this.compilation.deleteCacheKey(key);
          }
          removed++;
        }
      }

      if (removed === 0) {
        console.warn(`No schemas matched pattern: ${pattern}`);
      } else {
        console.warn(`Removed ${removed} schemas matching pattern: ${pattern}`);
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
            this.compilation.deleteCacheKey(key);
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
    if (this.options.cache) {
      this.compilation.clearCache();
    }
  }

  getAllSchemas(): Record<string, SchemaDefinition> {
    return { ...this.schemas };
  }
  //#endregion

  //#region

  private resolveRegisteredSchema(
    schema: object | boolean | string,
  ): object | boolean | undefined {
    if (typeof schema === "object" || typeof schema === "boolean") {
      return schema;
    }
    return this.schemas[schema];
  }

  validate(
    schema: object | boolean | string,
    data: any,
    config?: ValidatorOptions,
  ): ValidationResult {
    const finalSchema = this.resolveRegisteredSchema(schema);
    if (finalSchema === undefined) {
      throw Error(`Schema ${schema} was not found in registry.`);
    }

    const validator = this.compile(finalSchema, config);
    const valid = validator(data);
    return { valid, errors: validator.errors };
  }

  async validateAsync(
    schema: object | boolean | string,
    data: any,
    config?: ValidatorOptions,
  ): Promise<ValidationResult> {
    const finalSchema = this.resolveRegisteredSchema(schema);
    if (finalSchema === undefined) {
      throw Error(`Schema ${schema} was not found in registry.`);
    }

    const validator = await this.compileAsync(finalSchema, config);
    const valid = await validator(data);
    return { valid, errors: validator.errors };
  }

  //#endregion

  //#region
  getMetaSchema(
    $schema?: string,
    options?: ValidatorOptions,
  ): { metaSchema: object | undefined; metaSchemaId: string } {
    let metaSchemaId: string | undefined = options?.metaSchema ?? $schema;

    if (!metaSchemaId) {
      metaSchemaId =
        this.options.metaSchema || "https://json-schema.org/draft-07/schema";
    }

    const finalId = aliases[metaSchemaId] ?? metaSchemaId;
    const metaSchema = this.metaSchemas[finalId];
    return { metaSchema, metaSchemaId };
  }

  private metaSchemaNotFound(metaSchemaId: string): ValidationResult {
    return {
      valid: false,
      errors: [
        {
          dataPath: "",
          schemaPath: "#",
          notFound: true,
          keyword: metaSchemaId,
          message: "metaSchema not found",
        },
      ],
    };
  }

  validateSchemaSync(
    schema: SchemaDefinition,
    options?: ValidatorOptions,
  ): ValidationResult {
    const { metaSchema, metaSchemaId } = this.getMetaSchema(
      schema.$schema,
      options,
    );
    if (!metaSchema) {
      return this.metaSchemaNotFound(metaSchemaId);
    }
    const validator = this.compile(metaSchema, {
      ...options,
      validateSchema: false,
    });
    const result = validator(schema);
    return { valid: result, errors: validator.errors };
  }

  async validateSchemaAsync(
    schema: SchemaDefinition,
    options?: ValidatorOptions,
  ): Promise<ValidationResult> {
    const { metaSchema, metaSchemaId } = this.getMetaSchema(
      schema.$schema,
      options,
    );
    const resolvedMeta =
      metaSchema ?? (await this.options.loadSchema(metaSchemaId));
    if (!resolvedMeta) {
      return this.metaSchemaNotFound(metaSchemaId);
    }
    const validator = await this.compileAsync(resolvedMeta, {
      ...options,
      validateSchema: false,
      async: true,
    });
    const result = await validator(schema);
    return { valid: result, errors: validator.errors };
  }

  addMetaSchema(schema: SchemaDefinition, key?: string): this {
    const Key = key || schema.$id || schema.id;

    if (!Key) {
      throw new Error("Meta-schema must have an $id or explicit key");
    }
    const schemaKey = aliases[Key] ?? Key;
    if (!(schemaKey in this.metaSchemas)) {
      this.metaSchemas[schemaKey] = structuredClone(schema);
    }

    return this;
  }
  //#endregion

  clearRegistries(): void {
    this.schemas = {};
    this.formatValidators = this.initFormatValidators();
    this.clearKeywords();
    this.compilation.clearCache();
  }

  //#region compile

  compile(
    fschema: object | boolean,
    config?: ValidatorOptions,
  ): ErrorAttachedValidatorFn {
    const schema =
      typeof fschema === "boolean" ? fschema : (fschema as SchemaDefinition);
    const finalConfig = { ...this.options, ...config };

    if (
      typeof schema === "object" &&
      finalConfig.validateSchema &&
      (finalConfig.metaSchema || schema.$schema)
    ) {
      const result = this.validateSchemaSync(schema, {
        metaSchema: finalConfig.metaSchema,
        cache: true,
      });
      if (!result.valid) {
        throw result.errors;
      }
    }

    return this.compilation.compile(fschema, finalConfig);
  }

  async compileAsync(
    fschema: SchemaDefinition | boolean,
    config?: ValidatorOptions,
  ): Promise<ErrorAttachedValidatorFn> {
    const schema =
      typeof fschema === "boolean" ? fschema : (fschema as SchemaDefinition);
    const finalConfig = { ...this.options, ...config };

    if (
      typeof schema === "object" &&
      finalConfig.validateSchema &&
      (finalConfig.metaSchema || schema.$schema)
    ) {
      const result = await this.validateSchemaAsync(schema, {
        metaSchema: finalConfig.metaSchema,
        cache: true,
      });
      if (!result.valid) {
        throw result.errors;
      }
    }

    return this.compilation.compileAsync(fschema, finalConfig);
  }

  generateStandalone(
    schema: SchemaDefinition | object,
    gopts?: { functionName: string },
    sconfig?: ValidatorOptions,
  ): {
    code: string;
    functionName: string;
    formatSetup?: string;
    imports: string[];
  } {
    return this.compilation.generateStandalone(schema, gopts, sconfig);
  }

  logErrors(errors: ValidationError | ValidationError[], indent = 0) {
    const spacer = "  ".repeat(indent);

    if (Array.isArray(errors)) {
      errors.forEach((err) => this.logErrors(err, indent));
    } else if (errors && typeof errors === "object") {
      console.log(
        `${spacer}❌ Validation Failed: ${errors.message || "Unknown error"}`,
      );
      if (errors.dataPath) {
        console.log(`${spacer}   - Data Path: ${errors.dataPath}`);
      }
      if (errors.schemaPath) {
        console.log(`${spacer}   - Schema Path: ${errors.schemaPath}`);
      }
      if (errors.keyword) {
        console.log(`${spacer}   - Keyword: ${errors.keyword}`);
      }
      if (errors.expected) {
        console.log(`${spacer}   - Expected: ${errors.expected}`);
      }

      if (errors.subErrors) {
        console.log(`${spacer}   - Sub-errors:`);
        this.logErrors(errors.subErrors, indent + 1);
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

  getFieldErrors(errors: ValidationError[]): Record<string, string[]> {
    const byField: Record<string, string[]> = {};

    for (const error of errors) {
      const field = error.dataPath || "/";
      if (!byField[field]) byField[field] = [];
      byField[field].push(error.message);
    }

    return byField;
  }

  errorsText(
    errors: ValidationError[],
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
}
