import * as fs from "fs";
import * as path from "path";
import { describe, test, beforeAll, expect } from "vitest";
import { JetValidator, SchemaDefinition } from "../../src";

interface TestCase {
  description: string;
  data: unknown;
  valid: boolean;
}

interface TestGroup {
  description: string;
  schema: SchemaDefinition | boolean;
  tests: TestCase[];
}

type Validator = ((data: unknown) => boolean) & { errors?: unknown };

const env = (key: string, fallback = "") => process.env[key] ?? fallback;
const flag = (key: string) => {
  const v = process.env[key]?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
};

const testPath = path.join(
  env("TEST_PATH", "./JSON-Schema-Test-Suite/tests/draft2020-12"),
  env("FILE"),
);

const draft: any =
  env("DRAFT") || testPath.match(/draft[^/\\]*/)?.[0] || undefined;
const inline = flag("INLINE");
const allErrors = flag("ALL_ERRORS");

if (!fs.existsSync(testPath)) {
  throw new Error(
    [
      `Test path not found: ${testPath}`,
      ``,
      `Clone the suite first:`,
      `  git clone https://github.com/json-schema-org/JSON-Schema-Test-Suite.git`,
      ``,
      `Usage:`,
      `  TEST_PATH=<path> FILE=<file> INLINE=1 ALL_ERRORS=1 DRAFT=<draft> npx vitest run`,
      `  TEST_PATH=./JSON-Schema-Test-Suite/tests/draft2020-12 FILE=enum.json INLINE=1 npx vitest run`,
    ].join("\n"),
  );
}

const jet = new JetValidator({
  strict: false,
  inlineRefs: inline,
  allErrors,
  strictSchema: false,
  addUsedSchema: true,
  draft,
  validateFormats: false,
  loadSchema: async (uri: string) => {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to fetch ${uri}: ${res.status}`);
    return res.json();
  },
});

const collectFiles = (target: string): string[] => {
  if (fs.statSync(target).isFile()) return [target];
  return fs
    .readdirSync(target)
    .map((entry) => path.join(target, entry))
    .filter((full) => fs.statSync(full).isFile() && full.endsWith(".json"));
};

const files = collectFiles(testPath);

describe(`JSON Schema Test Suite (draft=${draft}, inline=${inline}, allErrors=${allErrors})`, () => {
  for (const file of files) {
    const groups = JSON.parse(fs.readFileSync(file, "utf8")) as TestGroup[];

    describe(path.basename(file), () => {
      for (const group of groups) {
        if (group.tests.length === 0) continue;

        describe(group.description, () => {
          let validate: Validator;

          beforeAll(async () => {
            try {
              validate = (await jet.compileAsync(group.schema)) as Validator;
            } catch (e) {
              throw new Error(
                `compilation failed: ${e}\nschema: ${JSON.stringify(group.schema, null, 2)}`,
              );
            }
          });

          test.each(group.tests)("$description", (t) => {
            const actual = validate(t.data);
            const detail =
              actual === t.valid
                ? ""
                : `\ndata: ${JSON.stringify(t.data)}` +
                  `\nschema: ${JSON.stringify(group.schema)}` +
                  `\nerrors: ${JSON.stringify(validate.errors ?? null, null, 2)}`;
            expect(actual, detail).toBe(t.valid);
          });
        });
      }
    });
  }
});
