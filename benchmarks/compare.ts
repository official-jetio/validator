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
interface Result {
  schema: string;
  category: string;
  compilation: { time: Stats; memoryUsed: number };
  validation: {
    singleValid: { opsPerSec: Stats };
    singleInvalidFast: { opsPerSec: Stats };
  };
}
interface File {
  validator: string;
  timestamp: string;
  config: Record<string, number>;
  results: Result[];
}

const resultsDir = path.join(__dirname, "results");
const TIE_BAND = 0.05;

function load(name: string): File {
  const p = path.join(resultsDir, name);
  if (!fs.existsSync(p)) {
    console.error(`Missing ${name} — run both benchmarks first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

const jet = load("jetvalidator-latest.json");
const ajv = load("ajv-latest.json");

const ajvByKey = new Map<string, Result>();
for (const r of ajv.results) ajvByKey.set(`${r.category}/${r.schema}`, r);

type Row = {
  category: string;
  schema: string;
  compileSpeedup: number;
  validRatio: number;
  invalidRatio: number;
};

const rows: Row[] = [];
for (const j of jet.results) {
  const a = ajvByKey.get(`${j.category}/${j.schema}`);
  if (!a) continue;
  rows.push({
    category: j.category,
    schema: j.schema,
    compileSpeedup: a.compilation.time.median / j.compilation.time.median,
    validRatio:
      j.validation.singleValid.opsPerSec.median /
      a.validation.singleValid.opsPerSec.median,
    invalidRatio:
      j.validation.singleInvalidFast.opsPerSec.median /
      a.validation.singleInvalidFast.opsPerSec.median,
  });
}

function median(xs: number[]): number {
  const s = [...xs].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
}

function band(ratios: number[]) {
  let jetWin = 0,
    ajvWin = 0,
    tie = 0;
  for (const r of ratios) {
    if (r > 1 + TIE_BAND) jetWin++;
    else if (r < 1 - TIE_BAND) ajvWin++;
    else tie++;
  }
  return { jetWin, ajvWin, tie };
}

const compileSpeedups = rows.map((r) => r.compileSpeedup);
const validRatios = rows.map((r) => r.validRatio);
const invalidRatios = rows.map((r) => r.invalidRatio);

const validBand = band(validRatios);
const invalidBand = band(invalidRatios);

let md = "# JetValidator vs AJV — Comparison\n\n";
md += `- Jet results: ${jet.timestamp}\n- AJV results: ${ajv.timestamp}\n`;
md += `- Schemas compared head-to-head: ${rows.length}\n`;
md += `- Tie band: \u00b1${TIE_BAND * 100}% (ratios inside this count as parity)\n\n`;

md += "## Headline\n\n";
md += "| Metric | Value |\n|---|---|\n";
md += `| **Compilation speedup (median)** | **${median(compileSpeedups).toFixed(1)}x faster** |\n`;
md += `| Compilation speedup (min) | ${Math.min(...compileSpeedups).toFixed(1)}x |\n`;
md += `| Compilation speedup (max) | ${Math.max(...compileSpeedups).toFixed(1)}x |\n`;
md += `| Valid-data: median throughput ratio | ${median(validRatios).toFixed(2)}x |\n`;
md += `| Invalid-data: median throughput ratio | ${median(invalidRatios).toFixed(2)}x |\n\n`;

md += "## Validation distribution (not win-counting)\n\n";
md += "| Outcome | Valid data | Invalid data |\n|---|---|---|\n";
md += `| Jet faster (>+5%) | ${validBand.jetWin} | ${invalidBand.jetWin} |\n`;
md += `| Parity (\u00b15%) | ${validBand.tie} | ${invalidBand.tie} |\n`;
md += `| AJV faster (>+5%) | ${validBand.ajvWin} | ${invalidBand.ajvWin} |\n\n`;
md += `> Median valid-data throughput ratio is ${median(validRatios).toFixed(2)}x; `;
md += `${validBand.tie} of ${rows.length} schemas land within \u00b15% (statistical parity).\n\n`;

const ajvLeadsValid = rows
  .filter((r) => r.validRatio < 1 - TIE_BAND)
  .sort((a, b) => a.validRatio - b.validRatio);
if (ajvLeadsValid.length) {
  md += "## Where AJV leads (valid data)\n\n";
  md += "| Schema | Category | AJV advantage |\n|---|---|---|\n";
  for (const r of ajvLeadsValid) {
    md += `| ${r.schema} | ${r.category} | ${((1 / r.validRatio - 1) * 100).toFixed(0)}% |\n`;
  }
  md += "\n";
}

md += "## Per-schema detail\n\n";
md += "| Category | Schema | Compile speedup | Valid ratio | Invalid ratio |\n";
md += "|---|---|---|---|---|\n";
for (const r of rows.sort(
  (a, b) => a.category.localeCompare(b.category) || a.schema.localeCompare(b.schema),
)) {
  md += `| ${r.category} | ${r.schema} | ${r.compileSpeedup.toFixed(1)}x | ${r.validRatio.toFixed(2)}x | ${r.invalidRatio.toFixed(2)}x |\n`;
}
md += "\n";

const outPath = path.join(resultsDir, "comparison.md");
fs.writeFileSync(outPath, md);
console.log(`\u2713 Comparison written: ${outPath}`);
console.log(`\nCompile speedup (median): ${median(compileSpeedups).toFixed(1)}x`);
console.log(`Valid throughput (median ratio): ${median(validRatios).toFixed(2)}x`);
console.log(`Invalid throughput (median ratio): ${median(invalidRatios).toFixed(2)}x`);
console.log(`Valid: Jet ${validBand.jetWin} / tie ${validBand.tie} / AJV ${validBand.ajvWin}`);
