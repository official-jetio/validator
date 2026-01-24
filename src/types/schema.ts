export type PrimitiveType = "string" | "number" | "boolean" | "integer";
export type BaseType = PrimitiveType | "array" | "object" | "null";
export type SchemaType = BaseType | BaseType[];
export interface PrimitiveSchema {
  type: PrimitiveType;
  minLength?: number | $data;
  maxLength?: number | $data;
  pattern?: string | $data;
  format?: string | $data;
  minimum?: number | $data;
  maximum?: number | $data;
  exclusiveMinimum?: number | $data;
  exclusiveMaximum?: number | $data;
  multipleOf?: number | $data;
  default?: any;
}

export interface ArraySchema {
  type: "array";
  prefixItems?: (SchemaDefinition | boolean)[];
  items?: SchemaDefinition | (SchemaDefinition | boolean)[] | boolean;
  minItems?: number | $data;
  maxItems?: number | $data;
  contains?: SchemaDefinition | boolean;
  uniqueItems?: boolean | $data;
  additionalItems?: SchemaDefinition | boolean;
  unevaluatedItems?: SchemaDefinition | boolean;
  minContains?: number | $data;
  maxContains?: number | $data;
  default?: any;
}

export interface ObjectSchema {
  type: "object";
  properties?: Record<string, SchemaDefinition>;
  maxProperties?: number | $data;
  minProperties?: number | $data;
  patternProperties?: Record<string, SchemaDefinition>;
  propertyNames?: SchemaDefinition;
  dependentRequired?: Record<string, string[]>;
  dependentSchemas?: Record<string, SchemaDefinition>;
  dependencies?: Record<string, string[] | SchemaDefinition>;
  required?: string[] | $data;
  additionalProperties?: SchemaDefinition | boolean;
  unevaluatedProperties?: SchemaDefinition | boolean;
  default?: any;
}

export type $data = { $data: string };
export interface BaseSchema<T = any> {
  $id?: string;
  $schema?: string;
  type?: SchemaType;
  minLength?: number | $data;
  maxLength?: number | $data;
  pattern?: string | $data;
  format?: string | $data;
  formatMode?: "fast" | "full";
  minimum?: number | $data;
  maximum?: number | $data;
  exclusiveMinimum?: number | $data;
  exclusiveMaximum?: number | $data;
  multipleOf?: number | $data;
  $vocabulary?: Record<string, boolean>;
  // ArraySchema properties
  items?: SchemaDefinition | (SchemaDefinition | boolean)[] | boolean;
  prefixItems?: (SchemaDefinition | boolean)[];
  minItems?: number | $data;
  maxItems?: number | $data;
  contains?: SchemaDefinition | boolean;
  uniqueItems?: boolean | $data;
  additionalItems?: SchemaDefinition | boolean;
  unevaluatedItems?: SchemaDefinition | boolean;
  minContains?: number | $data;
  maxContains?: number | $data;
  // ObjectSchema properties
  properties?: T extends object
    ? { [K in keyof T]?: SchemaDefinition | boolean }
    : Record<string, SchemaDefinition | boolean>;
  maxProperties?: number | $data;
  minProperties?: number | $data;
  patternProperties?: Record<string, SchemaDefinition | boolean>;
  propertyNames?: SchemaDefinition | boolean;
  dependentRequired?: Record<string, string[]>;
  dependentSchemas?: Record<string, SchemaDefinition | boolean>;
  dependencies?: Record<string, string[] | SchemaDefinition>;
  required?: T extends object ? (keyof T)[] : string[] | $data;
  additionalProperties?: SchemaDefinition | boolean;
  unevaluatedProperties?: SchemaDefinition | boolean;
  anyOf?: (SchemaDefinition | boolean)[];
  allOf?: (SchemaDefinition | boolean)[];
  not?: SchemaDefinition | boolean;
  oneOf?: (SchemaDefinition | boolean)[];
  if?: SchemaDefinition | boolean;
  then?: SchemaDefinition | boolean;
  elseIf?: { if?: SchemaDefinition; then?: SchemaDefinition }[];
  else?: SchemaDefinition | boolean;
  const?: any | $data;
  enum?: any[] | $data;
  title?: string;
  description?: string;
  examples?: any[];
  default?: any;
  readOnly?: boolean;
  writeOnly?: boolean;
  $ref?: string;
  $dynamicRef?: string;
  $dynamicAnchor?: string;
  $anchor?: string;
  $defs?: Record<string, SchemaDefinition | boolean>;
  definitions?: Record<string, SchemaDefinition | boolean>;

  __functionName?: string;
  allFormats?: string[];
  errorMessage?: string | Record<string, any>;
  [key: string]: any;
}

export type SchemaDefinition<T = any> = BaseSchema<T>;

export type DependencyEntry = {
  required?: string[];
  requiredSource?: "dependencies" | "dependentRequired";
  schema?: any;
  schemaSource?: "dependencies" | "dependentSchemas";
};
