import * as fs from "fs";
import * as path from "path";
import { JetValidator } from "../src"; // Your validator

interface TestCase {
  description: string;
  data: any;
  valid: boolean;
}

interface TestGroup {
  description: string;
  schema: any;
  tests: TestCase[];
}

interface TestResults {
  total: number;
  passed: number;
  failed: number;
  failedTests: Array<{
    file: string;
    group: string;
    test: string;
    expected: boolean;
    actual: boolean;
    data: any;
    schema: any;
    error?: string;
  }>;
}

async function runTestSuite(
  testPath: string,
  maxFailures: number = 10,
  draft: any,
): Promise<TestResults> {
  const jet = new JetValidator({
    strict: false,
    inlineRefs: false,
    allErrors: false,
    strictSchema: false,
    addUsedSchema: true,

    draft,
    validateFormats: false,
    loadSchema: async (uri) => {
      const response = await fetch(uri);

      if (!response.ok) {
        throw new Error(`Failed to fetch ${uri}: ${response.status}`);
      }
      return response.json();
    },
  });
  const results: TestResults = {
    total: 0,
    passed: 0,
    failed: 0,
    failedTests: [],
  };

  // Check if it's a single file or directory
  let testFiles: string[];
  if (fs.statSync(testPath).isFile()) {
    testFiles = [testPath];
  } else {
    testFiles = getAllTestFiles(testPath);
  }

  console.log(`Found ${testFiles.length} test file(s)`);

  for (const testFile of testFiles) {
    console.log(`\nRunning tests from: ${path.basename(testFile)}`);
    let fileFailures = 0;

    try {
      const testData = JSON.parse(
        fs.readFileSync(testFile, "utf8"),
      ) as TestGroup[];

      for (const testGroup of testData) {
        console.log(`  Group: ${testGroup.description}`);

        let validator: any;
        try {
          validator = await jet.compileAsync(testGroup.schema);
        } catch (compileError) {
          console.log(
            `    ❌ COMPILATION FAILED for group: ${testGroup.description}`,
          );
          console.log(
            `       Schema: ${JSON.stringify(testGroup.schema, null, 2)}`,
          );
          console.log(`       Error: ${compileError}`);
          console.log(`       ---`);

          // If schema compilation fails, mark all tests in group as failed
          for (const test of testGroup.tests) {
            results.total++;
            results.failed++;
            fileFailures++;
            results.failedTests.push({
              file: path.basename(testFile),
              group: testGroup.description,
              test: test.description,
              expected: test.valid,
              actual: false,
              data: test.data,
              schema: testGroup.schema,
              error: `Compilation failed: ${compileError}`,
            });
          }
          continue;
        }

        for (const test of testGroup.tests) {
          results.total++;

          try {
            const result = validator(test.data);
            const actualValid = result;

            if (actualValid === test.valid) {
              results.passed++;
              console.log(`    ✅ ${test.description}`);
            } else {
              results.failed++;
              fileFailures++;

              // Only show detailed output if under limit
              if (fileFailures <= maxFailures) {
                console.log(`    ❌ ${test.description}`);
                console.log(
                  `       Expected: ${test.valid}, Got: ${actualValid}`,
                );
                console.log(
                  `       Schema: ${JSON.stringify(testGroup.schema, null, 2)}`,
                );
                console.log(
                  `       Data: ${JSON.stringify(test.data, null, 2)}`,
                );
                if (!result && validator.errors) {
                  console.log(
                    `       Your Error: ${JSON.stringify(
                      validator.errors,
                      null,
                      2,
                    )}`,
                  );
                }
                console.log(`       ---`);
              } else if (fileFailures === maxFailures + 1) {
                console.log(
                  `    ... (hiding remaining failures for this file, limit: ${maxFailures})`,
                );
              }

              results.failedTests.push({
                file: path.basename(testFile),
                group: testGroup.description,
                test: test.description,
                expected: test.valid,
                actual: actualValid,
                data: test.data,
                schema: testGroup.schema,
                error: result
                  ? undefined
                  : JSON.stringify(validator.errors, null, 2),
              });
            }
          } catch (error) {
            results.failed++;
            fileFailures++;

            if (fileFailures <= maxFailures) {
              console.log(`    ❌ ${test.description} (RUNTIME ERROR)`);
              console.log(
                `       Schema: ${JSON.stringify(testGroup.schema, null, 2)}`,
              );
              console.log(`       Data: ${JSON.stringify(test.data, null, 2)}`);
              console.log(`       Error: ${error}`);
              console.log(`       ---`);
            }

            results.failedTests.push({
              file: path.basename(testFile),
              group: testGroup.description,
              test: test.description,
              expected: test.valid,
              actual: false,
              data: test.data,
              schema: testGroup.schema,
              error: `Runtime error: ${error}`,
            });
          }
        }
      }
    } catch (error) {
      console.error(`Failed to process test file ${testFile}:`, error);
    }
  }

  return results;
}

function getAllTestFiles(testDir: string): string[] {
  const files: string[] = [];

  function walkDir(dir: string) {
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // walkDir(fullPath);
      } else if (entry.endsWith(".json")) {
        // Skip optional tests and remotes for now
        // if (!entry.includes("optional") && !entry.includes("remotes")) {
        files.push(fullPath);
        // }
      }
    }
  }
  walkDir(testDir);
  console.log(files);
  return files;
}

function printSummary(results: TestResults) {
  console.log("\n" + "=".repeat(60));
  console.log("JSON SCHEMA TEST SUITE RESULTS");
  console.log("=".repeat(60));
  console.log(`Total tests: ${results.total}`);
  console.log(
    `Passed: ${results.passed} (${(
      (results.passed / results.total) *
      100
    ).toFixed(1)}%)`,
  );
  console.log(
    `Failed: ${results.failed} (${(
      (results.failed / results.total) *
      100
    ).toFixed(1)}%)`,
  );
  console.log("=".repeat(60));

  if (results.failed > 0) {
    console.log("\nFAILED TESTS:");
    console.log("-".repeat(40));

    // Group failures by type
    const failuresByFile = new Map<string, typeof results.failedTests>();

    for (const failure of results.failedTests) {
      if (!failuresByFile.has(failure.file)) {
        failuresByFile.set(failure.file, []);
      }
      failuresByFile.get(failure.file)!.push(failure);
    }

    for (const [file, failures] of Array.from(failuresByFile)) {
      console.log(`\n📁 ${file} (${failures.length} failures):`);

      for (const failure of failures.slice(0, 3)) {
        // Show first 3 failures per file
        console.log(`  ❌ ${failure.group} > ${failure.test}`);
        console.log(
          `     Expected: ${failure.expected}, Got: ${failure.actual}`,
        );
        console.log(`     Data: ${JSON.stringify(failure.data)}`);
        if (failure.error) {
          console.log(`     Error: ${failure.error.substring(0, 100)}...`);
        }
      }

      if (failures.length > 3) {
        console.log(`     ... and ${failures.length - 3} more failures`);
      }
    }
  }
}

// Usage
async function runTests() {
  const testPath =
    process.argv[2] || "./JSON-Schema-Test-Suite/tests/draft2020-12";
  const draft =
    process.argv[2].split("/")[process.argv[2].split("/").length - 1];
  const maxFailures = parseInt(process.argv[3]) || 10; // Limit failures shown per file
  if (!fs.existsSync(testPath)) {
    console.error(`Test path not found: ${testPath}`);
    console.log("Please clone the test suite first:");
    console.log(
      "git clone https://github.com/json-schema-org/JSON-Schema-Test-Suite.git",
    );
    console.log("\nUsage:");
    console.log("  npm run test:<version> [maxFailures]");
    console.log("  npm run test:2020-12");
    process.exit(1);
  }

  console.log(`Running JSON Schema Test Suite from: ${testPath}`);
  console.log(`Max failures per file: ${maxFailures}`);

  const results = await runTestSuite(testPath, maxFailures, draft);
  printSummary(results);
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests();
