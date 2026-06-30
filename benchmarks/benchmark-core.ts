import * as fs from "fs";
import * as path from "path";

export interface Stats {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p95: number;
  p99: number;
}

export interface BenchmarkResult {
  schema: string;
  category: string;
  compilation: {
    time: Stats;
    memoryUsed: number;
  };
  validation: {
    singleValid: { time: Stats; opsPerSec: Stats };
    batchValid: { time: Stats; opsPerSec: Stats; itemCount: number };
    singleInvalidFast: { time: Stats; opsPerSec: Stats };
    singleInvalidAll: { time: Stats; opsPerSec: Stats; errorCount: number };
  };
}

export interface FailedBenchmark {
  schema: string;
  category: string;
  error: string;
}

interface SchemaSet {
  [key: string]: any;
}
interface TestDataSet {
  [key: string]: { valid?: any[]; invalid?: any[] };
}

export interface CompiledPair {
  validate: (data: any) => boolean;
  allErrorsValidate: ((data: any) => boolean) & { errors?: any[] };
}

export interface ValidatorAdapter {
  name: string;
  compileFresh: (schema: any) => (data: any) => boolean;
  compilePair: (schema: any) => CompiledPair;
}

const envInt = (name: string, fallback: number): number => {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export class BenchmarkRunner {
  private warmupIterations: number;
  private benchmarkIterations: number;
  private batchSize: number;
  private benchmarkRuns: number;
  private compileRuns: number;
  private compileWarmup: number;

  private results: BenchmarkResult[] = [];
  private failedBenchmarks: FailedBenchmark[] = [];
  private baselineResults: BenchmarkResult[] | null = null;

  constructor(
    private adapter: ValidatorAdapter,
    cfg: Partial<{
      warmupIterations: number;
      benchmarkIterations: number;
      batchSize: number;
      benchmarkRuns: number;
      compileRuns: number;
      compileWarmup: number;
    }> = {},
  ) {
    this.warmupIterations =
      cfg.warmupIterations ?? envInt("WARMUP_ITERATIONS", 1000);
    this.benchmarkIterations =
      cfg.benchmarkIterations ?? envInt("BENCHMARK_ITERATIONS", 10000);
    this.batchSize = cfg.batchSize ?? envInt("BATCH_SIZE", 1000);
    this.benchmarkRuns = cfg.benchmarkRuns ?? envInt("BENCHMARK_RUNS", 30);
    this.compileRuns = cfg.compileRuns ?? envInt("COMPILE_RUNS", 30);
    this.compileWarmup = cfg.compileWarmup ?? envInt("COMPILE_WARMUP", 3);
  }

  private dir(...p: string[]) {
    return path.join(__dirname, ...p);
  }

  private loadSchemas(category: string): SchemaSet {
    return JSON.parse(
      fs.readFileSync(this.dir("schemas", `${category}.json`), "utf-8"),
    );
  }

  private loadTestData(category: string): TestDataSet {
    return JSON.parse(
      fs.readFileSync(this.dir("data", `${category}.json`), "utf-8"),
    );
  }

  private loadBaseline(): void {
    const baselinePath = this.dir(
      "results",
      `${this.adapter.name}baseline.json`,
    );
    if (fs.existsSync(baselinePath)) {
      this.baselineResults = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
      console.log("\u2713 Loaded baseline results for comparison\n");
    }
  }

  private measureMemory(): number {
    if (global.gc) {
      for (let i = 0; i < 5; i++) global.gc();
      const start = Date.now();
      while (Date.now() - start < 100) {}
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

  private time(fn: () => void, iterations: number): number {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) fn();
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000;
  }

  private calculateStats(values: number[]): Stats {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    return {
      mean,
      median: sorted[Math.floor(sorted.length / 2)],
      stdDev: Math.sqrt(variance),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
    };
  }

  private multipleRuns(fn: () => void, iterations: number): Stats {
    const times: number[] = [];
    for (let run = 0; run < this.benchmarkRuns; run++) {
      times.push(this.time(fn, iterations));
    }
    return this.calculateStats(times);
  }

  private warmup(
    validate: (d: any) => any,
    data: any[],
    iterations = this.warmupIterations,
  ) {
    for (let i = 0; i < iterations; i++) validate(data[i % data.length]);
  }

  private opsFromTime(timeStats: Stats, totalOps: number): Stats {
    return {
      mean: (totalOps / timeStats.mean) * 1000,
      median: (totalOps / timeStats.median) * 1000,
      stdDev: timeStats.stdDev,
      min: (totalOps / timeStats.max) * 1000,
      max: (totalOps / timeStats.min) * 1000,
      p95: (totalOps / timeStats.p95) * 1000,
      p99: (totalOps / timeStats.p99) * 1000,
    };
  }

  private benchmarkCompilation(schema: any): BenchmarkResult["compilation"] {
    for (let i = 0; i < this.compileWarmup; i++) {
      this.adapter.compileFresh(structuredClone(schema));
    }

    const memBefore = this.measureMemory();
    const times: number[] = [];

    for (let i = 0; i < this.compileRuns; i++) {
      const fresh = structuredClone(schema);
      const start = process.hrtime.bigint();
      this.adapter.compileFresh(fresh);
      const end = process.hrtime.bigint();
      times.push(Number(end - start) / 1_000_000);
    }

    const memAfter = this.measureMemory();
    return {
      time: this.calculateStats(times),
      memoryUsed: memAfter - memBefore,
    };
  }

  private benchmarkValidation(
    validate: (d: any) => boolean,
    allErrorsValidate: ((d: any) => boolean) & { errors?: any[] },
    svalidData: any[],
    sinvalidData: any[],
  ): BenchmarkResult["validation"] {
    const validData = this.shuffleArray(svalidData);
    const invalidData = this.shuffleArray(sinvalidData);

    this.warmup(validate, validData);

    const singleValidTime = this.multipleRuns(() => {
      for (let i = 0; i < this.benchmarkIterations; i++) {
        validate(validData[i % validData.length]);
      }
    }, 1);
    const singleValidOps = this.opsFromTime(
      singleValidTime,
      this.benchmarkIterations,
    );

    const batchValidData = Array(this.batchSize)
      .fill(null)
      .map((_, i) => validData[i % validData.length]);

    this.warmup(
      () => {
        for (const item of batchValidData) validate(item);
      },
      [batchValidData],
      100,
    );

    const batchValidTime = this.multipleRuns(() => {
      for (const item of batchValidData) validate(item);
    }, 100);
    const batchValidOps = this.opsFromTime(
      batchValidTime,
      this.batchSize * 100,
    );

    this.warmup(validate, invalidData);

    const singleInvalidFastTime = this.multipleRuns(() => {
      for (let i = 0; i < this.benchmarkIterations; i++) {
        validate(invalidData[i % invalidData.length]);
      }
    }, 1);
    const singleInvalidFastOps = this.opsFromTime(
      singleInvalidFastTime,
      this.benchmarkIterations,
    );

    this.warmup(allErrorsValidate, invalidData);
    allErrorsValidate(invalidData[0]);
    const errorCount = allErrorsValidate.errors?.length || 0;

    const singleInvalidAllTime = this.multipleRuns(() => {
      for (let i = 0; i < this.benchmarkIterations; i++) {
        allErrorsValidate(invalidData[i % invalidData.length]);
      }
    }, 1);
    const singleInvalidAllOps = this.opsFromTime(
      singleInvalidAllTime,
      this.benchmarkIterations,
    );

    return {
      singleValid: { time: singleValidTime, opsPerSec: singleValidOps },
      batchValid: {
        time: batchValidTime,
        opsPerSec: batchValidOps,
        itemCount: this.batchSize,
      },
      singleInvalidFast: {
        time: singleInvalidFastTime,
        opsPerSec: singleInvalidFastOps,
      },
      singleInvalidAll: {
        time: singleInvalidAllTime,
        opsPerSec: singleInvalidAllOps,
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
    const compilation = this.benchmarkCompilation(schema);
    const { validate, allErrorsValidate } = this.adapter.compilePair(schema);
    const validation = this.benchmarkValidation(
      validate,
      allErrorsValidate,
      validData,
      invalidData,
    );
    return { schema: schemaName, category, compilation, validation };
  }

  private compareWithBaseline(result: BenchmarkResult): string {
    if (!this.baselineResults) return "";
    const baseline = this.baselineResults.find(
      (r) => r.schema === result.schema && r.category === result.category,
    );
    if (!baseline) return "";
    const speedup =
      result.validation.singleValid.opsPerSec.mean /
      baseline.validation.singleValid.opsPerSec.mean;
    const pct = ((speedup - 1) * 100).toFixed(2);
    if (speedup > 1.05) return ` \ud83d\ude80 ${pct}% faster`;
    if (speedup < 0.95)
      return ` \ud83d\udc0c ${Math.abs(parseFloat(pct))}% slower`;
    return ` \u2248 similar performance`;
  }

  public async runBenchmarks() {
    console.log(`Starting ${this.adapter.name} Benchmarks...\n`);
    console.log("Configuration:");
    console.log(`  Warmup iterations:    ${this.warmupIterations}`);
    console.log(`  Benchmark iterations: ${this.benchmarkIterations}`);
    console.log(`  Runs per benchmark:   ${this.benchmarkRuns}`);
    console.log(
      `  Compile runs:         ${this.compileRuns} (+${this.compileWarmup} warmup)`,
    );
    console.log(`  Batch size:           ${this.batchSize}\n`);

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

    const skip = new Set([
      "array100KItems",
      "arrayUniqueItems1K",
      "arrayComplexItems",
    ]);

    for (const category of categories) {
      console.log(`\nCategory: ${category.toUpperCase()}`);
      console.log("=".repeat(50));

      let schemas: SchemaSet, data: TestDataSet;
      try {
        schemas = this.loadSchemas(category);
        data = this.loadTestData(category);
      } catch (error: any) {
        console.error(
          `  \u2717 Failed to load category ${category}: ${error.message}`,
        );
        continue;
      }

      for (const [schemaName, schema] of Object.entries(schemas)) {
        if (skip.has(schemaName)) continue;
        const testData = data[schemaName];
        const validData = testData?.valid;
        const invalidData = testData?.invalid;
        if (!validData?.length || !invalidData?.length) {
          console.log(
            `  \u26a0\ufe0f  Skipping ${schemaName}: missing test data`,
          );
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
          console.log(
            `  \u2713 Completed ${schemaName}${this.compareWithBaseline(result)}`,
          );
        } catch (error: any) {
          console.error(`  \u2717 Error in ${schemaName}: ${error.message}`);
          this.failedBenchmarks.push({
            schema: schemaName,
            category,
            error: error.message,
          });
        }
      }
    }

    this.saveResults();
    this.printSummary();
    this.generateMarkdownReport();
  }

  private config() {
    return {
      warmupIterations: this.warmupIterations,
      benchmarkIterations: this.benchmarkIterations,
      benchmarkRuns: this.benchmarkRuns,
      compileRuns: this.compileRuns,
      compileWarmup: this.compileWarmup,
      batchSize: this.batchSize,
    };
  }

  private saveResults() {
    const resultsDir = this.dir("results");
    if (!fs.existsSync(resultsDir))
      fs.mkdirSync(resultsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const output = {
      validator: this.adapter.name,
      timestamp: new Date().toISOString(),
      config: this.config(),
      results: this.results,
      failed: this.failedBenchmarks,
    };

    fs.writeFileSync(
      path.join(resultsDir, `${this.adapter.name}-${timestamp}.json`),
      JSON.stringify(output, null, 2),
    );
    fs.writeFileSync(
      path.join(resultsDir, `${this.adapter.name}-latest.json`),
      JSON.stringify(output, null, 2),
    );

    console.log(`\n\u2713 Results saved (${this.adapter.name}-latest.json)`);
    if (this.failedBenchmarks.length > 0) {
      console.log(
        `\u26a0\ufe0f  ${this.failedBenchmarks.length} benchmark(s) failed`,
      );
    }
  }

  private printSummary() {
    console.log("\n" + "=".repeat(70));
    console.log(`BENCHMARK SUMMARY \u2014 ${this.adapter.name}`);
    console.log("=".repeat(70));

    const avg = (sel: (r: BenchmarkResult) => number) =>
      this.results.reduce((s, r) => s + sel(r), 0) / this.results.length;

    console.log(`\nTotal Schemas Tested: ${this.results.length}`);
    console.log(`Failed Benchmarks:    ${this.failedBenchmarks.length}`);
    console.log(
      `\nAvg Compilation (median): ${avg((r) => r.compilation.time.median).toFixed(2)}ms`,
    );
    console.log(
      `Avg Valid Ops/Sec:        ${avg((r) => r.validation.singleValid.opsPerSec.mean).toFixed(0)}`,
    );
    console.log(
      `Avg Invalid Ops/Sec:      ${avg((r) => r.validation.singleInvalidFast.opsPerSec.mean).toFixed(0)}`,
    );
    console.log("\n" + "=".repeat(70) + "\n");
  }

  private generateMarkdownReport() {
    const reportPath = this.dir("results", `${this.adapter.name}report.md`);
    let md = `# ${this.adapter.name} Benchmark Report\n\n`;
    md += `**Generated:** ${new Date().toISOString()}\n\n`;
    md += "## Configuration\n\n";
    for (const [k, v] of Object.entries(this.config())) md += `- ${k}: ${v}\n`;
    md += `\n## Summary\n\n- Total schemas: ${this.results.length}\n- Failed: ${this.failedBenchmarks.length}\n\n`;

    const categories = Array.from(new Set(this.results.map((r) => r.category)));
    for (const category of categories) {
      md += `## ${category.toUpperCase()}\n\n`;
      md +=
        "| Schema | Compile median (ms) | Compile stdDev | Valid (ops/sec) | Invalid (ops/sec) |\n";
      md +=
        "|--------|--------------------|----------------|-----------------|-------------------|\n";
      for (const r of this.results.filter((x) => x.category === category)) {
        md += `| ${r.schema} | ${r.compilation.time.median.toFixed(2)} | ${r.compilation.time.stdDev.toFixed(2)} | ${r.validation.singleValid.opsPerSec.mean.toFixed(0)} | ${r.validation.singleInvalidFast.opsPerSec.mean.toFixed(0)} |\n`;
      }
      md += "\n";
    }
    fs.writeFileSync(reportPath, md);
    console.log(`\u2713 Markdown report: ${reportPath}\n`);
  }

  public saveAsBaseline() {
    const baselinePath = this.dir(
      "results",
      `${this.adapter.name}baseline.json`,
    );
    fs.writeFileSync(baselinePath, JSON.stringify(this.results, null, 2));
    console.log(`\u2713 Saved as baseline: ${baselinePath}`);
  }
}

export function runFromCli(adapter: ValidatorAdapter) {
  const saveBaseline = process.argv.slice(2).includes("--baseline");
  const runner = new BenchmarkRunner(adapter);
  runner
    .runBenchmarks()
    .then(() => {
      if (saveBaseline) runner.saveAsBaseline();
    })
    .catch(console.error);
}
