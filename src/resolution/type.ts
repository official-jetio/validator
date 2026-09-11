import { CompileContext, SchemaError } from "../types/resolver";
import { ValidatorOptions } from "../types/validation";

export interface ResolutionContext {
  isRootResolution: boolean;
  refToFunctionName: Map<string, string>;
  currentSchemaPath: string;
  schemaId?: string;
  rootHash?: string;
  localSchemaIds?: string[];
}

export interface InitializedResolutionContext extends ResolutionContext {
  refToFunctionName: Map<string, string>;
}

export interface SchemaIdentifierEntry {
  schemaPath: string;
  identifier: string;
  parentSchemaId?: string;
}

export interface SchemaTraversalState {
  currentPath: string;
  basePath: string;
  anchorToPathMap: Record<string, string>;
  dynamicAnchorToPathMap: Record<string, string>;
  collectedRefs: string[];
  identifiers: SchemaIdentifierEntry[];
  pathsContainingRefs: Set<string>;
  pathsWithRef: string[];
  contextId?: string;
}

export interface SchemaMetadataCtx {
  options: ValidatorOptions;
  jetValidator: { getAllKeywords(): { has(keyword: string): boolean } };
  compilationContext: CompileContext;
  discoveredFormats: Set<string>;
  discoveredCustomKeywords: Set<string>;
  schemaErrors: SchemaError;
}
