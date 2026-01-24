import * as path from "path";
import * as fs from "fs/promises";

export type SchemaVersion =
  | "draft-06"
  | "draft-07"
  | "draft/2019-09"
  | "draft/2020-12"
  | "all";

const METASCHEMA_CONFIGS = {
  "draft-06": {
    main: "https://json-schema.org/draft-06/schema",
    subSchemas: [],
  },
  "draft-07": {
    main: "https://json-schema.org/draft-07/schema",
    subSchemas: [],
  },
  "draft/2019-09": {
    main: "https://json-schema.org/draft/2019-09/schema",
    subSchemas: [
      "https://json-schema.org/draft/2019-09/meta/core",
      "https://json-schema.org/draft/2019-09/meta/applicator",
      "https://json-schema.org/draft/2019-09/meta/validation",
      "https://json-schema.org/draft/2019-09/meta/meta-data",
      "https://json-schema.org/draft/2019-09/meta/format",
      "https://json-schema.org/draft/2019-09/meta/content",
    ],
  },
  "draft/2020-12": {
    main: "https://json-schema.org/draft/2020-12/schema",
    subSchemas: [
      "https://json-schema.org/draft/2020-12/meta/core",
      "https://json-schema.org/draft/2020-12/meta/applicator",
      "https://json-schema.org/draft/2020-12/meta/unevaluated",
      "https://json-schema.org/draft/2020-12/meta/validation",
      "https://json-schema.org/draft/2020-12/meta/meta-data",
      "https://json-schema.org/draft/2020-12/meta/format-annotation",
      "https://json-schema.org/draft/2020-12/meta/content",
    ],
  },
};

async function fetchSchema(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return await response.json();
}

async function loadSingleVersion(
  version: Exclude<SchemaVersion, "all">,
  baseOutputDir: string = "./meta-schemas",
): Promise<void> {
  const config = METASCHEMA_CONFIGS[version];
  const outputDir = path.join(baseOutputDir, version);

  await fs.mkdir(outputDir, { recursive: true });

  const mainSchema = await fetchSchema(config.main);
  const strippedMain = mainSchema;

  const mainFile = path.join(outputDir, "schema.json");
  await fs.writeFile(mainFile, JSON.stringify(strippedMain, null, 2));
  console.log(`  ✓ ${mainFile}`);

  for (const subUrl of config.subSchemas) {
    const subSchema = await fetchSchema(subUrl);
    const strippedSub = subSchema;

    const metaDir = path.join(outputDir, "meta");
    await fs.mkdir(metaDir, { recursive: true });

    const filename = subUrl.split("/meta/")[1] + ".json";
    const filepath = path.join(metaDir, filename);

    await fs.writeFile(filepath, JSON.stringify(strippedSub, null, 2));
    console.log(`  ✓ ${filepath}`);
  }

  console.log(`✓ Saved ${version} to ${outputDir}\n`);
}

async function parseExistingLoader(
  loaderPath: string,
): Promise<Set<keyof typeof METASCHEMA_CONFIGS> | null> {
  try {
    const content = await fs.readFile(loaderPath, "utf-8");
    const existingVersions = new Set<keyof typeof METASCHEMA_CONFIGS>();

    for (const version of Object.keys(METASCHEMA_CONFIGS)) {
      const funcName =
        "load" +
        version.replace(/^draft[-\/]/, "Draft").replace(/[-\/\.]/g, "");
      if (content.includes(`function ${funcName}(`)) {
        existingVersions.add(version as keyof typeof METASCHEMA_CONFIGS);
      }
    }

    return existingVersions.size > 0 ? existingVersions : null;
  } catch {
    return null;
  }
}

async function generateLoaderFiles(
  outputDir: string,
  loadedVersions: Set<keyof typeof METASCHEMA_CONFIGS>,
): Promise<void> {
  const loaderJsPath = path.join(outputDir, "loader.js");
  const loaderDtsPath = path.join(outputDir, "loader.d.ts");

  const existingVersions = await parseExistingLoader(loaderJsPath);
  const allVersions = new Set([...(existingVersions || []), ...loadedVersions]);

  let jsImports = "";
  let jsLoadFunctions = "";
  let dtsExports = "";
  const functionNames: string[] = [];

  for (const version of allVersions) {
    const config = METASCHEMA_CONFIGS[version];

    const funcName =
      "load" + version.replace(/^draft[-\/]/, "Draft").replace(/[-\/\.]/g, "");
    functionNames.push(funcName);

    const mainImportName = `schema_${version.replace(/[-\/\.]/g, "_")}`;
    jsImports += `const ${mainImportName} = require('./${version}/schema.json');\n`;

    const subImports: Array<{ name: string; url: string }> = [];
    for (const subUrl of config.subSchemas) {
      const filename = subUrl.split("/meta/")[1];
      const subImportName = `schema_${version.replace(
        /[-\/\.]/g,
        "_",
      )}_${filename.replace(/[-\/\.]/g, "_")}`;

      jsImports += `const ${subImportName} = require('./${version}/meta/${filename}.json');\n`;
      subImports.push({ name: subImportName, url: subUrl });
    }

    jsImports += "\n";

    jsLoadFunctions += `function ${funcName}(jetValidator) {
  jetValidator.addMetaSchema(${mainImportName}, '${config.main}');
  jetValidator.addMetaSchema(${mainImportName}, '${version}');
  
`;

    for (const sub of subImports) {
      jsLoadFunctions += `  jetValidator.addMetaSchema(${sub.name}, '${sub.url}');\n`;
      const relativePath = sub.url.split("/meta/")[1];
      if (relativePath) {
        jsLoadFunctions += `  jetValidator.addMetaSchema(${sub.name}, '${version}/meta/${relativePath}');\n`;
      }
    }

    jsLoadFunctions += `}\n\n`;

    dtsExports += `export function ${funcName}(jetValidator: any): void;\n`;
  }

  jsLoadFunctions += `function loadAllMetaSchemas(jetValidator) {
`;

  for (const funcName of functionNames) {
    jsLoadFunctions += `  ${funcName}(jetValidator);\n`;
  }

  jsLoadFunctions += `}\n\n`;

  dtsExports += `export function loadAllMetaSchemas(jetValidator: any): void;\n`;
  const jsExports = functionNames.map((name) => name).join(",\n  ");
  const jsContent = `/**
 * Auto-generated meta-schema loader
 * Generated by: jetvalidator-meta load
 * 
 * Usage:
 *   const { loadDraft07, loadAllMetaSchemas } = require('./loader');
 *   
 *   const jetValidator = new JetValidator();
 *   loadDraft07(jetValidator); // Load specific version
 *   // OR
 *   loadAllMetaSchemas(jetValidator); // Load all versions
 */

${jsImports}
${jsLoadFunctions}
module.exports = {
  ${jsExports},
  loadAllMetaSchemas
};
`;

  const dtsContent = `/**
 * Auto-generated meta-schema loader
 * Generated by: jetvalidator-meta load
 */

${dtsExports}`;

  await fs.writeFile(loaderJsPath, jsContent);
  await fs.writeFile(loaderDtsPath, dtsContent);

  const isAppending = existingVersions && existingVersions.size > 0;

  console.log(`\n✓ ${isAppending ? "Updated" : "Generated"}: ${loaderJsPath}`);
  console.log(`✓ ${isAppending ? "Updated" : "Generated"}: ${loaderDtsPath}`);
  if (isAppending) {
    console.log(`  (Merged with ${existingVersions.size} existing version(s))`);
  }
  console.log(`\nUsage (CommonJS):`);
  console.log(
    `  const { ${functionNames.join(
      ", ",
    )}, loadAllMetaSchemas } = require('${outputDir}/loader');\n`,
  );
  console.log(`Usage (ES Modules):`);
  console.log(
    `  import { ${functionNames.join(
      ", ",
    )}, loadAllMetaSchemas } from '${outputDir}/loader';\n`,
  );
}

export async function loadMetaschema(
  version: SchemaVersion,
  outputDir: string = "./meta-schemas",
): Promise<void> {
  const loadedVersions = new Set<keyof typeof METASCHEMA_CONFIGS>();

  if (version === "all") {
    const versions = Object.keys(METASCHEMA_CONFIGS) as Exclude<
      SchemaVersion,
      "all"
    >[];
    for (const v of versions) {
      await loadSingleVersion(v, outputDir);
      loadedVersions.add(v);
    }
  } else {
    await loadSingleVersion(version, outputDir);
    loadedVersions.add(version);
  }

  await generateLoaderFiles(outputDir, loadedVersions);
}
