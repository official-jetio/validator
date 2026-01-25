# JetValidator Benchmark Report

**Generated:** 2026-01-25T18:40:11.312Z

## Configuration

- Warmup iterations: 1000
- Benchmark iterations: 10000
- Runs per benchmark: 30
- Batch size: 1000

## Summary

- Total schemas tested: 63
- Failed benchmarks: 0

## REAL-WORLD

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| packageJson | 5.65 | 7550513 | 9092745 | 1691.24 |
| tsconfigJson | 1.39 | 7272394 | 7680987 | 1057.96 |
| openApiPath | 1.21 | 656085 | 9453742 | 729.46 |
| jsonResume | 2.84 | 614027 | 5125378 | -465.77 |
| geoJson | 1.08 | 2879736 | 5586348 | 558.99 |
| awsCloudFormation | 1.31 | 3843021 | 7998880 | -1405.17 |
| graphqlSchema | 1.34 | 1921097 | 5986909 | -283.70 |

## FEATURES

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| simpleTypes | 1.77 | 22871702 | 15299976 | -944.45 |
| stringConstraints | 0.95 | 1435210 | 7447412 | 336.80 |
| numericConstraints | 1.74 | 27363699 | 16447808 | -199.20 |
| arrayOperations | 1.51 | 2300160 | 5346803 | -1379.20 |
| objectValidation | 1.39 | 3529863 | 6000335 | -1193.17 |
| composition | 1.53 | 13182765 | 11947566 | 325.48 |
| conditionals | 0.93 | 11926220 | 14421190 | 1197.87 |

## FORMATS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| regexFormats | 0.72 | 759024 | 7499889 | 1628.68 |
| functionFormats | 0.63 | 1874882 | 10050091 | 3568.16 |
| mixedFormats | 0.94 | 357938 | 7970467 | -1167.54 |
| integerFormats | 1.90 | 42664640 | 15655800 | 2063.19 |

## STRESS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| deepNesting | 1.27 | 2901702 | 4263805 | 1195.93 |
| wideObject | 1.64 | 12652798 | 9111419 | -1010.98 |
| largeEnum | 0.65 | 13749373 | 4585493 | 1164.98 |
| complexRefs | 3.32 | 443204 | 10059375 | -1020.22 |

## COMPLEXITY-COMPOSITION

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| deepAllOf | 0.98 | 21627726 | 10922919 | -341.41 |
| deepAnyOf | 1.59 | 7699834 | 1425639 | -429.19 |
| deepOneOf | 1.07 | 4486026 | 2210659 | -2331.46 |
| mixedComposition | 1.05 | 861845 | 7417467 | -1020.02 |
| complexNot | 0.78 | 24671976 | 14820174 | -3026.06 |
| multiLayeredComposition | 0.89 | 3361986 | 2056265 | 1409.38 |
| wideComposition | 1.61 | 2705291 | 4182661 | 136.64 |
| recursiveComposition | 1.23 | 3048290 | 9041420 | -1800.01 |

## COMPLEXITY-FORMATS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| bulkEmailValidation | 2.55 | 42650 | 18142245 | 4671.25 |
| bulkUuidValidation | 2.63 | 3840591 | 16527953 | 555.74 |
| bulkDateTimeValidation | 0.61 | 4216 | 12596639 | 160.22 |
| bulkUriValidation | 0.65 | 10402 | 13874091 | 3479.17 |
| mixedFormats100Items | 1.10 | 442398 | 11714611 | 145.57 |
| nestedFormats | 0.82 | 11918 | 6426221 | -447.73 |
| allFormatsObject | 0.92 | 576046 | 7797947 | 2890.20 |
| repeatedFormatValidation | 1.07 | 26068 | 16684184 | 2220.33 |
| deepFormatNesting | 2.33 | 433738 | 4888307 | 3572.50 |
| formatIntensive | 1.04 | 24846 | 13149583 | -3648.58 |

## COMPLEXITY-PATTERNS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| manySimplePatterns | 1.73 | 3634065 | 6928483 | 3354.10 |
| complexPatterns | 0.74 | 1361856 | 8994926 | 2540.58 |
| arrayWithPatterns | 0.69 | 24412 | 12261258 | 3938.04 |
| nestedPatterns | 2.18 | 3164773 | 7393078 | 90.20 |
| patternProperties50 | 0.71 | 2861970 | 11326204 | 825.42 |

## SCALE-ARRAYS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| array1KItems | 0.69 | 16573 | 15126147 | 831.34 |
| array10KItems | 0.62 | 9278 | 16910526 | 753.02 |
| arrayNestedArrays | 0.51 | 41641 | 14695781 | -250.13 |
| arrayMixedTypes1K | 0.65 | 13816523 | 22130969 | 493.51 |

## SCALE-NESTING

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| nesting50Levels | 5.36 | 18107 | 3451267 | 397.30 |
| nesting100Levels | 1.00 | 913180 | 1552959 | 327.37 |
| nestingAllOfChain | 0.80 | 20550301 | 15723977 | 162.60 |

## SCALE-OBJECTS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| object50Props | 1.73 | 343283 | 6192722 | 75.98 |
| object100Props | 2.71 | 169367 | 4679387 | -1731.65 |
| object500Props | 0.64 | 6818 | 13633243 | -1.57 |
| object1000Props | 0.61 | 2860 | 13778558 | -1352.47 |

## SCALE-REFS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| references | 1.02 | 8146863 | 16431742 | -1951.41 |
| refs100Times | 4.96 | 3572170 | 4617867 | 1025.12 |
| refs500Times | 0.73 | 5817 | 18843561 | -1442.05 |
| refs1000Times | 0.57 | 2973 | 21500515 | 561.69 |
| recursiveRefs | 0.78 | 3254974 | 13600735 | 4101.70 |
| chainedRefs | 1.19 | 16409654 | 32928098 | 2331.63 |
| complexRefGraph | 1.17 | 3542363 | 1021251 | 596.16 |

