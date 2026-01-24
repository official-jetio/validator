import { SchemaDefinition } from "./schema";

export interface ValidationError {
  dataPath: string;
  schemaPath: string;
  rule: string;
  value?: any;
  expected?: any;
  message: string;
  [key: string]: any
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

export type ValidationFunction = (data: any) => boolean;

export type ErrorAttachedValidatorFn = ValidationFunction & {
  errors: ValidationError[];
};

export interface ValidatorOptions {
  allErrors?: boolean;
  draft?: "draft2019-09" | "draft2020-12" | "draft7" | "draft6";
  verbose?: boolean;
  loopEnum?: number;
  debug?: boolean;
  loopRequired?: number;
  $data?: boolean;
  logFunction?: boolean;
  strict?: boolean;
  inlineRefs?: boolean;
  formatMode?: "full" | false | "fast";
  overwrittenFormats?: string[];
  formats?: string[];
  validateFormats?: boolean;
  loadSchema?: (uri: string) => Promise<SchemaDefinition> | SchemaDefinition;
  removeAdditional?: boolean | "all" | "failing";
  useDefaults?: boolean | "empty";
  coerceTypes?: boolean | "array";
  cache?: boolean;
  strictSchema?: boolean;
  metaSchema?: string;
  strictNumbers?: boolean;
  strictRequired?: boolean;
  allowFormatOverride?: boolean;
  strictTypes?: boolean | "log";
  async?: boolean;
  validateSchema?: boolean;
  addUsedSchema?: boolean;
  errorMessage?: boolean;
}

