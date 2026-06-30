import { execSync } from "child_process";
import * as path from "path";
import { runFromCli, ValidatorAdapter } from "./benchmark-core";

if (!process.env.SKIP_BUILD) {
  console.log("Building validator (npm run build)...");
  execSync("npm run build", {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
}

const { JetValidator } = require("../dist/index.cjs.js") as { JetValidator: any };

const adapter: ValidatorAdapter = {
  name: "jetvalidator",
  compileFresh: (schema) =>
    new JetValidator({ allErrors: false, strict: false }).compile(schema),
  compilePair: (schema) => ({
    validate: new JetValidator({ allErrors: false, strict: false }).compile(
      schema,
    ),
    allErrorsValidate: new JetValidator({
      allErrors: true,
      strict: false,
    }).compile(schema),
  }),
};

if (require.main === module) runFromCli(adapter);
