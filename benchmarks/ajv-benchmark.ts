import Ajv from "ajv";
import addFormats from "ajv-formats";
import { runFromCli, ValidatorAdapter } from "./benchmark-core";

function makeAjv(allErrors: boolean) {
  const ajv = new Ajv({ allErrors, strict: false });
  addFormats(ajv);
  return ajv;
}

const adapter: ValidatorAdapter = {
  name: "ajv",
  compileFresh: (schema) => makeAjv(false).compile(schema),
  compilePair: (schema) => ({
    validate: makeAjv(false).compile(schema),
    allErrorsValidate: makeAjv(true).compile(schema),
  }),
};

if (require.main === module) runFromCli(adapter);
