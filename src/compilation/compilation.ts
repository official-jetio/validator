import { Compiler } from "./compileSchema";
import {
  FAST_FORMAT_VALIDATORS,
  FULL_FORMAT_VALIDATORS,
} from "../utilities/formats";
import { SchemaResolver } from "../resolution/resolver";
import { SchemaDefinition } from "../types/schema";
import {
  ErrorAttachedValidatorFn,
  ValidatorOptions,
} from "../types/validation";
import {
  CompiledValidateFunction,
  KeywordDefinition,
  ValidateFunction,
  ValidateKeywordDefinition,
} from "../types/keywords";
import { FormatDefinition } from "../types/format";
import {
  createUniqueChecker,
  deepEqual,
  joinData,
  joinSchema,
  len_of,
} from "../utilities/validation";
import type { JetValidator } from "../jet-validator";
import { CompileContext } from "../types/resolver";
import { TrackingState } from "../types/compiler";

export interface CompilerHost {
  readonly options: Required<ValidatorOptions>;
  getFormat(format: string): FormatDefinition | undefined;
  getAllFormats(): Record<string, FormatDefinition>;
  getKeyword(keyword: string): KeywordDefinition | undefined;
}

type RootPath = { schema: string; data: string };

export class Compilation {
  private cache: Map<object | string, ErrorAttachedValidatorFn> = new Map();
  private counter: number = 0;

  constructor(private host: CompilerHost) {}

  //#region cache
  clearCache(): void {
    this.cache.clear();
  }

  deleteCacheKey(key: string): void {
    this.cache.delete(key);
  }

  private getCachedValidator(
    schema: SchemaDefinition | boolean,
    finalConfig: Required<ValidatorOptions>,
  ): ErrorAttachedValidatorFn | undefined {
    if (!finalConfig.cache || typeof schema === "boolean") return undefined;
    return (
      this.cache.get(schema.$id!) ??
      this.cache.get(schema.id!) ??
      this.cache.get(schema)
    );
  }

  private storeCachedValidator(
    schema: SchemaDefinition | boolean,
    finalConfig: Required<ValidatorOptions>,
    validator: ErrorAttachedValidatorFn,
  ): void {
    if (finalConfig.cache && typeof schema === "object" && schema !== null) {
      this.cache.set(schema.$id ?? schema.id ?? schema, validator);
    }
  }
  //#endregion

  private buildConfig(config?: ValidatorOptions): Required<ValidatorOptions> {
    return { ...this.host.options, ...config };
  }

  //#region compile
  compile(
    fschema: object | boolean,
    finalConfig: Required<ValidatorOptions>,
  ): ErrorAttachedValidatorFn {
    const schema =
      typeof fschema === "boolean" ? fschema : (fschema as SchemaDefinition);

    const cached = this.getCachedValidator(schema, finalConfig);
    if (cached) return cached;

    const resolver = new SchemaResolver(
      this.host as unknown as JetValidator,
      finalConfig,
    );
    const resolved = resolver.resolveSync(schema);

    const validator = this.compileResolved(
      resolved.schema,
      schema,
      resolved.refables,
      resolved.allFormats,
      resolved.keywords,
      finalConfig,
      resolved.compileContext,
    );

    this.storeCachedValidator(schema, finalConfig, validator);
    return validator;
  }

  async compileAsync(
    fschema: SchemaDefinition | boolean,
    finalConfig: Required<ValidatorOptions>,
  ): Promise<ErrorAttachedValidatorFn> {
    const schema =
      typeof fschema === "boolean" ? fschema : (fschema as SchemaDefinition);

    const cached = this.getCachedValidator(schema, finalConfig);
    if (cached) return cached;

    const resolver = new SchemaResolver(
      this.host as unknown as JetValidator,
      finalConfig,
    );
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

    this.storeCachedValidator(schema, finalConfig, validator);
    return validator;
  }

  private emitSchemaSource(
    compiler: Compiler,
    resolvedSchema: SchemaDefinition | boolean,
    compileContext: CompileContext,
    rootPath: RootPath,
    functionName: string,
  ): string {
    const includesItemsRef = compileContext.hasUnevaluatedItems;
    const includesPropRef = compileContext.hasUnevaluatedProperties;
    const extra = {
      after: "",
      predicate: false,
      before: "",
      noreturn: false,
      refAfter: "",
      errorVar: "allErrors",
      functionName,
    };

    if (!compileContext.hasRootReference) {
      return compiler.compileSchema(
        resolvedSchema,
        undefined,
        undefined,
        extra,
      );
    }

    const state: TrackingState = {
      parentHasUnevaluatedProperties: includesPropRef,
      parentUnevaluatedPropVar: includesPropRef ? "eP" : undefined,
      parentHasUnevaluatedItems: includesItemsRef,
      parentUnevaluatedItemVar: includesItemsRef ? "eI" : undefined,
    };

    return compiler.compileSchema(
      resolvedSchema,
      {
        schema: rootPath.schema,
        data: rootPath.data,
        rootDataVar: "rootData",
        fullAccess: [],
        accessPattern: "rootData",
      },
      state,
      extra,
    );
  }

  private buildFunctionDeclaration(
    name: string,
    compileContext: CompileContext,
  ): string {
    let decl = `${name}(rootData`;
    if (compileContext.hasRootReference) {
      if (compileContext.hasUnevaluatedProperties) decl += ",eP";
      if (compileContext.hasUnevaluatedItems) decl += ",eI";
      decl += ",path";
    }
    return decl + ")";
  }

  private toRuntimeFormat(validator: FormatDefinition): any {
    return typeof validator === "function" || validator instanceof RegExp
      ? validator
      : validator.validate;
  }

  private formatNamesForData(
    fconfig: Required<ValidatorOptions>,
  ): Iterable<string> {
    return Array.isArray(fconfig.formats) && fconfig.formats.length > 0
      ? fconfig.formats
      : Object.keys(this.host.getAllFormats());
  }

  private compileResolved(
    resolvedSchema: SchemaDefinition | boolean,
    mainSchema: SchemaDefinition | boolean,
    refables: any[],
    allFormats: Set<string>,
    allKeywords: Set<string>,
    fconfig: Required<ValidatorOptions>,
    compileContext: CompileContext,
  ): ErrorAttachedValidatorFn {
    const has$Data = compileContext.uses$Data;
    if (typeof resolvedSchema === "boolean") fconfig.allErrors = false;
    const compiler = new Compiler(
      refables,
      mainSchema,
      fconfig,
      this.host as unknown as JetValidator,
      allKeywords,
      compileContext,
      false,
    );

    const source = this.emitSchemaSource(
      compiler,
      resolvedSchema,
      compileContext,
      { schema: "#", data: "" },
      "validate",
    );

    const keywords = compiler.getCompiledKeywords();

    const keywordEntries: Array<
      [string, CompiledValidateFunction | ValidateFunction | SchemaDefinition]
    > = [...keywords.compiledKeywords];
    keywordEntries.push(...keywords.cachedValidateSchema);

    for (const kw of keywords.validateKeywords) {
      const validate = (this.host.getKeyword(kw) as ValidateKeywordDefinition)
        ?.validate;
      if (validate) {
        const safe = keywords.keywordSafeNames.get(kw) ?? kw;
        keywordEntries.push([safe, validate]);
      }
    }

    const keywordParams = keywordEntries.map(([name]) => name);
    const keywordArgs = keywordEntries.map(([, fn]) => fn);

    const functionDeclaration = this.buildFunctionDeclaration(
      "validate",
      compileContext,
    );
    const asyncPrefix = fconfig.async ? "async " : "";

    let finalSource: string = "";
    if (
      compiler.hoistedFunctions.length > 0 ||
      compileContext.hasRootReference
    ) {
      finalSource += joinData.toString();
      if (fconfig.verbose) finalSource += joinSchema.toString();
    }

    finalSource += compiler.hoistedFunctions.join("");
    finalSource += `${asyncPrefix}function ${functionDeclaration}{ `;

    if (compileContext.hasRootReference) {
      if (fconfig.verbose)
        finalSource += 'if (!path) {path = { s: "#", d: "" , prev: null};}';
      else finalSource += 'if (!path) {path = { d: "" , prev: null};}';
    }

    finalSource += source;

    if (resolvedSchema !== true && fconfig.allErrors)
      finalSource += "validate.errors = allErrors;";

    if (fconfig.allErrors)
      finalSource += `return allErrors === null || allErrors.length === 0;`;
    else finalSource += "return true;";

    finalSource += "}return validate;";

    if (fconfig.logFunction) {
      console.log(finalSource);
    }

    const formatValidators: Record<string, any> = {};
    if (typeof resolvedSchema !== "boolean") {
      const names = has$Data
        ? this.formatNamesForData(fconfig)
        : allFormats.size > 0
          ? allFormats
          : null;

      if (names) {
        for (const key of names) {
          const validator = this.host.getFormat(key);
          if (validator)
            formatValidators[key] = this.toRuntimeFormat(validator);
        }
      }
    }

    const regexParams: string[] = [];
    const regexArgs: RegExp[] = [];
    if (compiler.regexCache.size > 0) {
      for (const [key, value] of compiler.regexCache.entries()) {
        regexParams.push(value);
        regexArgs.push(new RegExp(key, "u"));
      }
    }

    const checkUnique = createUniqueChecker();

    return new Function(
      "formatValidators",
      "deepEqual",
      "hasDuplicateItems",
      "len_of",
      ...keywordParams,
      ...regexParams,
      finalSource,
    )(
      formatValidators,
      deepEqual,
      checkUnique,
      len_of,
      ...keywordArgs,
      ...regexArgs,
    ) as ErrorAttachedValidatorFn;
  }
  //#endregion

  //#region standalone
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
    const code: string[] = [];
    const formatImports: string[] = [];
    const config = this.buildConfig(sconfig);
    const generatedFunctionName =
      gopts?.functionName ?? "validate" + this.counter++;

    const resolver = new SchemaResolver(
      this.host as unknown as JetValidator,
      config,
    );
    resolver.rootFunctionName = generatedFunctionName;
    const resolved = resolver.resolveSync(schema);
    const has$Data = resolved.compileContext.uses$Data;

    const compiler = new Compiler(
      resolved.refables,
      schema,
      config,
      this.host as unknown as JetValidator,
      resolved.keywords,
      resolved.compileContext,
      true,
    );

    const source = this.emitSchemaSource(
      compiler,
      resolved.schema,
      resolved.compileContext,
      { schema: "#", data: "" },
      generatedFunctionName,
    );

    const keywords = compiler.getCompiledKeywords();

    if (keywords.hasCompileKeyword) {
      code.push(`const compilerOptions = ${JSON.stringify(config)};\n`);
      code.push(`const mainRootSchema = ${JSON.stringify(schema)};\n`);
    }

    for (const [vn, schema] of keywords.cachedValidateSchema.entries()) {
      code.push(`const ${vn} = ${JSON.stringify(schema)}`);
    }

    code.push(compiler.hoistedKeywords.join("\n"));

    for (const kw of keywords.validateKeywords) {
      const validate = (this.host.getKeyword(kw) as ValidateKeywordDefinition)
        ?.validate;
      if (validate) {
        const safe = keywords.keywordSafeNames.get(kw) ?? kw;
        code.push(`const ${safe} = ${validate.toString()};\n`);
      }
    }

    if (compiler.needslen_of) code.push(len_of.toString());

    if (compiler.needsDeepEqual) code.push(deepEqual.toString());

    if (compiler.needsUniqueChecker) {
      code.push(createUniqueChecker.toString() + ";");
      code.push(`const hasDuplicateItems = createUniqueChecker();`);
    }

    if (
      compiler.hoistedFunctions.length > 0 ||
      resolved.compileContext.hasRootReference
    ) {
      code.push(joinData.toString());
      if (config.verbose) code.push(joinSchema.toString());
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

    if (compiler.regexCache.size > 0) {
      for (const [key, value] of compiler.regexCache.entries()) {
        code.push(`const ${value} = new RegExp(${JSON.stringify(key)});\n`);
      }
    }

    code.push(compiler.hoistedFunctions.join(""));

    const asyncPrefix = config.async ? "async " : "";
    const functionDeclaration = this.buildFunctionDeclaration(
      generatedFunctionName,
      resolved.compileContext,
    );

    let finalSource = `${asyncPrefix}function ${functionDeclaration} {`;

    if (resolved.compileContext.hasRootReference) {
      if (config.verbose)
        finalSource += 'if (!path) {path = { s: "#", d: "" , prev: null};}';
      else finalSource += 'if (!path) {path = { d: "" , prev: null};}';
    }
    finalSource += source;
    
    if (resolved.schema !== true && config.allErrors)
      finalSource += `${generatedFunctionName}.errors = allErrors;`;

    if (config.allErrors)
      finalSource += `return allErrors === null || allErrors.length === 0;`;
    else finalSource += "return true;";

    finalSource += "}";

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

  private regexFormatSource(formatName: string, regex: RegExp): string {
    const safeName = this.getSafeFormatName(formatName);
    return `const ${safeName} = new RegExp(${JSON.stringify(regex.source)}, '${
      regex.flags
    }');\n`;
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

      const validator = this.host.getFormat(formatName);

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
      code.push(this.regexFormatSource(formatName, validator));
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

        const validator = this.host.getFormat(formatName);
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
      const validators = this.host.getAllFormats();

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
      code.push(this.regexFormatSource(formatName, validator));
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
    const validator = this.host.getFormat(formatName);
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
    const validator = this.host.getFormat(formatName);

    if (!validator) return "";

    if (validator instanceof RegExp) {
      return this.regexFormatSource(formatName, validator);
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
  //#endregion
}
