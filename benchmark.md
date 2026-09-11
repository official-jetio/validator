# JetValidator vs AJV: Performance Comparison

A schema-by-schema benchmark of JetValidator against AJV, the de facto standard JSON Schema validator, across 65 schemas spanning real-world, features, formats, stress, complexity-composition, complexity-formats, complexity-patterns, scale-arrays, scale-nesting, scale-objects, scale-refs.

## Executive Summary

JetValidator generates validators an order of magnitude faster than AJV and is faster to compile on all 65 schemas tested. It also wins the majority of validation throughput comparisons on identical hardware.

| Metric | JetValidator | AJV | Result |
|--------|--------------|-----|--------|
| Average compilation | 0.52 ms | 7.58 ms | JetValidator, 14.6x faster |
| Compilation wins | 65 | 0 | JetValidator, 65 of 65 |
| valid throughput wins | 39 | 10 | JetValidator, 60% (39 of 65) |
| invalid throughput wins | 42 | 12 | JetValidator, 65% (42 of 65) |
| invalid (allErrors) throughput wins | 26 | 26 | JetValidator, 40% (26 of 65) |
| Overall throughput wins | 107 | 48 | JetValidator, 55% (107 of 195) |

Throughput comparisons use a 2 percent tie band: any two results within 2 percent are recorded as a tie rather than a win. Ties: 16 valid, 11 invalid, 13 invalid (allErrors).

## Test Environment

```
Platform:  linux
Runtime:   Node.js v24.20.0
CPU:       1.6 GHz laptop (x86_64)
Date:      2026-09-11
```

## About the schema names

Most schema names describe the schema itself. Some describe the *data* instead —
this is a validation benchmark, so a name like `object1000Props` means "validate an
object with 1000 properties," not "a schema with 1000 property definitions."

Quick example: `object50Props` really is 50 properties written out, so it's slower
to compile than `object1000Props`, which is just one `patternProperties` rule with a
`maxProperties: 1000` bound. The 1000 lives in the data, not the schema.

So if a compile number looks backwards, check the schema — the name might be about
the data.

## Methodology

Validation validators are built once, outside every timed region. Compilation is measured separately as a cold run: each measured compile uses a freshly constructed validator instance (construction untimed) against a freshly structuredClone'd schema, so no compile is served from a warm cache or a warmed JIT loop. Validation throughput uses mitata, which auto-warms and auto-sizes iterations and reports a per-iteration latency distribution.

- Compilation statistic: cold latency in milliseconds, median of 5 cold samples per schema. Lower is better.
- Throughput statistic: median (p50) per-iteration latency, converted to operations per second as 1e9 / ns. Higher is better.
- Median over mean because latency distributions are right-skewed; the mean is pulled up by scheduler and GC tail outliers.
- Three throughput cases are measured: valid data, invalid data with allErrors disabled (first error wins), and invalid data with allErrors enabled (every error collected). The third case exercises error accumulation, which the first two do not.
- Throughput comparisons apply a 2 percent tie band.
- Compile numbers are measured in-process in schema order, so the compiler JIT warms as the run proceeds; for a stable headline, run the suite in several fresh processes and take the per-schema minimum.

## Compilation Performance

Compilation is measured as the time to produce a validator from a schema. JetValidator is faster on every schema tested.

### REAL-WORLD

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| packageJson | 1.74 ms | 18.58 ms | 10.7x |
| tsconfigJson | 1.20 ms | 10.07 ms | 8.4x |
| openApiPath | 0.73 ms | 9.32 ms | 12.8x |
| jsonResume | 0.88 ms | 9.64 ms | 11.0x |
| geoJson | 0.38 ms | 8.93 ms | 23.5x |
| awsCloudFormation | 0.50 ms | 7.42 ms | 14.7x |
| graphqlSchema | 0.62 ms | 7.78 ms | 12.5x |

### FEATURES

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| simpleTypes | 0.45 ms | 5.93 ms | 13.1x |
| stringConstraints | 0.28 ms | 6.37 ms | 22.7x |
| numericConstraints | 0.32 ms | 6.62 ms | 20.4x |
| arrayOperations | 0.47 ms | 8.15 ms | 17.2x |
| objectValidation | 0.25 ms | 7.58 ms | 29.9x |
| composition | 0.54 ms | 7.20 ms | 13.3x |
| conditionals | 0.26 ms | 6.60 ms | 25.8x |

### FORMATS

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| regexFormats | 0.28 ms | 6.64 ms | 23.9x |
| functionFormats | 0.17 ms | 5.85 ms | 33.5x |
| mixedFormats | 0.33 ms | 6.79 ms | 20.8x |
| integerFormats | 0.14 ms | 5.52 ms | 38.5x |

### STRESS

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| deepNesting | 0.51 ms | 8.64 ms | 16.9x |
| wideObject | 1.02 ms | 9.33 ms | 9.1x |
| largeEnum | 0.19 ms | 7.15 ms | 37.3x |
| complexRefs | 0.69 ms | 8.17 ms | 11.9x |

### COMPLEXITY-COMPOSITION

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| deepAllOf | 0.43 ms | 6.21 ms | 14.6x |
| deepAnyOf | 0.36 ms | 6.52 ms | 18.1x |
| deepOneOf | 2.10 ms | 14.78 ms | 7.0x |
| mixedComposition | 0.38 ms | 6.64 ms | 17.3x |
| complexNot | 0.33 ms | 6.90 ms | 20.7x |
| multiLayeredComposition | 0.32 ms | 7.51 ms | 23.2x |
| wideComposition | 0.74 ms | 7.84 ms | 10.6x |
| recursiveComposition | 0.37 ms | 6.50 ms | 17.5x |

### COMPLEXITY-FORMATS

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| bulkEmailValidation | 0.14 ms | 6.50 ms | 45.1x |
| bulkUuidValidation | 0.15 ms | 5.71 ms | 38.7x |
| bulkDateTimeValidation | 0.18 ms | 5.73 ms | 32.3x |
| bulkUriValidation | 0.20 ms | 5.65 ms | 28.9x |
| mixedFormats100Items | 0.23 ms | 6.04 ms | 26.3x |
| nestedFormats | 0.27 ms | 6.26 ms | 23.2x |
| allFormatsObject | 0.33 ms | 6.60 ms | 20.2x |
| repeatedFormatValidation | 0.28 ms | 6.27 ms | 22.1x |
| deepFormatNesting | 0.54 ms | 8.36 ms | 15.6x |
| formatIntensive | 0.17 ms | 5.79 ms | 34.2x |

### COMPLEXITY-PATTERNS

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| manySimplePatterns | 0.92 ms | 10.28 ms | 11.2x |
| complexPatterns | 0.26 ms | 6.21 ms | 23.8x |
| arrayWithPatterns | 0.19 ms | 5.72 ms | 30.2x |
| nestedPatterns | 0.28 ms | 6.19 ms | 21.9x |
| patternProperties50 | 0.18 ms | 5.81 ms | 32.9x |

### SCALE-ARRAYS

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| array1KItems | 0.18 ms | 5.78 ms | 32.5x |
| array10KItems | 0.15 ms | 5.44 ms | 37.0x |
| array100KItems | 0.11 ms | 5.21 ms | 46.3x |
| arrayUniqueItems1K | 0.14 ms | 5.77 ms | 41.2x |
| arrayComplexItems | 0.23 ms | 6.08 ms | 26.7x |
| arrayNestedArrays | 0.13 ms | 5.92 ms | 44.4x |
| arrayMixedTypes1K | 0.38 ms | 5.82 ms | 15.3x |

### SCALE-NESTING

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| nesting50Levels | 1.58 ms | 12.93 ms | 8.2x |
| nestingAllOfChain | 0.43 ms | 6.11 ms | 14.2x |

### SCALE-OBJECTS

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| object50Props | 0.95 ms | 9.27 ms | 9.7x |
| object100Props | 1.70 ms | 13.92 ms | 8.2x |
| object500Props | 0.24 ms | 5.34 ms | 22.0x |
| object1000Props | 0.17 ms | 5.81 ms | 33.7x |

### SCALE-REFS

| Schema | JetValidator | AJV | Speedup |
|--------|--------------|-----|---------|
| references | 0.53 ms | 6.64 ms | 12.6x |
| refs100Times | 3.83 ms | 25.82 ms | 6.7x |
| refs500Times | 0.18 ms | 5.67 ms | 32.1x |
| refs1000Times | 0.13 ms | 5.27 ms | 40.0x |
| recursiveRefs | 0.26 ms | 5.70 ms | 21.7x |
| chainedRefs | 0.55 ms | 5.39 ms | 9.8x |
| complexRefGraph | 0.57 ms | 6.70 ms | 11.8x |

### Compilation Summary

| Metric | Value |
|--------|-------|
| Schemas tested | 65 |
| Cold samples per schema | 5 |
| JetValidator average | 0.52 ms |
| AJV average | 7.58 ms |
| Average speedup (ratio of averages) | 14.6x |
| Median per-schema speedup | 20.8x |
| Maximum per-schema speedup | 46.3x (array100KItems) |
| Minimum per-schema speedup | 6.7x (refs100Times) |

Two speedup figures are reported because they answer different questions. The ratio of averages is the conservative headline for total time saved. The median per-schema speedup describes the typical schema.

## Validation Throughput by Category

Each case is reported separately. The invalid columns measure how quickly each validator rejects non-conforming data; the allErrors column additionally exercises error accumulation.

### REAL-WORLD

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| packageJson | valid | **854.4K** | 819.9K | JetValidator |
| packageJson | invalid | 4.61M | **4.82M** | AJV |
| packageJson | invalid (allErrors) | 2.77M | **2.92M** | AJV |
| tsconfigJson | valid | **12.21M** | 10.93M | JetValidator |
| tsconfigJson | invalid | **9.84M** | 9.55M | JetValidator |
| tsconfigJson | invalid (allErrors) | 7.60M | **8.23M** | AJV |
| openApiPath | valid | 1.52M | 1.49M | Tie |
| openApiPath | invalid | **19.26M** | 17.91M | JetValidator |
| openApiPath | invalid (allErrors) | 1.79M | 1.82M | Tie |
| jsonResume | valid | 659.7K | 653.0K | Tie |
| jsonResume | invalid | **963.4K** | 908.2K | JetValidator |
| jsonResume | invalid (allErrors) | 632.5K | 631.0K | Tie |
| geoJson | valid | 10.64M | 10.46M | Tie |
| geoJson | invalid | 5.94M | **6.25M** | AJV |
| geoJson | invalid (allErrors) | **2.96M** | 2.85M | JetValidator |
| awsCloudFormation | valid | **4.30M** | 4.19M | JetValidator |
| awsCloudFormation | invalid | **3.89M** | 2.24M | JetValidator |
| awsCloudFormation | invalid (allErrors) | **3.62M** | 2.26M | JetValidator |
| graphqlSchema | valid | 3.30M | 3.26M | Tie |
| graphqlSchema | invalid | **4.02M** | 3.70M | JetValidator |
| graphqlSchema | invalid (allErrors) | 2.54M | **2.67M** | AJV |

Category result: JetValidator 10, AJV 5, 6 ties.

### FEATURES

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| simpleTypes | valid | **71.18M** | 43.61M | JetValidator |
| simpleTypes | invalid | **37.93M** | 26.51M | JetValidator |
| simpleTypes | invalid (allErrors) | 22.48M | **26.35M** | AJV |
| stringConstraints | valid | **1.60M** | 1.52M | JetValidator |
| stringConstraints | invalid | **1.55M** | 1.49M | JetValidator |
| stringConstraints | invalid (allErrors) | 1.53M | 1.50M | Tie |
| numericConstraints | valid | **86.83M** | 65.33M | JetValidator |
| numericConstraints | invalid | **41.32M** | 30.78M | JetValidator |
| numericConstraints | invalid (allErrors) | 24.90M | **32.27M** | AJV |
| arrayOperations | valid | **6.83M** | 4.22M | JetValidator |
| arrayOperations | invalid | **5.90M** | 3.84M | JetValidator |
| arrayOperations | invalid (allErrors) | **5.04M** | 3.73M | JetValidator |
| objectValidation | valid | 4.85M | 4.77M | Tie |
| objectValidation | invalid | **3.26M** | 2.01M | JetValidator |
| objectValidation | invalid (allErrors) | **3.20M** | 2.03M | JetValidator |
| composition | valid | **25.11M** | 17.93M | JetValidator |
| composition | invalid | **38.63M** | 29.46M | JetValidator |
| composition | invalid (allErrors) | **8.82M** | 5.13M | JetValidator |
| conditionals | valid | **18.46M** | 15.56M | JetValidator |
| conditionals | invalid | **23.44M** | 19.12M | JetValidator |
| conditionals | invalid (allErrors) | **17.91M** | 12.31M | JetValidator |

Category result: JetValidator 17, AJV 2, 2 ties.

### FORMATS

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| regexFormats | valid | **817.4K** | 667.8K | JetValidator |
| regexFormats | invalid | **83.6K** | 77.2K | JetValidator |
| regexFormats | invalid (allErrors) | **82.5K** | 77.6K | JetValidator |
| functionFormats | valid | 766.3K | **798.2K** | AJV |
| functionFormats | invalid | 15.98M | **18.85M** | AJV |
| functionFormats | invalid (allErrors) | 875.8K | **931.0K** | AJV |
| mixedFormats | valid | 448.6K | 455.2K | Tie |
| mixedFormats | invalid | **4.05M** | 3.94M | JetValidator |
| mixedFormats | invalid (allErrors) | 445.0K | 453.6K | Tie |
| integerFormats | valid | **84.74M** | 37.89M | JetValidator |
| integerFormats | invalid | **48.49M** | 24.11M | JetValidator |
| integerFormats | invalid (allErrors) | **28.01M** | 24.60M | JetValidator |

Category result: JetValidator 7, AJV 3, 2 ties.

### STRESS

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| deepNesting | valid | **12.09M** | 11.03M | JetValidator |
| deepNesting | invalid | **10.04M** | 8.78M | JetValidator |
| deepNesting | invalid (allErrors) | 8.65M | **8.86M** | AJV |
| wideObject | valid | 979.3K | **1.03M** | AJV |
| wideObject | invalid | 977.3K | **1.03M** | AJV |
| wideObject | invalid (allErrors) | 959.2K | **1.05M** | AJV |
| largeEnum | valid | **27.46M** | 26.18M | JetValidator |
| largeEnum | invalid | **11.87M** | 11.20M | JetValidator |
| largeEnum | invalid (allErrors) | 9.87M | **11.12M** | AJV |
| complexRefs | valid | 624.9K | **647.2K** | AJV |
| complexRefs | invalid | **7.42M** | 6.45M | JetValidator |
| complexRefs | invalid (allErrors) | 576.7K | **615.5K** | AJV |

Category result: JetValidator 5, AJV 7.

### COMPLEXITY-COMPOSITION

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| deepAllOf | valid | **63.06M** | 51.65M | JetValidator |
| deepAllOf | invalid | **36.82M** | 29.46M | JetValidator |
| deepAllOf | invalid (allErrors) | 24.02M | **29.86M** | AJV |
| deepAnyOf | valid | **4.56M** | 4.11M | JetValidator |
| deepAnyOf | invalid | **7.25M** | 4.26M | JetValidator |
| deepAnyOf | invalid (allErrors) | **7.02M** | 4.27M | JetValidator |
| deepOneOf | valid | 6.18M | **7.11M** | AJV |
| deepOneOf | invalid | **7.37M** | 5.43M | JetValidator |
| deepOneOf | invalid (allErrors) | **1.35M** | 1.17M | JetValidator |
| mixedComposition | valid | 975.8K | **1.02M** | AJV |
| mixedComposition | invalid | 3.02M | 3.00M | Tie |
| mixedComposition | invalid (allErrors) | 3.12M | 3.08M | Tie |
| complexNot | valid | **46.45M** | 13.05M | JetValidator |
| complexNot | invalid | **29.26M** | 12.11M | JetValidator |
| complexNot | invalid (allErrors) | **26.65M** | 12.15M | JetValidator |
| multiLayeredComposition | valid | **12.50M** | 9.52M | JetValidator |
| multiLayeredComposition | invalid | 9.40M | **9.96M** | AJV |
| multiLayeredComposition | invalid (allErrors) | 8.66M | **10.04M** | AJV |
| wideComposition | valid | **15.99M** | 10.10M | JetValidator |
| wideComposition | invalid | **11.23M** | 7.67M | JetValidator |
| wideComposition | invalid (allErrors) | **12.21M** | 7.74M | JetValidator |
| recursiveComposition | valid | **8.27M** | 7.50M | JetValidator |
| recursiveComposition | invalid | **5.08M** | 2.57M | JetValidator |
| recursiveComposition | invalid (allErrors) | **3.74M** | 2.13M | JetValidator |

Category result: JetValidator 17, AJV 5, 2 ties.

### COMPLEXITY-FORMATS

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| bulkEmailValidation | valid | 46.8K | **50.7K** | AJV |
| bulkEmailValidation | invalid | 46.4K | **50.6K** | AJV |
| bulkEmailValidation | invalid (allErrors) | 46.3K | **50.5K** | AJV |
| bulkUuidValidation | valid | 22.2K | 22.3K | Tie |
| bulkUuidValidation | invalid | 22.6K | 22.5K | Tie |
| bulkUuidValidation | invalid (allErrors) | 22.2K | **22.8K** | AJV |
| bulkDateTimeValidation | valid | 4.9K | **5.1K** | AJV |
| bulkDateTimeValidation | invalid | 4.9K | **5.2K** | AJV |
| bulkDateTimeValidation | invalid (allErrors) | 4.9K | 4.9K | Tie |
| bulkUriValidation | valid | **15.9K** | 13.9K | JetValidator |
| bulkUriValidation | invalid | **16.0K** | 14.1K | JetValidator |
| bulkUriValidation | invalid (allErrors) | **15.8K** | 13.9K | JetValidator |
| mixedFormats100Items | valid | 5.7K | 5.8K | Tie |
| mixedFormats100Items | invalid | 5.7K | 5.8K | Tie |
| mixedFormats100Items | invalid (allErrors) | 5.7K | **5.8K** | AJV |
| nestedFormats | valid | 14.2K | 14.2K | Tie |
| nestedFormats | invalid | 14.0K | 14.2K | Tie |
| nestedFormats | invalid (allErrors) | 14.0K | **14.3K** | AJV |
| allFormatsObject | valid | **417.6K** | 370.7K | JetValidator |
| allFormatsObject | invalid | **67.7K** | 62.6K | JetValidator |
| allFormatsObject | invalid (allErrors) | **68.0K** | 63.6K | JetValidator |
| repeatedFormatValidation | valid | **33.8K** | 32.9K | JetValidator |
| repeatedFormatValidation | invalid | **277.8K** | 259.0K | JetValidator |
| repeatedFormatValidation | invalid (allErrors) | **33.8K** | 32.9K | JetValidator |
| deepFormatNesting | valid | **473.2K** | 463.4K | JetValidator |
| deepFormatNesting | invalid | 505.5K | 502.5K | Tie |
| deepFormatNesting | invalid (allErrors) | 506.4K | 508.7K | Tie |
| formatIntensive | valid | **29.4K** | 28.5K | JetValidator |
| formatIntensive | invalid | **29.4K** | 28.1K | JetValidator |
| formatIntensive | invalid (allErrors) | **29.9K** | 28.6K | JetValidator |

Category result: JetValidator 13, AJV 8, 9 ties.

### COMPLEXITY-PATTERNS

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| manySimplePatterns | valid | 435.0K | 426.9K | Tie |
| manySimplePatterns | invalid | 428.0K | 427.7K | Tie |
| manySimplePatterns | invalid (allErrors) | 441.6K | 447.3K | Tie |
| complexPatterns | valid | 865.7K | 859.6K | Tie |
| complexPatterns | invalid | 889.3K | 882.4K | Tie |
| complexPatterns | invalid (allErrors) | 888.7K | 899.2K | Tie |
| arrayWithPatterns | valid | 26.1K | 26.1K | Tie |
| arrayWithPatterns | invalid | 26.0K | 26.0K | Tie |
| arrayWithPatterns | invalid (allErrors) | 26.3K | 26.3K | Tie |
| nestedPatterns | valid | **4.97M** | 4.73M | JetValidator |
| nestedPatterns | invalid | **4.88M** | 4.68M | JetValidator |
| nestedPatterns | invalid (allErrors) | 4.63M | **4.78M** | AJV |
| patternProperties50 | valid | **135.3K** | 128.6K | JetValidator |
| patternProperties50 | invalid | **134.8K** | 119.0K | JetValidator |
| patternProperties50 | invalid (allErrors) | **133.5K** | 122.2K | JetValidator |

Category result: JetValidator 5, AJV 1, 9 ties.

### SCALE-ARRAYS

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| array1KItems | valid | **65.8K** | 62.1K | JetValidator |
| array1KItems | invalid | **65.4K** | 62.6K | JetValidator |
| array1KItems | invalid (allErrors) | **64.5K** | 62.1K | JetValidator |
| array10KItems | valid | 16.5K | 16.5K | Tie |
| array10KItems | invalid | **17.6K** | 16.5K | JetValidator |
| array10KItems | invalid (allErrors) | **15.3K** | 14.0K | JetValidator |
| array100KItems | valid | **1.2K** | 1.2K | JetValidator |
| array100KItems | invalid | 1.2K | 1.2K | Tie |
| array100KItems | invalid (allErrors) | 1.2K | **1.2K** | AJV |
| arrayUniqueItems1K | valid | **2.5K** | 23 | JetValidator |
| arrayUniqueItems1K | invalid | 4.1K | **6.4K** | AJV |
| arrayUniqueItems1K | invalid (allErrors) | 2.5K | **6.5K** | AJV |
| arrayComplexItems | valid | 246 | **255** | AJV |
| arrayComplexItems | invalid | 245 | **254** | AJV |
| arrayComplexItems | invalid (allErrors) | 252 | 249 | Tie |
| arrayNestedArrays | valid | 96.2K | 96.9K | Tie |
| arrayNestedArrays | invalid | 96.4K | **99.7K** | AJV |
| arrayNestedArrays | invalid (allErrors) | 48.7K | **53.7K** | AJV |
| arrayMixedTypes1K | valid | **23.8K** | 22.4K | JetValidator |
| arrayMixedTypes1K | invalid | **23.4K** | 20.9K | JetValidator |
| arrayMixedTypes1K | invalid (allErrors) | 21.0K | **21.6K** | AJV |

Category result: JetValidator 9, AJV 8, 4 ties.

### SCALE-NESTING

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| nesting50Levels | valid | 3.46M | 3.49M | Tie |
| nesting50Levels | invalid | 3.48M | 3.41M | Tie |
| nesting50Levels | invalid (allErrors) | 3.37M | 3.41M | Tie |
| nestingAllOfChain | valid | **53.42M** | 48.12M | JetValidator |
| nestingAllOfChain | invalid | **34.28M** | 27.30M | JetValidator |
| nestingAllOfChain | invalid (allErrors) | 23.48M | **27.64M** | AJV |

Category result: JetValidator 2, AJV 1, 3 ties.

### SCALE-OBJECTS

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| object50Props | valid | **408.9K** | 296.7K | JetValidator |
| object50Props | invalid | **408.9K** | 296.9K | JetValidator |
| object50Props | invalid (allErrors) | **404.8K** | 318.8K | JetValidator |
| object100Props | valid | **177.2K** | 144.2K | JetValidator |
| object100Props | invalid | **175.8K** | 143.9K | JetValidator |
| object100Props | invalid (allErrors) | **175.9K** | 155.9K | JetValidator |
| object500Props | valid | **9.1K** | 5.2K | JetValidator |
| object500Props | invalid | **9.2K** | 5.1K | JetValidator |
| object500Props | invalid (allErrors) | **9.1K** | 5.2K | JetValidator |
| object1000Props | valid | **3.3K** | 2.0K | JetValidator |
| object1000Props | invalid | **3.3K** | 2.0K | JetValidator |
| object1000Props | invalid (allErrors) | **3.2K** | 2.0K | JetValidator |

Category result: JetValidator 12, AJV 0.

### SCALE-REFS

| Schema | Case | JetValidator | AJV | Winner |
|--------|------|--------------|-----|--------|
| references | valid | **4.65M** | 4.32M | JetValidator |
| references | invalid | **4.68M** | 3.90M | JetValidator |
| references | invalid (allErrors) | **4.61M** | 4.03M | JetValidator |
| refs100Times | valid | 162.5K | 164.5K | Tie |
| refs100Times | invalid | 163.5K | 164.5K | Tie |
| refs100Times | invalid (allErrors) | 160.2K | **166.0K** | AJV |
| refs500Times | valid | 8.1K | **14.0K** | AJV |
| refs500Times | invalid | 8.1K | **13.9K** | AJV |
| refs500Times | invalid (allErrors) | 8.2K | **14.0K** | AJV |
| refs1000Times | valid | 4.0K | **4.8K** | AJV |
| refs1000Times | invalid | 4.0K | **4.7K** | AJV |
| refs1000Times | invalid (allErrors) | 4.0K | **4.6K** | AJV |
| recursiveRefs | valid | **3.92M** | 2.29M | JetValidator |
| recursiveRefs | invalid | **2.71M** | 1.96M | JetValidator |
| recursiveRefs | invalid (allErrors) | 2.20M | 2.19M | Tie |
| chainedRefs | valid | **46.34M** | 38.44M | JetValidator |
| chainedRefs | invalid | **52.99M** | 35.26M | JetValidator |
| chainedRefs | invalid (allErrors) | 28.07M | **35.36M** | AJV |
| complexRefGraph | valid | **18.98M** | 8.70M | JetValidator |
| complexRefGraph | invalid | **3.07M** | 1.07M | JetValidator |
| complexRefGraph | invalid (allErrors) | **2.60M** | 1.17M | JetValidator |

Category result: JetValidator 10, AJV 8, 3 ties.

## Where JetValidator Leads by More Than 50 Percent

| Schema | Case | JetValidator | AJV | Advantage |
|--------|------|--------------|-----|-----------|
| arrayUniqueItems1K | valid | 2.5K | 23 | +10967% |
| complexNot | valid | 46.45M | 13.05M | +256% |
| complexRefGraph | invalid | 3.07M | 1.07M | +186% |
| complexNot | invalid | 29.26M | 12.11M | +142% |
| integerFormats | valid | 84.74M | 37.89M | +124% |
| complexRefGraph | invalid (allErrors) | 2.60M | 1.17M | +122% |
| complexNot | invalid (allErrors) | 26.65M | 12.15M | +119% |
| complexRefGraph | valid | 18.98M | 8.70M | +118% |
| integerFormats | invalid | 48.49M | 24.11M | +101% |
| recursiveComposition | invalid | 5.08M | 2.57M | +98% |
| object500Props | invalid | 9.2K | 5.1K | +78% |
| object500Props | valid | 9.1K | 5.2K | +77% |
| object500Props | invalid (allErrors) | 9.1K | 5.2K | +76% |
| recursiveComposition | invalid (allErrors) | 3.74M | 2.13M | +75% |
| awsCloudFormation | invalid | 3.89M | 2.24M | +74% |
| composition | invalid (allErrors) | 8.82M | 5.13M | +72% |
| recursiveRefs | valid | 3.92M | 2.29M | +71% |
| deepAnyOf | invalid | 7.25M | 4.26M | +70% |
| deepAnyOf | invalid (allErrors) | 7.02M | 4.27M | +64% |
| simpleTypes | valid | 71.18M | 43.61M | +63% |
| objectValidation | invalid | 3.26M | 2.01M | +62% |
| arrayOperations | valid | 6.83M | 4.22M | +62% |
| object1000Props | valid | 3.3K | 2.0K | +62% |
| object1000Props | invalid | 3.3K | 2.0K | +61% |
| object1000Props | invalid (allErrors) | 3.2K | 2.0K | +61% |
| awsCloudFormation | invalid (allErrors) | 3.62M | 2.26M | +60% |
| wideComposition | valid | 15.99M | 10.10M | +58% |
| wideComposition | invalid (allErrors) | 12.21M | 7.74M | +58% |
| objectValidation | invalid (allErrors) | 3.20M | 2.03M | +58% |
| arrayOperations | invalid | 5.90M | 3.84M | +54% |
| chainedRefs | invalid | 52.99M | 35.26M | +50% |

## Where AJV Leads by More Than 50 Percent

| Schema | Case | AJV | JetValidator | Advantage |
|--------|------|--------------|-----|-----------|
| arrayUniqueItems1K | invalid (allErrors) | 6.5K | 2.5K | +162% |
| refs500Times | valid | 14.0K | 8.1K | +72% |
| refs500Times | invalid | 13.9K | 8.1K | +70% |
| refs500Times | invalid (allErrors) | 14.0K | 8.2K | +70% |
| arrayUniqueItems1K | invalid | 6.4K | 4.1K | +58% |

## Scorecard

Combined throughput wins per category, across all three cases.

| Category | JetValidator | AJV | Ties |
|----------|--------------|-----|------|
| REAL-WORLD | 10 | 5 | 6 |
| FEATURES | 17 | 2 | 2 |
| FORMATS | 7 | 3 | 2 |
| STRESS | 5 | 7 | 0 |
| COMPLEXITY-COMPOSITION | 17 | 5 | 2 |
| COMPLEXITY-FORMATS | 13 | 8 | 9 |
| COMPLEXITY-PATTERNS | 5 | 1 | 9 |
| SCALE-ARRAYS | 9 | 8 | 4 |
| SCALE-NESTING | 2 | 1 | 3 |
| SCALE-OBJECTS | 12 | 0 | 0 |
| SCALE-REFS | 10 | 8 | 3 |
| **Total** | **107** | **48** | **40** |

Across all 195 throughput comparisons, JetValidator wins 55 percent.

## Known Limitations

These results are reported as measured, including the cases where AJV is ahead:

- Categories where AJV is even or ahead on throughput: STRESS.
- Largest AJV throughput advantages: arrayUniqueItems1K (invalid (allErrors), +162%); refs500Times (valid, +72%); refs500Times (invalid, +70%); refs500Times (invalid (allErrors), +70%); arrayUniqueItems1K (invalid, +58%).

These are named here rather than omitted so the comparison can be reproduced and trusted.

## Summary

On identical hardware, measured in a single run:

- Compilation averages 14.6x faster (median per-schema 20.8x), and is faster on all 65 schemas.
- valid throughput favors JetValidator on 60 percent of schemas.
- invalid throughput favors JetValidator on 65 percent of schemas.
- invalid (allErrors) throughput favors JetValidator on 40 percent of schemas.
