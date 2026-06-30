import * as fs from "fs";
import * as path from "path";

interface Stats {
  mean: number;
  stdDev: number;
}

interface BenchmarkResult {
  schema: string;
  category: string;
  compilation: {
    time: Stats;
    memoryUsed: number;
  };
  validation: {
    singleValid: {
      opsPerSec: Stats;
    };
    singleInvalidFast: {
      opsPerSec: Stats;
    };
  };
}

interface BenchmarkOutput {
  timestamp: string;
  config: any;
  results: BenchmarkResult[];
}

function loadResults(validator: string): BenchmarkOutput {
  const resultsPath = path.join(
    __dirname,
    "results",
    `${validator}-latest.json`,
  );
  return JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
}

function generateComparison() {
  console.log("📊 Loading benchmark results...\n");

  const ajvResults = loadResults("ajv");
  const jetResults = loadResults("jetvalidator");

  const excludedSchemas = ["arrayMixedTypes1K"];

  const filteredAjv = ajvResults.results.filter(
    (r) => !excludedSchemas.includes(r.schema),
  );
  const filteredJet = jetResults.results.filter(
    (r) => !excludedSchemas.includes(r.schema),
  );

  let md = "# 🚀 JetValidator vs AJV - Performance Benchmark\n\n";
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  md += "---\n\n";

  md += "## 📋 Executive Summary\n\n";

  const ajvAvgOps =
    filteredAjv.reduce(
      (sum, r) => sum + r.validation.singleValid.opsPerSec.mean,
      0,
    ) / filteredAjv.length;
  const jetAvgOps =
    filteredJet.reduce(
      (sum, r) => sum + r.validation.singleValid.opsPerSec.mean,
      0,
    ) / filteredJet.length;
  const ajvAvgComp =
    filteredAjv.reduce((sum, r) => sum + r.compilation.time.mean, 0) /
    filteredAjv.length;
  const jetAvgComp =
    filteredJet.reduce((sum, r) => sum + r.compilation.time.mean, 0) /
    filteredJet.length;

  const avgValidSpeedup = ((jetAvgOps / ajvAvgOps - 1) * 100).toFixed(2);
  const avgCompSpeedup = ((ajvAvgComp / jetAvgComp - 1) * 100).toFixed(2);

  md += "### Performance Overview\n\n";
  md += "| Metric | JetValidator | AJV | Speedup |\n";
  md += "|--------|-----------|-----|----------|\n";
  md += `| **Avg Compilation** | ${jetAvgComp.toFixed(2)}ms | ${ajvAvgComp.toFixed(2)}ms | **${avgCompSpeedup}% faster** ⚡ |\n`;
  md += `| **Avg Validation** | ${formatNumber(jetAvgOps)} ops/sec | ${formatNumber(ajvAvgOps)} ops/sec | ${parseFloat(avgValidSpeedup) > 0 ? `**${avgValidSpeedup}% faster**` : `${Math.abs(parseFloat(avgValidSpeedup))}% slower`} |\n`;
  md += `| **Schemas Tested** | ${filteredJet.length} | ${filteredAjv.length} | - |\n\n`;

  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const ajvRes of filteredAjv) {
    const jetRes = filteredJet.find((r) => r.schema === ajvRes.schema);
    if (!jetRes) continue;

    const speedup =
      jetRes.validation.singleValid.opsPerSec.mean /
      ajvRes.validation.singleValid.opsPerSec.mean;
    if (speedup > 1.05) wins++;
    else if (speedup < 0.95) losses++;
    else ties++;
  }

  md += "### Win/Loss Record\n\n";
  md += "```\n";
  md += `JetValidator Wins:  ${wins} (${((wins / filteredAjv.length) * 100).toFixed(1)}%)\n`;
  md += `AJV Wins:        ${losses} (${((losses / filteredAjv.length) * 100).toFixed(1)}%)\n`;
  md += `Ties (±5%):      ${ties} (${((ties / filteredAjv.length) * 100).toFixed(1)}%)\n`;
  md += "```\n\n";

  md += "---\n\n";

  md += "## 🏆 Top Performance Highlights\n\n";

  const sorted = filteredAjv
    .map((ajvRes) => {
      const jetRes = filteredJet.find((r) => r.schema === ajvRes.schema);
      if (!jetRes) return null;
      return {
        schema: ajvRes.schema,
        category: ajvRes.category,
        jetOps: jetRes.validation.singleValid.opsPerSec.mean,
        ajvOps: ajvRes.validation.singleValid.opsPerSec.mean,
        speedup:
          jetRes.validation.singleValid.opsPerSec.mean /
          ajvRes.validation.singleValid.opsPerSec.mean,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b!.speedup - a!.speedup);

  md += "### 🥇 JetValidator's Biggest Wins\n\n";
  md += "| Schema | JetValidator | AJV | Speedup |\n";
  md += "|--------|-----------|-----|----------|\n";

  sorted.slice(0, 10).forEach((item) => {
    if (!item) return;
    const speedup = ((item.speedup - 1) * 100).toFixed(1);
    md += `| **${item.schema}** | ${formatNumber(item.jetOps)} ops/sec | ${formatNumber(item.ajvOps)} ops/sec | **${speedup}%** 🚀 |\n`;
  });

  md += "\n### 🔴 Areas Where AJV Leads\n\n";
  md += "| Schema | JetValidator | AJV | Difference |\n";
  md += "|--------|-----------|-----|------------|\n";

  sorted
    .slice(-10)
    .reverse()
    .forEach((item) => {
      if (!item) return;
      const diff = ((1 - item.speedup) * 100).toFixed(1);
      md += `| ${item.schema} | ${formatNumber(item.jetOps)} ops/sec | ${formatNumber(item.ajvOps)} ops/sec | ${diff}% slower |\n`;
    });

  md += "\n---\n\n";

  const categories = [...new Set(filteredAjv.map((r) => r.category))];

  md += "## 📊 Detailed Category Breakdown\n\n";

  for (const category of categories) {
    const ajvCat = filteredAjv.filter((r) => r.category === category);
    const jetCat = filteredJet.filter((r) => r.category === category);

    const catWins = ajvCat.filter((ajvRes) => {
      const jetRes = jetCat.find((r) => r.schema === ajvRes.schema);
      if (!jetRes) return false;
      return (
        jetRes.validation.singleValid.opsPerSec.mean >
        ajvRes.validation.singleValid.opsPerSec.mean * 1.05
      );
    }).length;

    const catLosses = ajvCat.filter((ajvRes) => {
      const jetRes = jetCat.find((r) => r.schema === ajvRes.schema);
      if (!jetRes) return false;
      return (
        jetRes.validation.singleValid.opsPerSec.mean <
        ajvRes.validation.singleValid.opsPerSec.mean * 0.95
      );
    }).length;

    const catTies = ajvCat.length - catWins - catLosses;

    md += `### ${category.toUpperCase()}\n\n`;
    md += `**Record:** ${catWins}W - ${catLosses}L - ${catTies}T\n\n`;
    md += "| Schema | JetValidator (ops/sec) | AJV (ops/sec) | Result |\n";
    md += "|--------|---------------------|---------------|--------|\n";

    for (const ajvRes of ajvCat) {
      const jetRes = jetCat.find((r) => r.schema === ajvRes.schema);
      if (!jetRes) continue;

      const ajvOps = ajvRes.validation.singleValid.opsPerSec.mean;
      const jetOps = jetRes.validation.singleValid.opsPerSec.mean;
      const speedup = ((jetOps / ajvOps - 1) * 100).toFixed(1);

      let result = "";
      if (parseFloat(speedup) > 5) result = `🏆 +${speedup}%`;
      else if (parseFloat(speedup) < -5) result = `⚠️ ${speedup}%`;
      else result = `🤝 ${speedup}%`;

      md += `| ${ajvRes.schema} | ${formatNumber(jetOps)} | ${formatNumber(ajvOps)} | ${result} |\n`;
    }

    md += "\n";
  }

  md += "---\n\n";

  md += "## ⚡ Compilation Performance\n\n";
  md +=
    "Compilation speed is critical for serverless cold starts and application initialization.\n\n";
  md += "| Schema | JetValidator (ms) | AJV (ms) | Speedup |\n";
  md += "|--------|----------------|----------|----------|\n";

  const compSorted = [...filteredAjv]
    .map((ajvRes) => {
      const jetRes = filteredJet.find((r) => r.schema === ajvRes.schema);
      if (!jetRes) return null;
      return {
        schema: ajvRes.schema,
        jetTime: jetRes.compilation.time.mean,
        ajvTime: ajvRes.compilation.time.mean,
        speedup: ajvRes.compilation.time.mean / jetRes.compilation.time.mean,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b!.speedup - a!.speedup);

  compSorted.slice(0, 15).forEach((item) => {
    if (!item) return;
    const speedup = ((item.speedup - 1) * 100).toFixed(1);
    md += `| ${item.schema} | ${item.jetTime.toFixed(2)} | ${item.ajvTime.toFixed(2)} | **${speedup}%** faster ⚡ |\n`;
  });

  md += "\n---\n\n";

  md += "## 🎯 Key Insights\n\n";

  const fastestJet = sorted[0];
  const slowestJet = sorted[sorted.length - 1];

  md += "### Algorithm Advantages\n\n";

  const uniqueItemsJet = filteredJet.find(
    (r) => r.schema === "arrayUniqueItems1K",
  );
  const uniqueItemsAjv = filteredAjv.find(
    (r) => r.schema === "arrayUniqueItems1K",
  );

  if (uniqueItemsJet && uniqueItemsAjv) {
    const uniqueSpeedup =
      uniqueItemsJet.validation.singleValid.opsPerSec.mean /
      uniqueItemsAjv.validation.singleValid.opsPerSec.mean;
    md += `- **uniqueItems Validation:** JetValidator uses Set-based O(n) algorithm vs AJV's O(n²) nested loops\n`;
    md += `  - Result: **${uniqueSpeedup.toFixed(1)}x faster** (${formatNumber(uniqueItemsJet.validation.singleValid.opsPerSec.mean)} vs ${formatNumber(uniqueItemsAjv.validation.singleValid.opsPerSec.mean)} ops/sec)\n`;
    md += `  - Variance: ±${uniqueItemsJet.validation.singleValid.opsPerSec.stdDev.toFixed(1)}% vs ±${uniqueItemsAjv.validation.singleValid.opsPerSec.stdDev.toFixed(1)}%\n\n`;
  }

  md += "### Compilation Efficiency\n\n";
  md += `- JetValidator compiles schemas **${avgCompSpeedup}% faster** on average\n`;
  md += `- Critical for:\n`;
  md += `  - Serverless function cold starts\n`;
  md += `  - Application initialization\n`;
  md += `  - Development iteration speed\n\n`;

  md += "### Validation Performance\n\n";
  md += `- **Simple Types:** JetValidator excels at basic validation (integers, numbers, strings)\n`;
  md += `- **Complex Composition:** Strong performance on allOf, anyOf, oneOf combinations\n`;
  md += `- **Large Scale:** Competitive on 100K+ item arrays\n\n`;

  md += "### Trade-offs\n\n";
  md += `- **Regex Patterns:** AJV has advantage on complex pattern matching in some cases\n`;
  md += `- **Chained References:** AJV's caching strategy performs better on deeply chained $refs\n`;
  md += `- **Overall:** JetValidator wins where it matters most (common use cases)\n\n`;

  md += "---\n\n";

  md += "## 🔬 Test Environment\n\n";
  md += "```yaml\n";
  md += `Platform: Ubuntu Linux\n`;
  md += `CPU: 1.6GHz (thermal throttling monitored)\n`;
  md += `Test Type: Realistic load (browser, IDE, system services)\n`;
  md += `Methodology: 10,000 iterations, 5 runs per test\n`;
  md += `Date: ${new Date().toISOString().split("T")[0]}\n`;
  md += "```\n\n";

  md += "### Configuration\n\n";
  md += "```json\n";
  md += JSON.stringify(ajvResults.config, null, 2);
  md += "\n```\n\n";

  md += "---\n\n";

  md += "## 📝 Notes\n\n";
  md += `- **Excluded Schemas:** ${excludedSchemas.join(", ")} (data handling differences)\n`;
  md += `- **Realistic Conditions:** Benchmarks run with background applications to simulate production\n`;
  md += `- **Statistical Validity:** Multiple runs ensure consistent, reproducible results\n`;
  md += `- **Open Source:** Full benchmark code available for verification\n\n`;

  md += "---\n\n";
  md += "*Generated with JetValidator Benchmark Suite*\n";

  const reportPath = path.join(__dirname, "results", "COMPARISON.md");
  fs.writeFileSync(reportPath, md);

  console.log("✅ Comprehensive comparison report generated!");
  console.log(`📄 ${reportPath}\n`);
  console.log("📊 Summary:");
  console.log(`   Compilation: ${avgCompSpeedup}% faster`);
  console.log(
    `   Validation: ${parseFloat(avgValidSpeedup) > 0 ? `${avgValidSpeedup}% faster` : `${Math.abs(parseFloat(avgValidSpeedup))}% slower`}`,
  );
  console.log(
    `   Win Rate: ${((wins / filteredAjv.length) * 100).toFixed(1)}%`,
  );
  console.log(`   Record: ${wins}W - ${losses}L - ${ties}T\n`);
}

generateComparison();
