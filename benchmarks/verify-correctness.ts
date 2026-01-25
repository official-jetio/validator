import { JetValidator } from "../dist";
import * as fs from "fs";
import * as path from "path";

interface VerificationResult {
  schema: string;
  category: string;
  passed: boolean;
  validDataCount: number;
  invalidDataCount: number;
  validFailures: number[];
  invalidFailures: number[];
}

class CorrectnessVerifier {
  private results: VerificationResult[] = [];
  private passed = 0;
  private failed = 0;

  private loadSchemas(category: string): Record<string, any> {
    const schemaPath = path.join(__dirname, "schemas", `${category}.json`);
    return JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  }

  private loadTestData(category: string): Record<string, { valid?: any[]; invalid?: any[] }> {
    const dataPath = path.join(__dirname, "data", `${category}.json`);
    return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  }

  private verify(
    schemaName: string,
    schema: any,
    validData: any[],
    invalidData: any[],
    category: string
  ): VerificationResult {
    const jetValidator = new JetValidator({ allErrors: false, strict: false });
    const validate = jetValidator.compile(schema);

    const validFailures: number[] = [];
    const invalidFailures: number[] = [];

    for (let i = 0; i < validData.length; i++) {
      const result = validate(validData[i]);
      if (result !== true) {
        validFailures.push(i);
      }
    }

    for (let i = 0; i < invalidData.length; i++) {
      const result = validate(invalidData[i]);
      if (result !== false) {
        invalidFailures.push(i);
      }
    }

    const passed = validFailures.length === 0 && invalidFailures.length === 0;

    return {
      schema: schemaName,
      category,
      passed,
      validDataCount: validData.length,
      invalidDataCount: invalidData.length,
      validFailures,
      invalidFailures,
    };
  }

  public run() {
    console.log("Verifying Correctness of Benchmark Schemas...\n");

    const categories = [
      "real-world",
      "features",
      "formats",
      "stress",
      "complexity-composition",
      "complexity-formats",
      "complexity-patterns",
      "scale-arrays",
      "scale-nesting",
      "scale-objects",
      "scale-refs",
    ];

    for (const category of categories) {
      console.log(`\nCategory: ${category.toUpperCase()}`);
      console.log("=".repeat(50));

      try {
        const schemas = this.loadSchemas(category);
        const data = this.loadTestData(category);

        for (const [schemaName, schema] of Object.entries(schemas)) {
          const testData = data[schemaName];
          const validData = testData?.valid || [];
          const invalidData = testData?.invalid || [];

          if (validData.length === 0 && invalidData.length === 0) {
            console.log(`  ⚠️  Skipping ${schemaName}: no test data`);
            continue;
          }

          try {
            const result = this.verify(schemaName, schema, validData, invalidData, category);
            this.results.push(result);

            if (result.passed) {
              this.passed++;
              console.log(`  ✓ ${schemaName} (${validData.length} valid, ${invalidData.length} invalid)`);
            } else {
              this.failed++;
              console.log(`  ✗ ${schemaName} FAILED`);
              if (result.validFailures.length > 0) {
                console.log(`    Valid data failed at indices: ${result.validFailures.join(", ")}`);
              }
              if (result.invalidFailures.length > 0) {
                console.log(`    Invalid data passed at indices: ${result.invalidFailures.join(", ")}`);
              }
            }
          } catch (error: any) {
            this.failed++;
            console.log(`  ✗ ${schemaName} ERROR: ${error.message}`);
            this.results.push({
              schema: schemaName,
              category,
              passed: false,
              validDataCount: validData.length,
              invalidDataCount: invalidData.length,
              validFailures: [-1],
              invalidFailures: [-1],
            });
          }
        }
      } catch (error: any) {
        console.error(`  ✗ Failed to load category: ${error.message}`);
      }
    }

    this.printSummary();
  }

  private printSummary() {
    console.log("\n" + "=".repeat(50));
    console.log("VERIFICATION SUMMARY");
    console.log("=".repeat(50));
    console.log(`\nPassed: ${this.passed}`);
    console.log(`Failed: ${this.failed}`);
    console.log(`Total:  ${this.passed + this.failed}`);

    if (this.failed > 0) {
      console.log("\nFailed schemas:");
      for (const r of this.results.filter((r) => !r.passed)) {
        console.log(`  - ${r.category}/${r.schema}`);
      }
    }

    console.log("\n" + (this.failed === 0 ? "✓ All validations correct!" : "✗ Some validations failed!"));
  }
}

const verifier = new CorrectnessVerifier();
verifier.run();