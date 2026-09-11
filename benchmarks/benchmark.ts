import { run, bench, group, summary, do_not_optimize } from "mitata";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

import { JetValidator } from "../src/";

type Validate = ((data: any) => boolean) & { errors?: any[] | null };

interface ValidatorAdapter {
  name: string;
  compile: (schema: any, allErrors: boolean) => Validate;
}

function makeAjv(allErrors: boolean) {
  const ajv = new Ajv({ allErrors, strict: false, strictNumbers: false });
  addFormats(ajv);
  return ajv;
}

const jetAdapter: ValidatorAdapter = {
  name: "jet",
  compile: (schema, allErrors) =>
    new JetValidator({
      allErrors,
      strict: false,
      strictNumbers: false,
      // logFunction: true
    }).compile(schema),
};

const ajvAdapter: ValidatorAdapter = {
  name: "ajv",
  compile: (schema, allErrors) => makeAjv(allErrors).compile(schema),
};

const adapters: ValidatorAdapter[] = [jetAdapter, ajvAdapter];

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

const dir = (...p: string[]) => path.join(__dirname, ...p);
const load = (kind: "schemas" | "data", c: string) =>
  JSON.parse(fs.readFileSync(dir(kind, `${c}.json`), "utf-8"));

function assertCorrect(
  name: string,
  validate: Validate,
  validItem: any,
  invalidItem: any,
  schemaName: string,
  category: string,
): void {
  if (validate(validItem) !== true)
    throw new Error(
      `${name}: ${category} - ${schemaName} valid[0] did not return true`,
    );
  if (validate(invalidItem) !== false)
    throw new Error(
      `${name}: ${category} - ${schemaName} invalid[0] did not return false`,
    );
}

type Mode = "compile" | "valid" | "invalid" | "invalidAllErrors";
type Cell = { p50Ns: number; p99Ns: number; minNs: number };
type Row = Partial<Record<Mode, Record<string, Cell>>>;
type Results = Record<string, Record<string, Row>>;

type FullStats = {
  avg: number;
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  p99: number;
  p999: number;
};
type PerAdapter = Record<
  string,
  Record<string, Partial<Record<Mode, Record<string, FullStats>>>>
>;

const THROUGHPUT_MODES: Mode[] = ["valid", "invalid", "invalidAllErrors"];

const MODE_LABEL: Record<Mode, string> = {
  compile: "compile",
  valid: "valid",
  invalid: "invalid",
  invalidAllErrors: "invalid (allErrors)",
};

const benchMeta = new Map<
  string,
  { category: string; schema: string; mode: Mode; adapter: string }
>();

function registerBench(
  category: string,
  schema: string,
  mode: Mode,
  adapter: string,
): string {
  const name = `${adapter} \u2502 ${category} \u2502 ${schema} \u2502 ${mode}`;
  benchMeta.set(name, { category, schema, mode, adapter });
  return name;
}

function asString(v: any): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object")
    return v.name ?? v.label ?? v.alias ?? v.id ?? "";
  return v == null ? "" : String(v);
}

function eachBench(
  trial: any,
  fn: (
    meta: { category: string; schema: string; mode: Mode; adapter: string },
    stats: FullStats,
  ) => void,
): void {
  const benches: any[] = trial?.benchmarks ?? trial?.benches ?? [];
  for (const b of benches) {
    if (!b || b.error) continue;

    const name = asString(b.name ?? b.alias ?? b.n);
    const meta = benchMeta.get(name);
    if (!meta) continue;

    const stats = b.runs?.[0]?.stats ?? b.stats ?? b.runs?.[0];
    if (!stats || typeof stats.avg !== "number") continue;

    fn(meta, stats as FullStats);
  }
}

function extract(trial: any): Results {
  const results: Results = {};
  eachBench(trial, (meta, stats) => {
    results[meta.category] ??= {};
    results[meta.category][meta.schema] ??= {};
    (results[meta.category][meta.schema][meta.mode] ??= {})[meta.adapter] = {
      p50Ns: stats.p50,
      p99Ns: stats.p99,
      minNs: stats.min,
    };
  });
  return results;
}

function extractPerAdapter(trial: any): Record<string, PerAdapter> {
  const byAdapter: Record<string, PerAdapter> = { jet: {}, ajv: {} };
  eachBench(trial, (meta, stats) => {
    const results = (byAdapter[meta.adapter] ??= {});
    results[meta.category] ??= {};
    results[meta.category][meta.schema] ??= {};
    (results[meta.category][meta.schema][meta.mode] ??= {})[meta.adapter] = {
      avg: stats.avg,
      min: stats.min,
      max: stats.max,
      p25: stats.p25,
      p50: stats.p50,
      p75: stats.p75,
      p99: stats.p99,
      p999: stats.p999,
    };
  });
  return byAdapter;
}

const opsFrom = (ns: number) => (ns > 0 ? 1e9 / ns : 0);
const msFrom = (ns: number) => ns / 1e6;
const avg = (a: number[]) =>
  a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// ---- Cold compilation measurement -------------------------------------------
// mitata auto-warms and loops each bench thousands of times, which fully
// JIT-optimizes the compile path and reports a warm number nobody hits in
// practice. Compilation is measured here instead: cold, with a freshly
// constructed instance per sample (construction untimed) so no compile is
// served from a warm cache or a warmed loop. COMPILE_SAMPLES cold samples are
// taken per schema and the median is reported; a single sample is too noisy to
// headline, so the default is 5.
const COMPILE_SAMPLES = Math.max(1, Number(process.env.COMPILE_SAMPLES ?? 5));

type CompilerFactory = () => { compile: (s: any) => Validate };
const compileFactories: Record<string, CompilerFactory> = {
  jet: () => new JetValidator({ allErrors: false, strict: false}),
  ajv: () => makeAjv(false),
};

function measureCompile(factory: CompilerFactory, schema: any): Cell {
  const ns: number[] = [];
  
  for (let i = 0; i < COMPILE_SAMPLES; i++) {
     const inst = factory();//
    const fresh = structuredClone(schema); 
    fresh["tida"] = i;
    const t0 = process.hrtime.bigint();
    do_not_optimize(inst.compile(fresh)); // timed: compile only
    const t1 = process.hrtime.bigint();
    ns.push(Number(t1 - t0));
  }
  ns.sort((a, b) => a - b);
  const q = (p: number) =>
    ns[Math.min(ns.length - 1, Math.round(p * (ns.length - 1)))];
  return { p50Ns: q(0.5), p99Ns: q(0.99), minNs: ns[0] };
}

type CompileCells = Record<string, Record<string, Record<string, Cell>>>;

const TIE_BAND = 0.02;

type Winner = "jet" | "ajv" | "tie";

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const fmtOps = (n: number) =>
  isNaN(n)
    ? "\u2014"
    : n >= 1e6
      ? (n / 1e6).toFixed(2) + "M"
      : n >= 1e3
        ? (n / 1e3).toFixed(1) + "K"
        : n.toFixed(0);

const fmtX = (n: number) => (isNaN(n) ? "\u2014" : n.toFixed(1) + "x");

const decideWinner = (jet: number, ajv: number): Winner => {
  if (isNaN(jet) || isNaN(ajv)) return "tie";
  const hi = Math.max(jet, ajv);
  if (hi === 0 || Math.abs(jet - ajv) / hi <= TIE_BAND) return "tie";
  return jet > ajv ? "jet" : "ajv";
};

const winsResult = (jet: number, ajv: number, total: number) => {
  if (!total) return "\u2014";
  const name = jet >= ajv ? "JetValidator" : "AJV";
  const wins = Math.max(jet, ajv);
  return `${name}, ${Math.round((wins / total) * 100)}% (${wins} of ${total})`;
};

function writeReport(
  trial: any,
  outDir: string,
  saveBaseline: boolean,
  compileCells: CompileCells = {},
) {
  const results = extract(trial);

  // Merge cold compile measurements (taken outside mitata) into results.
  for (const [category, schemas] of Object.entries(compileCells)) {
    for (const [schema, cell] of Object.entries(schemas)) {
      (results[category] ??= {})[schema] ??= {};
      results[category][schema].compile = cell;
    }
  }

  fs.mkdirSync(outDir, { recursive: true });

  const cats = Object.keys(results);
  const generated = new Date().toISOString();
  const ts = generated.replace(/[:.]/g, "-");

  const structured = {
    generated,
    categories: cats,
    tool: "mitata",
    comparison: "jet-vs-ajv",
    compileSamples: COMPILE_SAMPLES,
    results,
  };
  fs.writeFileSync(
    path.join(outDir, `comparison-${ts}.json`),
    JSON.stringify(structured, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, `comparison-latest.json`),
    JSON.stringify(structured, null, 2),
  );

  const baselinePath = path.join(outDir, "comparison-baseline.json");
  let baseline: Results | null = null;
  if (fs.existsSync(baselinePath)) {
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8")).results;
    } catch {
      baseline = null;
    }
  }

  const compileSpeedups: { schema: string; x: number }[] = [];
  const jetCompileMs: number[] = [];
  const ajvCompileMs: number[] = [];
  let jetCompileWins = 0;
  let compileCount = 0;

  type Lead = {
    schema: string;
    kase: string;
    jet: number;
    ajv: number;
    adv: number;
  };
  const jetLeads: Lead[] = [];
  const ajvLeads: Lead[] = [];

  const score: Record<string, { jet: number; ajv: number; tie: number }> = {};
  const tally: Record<Mode, { jet: number; ajv: number; tie: number }> = {
    compile: { jet: 0, ajv: 0, tie: 0 },
    valid: { jet: 0, ajv: 0, tie: 0 },
    invalid: { jet: 0, ajv: 0, tie: 0 },
    invalidAllErrors: { jet: 0, ajv: 0, tie: 0 },
  };
  let totalSchemas = 0;

  for (const category of cats) {
    score[category] = { jet: 0, ajv: 0, tie: 0 };
    for (const [schema, r] of Object.entries(results[category])) {
      totalSchemas++;

      const jc = r.compile?.jet;
      const ac = r.compile?.ajv;
      if (jc && ac) {
        const jms = msFrom(jc.p50Ns);
        const ams = msFrom(ac.p50Ns);
        jetCompileMs.push(jms);
        ajvCompileMs.push(ams);
        if (jms < ams) jetCompileWins++;
        compileCount++;
        if (jms > 0) compileSpeedups.push({ schema, x: ams / jms });
      }

      for (const mode of THROUGHPUT_MODES) {
        const cell = r[mode];
        const j = cell?.jet;
        const a = cell?.ajv;
        if (!j || !a) continue;

        const jo = opsFrom(j.p50Ns);
        const ao = opsFrom(a.p50Ns);
        const w = decideWinner(jo, ao);

        score[category][w]++;
        tally[mode][w]++;

        if (w === "jet") {
          const adv = (jo / ao - 1) * 100;
          if (adv > 50)
            jetLeads.push({
              schema,
              kase: MODE_LABEL[mode],
              jet: jo,
              ajv: ao,
              adv,
            });
        } else if (w === "ajv") {
          const adv = (ao / jo - 1) * 100;
          if (adv > 50)
            ajvLeads.push({
              schema,
              kase: MODE_LABEL[mode],
              jet: jo,
              ajv: ao,
              adv,
            });
        }
      }
    }
  }

  const jetAvgCompile = avg(jetCompileMs);
  const ajvAvgCompile = avg(ajvCompileMs);
  const compileRatio = jetAvgCompile > 0 ? ajvAvgCompile / jetAvgCompile : NaN;
  const hasCompile = compileSpeedups.length > 0;
  const medSpeedup = median(compileSpeedups.map((s) => s.x));
  const maxSpeedup = hasCompile
    ? compileSpeedups.reduce((m, s) => (s.x > m.x ? s : m))
    : { schema: "\u2014", x: NaN };
  const minSpeedup = hasCompile
    ? compileSpeedups.reduce((m, s) => (s.x < m.x ? s : m))
    : { schema: "\u2014", x: NaN };

  const modeTotal = (m: Mode) => tally[m].jet + tally[m].ajv + tally[m].tie;
  const jetThroughputWins = THROUGHPUT_MODES.reduce(
    (n, m) => n + tally[m].jet,
    0,
  );
  const ajvThroughputWins = THROUGHPUT_MODES.reduce(
    (n, m) => n + tally[m].ajv,
    0,
  );
  const tieTotal = THROUGHPUT_MODES.reduce((n, m) => n + tally[m].tie, 0);
  const throughputTotal = jetThroughputWins + ajvThroughputWins + tieTotal;

  const orderOfMag = compileRatio >= 10;
  // A clean sweep is only worth claiming when each schema has more than one
  // cold sample behind it; with a single sample one GC pause flips the claim.
  const compileAll =
    COMPILE_SAMPLES > 1 && compileCount > 0 && jetCompileWins === compileCount;

  let md = `# JetValidator vs AJV: Performance Comparison\n\n`;
  md += `A schema-by-schema benchmark of JetValidator against AJV, the de facto standard JSON Schema validator, across ${totalSchemas} schemas spanning ${cats.join(", ")}.\n\n`;

  md += `## Executive Summary\n\n`;
  md += `JetValidator ${orderOfMag ? "generates validators an order of magnitude faster than" : `compiles ${fmtX(compileRatio)} faster than`} AJV`;
  md += compileAll
    ? ` and is faster to compile on all ${compileCount} schemas tested. `
    : `. `;
  md +=
    jetThroughputWins > ajvThroughputWins
      ? `It also wins the majority of validation throughput comparisons on identical hardware.\n\n`
      : `Validation throughput is competitive between the two.\n\n`;

  md += `| Metric | JetValidator | AJV | Result |\n`;
  md += `|--------|--------------|-----|--------|\n`;
  md += `| Average compilation | ${jetAvgCompile.toFixed(2)} ms | ${ajvAvgCompile.toFixed(2)} ms | JetValidator, ${fmtX(compileRatio)} faster |\n`;
  md += `| Compilation wins | ${jetCompileWins} | ${compileCount - jetCompileWins} | JetValidator, ${jetCompileWins} of ${compileCount} |\n`;
  for (const mode of THROUGHPUT_MODES) {
    const t = tally[mode];
    md += `| ${MODE_LABEL[mode]} throughput wins | ${t.jet} | ${t.ajv} | ${winsResult(t.jet, t.ajv, modeTotal(mode))} |\n`;
  }
  md += `| Overall throughput wins | ${jetThroughputWins} | ${ajvThroughputWins} | ${winsResult(jetThroughputWins, ajvThroughputWins, throughputTotal)} |\n\n`;

  md += `Throughput comparisons use a 2 percent tie band: any two results within 2 percent are recorded as a tie rather than a win. Ties: ${THROUGHPUT_MODES.map((m) => `${tally[m].tie} ${MODE_LABEL[m]}`).join(", ")}.\n\n`;

  md += `## Test Environment\n\n`;
  md += "```\n";
  md += `Platform:  ${process.platform}\n`;
  md += `Runtime:   ${asString(trial?.runtime) || "unknown"}\n`;
  md += `CPU:       ${asString(trial?.cpu) || "unknown"}\n`;
  md += `Date:      ${generated.slice(0, 10)}\n`;
  md += "```\n\n";

  md += `## Methodology\n\n`;
  md += `Validation validators are built once, outside every timed region. Compilation is measured separately as a cold run: each measured compile uses a freshly constructed validator instance (construction untimed) against a freshly structuredClone'd schema, so no compile is served from a warm cache or a warmed JIT loop. Validation throughput uses mitata, which auto-warms and auto-sizes iterations and reports a per-iteration latency distribution.\n\n`;
  md += `- Compilation statistic: cold latency in milliseconds, ${COMPILE_SAMPLES > 1 ? `median of ${COMPILE_SAMPLES} cold samples per schema` : "a single cold compile per schema"}. Lower is better.\n`;
  md += `- Throughput statistic: median (p50) per-iteration latency, converted to operations per second as 1e9 / ns. Higher is better.\n`;
  md += `- Median over mean because latency distributions are right-skewed; the mean is pulled up by scheduler and GC tail outliers.\n`;
  md += `- Three throughput cases are measured: valid data, invalid data with allErrors disabled (first error wins), and invalid data with allErrors enabled (every error collected). The third case exercises error accumulation, which the first two do not.\n`;
  md += `- Throughput comparisons apply a 2 percent tie band.\n`;
  md += `- Compile numbers are measured in-process in schema order, so the compiler JIT warms as the run proceeds; for a stable headline, run the suite in several fresh processes and take the per-schema minimum.\n\n`;

  md += `## Compilation Performance\n\n`;
  md += `Compilation is measured as the time to produce a validator from a schema.${compileAll ? " JetValidator is faster on every schema tested." : ""}\n\n`;
  for (const category of cats) {
    const rows = Object.entries(results[category]).filter(
      ([, r]) => r.compile?.jet && r.compile?.ajv,
    );
    if (!rows.length) continue;
    md += `### ${category.toUpperCase()}\n\n`;
    md += `| Schema | JetValidator | AJV | Speedup |\n`;
    md += `|--------|--------------|-----|---------|\n`;
    for (const [schema, r] of rows) {
      const j = msFrom(r.compile!.jet.p50Ns);
      const a = msFrom(r.compile!.ajv.p50Ns);
      md += `| ${schema} | ${j.toFixed(2)} ms | ${a.toFixed(2)} ms | ${fmtX(a / j)} |\n`;
    }
    md += `\n`;
  }

  md += `### Compilation Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Schemas tested | ${compileCount} |\n`;
  md += `| Cold samples per schema | ${COMPILE_SAMPLES} |\n`;
  md += `| JetValidator average | ${jetAvgCompile.toFixed(2)} ms |\n`;
  md += `| AJV average | ${ajvAvgCompile.toFixed(2)} ms |\n`;
  md += `| Average speedup (ratio of averages) | ${fmtX(compileRatio)} |\n`;
  md += `| Median per-schema speedup | ${fmtX(medSpeedup)} |\n`;
  md += `| Maximum per-schema speedup | ${fmtX(maxSpeedup.x)} (${maxSpeedup.schema}) |\n`;
  md += `| Minimum per-schema speedup | ${fmtX(minSpeedup.x)} (${minSpeedup.schema}) |\n\n`;
  md += `Two speedup figures are reported because they answer different questions. The ratio of averages is the conservative headline for total time saved. The median per-schema speedup describes the typical schema.\n\n`;

  md += `## Validation Throughput by Category\n\n`;
  md += `Each case is reported separately. The invalid columns measure how quickly each validator rejects non-conforming data; the allErrors column additionally exercises error accumulation.\n\n`;
  for (const category of cats) {
    md += `### ${category.toUpperCase()}\n\n`;
    md += `| Schema | Case | JetValidator | AJV | Winner |\n`;
    md += `|--------|------|--------------|-----|--------|\n`;
    for (const [schema, r] of Object.entries(results[category])) {
      for (const mode of THROUGHPUT_MODES) {
        const cell = r[mode];
        const j = cell?.jet;
        const a = cell?.ajv;
        if (!j || !a) continue;
        const jo = opsFrom(j.p50Ns);
        const ao = opsFrom(a.p50Ns);
        const w = decideWinner(jo, ao);
        const jt = w === "jet" ? `**${fmtOps(jo)}**` : fmtOps(jo);
        const at = w === "ajv" ? `**${fmtOps(ao)}**` : fmtOps(ao);
        const label =
          w === "jet" ? "JetValidator" : w === "ajv" ? "AJV" : "Tie";
        md += `| ${schema} | ${MODE_LABEL[mode]} | ${jt} | ${at} | ${label} |\n`;
      }
    }
    const s = score[category];
    md += `\nCategory result: JetValidator ${s.jet}, AJV ${s.ajv}${s.tie ? `, ${s.tie} ties` : ""}.\n\n`;
  }

  const leadTable = (
    title: string,
    arr: Lead[],
    leader: "JetValidator" | "AJV",
  ) => {
    if (!arr.length) return "";
    const other = leader === "JetValidator" ? "AJV" : "JetValidator";
    const sorted = [...arr].sort((a, b) => b.adv - a.adv);
    let out = `## ${title}\n\n`;
    out += `| Schema | Case | ${leader} | ${other} | Advantage |\n`;
    out += `|--------|------|--------------|-----|-----------|\n`;
    for (const l of sorted) {
      const lead = leader === "JetValidator" ? l.jet : l.ajv;
      const oth = leader === "JetValidator" ? l.ajv : l.jet;
      out += `| ${l.schema} | ${l.kase} | ${fmtOps(lead)} | ${fmtOps(oth)} | +${Math.round(l.adv)}% |\n`;
    }
    return out + `\n`;
  };
  md += leadTable(
    "Where JetValidator Leads by More Than 50 Percent",
    jetLeads,
    "JetValidator",
  );
  md += leadTable("Where AJV Leads by More Than 50 Percent", ajvLeads, "AJV");

  md += `## Scorecard\n\n`;
  md += `Combined throughput wins per category, across all three cases.\n\n`;
  md += `| Category | JetValidator | AJV | Ties |\n|----------|--------------|-----|------|\n`;
  let tj = 0;
  let ta = 0;
  let tt = 0;
  for (const category of cats) {
    const s = score[category];
    tj += s.jet;
    ta += s.ajv;
    tt += s.tie;
    md += `| ${category.toUpperCase()} | ${s.jet} | ${s.ajv} | ${s.tie} |\n`;
  }
  md += `| **Total** | **${tj}** | **${ta}** | **${tt}** |\n\n`;
  md += `Across all ${tj + ta + tt} throughput comparisons, ${tj >= ta ? "JetValidator" : "AJV"} wins ${Math.round((Math.max(tj, ta) / (tj + ta + tt || 1)) * 100)} percent.\n\n`;

  const ajvFavored = cats.filter((c) => score[c].ajv >= score[c].jet);
  md += `## Known Limitations\n\n`;
  md += `These results are reported as measured, including the cases where AJV is ahead:\n\n`;
  if (ajvFavored.length)
    md += `- Categories where AJV is even or ahead on throughput: ${ajvFavored.map((c) => c.toUpperCase()).join(", ")}.\n`;
  if (ajvLeads.length) {
    const top = [...ajvLeads].sort((a, b) => b.adv - a.adv).slice(0, 5);
    md += `- Largest AJV throughput advantages: ${top.map((l) => `${l.schema} (${l.kase}, +${Math.round(l.adv)}%)`).join("; ")}.\n`;
  }
  md += `\nThese are named here rather than omitted so the comparison can be reproduced and trusted.\n\n`;

  md += `## Summary\n\n`;
  md += `On identical hardware, measured in a single run:\n\n`;
  md += `- Compilation averages ${fmtX(compileRatio)} faster (median per-schema ${fmtX(medSpeedup)})${compileAll ? `, and is faster on all ${compileCount} schemas` : ""}.\n`;
  for (const mode of THROUGHPUT_MODES) {
    const t = tally[mode];
    const total = modeTotal(mode) || 1;
    md += `- ${MODE_LABEL[mode]} throughput favors ${t.jet >= t.ajv ? "JetValidator" : "AJV"} on ${Math.round((Math.max(t.jet, t.ajv) / total) * 100)} percent of schemas.\n`;
  }

  fs.writeFileSync(path.join(outDir, "comparison-report.md"), md);

  if (baseline) {
    for (const category of cats) {
      for (const [schema, r] of Object.entries(results[category])) {
        const jv = r.valid?.jet;
        const base = baseline?.[category]?.[schema]?.valid?.jet;
        if (jv && base) {
          const s = base.p50Ns / jv.p50Ns;
          if (s > 1.05)
            console.log(
              `  ${category}/${schema} faster by ${((s - 1) * 100).toFixed(1)}%`,
            );
          else if (s < 0.95)
            console.log(
              `  ${category}/${schema} slower by ${((1 - s) * 100).toFixed(1)}%`,
            );
        }
      }
    }
  }

  console.log(
    `\nWrote comparison-latest.json + comparison-report.md to ${outDir}`,
  );

  if (saveBaseline) {
    fs.writeFileSync(baselinePath, JSON.stringify({ results }, null, 2));
    console.log(`Saved as baseline: ${baselinePath}`);
  }

  const perAdapter = extractPerAdapter(trial);
  for (const adapter of Object.keys(perAdapter)) {
    const payload = {
      generated,
      categories: cats,
      tool: "mitata",
      comparison: adapter,
      results: perAdapter[adapter],
    };
    fs.writeFileSync(
      path.join(outDir, `${adapter}-${ts}.json`),
      JSON.stringify(payload, null, 2),
    );
    fs.writeFileSync(
      path.join(outDir, `${adapter}-latest.json`),
      JSON.stringify(payload, null, 2),
    );
  }
}

async function main() {
  const compileCells: CompileCells = {};

  for (const category of categories) {
    let schemas: Record<string, any>;
    let data: Record<string, { valid?: any[]; invalid?: any[] }>;
    try {
      schemas = load("schemas", category);
      data = load("data", category);
    } catch (e) {
      console.warn(`skipping category ${category}: ${(e as Error).message}`);
      continue;
    }

    for (const [schemaName, schema] of Object.entries(schemas)) {
      // if (schemaName !== "deepAnyOf") continue;
      const validItem = data[schemaName]?.valid?.[0];
      const invalidItem = data[schemaName]?.invalid?.[0];
      if (validItem === undefined || invalidItem === undefined) {
        console.warn(
          `skipping ${category}/${schemaName}: missing valid[0] or invalid[0]`,
        );
        continue;
      }

      // Cold compile measurement (outside mitata). Taken before the correctness
      // compiles below so each recorded compile is as cold as the process allows.
      (compileCells[category] ??= {})[schemaName] = {
        jet: measureCompile(compileFactories.jet, schema),
        ajv: measureCompile(compileFactories.ajv, schema),
      };

      const compiled = adapters.map((a) => {
        const validate = a.compile(schema, false);
        const allErrorsValidate = a.compile(schema, true);
        assertCorrect(
          a.name,
          validate,
          validItem,
          invalidItem,
          schemaName,
          category,
        );
        assertCorrect(
          `${a.name} (allErrors)`,
          allErrorsValidate,
          validItem,
          invalidItem,
          schemaName,
          category,
        );
        return { name: a.name, validate, allErrorsValidate };
      });

      group(`${category} \u00b7 ${schemaName} \u00b7 validate(valid)`, () => {
        summary(() => {
          for (const c of compiled)
            bench(registerBench(category, schemaName, "valid", c.name), () => {
              do_not_optimize(c.validate(validItem));
            });
        });
      });

      group(`${category} \u00b7 ${schemaName} \u00b7 validate(invalid)`, () => {
        summary(() => {
          for (const c of compiled)
            bench(
              registerBench(category, schemaName, "invalid", c.name),
              () => {
                do_not_optimize(c.validate(invalidItem));
              },
            );
        });
      });

      group(
        `${category} \u00b7 ${schemaName} \u00b7 validate(invalid, allErrors)`,
        () => {
          summary(() => {
            for (const c of compiled)
              bench(
                registerBench(category, schemaName, "invalidAllErrors", c.name),
                () => {
                  do_not_optimize(c.allErrorsValidate(invalidItem));
                },
              );
          });
        },
      );
    }
  }

  const trial = await run({ format: "quiet" });

  const saveBaseline = process.argv.slice(2).includes("--baseline");
  writeReport(trial, dir("results"), saveBaseline, compileCells);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
