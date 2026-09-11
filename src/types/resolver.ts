export type SchemaError = {
  schemaId?: string;
  unknownKeywords: { path: string; keyword: string; mode: string }[];
  missingType: {
    path: string;
    validTypes: string[];
    mode: string;
    keyword: string;
  }[];
  strictRequired: { path: string; required: string[]; mode: string }[];
  incompatibleKeywords: {
    errors: { path: string; types: string[]; mode: string; keyword: string }[];
    unknownTypes: { path: string; types: string[] }[];
  };
  invalidKeywordTypes: {
    path: string;
    validType: string;
    data: boolean;
    keyword: string;
  }[];
};

export type CompileContext = {
  hasUnevaluatedProperties: boolean;
  hasUnevaluatedItems: boolean;
  hasRootReference: boolean;
  referencedFunctions: string[];
  uses$Data: boolean;
  inliningStats: {
    totalRefs: number;
    inlinedRefs: number;
  };
};
