import { loadMetaschema } from "./metaschema-loader";
import { SchemaVersion } from "./metaschema-loader";
import * as path from "path";

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "load") {
    args.shift();
  }

  const version = args[0] || "all";
  const outputDir = args[1] || "./meta-schemas";

  console.log(`Loading meta-schema: ${version}`);
  console.log(`Output directory: ${path.resolve(outputDir)}`);

  await loadMetaschema(version as SchemaVersion, outputDir);
  console.log("✓ Meta-schemas downloaded and saved");
}

main();
