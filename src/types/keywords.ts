// types/keywords.ts

import { Extra } from "../compileSchema";
import { SchemaDefinition, SchemaType } from "./schema";
import { ValidatorOptions } from "./validation";

export interface KeywordDefinition {
  keyword: string; // Name of the keyword
  type?: SchemaType; // Only apply to these types (optional)
  schemaType?: SchemaType; // Expected type of keyword value (optional)
  implements?: string | string[]; // Other keywords this handles (optional)
  async?: boolean;
  // Macro function

  // Metadata
  metaSchema?: SchemaDefinition; // Schema to validate keyword value
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

export type MacroFunction<TValue = unknown> = (
  schemaValue: TValue, // The keyword's value
  parentSchema: SchemaDefinition, // Full schema
  context?: MacroContext, // Compilation context
) => SchemaDefinition | boolean; // Returns expanded schema

export interface MacroContext {
  schemaPath: string; // Path in schema
  rootSchema: SchemaDefinition; // Root schema
  opts: ValidatorOptions; // Validator options
}

export interface CompileContext {
  schemaPath: string; // Path in schema
  rootSchema: SchemaDefinition; // Root schema
  opts: ValidatorOptions; // Validator options
}

// Placeholder types for future
export type CompileFunction<
  TValue = unknown,
  TData = unknown,
  TRootData = unknown,
> = (
  schemaValue: TValue, // The keyword's value in schema
  parentSchema: SchemaDefinition, // Full schema
  context: CompileContext, // Compilation context
) => CompiledValidateFunction<TData, TRootData>;

export type CompiledValidateFunction<TData = unknown, TRootData = unknown> = (
  data: TData, // Current data being validated
  rootData: TRootData, // Original data passed to validate()
  dataPath: string,
) =>
  | boolean
  | KeywordValidationError
  | Promise<boolean | KeywordValidationError>;

export type ValidateFunction<
  TValue = unknown,
  TData = unknown,
  TRootData = unknown,
> = (
  schemaValue: TValue, // Keyword value from schema
  data: TData, // Current data being validated
  parentSchema: SchemaDefinition,
  dataContext: ValidateDataContext<TRootData>,
) =>
  | boolean
  | KeywordValidationError
  | Promise<boolean | KeywordValidationError>;

export interface ValidateDataContext<TRootData = unknown> {
  dataPath: string; // Where in data (e.g., "/user/age")
  rootData: TRootData; // Original data
  schemaPath: string; // Where in schema
  parentData?: unknown;
  parentDataProperty?: string | number;
}

interface KeywordValidationError {
  message: string;
  [key: string]: any;
}

export type CodeFunction<TValue = unknown> = (
  schemaValue: TValue,
  parentSchema: SchemaDefinition,
  context: CodeContext,
) => string;

export type codeError = {
  keyword?: string;
  message: string;
  expected?: string;
  value?: string;
  [key: string]: any;
};
export interface CodeContext {
  dataVar: string; // Variable name for current data (e.g., "var1")
  dataPath: string; // Path to data (e.g., "/user/email")
  schemaPath: string; // Path in schema (e.g., "#/properties/user/properties/email")
  accessPattern?: string; // Full access pattern (e.g., "var1['email']"),
  errorVariable?: string; // ← ADD THIS: "allErrors" or undefined
  allErrors: boolean;
  functionName: string;
  extra: Extra;
  buildError(error: codeError): string;
  addEvaluatedProperty(prop: any): string;
  addEvaluatedItem(item: any): string;
}
