import { JetValidator, ValidatorOptions } from "..";
import { MacroKeywordDefinition } from "../types/keywords";
import { SchemaDefinition } from "../types/schema";
import {
  encodePointerSegment,
  shouldApplyKeyword,
  validateKeywordValue,
} from "../utilities/resolver";

type MinorCtx = {
  jetValidator: JetValidator;
  options: ValidatorOptions;
};

export function expandMacros(
  schema: SchemaDefinition,
  macroContext: {
    schemaPath: string;
    rootSchema: SchemaDefinition;
  },
  ctx: MinorCtx,
): SchemaDefinition {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }

  let expandedSchema = schema;
  const implementedKeywords = new Set<string>();

  for (const [keyword, value] of Object.entries(schema)) {
    const keywordDef = ctx.jetValidator.getKeyword(
      keyword,
    ) as MacroKeywordDefinition;

    if (!keywordDef?.macro) continue;
    if (!shouldApplyKeyword(keywordDef, value)) continue;

    if (keywordDef.metaSchema) {
      validateKeywordValue(
        keyword,
        value,
        keywordDef.metaSchema,
        ctx.jetValidator,
      );
    }

    const macroResult = keywordDef.macro(value, schema, {
      schemaPath: `${macroContext.schemaPath}/${keyword}`,
      rootSchema: macroContext.rootSchema,
      opts: { ...ctx.options },
    });

    if (typeof macroResult === "object" && macroResult !== null) {
      Object.assign(expandedSchema, macroResult);
    } else {
      expandedSchema = macroResult as any;
      break;
    }

    delete expandedSchema[keyword];

    if (keywordDef.implements) {
      const implemented = Array.isArray(keywordDef.implements)
        ? keywordDef.implements
        : [keywordDef.implements];
      implemented.forEach((k) => implementedKeywords.add(k));
    }
  }

  for (const implKeyword of Array.from(implementedKeywords)) {
    delete expandedSchema[implKeyword];
  }

  expandedSchema = expandMacrosRecursively(expandedSchema, macroContext, ctx);
  return expandedSchema;
}

function expandMacrosRecursively(
  schema: SchemaDefinition,
  macroContext: { schemaPath: string; rootSchema: SchemaDefinition },
  ctx: MinorCtx,
): SchemaDefinition {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }

  const expandNestedSchema = (
    key: keyof SchemaDefinition,
    pathSegment: string,
  ) => {
    if (
      schema[key] &&
      typeof schema[key] === "object" &&
      !Array.isArray(schema[key])
    ) {
      schema[key] = expandMacros(
        schema[key] as SchemaDefinition,
        {
          schemaPath: `${macroContext.schemaPath}/${pathSegment}`,
          rootSchema: macroContext.rootSchema,
        },
        ctx,
      );
    }
  };

  const expandSchemaMap = (
    key:
      | "properties"
      | "patternProperties"
      | "dependentSchemas"
      | "$defs"
      | "definitions",
  ) => {
    if (schema[key]) {
      for (const [propKey, propSchema] of Object.entries(
        schema[key] as Record<string, SchemaDefinition>,
      )) {
        if (typeof propSchema === "object" && propSchema !== null) {
          schema[key]![propKey] = expandMacros(
            propSchema,
            {
              schemaPath: `${macroContext.schemaPath}/${key}/${encodePointerSegment(propKey)}`,
              rootSchema: macroContext.rootSchema,
            },
            ctx,
          );
        }
      }
    }
  };

  const expandSchemaArray = (
    key: "allOf" | "anyOf" | "oneOf" | "prefixItems" | "items",
  ) => {
    if (schema[key] && Array.isArray(schema[key])) {
      schema[key] = (schema[key] as SchemaDefinition[]).map((subSchema, i) =>
        typeof subSchema === "object" && subSchema !== null
          ? expandMacros(
              subSchema,
              {
                schemaPath: `${macroContext.schemaPath}/${key}/${i}`,
                rootSchema: macroContext.rootSchema,
              },
              ctx,
            )
          : subSchema,
      );
    }
  };

  expandSchemaMap("properties");
  expandSchemaMap("patternProperties");
  expandSchemaMap("dependentSchemas");
  expandSchemaMap("$defs");
  expandSchemaMap("definitions");

  if (schema.items) {
    if (Array.isArray(schema.items)) {
      expandSchemaArray("items");
    } else {
      expandNestedSchema("items", "items");
    }
  }

  expandSchemaArray("prefixItems");
  for (const combiner of ["allOf", "anyOf", "oneOf"] as const) {
    expandSchemaArray(combiner);
  }

  expandNestedSchema("contains", "contains");
  expandNestedSchema("not", "not");
  expandNestedSchema("if", "if");
  expandNestedSchema("then", "then");
  expandNestedSchema("additionalProperties", "additionalProperties");
  expandNestedSchema("unevaluatedProperties", "unevaluatedProperties");
  expandNestedSchema("propertyNames", "propertyNames");
  expandNestedSchema("additionalItems", "additionalItems");
  expandNestedSchema("unevaluatedItems", "unevaluatedItems");

  if (schema.elseIf && Array.isArray(schema.elseIf)) {
    schema.elseIf = schema.elseIf.map((elseIfItem, i) => {
      const expandedElseIf: any = {};

      if (elseIfItem.if && typeof elseIfItem.if === "object") {
        expandedElseIf.if = expandMacros(
          elseIfItem.if as SchemaDefinition,
          {
            schemaPath: `${macroContext.schemaPath}/elseIf/${i}/if`,
            rootSchema: macroContext.rootSchema,
          },
          ctx,
        );
      }

      if (elseIfItem.then && typeof elseIfItem.then === "object") {
        expandedElseIf.then = expandMacros(
          elseIfItem.then as SchemaDefinition,
          {
            schemaPath: `${macroContext.schemaPath}/elseIf/${i}/then`,
            rootSchema: macroContext.rootSchema,
          },
          ctx,
        );
      }

      return expandedElseIf;
    });
  }

  expandNestedSchema("else", "else");
  return schema;
}
