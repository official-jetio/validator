import { AccessSegment, Extra } from "./compiler";
import { SchemaDefinition, SchemaType } from "./schema";
import { ValidatorOptions } from "./validation";

export interface KeywordDefinition {
  keyword: string;
  type?: SchemaType;
  schemaType?: SchemaType;
  implements?: string | string[];
  async?: boolean;
  metaSchema?: SchemaDefinition;
}

export interface MacroKeywordDefinition extends KeywordDefinition {
  macro?: MacroFunction;
}

export interface CompileKeywordDefinition extends KeywordDefinition {
  compile?: CompileFunction;
}

export interface ValidateKeywordDefinition extends KeywordDefinition {
  validate?: ValidateFunction;
}

export interface CodeKeywordDefinition extends KeywordDefinition {
  code?: CodeFunction;
}

export type MacroFunction = (
  schemaValue: any,
  parentSchema: SchemaDefinition,
  context?: MacroContext,
) => SchemaDefinition | boolean;

export interface MacroContext {
  schemaPath: string;
  rootSchema: SchemaDefinition;
  opts: ValidatorOptions;
}

export interface CompileKeywordContext {
  schemaPath: string;
  rootSchema: SchemaDefinition;
  opts: ValidatorOptions;
}

export type CompileFunction = (
  schemaValue: any,
  parentSchema: SchemaDefinition,
  context: CompileKeywordContext,
) => CompiledValidateFunction;

export type CompiledValidateFunction = (
  data: any,
  rootData: any,
  dataPath: string,
) =>
  | boolean
  | KeywordValidationError
  | Promise<boolean | KeywordValidationError>;

export type ValidateFunction = (
  schemaValue: any,
  data: any,
  parentSchema: SchemaDefinition,
  dataContext: ValidateDataContext,
) =>
  | boolean
  | KeywordValidationError
  | Promise<boolean | KeywordValidationError>;

export interface ValidateDataContext {
  dataPath: string;
  rootData: any;
  schemaPath: string;
  parentData?: any;
  parentDataProperty?: string | number;
}

export type CodeFunction = (
  schemaValue: any,
  parentSchema: SchemaDefinition,
  context: CodeContext,
) => string;

export type KeywordValidationError = {
  keyword?: string;
  message: string;
  expected?: string;
  value?: string;
  [key: string]: any;
};

export interface CodeContext {
  dataVar: string;
  dataPath: string;
  schemaPath: string;
  fullAccess: ReadonlyArray<AccessSegment>;
  rootDataVar: string;
  errorVariable?: string;
  allErrors: boolean;
  functionName: string;
  resolveDataPointer: (pointer: string) => string;
  buildError(error: KeywordValidationError): string;
  addEvaluatedProperty(prop: string): string;
  addEvaluatedItem(item: number): string;
}
