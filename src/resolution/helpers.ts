import { splitUrlIntoPathAndFragment } from "../utilities/resolver";
import { SchemaTraversalState } from "./type";

export function resolveAndRegisterSchemaId(
  schema: any,
  state: SchemaTraversalState,
): string {
  let resolvedId: string;

  if (schema.$id.startsWith("http")) {
    resolvedId = schema.$id;
  } else if (state.contextId?.startsWith("http")) {
    resolvedId = new URL(schema.$id, state.contextId).href;
    schema.$id = resolvedId;
  } else {
    resolvedId = schema.$id;
  }

  state.identifiers.push({
    schemaPath: state.currentPath,
    identifier: resolvedId,
  });

  return resolvedId;
}

export function registerAnchor(schema: any, state: SchemaTraversalState): void {
  const anchorName = schema.$anchor;

  state.anchorToPathMap[anchorName] = state.currentPath;

  if (schema.$id) {
    state.identifiers.push(
      {
        schemaPath: state.currentPath,
        identifier: anchorName + ":ANCHOR",
        parentSchemaId: schema.$id,
      },
      {
        schemaPath: state.currentPath,
        identifier: schema.$id + "#" + anchorName + ":ANCHOR",
        parentSchemaId: schema.$id,
      },
    );
  } else {
    state.identifiers.push({
      schemaPath: state.currentPath,
      identifier: anchorName + ":ANCHOR",
    });

    if (state.contextId) {
      state.identifiers.push({
        schemaPath: state.currentPath,
        identifier: state.contextId + "#" + anchorName + ":ANCHOR",
      });
    }
  }
}

export function registerDynamicAnchor(
  schema: any,
  state: SchemaTraversalState,
  alreadyRegisteredAnchors: string[],
): void {
  const dynamicAnchorName = schema.$dynamicAnchor;
  const dynamicAnchorKey = dynamicAnchorName + ":DYNAMIC";

  if (alreadyRegisteredAnchors.includes(dynamicAnchorKey)) {
    return;
  }

  state.dynamicAnchorToPathMap[dynamicAnchorName] = state.currentPath;

  if (schema.$id) {
    alreadyRegisteredAnchors.push(dynamicAnchorKey);
    const isRootSchema = state.basePath === "#";


    state.identifiers.push(
      {
        schemaPath: state.currentPath,
        identifier: schema.$id + "#" + dynamicAnchorKey,
        parentSchemaId: isRootSchema ? schema.$id : undefined,
      },
      {
        schemaPath: state.currentPath,
        identifier: dynamicAnchorKey,
        parentSchemaId: isRootSchema ? schema.$id : undefined,
      },
    );
  } else {
    state.identifiers.push(
      {
        schemaPath: state.currentPath,
        identifier: dynamicAnchorKey,
      },
      {
        schemaPath: state.currentPath,
        identifier: state.contextId + "#" + dynamicAnchorKey,
      },
    );
  }
}

export function processReference(
  schema: any,
  state: SchemaTraversalState,
): void {
  const rawRef = schema.$ref;
  let resolvedRef: string;

  if (rawRef.startsWith("#/")) {
    const basePath = state.basePath;
    resolvedRef = basePath ? basePath + rawRef.slice(1) : rawRef;
  } else if (rawRef.startsWith("#")) {
    if (rawRef === "#") {
      resolvedRef = rawRef;
    } else {
      const anchorName = rawRef.slice(1);
      resolvedRef = state.anchorToPathMap[anchorName] || rawRef + ":ANCHOR";
    }
  } else {
    let absoluteUrl: string;

    if (rawRef.startsWith("http")) {
      absoluteUrl = rawRef;
    } else if (state.contextId?.startsWith("http")) {
      absoluteUrl = new URL(rawRef, state.contextId).href;
    } else {
      absoluteUrl = rawRef;
    }

    if (absoluteUrl.includes("#")) {
      const urlParts = splitUrlIntoPathAndFragment(absoluteUrl);
      const isAnchorFragment =
        urlParts.hash &&
        urlParts.hash !== "#" &&
        !urlParts.hash.startsWith("#/");
      resolvedRef = isAnchorFragment ? absoluteUrl + ":ANCHOR" : absoluteUrl;
    } else {
      resolvedRef = absoluteUrl;
    }
  }

  schema.$ref = resolvedRef;
  state.collectedRefs.push(resolvedRef);
}

export function processDynamicReference(
  schema: any,
  state: SchemaTraversalState,
): void {
  const rawDynamicRef = schema.$dynamicRef;
  let resolvedDynamicRef: string;

  const currentContextId = state.contextId;
  if (rawDynamicRef.startsWith("#/")) {
    resolvedDynamicRef = state.basePath + rawDynamicRef.slice(1);
  } else if (rawDynamicRef.startsWith("#")) {
    if (rawDynamicRef === "#") {
      resolvedDynamicRef = rawDynamicRef;
    } else {
      resolvedDynamicRef = currentContextId + rawDynamicRef + ":DYNAMIC";
    }
  } else {
    let absoluteUrl: string;

    if (rawDynamicRef.startsWith("http")) {
      absoluteUrl = rawDynamicRef;
    } else {
      absoluteUrl = new URL(rawDynamicRef, currentContextId).href;
    }

    if (absoluteUrl.includes("#")) {
      const urlParts = splitUrlIntoPathAndFragment(absoluteUrl);

      const hasAnchorFragment =
        urlParts.hash &&
        urlParts.hash !== "#" &&
        !urlParts.hash.startsWith("#/");
      resolvedDynamicRef = hasAnchorFragment
        ? absoluteUrl + ":DYNAMIC"
        : absoluteUrl;
    } else {
      resolvedDynamicRef = absoluteUrl;
    }
  }

  state.collectedRefs.push(resolvedDynamicRef);
  schema.$dynamicRef = resolvedDynamicRef;
}

const DEFINITION_KEYWORDS = new Set(["$defs", "definitions"]);

export function markPathsContainingRefs(
  currentPath: string,
  pathsContainingRefs: Set<string>,
): void {
  pathsContainingRefs.add(currentPath);

  const pathSegments = currentPath
    .slice(1)
    .split("/")
    .filter((segment) => segment);

  for (let i = pathSegments.length - 1; i > 0; i--) {
    if (DEFINITION_KEYWORDS.has(pathSegments[i - 1])) {
      break;
    }
    const parentPath = "#/" + pathSegments.slice(0, i).join("/");
    pathsContainingRefs.add(parentPath);
  }

  if (pathSegments.length > 0 && !DEFINITION_KEYWORDS.has(pathSegments[0])) {
    pathsContainingRefs.add("#");
  }
}
