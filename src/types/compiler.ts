export type Extra = {
  before: string;
  after: string;
  refAfter?: string;
  predicate?: boolean;
  noreturn?: boolean;
  errorVar: string;
  functionName: string;
  first?: boolean;
  inlined?: boolean;
};

export interface ErrorInfo {
  keyword: string;
  value: string;
  message: string;
  expected?: string;
  schemaPath?: string;
}

export type AccessSegment =
  | { kind: "key"; value: string }
  | { kind: "index"; value: number }
  | { kind: "dynamic"; expr: string };

export interface PathContext {
  schema: string;
  data: string;
  fullAccess: AccessSegment[];
  rootDataVar: "rootData" | "data";
  accessPattern: string;
  mapping?: string;
}

export interface TrackingState {
  parentHasUnevaluatedProperties?: boolean;
  hasOwnUnevaluatedProperties?: boolean;
  shouldTrackEvaluatedProperties?: boolean;
  parentUnevaluatedPropVar?: string;
  unevaluatedPropVar?: string;
  unEvaluatedPropertiesSetVar?: string;

  parentHasUnevaluatedItems?: boolean;
  hasOwnUnevaluatedItems?: boolean;
  shouldTrackEvaluatedItems?: boolean;
  parentUnevaluatedItemVar?: string;
  unevaluatedItemVar?: string;
  unEvaluatedItemsSetVar?: string;
}
