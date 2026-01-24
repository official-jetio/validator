import { SchemaType } from "./schema";

export type FormatDefinition =
  | RegExp
  | ((value: any) => boolean)
  | FormatValidate;

export interface FormatValidate {
  async?: boolean;
  type?: SchemaType;
  validate: RegExp | ((value: any) => boolean | Promise<boolean>);
}
