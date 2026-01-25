"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JetValidatorBenchmark = void 0;
var dist_1 = require("../dist");
var fs = require("fs");
var path = require("path");
var JetValidatorBenchmark = /** @class */ (function () {
    function JetValidatorBenchmark() {
        this.warmupIterations = 1000;
        this.benchmarkIterations = 10000;
        this.batchSize = 1000;
        this.benchmarkRuns = 30;
        this.results = [];
        this.failedBenchmarks = [];
        this.baselineResults = null;
    }
    JetValidatorBenchmark.prototype.loadSchemas = function (category) {
        var schemaPath = path.join(__dirname, "schemas", "".concat(category, ".json"));
        return JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    };
    JetValidatorBenchmark.prototype.loadTestData = function (category) {
        var dataPath = path.join(__dirname, "data", "".concat(category, ".json"));
        return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    };
    JetValidatorBenchmark.prototype.loadBaseline = function () {
        var baselinePath = path.join(__dirname, "results", "jetbaseline.json");
        if (fs.existsSync(baselinePath)) {
            this.baselineResults = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
            console.log("✓ Loaded baseline results for comparison\n");
        }
    };
    JetValidatorBenchmark.prototype.measureMemory = function () {
        if (global.gc) {
            // Run GC multiple times to ensure clean state
            for (var i = 0; i < 5; i++) {
                global.gc();
            }
            // Wait for GC to complete
            var start = Date.now();
            while (Date.now() - start < 100) { } // Increased to 100ms
        }
        return process.memoryUsage().heapUsed;
    };
    JetValidatorBenchmark.prototype.shuffleArray = function (array) {
        var _a;
        var arr = __spreadArray([], array, true);
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            _a = [arr[j], arr[i]], arr[i] = _a[0], arr[j] = _a[1];
        }
        return arr;
    };
    JetValidatorBenchmark.prototype.benchmark = function (fn, iterations) {
        var start = process.hrtime.bigint();
        for (var i = 0; i < iterations; i++) {
            fn();
        }
        var end = process.hrtime.bigint();
        return Number(end - start) / 1000000;
    };
    JetValidatorBenchmark.prototype.calculateStats = function (values) {
        var sorted = __spreadArray([], values, true).sort(function (a, b) { return a - b; });
        var mean = values.reduce(function (a, b) { return a + b; }) / values.length;
        var variance = values.reduce(function (sum, val) { return sum + Math.pow(val - mean, 2); }, 0) /
            values.length;
        var stdDev = Math.sqrt(variance);
        return {
            mean: mean,
            median: sorted[Math.floor(sorted.length / 2)],
            stdDev: stdDev,
            min: Math.min.apply(Math, values),
            max: Math.max.apply(Math, values),
            p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
            p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
        };
    };
    JetValidatorBenchmark.prototype.benchmarkMultipleRuns = function (fn, iterations, runs) {
        if (runs === void 0) { runs = this.benchmarkRuns; }
        var times = [];
        for (var run = 0; run < runs; run++) {
            var time = this.benchmark(fn, iterations);
            times.push(time);
        }
        return this.calculateStats(times);
    };
    JetValidatorBenchmark.prototype.warmup = function (validate, data, iterations) {
        if (iterations === void 0) { iterations = this.warmupIterations; }
        for (var i = 0; i < iterations; i++) {
            validate(data[i % data.length]);
        }
    };
    JetValidatorBenchmark.prototype.benchmarkCompilation = function (schema) {
        var memBefore = this.measureMemory();
        var compilationTimes = [];
        var jetValidator = new dist_1.JetValidator({ allErrors: false, strict: false });
        var start = process.hrtime.bigint();
        jetValidator.compile(schema);
        var end = process.hrtime.bigint();
        compilationTimes.push(Number(end - start) / 1000000);
        var memAfter = this.measureMemory();
        var timeStats = this.calculateStats(compilationTimes);
        return {
            time: timeStats,
            memoryBefore: memBefore,
            memoryAfter: memAfter,
            memoryUsed: memAfter - memBefore,
        };
    };
    JetValidatorBenchmark.prototype.benchmarkValidation = function (validate, svalidData, sinvalidData, allErrorsValidate) {
        var _this = this;
        var _a;
        var validData = this.shuffleArray(svalidData);
        var invalidData = this.shuffleArray(sinvalidData);
        var singleValidTimeStats = this.benchmarkMultipleRuns(function () {
            for (var i = 0; i < _this.benchmarkIterations; i++) {
                validate(validData[i % validData.length]);
            }
        }, 1);
        var singleValidOpsStats = {
            mean: (this.benchmarkIterations / singleValidTimeStats.mean) * 1000,
            median: (this.benchmarkIterations / singleValidTimeStats.median) * 1000,
            stdDev: singleValidTimeStats.stdDev,
            min: (this.benchmarkIterations / singleValidTimeStats.max) * 1000,
            max: (this.benchmarkIterations / singleValidTimeStats.min) * 1000,
            p95: (this.benchmarkIterations / singleValidTimeStats.p95) * 1000,
            p99: (this.benchmarkIterations / singleValidTimeStats.p99) * 1000,
        };
        var batchValidData = Array(this.batchSize)
            .fill(null)
            .map(function (_, i) { return validData[i % validData.length]; });
        this.warmup(function () {
            for (var _i = 0, batchValidData_1 = batchValidData; _i < batchValidData_1.length; _i++) {
                var item = batchValidData_1[_i];
                validate(item);
            }
        }, [batchValidData], 100);
        var batchValidTimeStats = this.benchmarkMultipleRuns(function () {
            for (var _i = 0, batchValidData_2 = batchValidData; _i < batchValidData_2.length; _i++) {
                var item = batchValidData_2[_i];
                validate(item);
            }
        }, 100);
        var batchValidOpsStats = {
            mean: ((this.batchSize * 100) / batchValidTimeStats.mean) * 1000,
            median: ((this.batchSize * 100) / batchValidTimeStats.median) * 1000,
            stdDev: batchValidTimeStats.stdDev,
            min: ((this.batchSize * 100) / batchValidTimeStats.max) * 1000,
            max: ((this.batchSize * 100) / batchValidTimeStats.min) * 1000,
            p95: ((this.batchSize * 100) / batchValidTimeStats.p95) * 1000,
            p99: ((this.batchSize * 100) / batchValidTimeStats.p99) * 1000,
        };
        this.warmup(validate, invalidData);
        var singleInvalidFastTimeStats = this.benchmarkMultipleRuns(function () {
            for (var i = 0; i < _this.benchmarkIterations; i++) {
                validate(invalidData[i % invalidData.length]);
            }
        }, 1);
        var singleInvalidFastOpsStats = {
            mean: (this.benchmarkIterations / singleInvalidFastTimeStats.mean) * 1000,
            median: (this.benchmarkIterations / singleInvalidFastTimeStats.median) * 1000,
            stdDev: singleInvalidFastTimeStats.stdDev,
            min: (this.benchmarkIterations / singleInvalidFastTimeStats.max) * 1000,
            max: (this.benchmarkIterations / singleInvalidFastTimeStats.min) * 1000,
            p95: (this.benchmarkIterations / singleInvalidFastTimeStats.p95) * 1000,
            p99: (this.benchmarkIterations / singleInvalidFastTimeStats.p99) * 1000,
        };
        this.warmup(allErrorsValidate, invalidData);
        allErrorsValidate(invalidData[0]);
        var errorCount = ((_a = allErrorsValidate.errors) === null || _a === void 0 ? void 0 : _a.length) || 0;
        var singleInvalidAllTimeStats = this.benchmarkMultipleRuns(function () {
            for (var i = 0; i < _this.benchmarkIterations; i++) {
                allErrorsValidate(invalidData[i % invalidData.length]);
            }
        }, 1);
        var singleInvalidAllOpsStats = {
            mean: (this.benchmarkIterations / singleInvalidAllTimeStats.mean) * 1000,
            median: (this.benchmarkIterations / singleInvalidAllTimeStats.median) * 1000,
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
                errorCount: errorCount,
            },
        };
    };
    JetValidatorBenchmark.prototype.benchmarkSchema = function (schemaName, schema, validData, invalidData, category) {
        console.log("  Benchmarking: ".concat(schemaName));
        var jetValidator = new dist_1.JetValidator({ allErrors: false, strict: false });
        var jetValidatorAllErrors = new dist_1.JetValidator({
            allErrors: true,
            strict: false,
        });
        var compilation = this.benchmarkCompilation(schema);
        var validate = jetValidator.compile(schema);
        var allErrorsValidate = jetValidatorAllErrors.compile(schema);
        var validation = this.benchmarkValidation(validate, validData, invalidData, allErrorsValidate);
        return {
            schema: schemaName,
            category: category,
            compilation: compilation,
            validation: validation,
        };
    };
    JetValidatorBenchmark.prototype.compareWithBaseline = function (result) {
        if (!this.baselineResults)
            return "";
        var baseline = this.baselineResults.find(function (r) { return r.schema === result.schema && r.category === result.category; });
        if (!baseline)
            return "";
        var currentOps = result.validation.singleValid.opsPerSec.mean;
        var baselineOps = baseline.validation.singleValid.opsPerSec.mean;
        var speedup = currentOps / baselineOps;
        var percentage = ((speedup - 1) * 100).toFixed(2);
        if (speedup > 1.05) {
            return " \uD83D\uDE80 ".concat(percentage, "% faster");
        }
        else if (speedup < 0.95) {
            return " \uD83D\uDC0C ".concat(Math.abs(parseFloat(percentage)), "% slower");
        }
        else {
            return " \u2248 similar performance";
        }
    };
    JetValidatorBenchmark.prototype.runBenchmarks = function () {
        return __awaiter(this, void 0, void 0, function () {
            var categories, _i, categories_1, category, schemas, data, _a, _b, _c, schemaName, schema, testData, validData, invalidData, result, comparison;
            return __generator(this, function (_d) {
                console.log("Starting JetValidator Benchmarks...\n");
                console.log("Configuration:");
                console.log("  Warmup iterations: ".concat(this.warmupIterations));
                console.log("  Benchmark iterations: ".concat(this.benchmarkIterations));
                console.log("  Runs per benchmark: ".concat(this.benchmarkRuns));
                console.log("  Batch size: ".concat(this.batchSize, "\n"));
                this.loadBaseline();
                categories = [
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
                for (_i = 0, categories_1 = categories; _i < categories_1.length; _i++) {
                    category = categories_1[_i];
                    console.log("\nCategory: ".concat(category.toUpperCase()));
                    console.log("=".repeat(50));
                    try {
                        schemas = this.loadSchemas(category);
                        data = this.loadTestData(category);
                        for (_a = 0, _b = Object.entries(schemas); _a < _b.length; _a++) {
                            _c = _b[_a], schemaName = _c[0], schema = _c[1];
                            if (schemaName === "array100KItems" ||
                                schemaName === "arrayUniqueItems1K" ||
                                schemaName === "arrayComplexItems")
                                continue;
                            testData = data[schemaName];
                            validData = testData === null || testData === void 0 ? void 0 : testData.valid;
                            invalidData = testData === null || testData === void 0 ? void 0 : testData.invalid;
                            if (!validData ||
                                !invalidData ||
                                validData.length === 0 ||
                                invalidData.length === 0) {
                                console.log("  \u26A0\uFE0F  Skipping ".concat(schemaName, ": missing test data"));
                                continue;
                            }
                            try {
                                result = this.benchmarkSchema(schemaName, schema, validData, invalidData, category);
                                this.results.push(result);
                                comparison = this.compareWithBaseline(result);
                                console.log("  \u2713 Completed ".concat(schemaName).concat(comparison));
                            }
                            catch (error) {
                                console.error("  \u2717 Error in ".concat(schemaName, ":"));
                                console.error("    ".concat(error.message));
                                this.failedBenchmarks.push({
                                    schema: schemaName,
                                    category: category,
                                    error: error.message,
                                });
                            }
                        }
                    }
                    catch (error) {
                        console.error("  \u2717 Failed to load category ".concat(category, ":"));
                        console.error("    ".concat(error.message));
                    }
                }
                this.saveResults();
                this.printSummary();
                this.generateMarkdownReport();
                return [2 /*return*/];
            });
        });
    };
    JetValidatorBenchmark.prototype.saveResults = function () {
        var resultsDir = path.join(__dirname, "results");
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        var timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        var resultsPath = path.join(resultsDir, "jetvalidator-".concat(timestamp, ".json"));
        var latestPath = path.join(resultsDir, "jetvalidator-latest.json");
        var output = {
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
        console.log("\n\u2713 Results saved to: ".concat(resultsPath));
        console.log("\u2713 Latest results: ".concat(latestPath));
        if (this.failedBenchmarks.length > 0) {
            console.log("\n\u26A0\uFE0F  ".concat(this.failedBenchmarks.length, " benchmark(s) failed"));
        }
    };
    JetValidatorBenchmark.prototype.printSummary = function () {
        console.log("\n" + "=".repeat(70));
        console.log("BENCHMARK SUMMARY");
        console.log("=".repeat(70));
        var avgCompilation = this.results.reduce(function (sum, r) { return sum + r.compilation.time.mean; }, 0) /
            this.results.length;
        var avgValidOps = this.results.reduce(function (sum, r) { return sum + r.validation.singleValid.opsPerSec.mean; }, 0) / this.results.length;
        var avgInvalidOps = this.results.reduce(function (sum, r) { return sum + r.validation.singleInvalidFast.opsPerSec.mean; }, 0) / this.results.length;
        console.log("\nTotal Schemas Tested: ".concat(this.results.length));
        console.log("Failed Benchmarks: ".concat(this.failedBenchmarks.length));
        console.log("\nAverage Compilation Time: ".concat(avgCompilation.toFixed(2), "ms"));
        console.log("Average Valid Data Ops/Sec: ".concat(avgValidOps.toFixed(0)));
        console.log("Average Invalid Data Ops/Sec (fail-fast): ".concat(avgInvalidOps.toFixed(0)));
        console.log("\n" + "-".repeat(70));
        console.log("Top 5 Fastest Validators (ops/sec):");
        console.log("-".repeat(70));
        var sorted = __spreadArray([], this.results, true).sort(function (a, b) {
            return b.validation.singleValid.opsPerSec.mean -
                a.validation.singleValid.opsPerSec.mean;
        });
        sorted.slice(0, 5).forEach(function (r, i) {
            var ops = r.validation.singleValid.opsPerSec.mean;
            var stdDev = r.validation.singleValid.opsPerSec.stdDev;
            console.log("".concat(i + 1, ". ").concat(r.schema.padEnd(30), " ").concat(ops
                .toFixed(0)
                .padStart(15), " ops/sec (\u00B1").concat(stdDev.toFixed(2), "%)"));
        });
        console.log("\n" + "-".repeat(70));
        console.log("Top 5 Slowest Validators (ops/sec):");
        console.log("-".repeat(70));
        sorted
            .slice(-5)
            .reverse()
            .forEach(function (r, i) {
            var ops = r.validation.singleValid.opsPerSec.mean;
            var stdDev = r.validation.singleValid.opsPerSec.stdDev;
            console.log("".concat(i + 1, ". ").concat(r.schema.padEnd(30), " ").concat(ops
                .toFixed(0)
                .padStart(15), " ops/sec (\u00B1").concat(stdDev.toFixed(2), "%)"));
        });
        console.log("\n" + "-".repeat(70));
        console.log("Compilation Time Breakdown:");
        console.log("-".repeat(70));
        var compSorted = __spreadArray([], this.results, true).sort(function (a, b) { return b.compilation.time.mean - a.compilation.time.mean; });
        console.log("\nSlowest to compile:");
        compSorted.slice(0, 5).forEach(function (r, i) {
            var time = r.compilation.time.mean;
            var stdDev = r.compilation.time.stdDev;
            console.log("".concat(i + 1, ". ").concat(r.schema.padEnd(30), " ").concat(time
                .toFixed(2)
                .padStart(10), "ms (\u00B1").concat(stdDev.toFixed(2), "ms)"));
        });
        console.log("\n" + "=".repeat(70) + "\n");
    };
    JetValidatorBenchmark.prototype.generateMarkdownReport = function () {
        var reportPath = path.join(__dirname, "results", "jetreport.md");
        var md = "# JetValidator Benchmark Report\n\n";
        md += "**Generated:** ".concat(new Date().toISOString(), "\n\n");
        md += "## Configuration\n\n";
        md += "- Warmup iterations: ".concat(this.warmupIterations, "\n");
        md += "- Benchmark iterations: ".concat(this.benchmarkIterations, "\n");
        md += "- Runs per benchmark: ".concat(this.benchmarkRuns, "\n");
        md += "- Batch size: ".concat(this.batchSize, "\n\n");
        md += "## Summary\n\n";
        md += "- Total schemas tested: ".concat(this.results.length, "\n");
        md += "- Failed benchmarks: ".concat(this.failedBenchmarks.length, "\n\n");
        var categories = Array.from(new Set(this.results.map(function (r) { return r.category; })));
        var _loop_1 = function (category) {
            md += "## ".concat(category.toUpperCase(), "\n\n");
            md +=
                "| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |\n";
            md +=
                "|--------|------------------|-----------------|-------------------|-------------|\n";
            var categoryResults = this_1.results.filter(function (r) { return r.category === category; });
            for (var _c = 0, categoryResults_1 = categoryResults; _c < categoryResults_1.length; _c++) {
                var result = categoryResults_1[_c];
                var comp = result.compilation.time.mean.toFixed(2);
                var validOps = result.validation.singleValid.opsPerSec.mean.toFixed(0);
                var invalidOps = result.validation.singleInvalidFast.opsPerSec.mean.toFixed(0);
                var mem = (result.compilation.memoryUsed / 1024).toFixed(2);
                md += "| ".concat(result.schema, " | ").concat(comp, " | ").concat(validOps, " | ").concat(invalidOps, " | ").concat(mem, " |\n");
            }
            md += "\n";
        };
        var this_1 = this;
        for (var _i = 0, categories_2 = categories; _i < categories_2.length; _i++) {
            var category = categories_2[_i];
            _loop_1(category);
        }
        if (this.failedBenchmarks.length > 0) {
            md += "## Failed Benchmarks\n\n";
            md += "| Category | Schema | Error |\n";
            md += "|----------|--------|-------|\n";
            for (var _a = 0, _b = this.failedBenchmarks; _a < _b.length; _a++) {
                var failed = _b[_a];
                md += "| ".concat(failed.category, " | ").concat(failed.schema, " | ").concat(failed.error, " |\n");
            }
            md += "\n";
        }
        fs.writeFileSync(reportPath, md);
        console.log("\u2713 Markdown report: ".concat(reportPath, "\n"));
    };
    JetValidatorBenchmark.prototype.saveAsBaseline = function () {
        var baselinePath = path.join(__dirname, "results", "jetbaseline.json");
        fs.writeFileSync(baselinePath, JSON.stringify(this.results, null, 2));
        console.log("\u2713 Current results saved as baseline: ".concat(baselinePath));
    };
    return JetValidatorBenchmark;
}());
exports.JetValidatorBenchmark = JetValidatorBenchmark;
if (require.main === module) {
    var args = process.argv.slice(2);
    var saveBaseline_1 = args.includes("--baseline");
    var benchmark_1 = new JetValidatorBenchmark();
    benchmark_1
        .runBenchmarks()
        .then(function () {
        if (saveBaseline_1) {
            benchmark_1.saveAsBaseline();
        }
    })
        .catch(console.error);
}
