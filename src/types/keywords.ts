

import { Extra } from "../compileSchema";
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

export interface CompileContext {
  schemaPath: string; 
  rootSchema: SchemaDefinition; 
  opts: ValidatorOptions; 
}

export type CompileFunction = (
  schemaValue: any, 
  parentSchema: SchemaDefinition, 
  context: CompileContext, 
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

interface KeywordValidationError {
  message: string;
  [key: string]: any;
}

export type CodeFunction = (
  schemaValue: any,
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
  dataVar: string; 
  dataPath: string; 
  schemaPath: string; 
  accessPattern?: string; 
  errorVariable?: string; 
  allErrors: boolean;
  functionName: string;
  extra: Extra;
  buildError(error: codeError): string;
  addEvaluatedProperty(prop: any): string;
  addEvaluatedItem(item: any): string;
}
