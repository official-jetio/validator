import { JetValidator } from "../dist";
import * as fs from "fs";
import * as path from "path";

interface Stats {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p95: number;
  p99: number;
}

interface BenchmarkResult {
  schema: string;
  category: string;
  compilation: {
    time: Stats;
    memoryBefore: number;
    memoryAfter: number;
    memoryUsed: number;
  };
  validation: {
    singleValid: {
      time: Stats;
      opsPerSec: Stats;
    };
    batchValid: {
      time: Stats;
      opsPerSec: Stats;
      itemCount: number;
    };
    singleInvalidFast: {
      time: Stats;
      opsPerSec: Stats;
    };
    singleInvalidAll: {
      time: Stats;
      opsPerSec: Stats;
      errorCount: number;
    };
  };
}

interface FailedBenchmark {
  schema: string;
  category: string;
  error: string;
}

interface SchemaSet {
  [key: string]: any;
}

interface TestDataSet {
  [key: string]: {
    valid?: any[];
    invalid?: any[];
  };
}

class JetValidatorBenchmark {
  private warmupIterations = 1000;
  private benchmarkIterations = 10000;
  private batchSize = 1000;
  private benchmarkRuns = 30;
  private results: BenchmarkResult[] = [];
  private failedBenchmarks: FailedBenchmark[] = [];
  private baselineResults: BenchmarkResult[] | null = null;

  private loadSchemas(category: string): SchemaSet {
    const schemaPath = path.join(__dirname, "schemas", `${category}.json`);
    return JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  }

  private loadTestData(category: string): TestDataSet {
    const dataPath = path.join(__dirname, "data", `${category}.json`);
    return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  }

  private loadBaseline(): void {
    const baselinePath = path.join(__dirname, "results", "jetbaseline.json");
    if (fs.existsSync(baselinePath)) {
      this.baselineResults = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
      console.log("✓ Loaded baseline results for comparison\n");
    }
  }

  private measureMemory(): number {
    if (global.gc) {
      // Run GC multiple times to ensure clean state
      for (let i = 0; i < 5; i++) {
        global.gc();
      }
      // Wait for GC to complete
      const start = Date.now();
      while (Date.now() - start < 100) {} // Increased to 100ms
    }
    return process.memoryUsage().heapUsed;
  }

  private shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private benchmark(fn: () => void, iterations: number): number {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      fn();
    }
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000;
  }

  private calculateStats(values: number[]): Stats {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b) / values.length;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    const stdDev = Math.sqrt(variance);

    return {
      mean,
      median: sorted[Math.floor(sorted.length / 2)],
      stdDev,
      min: Math.min(...values),
      max: Math.max(...values),
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
    };
  }

  private benchmarkMultipleRuns(
    fn: () => void,
    iterations: number,
    runs: number = this.benchmarkRuns,
  ): Stats {
    const times: number[] = [];

    for (let run = 0; run < runs; run++) {
      const time = this.benchmark(fn, iterations);
      times.push(time);
    }

    return this.calculateStats(times);
  }

  private warmup(
    validate: any,
    data: any[],
    iterations: number = this.warmupIterations,
  ) {
    for (let i = 0; i < iterations; i++) {
      validate(data[i % data.length]);
    }
  }

  private benchmarkCompilation(schema: any): BenchmarkResult["compilation"] {
    const memBefore = this.measureMemory();

    const compilationTimes: number[] = [];
    const jetValidator = new JetValidator({ allErrors: false, strict: false });

    const start = process.hrtime.bigint();
    jetValidator.compile(schema);
    const end = process.hrtime.bigint();

    compilationTimes.push(Number(end - start) / 1_000_000);

    const memAfter = this.measureMemory();
    const timeStats = this.calculateStats(compilationTimes);

    return {
      time: timeStats,
      memoryBefore: memBefore,
      memoryAfter: memAfter,
      memoryUsed: memAfter - memBefore,
    };
  }

  private benchmarkValidation(
    validate: any,
    svalidData: any[],
    sinvalidData: any[],
    allErrorsValidate: any,
  ): BenchmarkResult["validation"] {
    const validData = this.shuffleArray(svalidData);
    const invalidData = this.shuffleArray(sinvalidData);

    const singleValidTimeStats = this.benchmarkMultipleRuns(() => {
      for (let i = 0; i < this.benchmarkIterations; i++) {
        validate(validData[i % validData.length]);
      }
    }, 1);

    const singleValidOpsStats: Stats = {
      mean: (this.benchmarkIterations / singleValidTimeStats.mean) * 1000,
      median: (this.benchmarkIterations / singleValidTimeStats.median) * 1000,
      stdDev: singleValidTimeStats.stdDev,
      min: (this.benchmarkIterations / singleValidTimeStats.max) * 1000,
      max: (this.benchmarkIterations / singleValidTimeStats.min) * 1000,
      p95: (this.benchmarkIterations / singleValidTimeStats.p95) * 1000,
      p99: (this.benchmarkIterations / singleValidTimeStats.p99) * 1000,
    };

    const batchValidData = Array(this.batchSize)
      .fill(null)
      .map((_, i) => validData[i % validData.length]);

    this.warmup(
      () => {
        for (const item of batchValidData) {
          validate(item);
        }
      },
      [batchValidData],
      100,
    );

    const batchValidTimeStats = this.benchmarkMultipleRuns(() => {
      for (const item of batchValidData) {
        validate(item);
      }
    }, 100);

    const batchValidOpsStats: Stats = {
      mean: ((this.batchSize * 100) / batchValidTimeStats.mean) * 1000,
      median: ((this.batchSize * 100) / batchValidTimeStats.median) * 1000,
      stdDev: batchValidTimeStats.stdDev,
      min: ((this.batchSize * 100) / batchValidTimeStats.max) * 1000,
      max: ((this.batchSize * 100) / batchValidTimeStats.min) * 1000,
      p95: ((this.batchSize * 100) / batchValidTimeStats.p95) * 1000,
      p99: ((this.batchSize * 100) / batchValidTimeStats.p99) * 1000,
    };

    this.warmup(validate, invalidData);

    const singleInvalidFastTimeStats = this.benchmarkMultipleRuns(() => {
      for (let i = 0; i < this.benchmarkIterations; i++) {
        validate(invalidData[i % invalidData.length]);
      }
    }, 1);

    const singleInvalidFastOpsStats: Stats = {
      mean: (this.benchmarkIterations / singleInvalidFastTimeStats.mean) * 1000,
      median:
        (this.benchmarkIterations / singleInvalidFastTimeStats.median) * 1000,
      stdDev: singleInvalidFastTimeStats.stdDev,
      min: (this.benchmarkIterations / singleInvalidFastTimeStats.max) * 1000,
      max: (this.benchmarkIterations / singleInvalidFastTimeStats.min) * 1000,
      p95: (this.benchmarkIterations / singleInvalidFastTimeStats.p95) * 1000,
      p99: (this.benchmarkIterations / singleInvalidFastTimeStats.p99) * 1000,
    };

    this.warmup(allErrorsValidate, invalidData);
    allErrorsValidate(invalidData[0]);
    const errorCount = allErrorsValidate.errors?.length || 0;

    const singleInvalidAllTimeStats = this.benchmarkMultipleRuns(() => {
      for (let i = 0; i < this.benchmarkIterations; i++) {
        allErrorsValidate(invalidData[i % invalidData.length]);
      }
    }, 1);

    const singleInvalidAllOpsStats: Stats = {
      mean: (this.benchmarkIterations / singleInvalidAllTimeStats.mean) * 1000,
      median:
        (this.benchmarkIterations / singleInvalidAllTimeStats.median) * 1000,
      stdDev: singleInvalidAllTimeStats.stdDev,
      min: (this.benchmarkIterations / singleInvalidAllTimeStats.max) * 1000,
      max: (this.benchmarkIterations / singleInvalidAllTimeStats.min) * 1000,
      p95: (this.benchmarkIterations / singleInvalidAllTimeStats.p95) * 1000,
      p99: (this.benchmarkIterations / singleInvalidAllTimeStats.p99) * 1000,
    };

    return {
      singleValid: {
        time: singleValidTimeStats,
        opsPerSec: singleValidOpsStats,
      },
      batchValid: {
        time: batchValidTimeStats,
        opsPerSec: batchValidOpsStats,
        itemCount: this.batchSize,
      },
      singleInvalidFast: {
        time: singleInvalidFastTimeStats,
        opsPerSec: singleInvalidFastOpsStats,
      },
      singleInvalidAll: {
        time: singleInvalidAllTimeStats,
        opsPerSec: singleInvalidAllOpsStats,
        errorCount,
      },
    };
  }

  private benchmarkSchema(
    schemaName: string,
    schema: any,
    validData: any[],
    invalidData: any[],
    category: string,
  ): BenchmarkResult {
    console.log(`  Benchmarking: ${schemaName}`);

    const jetValidator = new JetValidator({ allErrors: false, strict: false });
    const jetValidatorAllErrors = new JetValidator({
      allErrors: true,
      strict: false,
    });

    const compilation = this.benchmarkCompilation(schema);

    const validate = jetValidator.compile(schema);
    const allErrorsValidate = jetValidatorAllErrors.compile(schema);

    const validation = this.benchmarkValidation(
      validate,
      validData,
      invalidData,
      allErrorsValidate,
    );

    return {
      schema: schemaName,
      category,
      compilation,
      validation,
    };
  }

  private compareWithBaseline(result: BenchmarkResult): string {
    if (!this.baselineResults) return "";

    const baseline = this.baselineResults.find(
      (r) => r.schema === result.schema && r.category === result.category,
    );

    if (!baseline) return "";

    const currentOps = result.validation.singleValid.opsPerSec.mean;
    const baselineOps = baseline.validation.singleValid.opsPerSec.mean;
    const speedup = currentOps / baselineOps;
    const percentage = ((speedup - 1) * 100).toFixed(2);

    if (speedup > 1.05) {
      return ` 🚀 ${percentage}% faster`;
    } else if (speedup < 0.95) {
      return ` 🐌 ${Math.abs(parseFloat(percentage))}% slower`;
    } else {
      return ` ≈ similar performance`;
    }
  }

  public async runBenchmarks() {
    console.log("Starting JetValidator Benchmarks...\n");
    console.log(`Configuration:`);
    console.log(`  Warmup iterations: ${this.warmupIterations}`);
    console.log(`  Benchmark iterations: ${this.benchmarkIterations}`);
    console.log(`  Runs per benchmark: ${this.benchmarkRuns}`);
    console.log(`  Batch size: ${this.batchSize}\n`);

    this.loadBaseline();

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
          if (
            schemaName === "array100KItems" ||
            schemaName === "arrayUniqueItems1K" ||
            schemaName === "arrayComplexItems"
          )
            continue;
          const testData = data[schemaName];
          const validData = testData?.valid;
          const invalidData = testData?.invalid;

          if (
            !validData ||
            !invalidData ||
            validData.length === 0 ||
            invalidData.length === 0
          ) {
            console.log(`  ⚠️  Skipping ${schemaName}: missing test data`);
            continue;
          }

          try {
            const result = this.benchmarkSchema(
              schemaName,
              schema,
              validData,
              invalidData,
              category,
            );
            this.results.push(result);

            const comparison = this.compareWithBaseline(result);
            console.log(`  ✓ Completed ${schemaName}${comparison}`);
          } catch (error: any) {
            console.error(`  ✗ Error in ${schemaName}:`);
            console.error(`    ${error.message}`);
            this.failedBenchmarks.push({
              schema: schemaName,
              category,
              error: error.message,
            });
          }
        }
      } catch (error: any) {
        console.error(`  ✗ Failed to load category ${category}:`);
        console.error(`    ${error.message}`);
      }
    }

    this.saveResults();
    this.printSummary();
    this.generateMarkdownReport();
  }

  private saveResults() {
    const resultsDir = path.join(__dirname, "results");

    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const resultsPath = path.join(resultsDir, `jetvalidator-${timestamp}.json`);
    const latestPath = path.join(resultsDir, "jetvalidator-latest.json");

    const output = {
      timestamp: new Date().toISOString(),
      config: {
        warmupIterations: this.warmupIterations,
        benchmarkIterations: this.benchmarkIterations,
        benchmarkRuns: this.benchmarkRuns,
        batchSize: this.batchSize,
      },
      results: this.results,
      failed: this.failedBenchmarks,
    };

    fs.writeFileSync(resultsPath, JSON.stringify(output, null, 2));
    fs.writeFileSync(latestPath, JSON.stringify(output, null, 2));

    console.log(`\n✓ Results saved to: ${resultsPath}`);
    console.log(`✓ Latest results: ${latestPath}`);

    if (this.failedBenchmarks.length > 0) {
      console.log(`\n⚠️  ${this.failedBenchmarks.length} benchmark(s) failed`);
    }
  }

  private printSummary() {
    console.log("\n" + "=".repeat(70));
    console.log("BENCHMARK SUMMARY");
    console.log("=".repeat(70));

    const avgCompilation =
      this.results.reduce((sum, r) => sum + r.compilation.time.mean, 0) /
      this.results.length;
    const avgValidOps =
      this.results.reduce(
        (sum, r) => sum + r.validation.singleValid.opsPerSec.mean,
        0,
      ) / this.results.length;
    const avgInvalidOps =
      this.results.reduce(
        (sum, r) => sum + r.validation.singleInvalidFast.opsPerSec.mean,
        0,
      ) / this.results.length;

    console.log(`\nTotal Schemas Tested: ${this.results.length}`);
    console.log(`Failed Benchmarks: ${this.failedBenchmarks.length}`);
    console.log(`\nAverage Compilation Time: ${avgCompilation.toFixed(2)}ms`);
    console.log(`Average Valid Data Ops/Sec: ${avgValidOps.toFixed(0)}`);
    console.log(
      `Average Invalid Data Ops/Sec (fail-fast): ${avgInvalidOps.toFixed(0)}`,
    );

    console.log("\n" + "-".repeat(70));
    console.log("Top 5 Fastest Validators (ops/sec):");
    console.log("-".repeat(70));

    const sorted = [...this.results].sort(
      (a, b) =>
        b.validation.singleValid.opsPerSec.mean -
        a.validation.singleValid.opsPerSec.mean,
    );

    sorted.slice(0, 5).forEach((r, i) => {
      const ops = r.validation.singleValid.opsPerSec.mean;
      const stdDev = r.validation.singleValid.opsPerSec.stdDev;
      console.log(
        `${i + 1}. ${r.schema.padEnd(30)} ${ops
          .toFixed(0)
          .padStart(15)} ops/sec (±${stdDev.toFixed(2)}%)`,
      );
    });

    console.log("\n" + "-".repeat(70));
    console.log("Top 5 Slowest Validators (ops/sec):");
    console.log("-".repeat(70));

    sorted
      .slice(-5)
      .reverse()
      .forEach((r, i) => {
        const ops = r.validation.singleValid.opsPerSec.mean;
        const stdDev = r.validation.singleValid.opsPerSec.stdDev;
        console.log(
          `${i + 1}. ${r.schema.padEnd(30)} ${ops
            .toFixed(0)
            .padStart(15)} ops/sec (±${stdDev.toFixed(2)}%)`,
        );
      });

    console.log("\n" + "-".repeat(70));
    console.log("Compilation Time Breakdown:");
    console.log("-".repeat(70));

    const compSorted = [...this.results].sort(
      (a, b) => b.compilation.time.mean - a.compilation.time.mean,
    );

    console.log("\nSlowest to compile:");
    compSorted.slice(0, 5).forEach((r, i) => {
      const time = r.compilation.time.mean;
      const stdDev = r.compilation.time.stdDev;
      console.log(
        `${i + 1}. ${r.schema.padEnd(30)} ${time
          .toFixed(2)
          .padStart(10)}ms (±${stdDev.toFixed(2)}ms)`,
      );
    });

    console.log("\n" + "=".repeat(70) + "\n");
  }

  private generateMarkdownReport() {
    const reportPath = path.join(__dirname, "results", "jetreport.md");

    let md = "# JetValidator Benchmark Report\n\n";
    md += `**Generated:** ${new Date().toISOString()}\n\n`;

    md += "## Configuration\n\n";
    md += `- Warmup iterations: ${this.warmupIterations}\n`;
    md += `- Benchmark iterations: ${this.benchmarkIterations}\n`;
    md += `- Runs per benchmark: ${this.benchmarkRuns}\n`;
    md += `- Batch size: ${this.batchSize}\n\n`;

    md += "## Summary\n\n";
    md += `- Total schemas tested: ${this.results.length}\n`;
    md += `- Failed benchmarks: ${this.failedBenchmarks.length}\n\n`;

    const categories = Array.from(new Set(this.results.map((r) => r.category)));
    for (const category of categories) {
      md += `## ${category.toUpperCase()}\n\n`;
      md +=
        "| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |\n";
      md +=
        "|--------|------------------|-----------------|-------------------|-------------|\n";

      const categoryResults = this.results.filter(
        (r) => r.category === category,
      );

      for (const result of categoryResults) {
        const comp = result.compilation.time.mean.toFixed(2);
        const validOps =
          result.validation.singleValid.opsPerSec.mean.toFixed(0);
        const invalidOps =
          result.validation.singleInvalidFast.opsPerSec.mean.toFixed(0);
        const mem = (result.compilation.memoryUsed / 1024).toFixed(2);

        md += `| ${result.schema} | ${comp} | ${validOps} | ${invalidOps} | ${mem} |\n`;
      }

      md += "\n";
    }

    if (this.failedBenchmarks.length > 0) {
      md += "## Failed Benchmarks\n\n";
      md += "| Category | Schema | Error |\n";
      md += "|----------|--------|-------|\n";

      for (const failed of this.failedBenchmarks) {
        md += `| ${failed.category} | ${failed.schema} | ${failed.error} |\n`;
      }

      md += "\n";
    }

    fs.writeFileSync(reportPath, md);
    console.log(`✓ Markdown report: ${reportPath}\n`);
  }

  public saveAsBaseline() {
    const baselinePath = path.join(__dirname, "results", "jetbaseline.json");
    fs.writeFileSync(baselinePath, JSON.stringify(this.results, null, 2));
    console.log(`✓ Current results saved as baseline: ${baselinePath}`);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const saveBaseline = args.includes("--baseline");

  const benchmark = new JetValidatorBenchmark();
  benchmark
    .runBenchmarks()
    .then(() => {
      if (saveBaseline) {
        benchmark.saveAsBaseline();
      }
    })
    .catch(console.error);
}

export { JetValidatorBenchmark };
