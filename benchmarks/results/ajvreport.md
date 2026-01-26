# Ajv Benchmark Report

**Generated:** 2026-01-26T13:41:38.516Z

## Configuration

- Warmup iterations: 1000
- Benchmark iterations: 10000
- Runs per benchmark: 30
- Batch size: 1000

## Summary

- Total schemas tested: 62
- Failed benchmarks: 0

## REAL-WORLD

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| packageJson | 57.13 | 714426 | 4435751 | 658.06 |
| tsconfigJson | 44.04 | 6177073 | 7028887 | 120.34 |
| openApiPath | 35.54 | 1138723 | 9856644 | 242.45 |
| jsonResume | 41.23 | 553944 | 2210881 | 433.69 |
| geoJson | 34.48 | 4930885 | 8040281 | -29.84 |
| awsCloudFormation | 14.84 | 3361538 | 9321664 | 187.15 |
| graphqlSchema | 18.11 | 2515276 | 5753515 | 237.27 |

## FEATURES

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| simpleTypes | 12.42 | 13477264 | 11762723 | 393.61 |
| stringConstraints | 12.84 | 1384782 | 7428824 | -47.82 |
| numericConstraints | 23.13 | 14789816 | 7571877 | -57.94 |
| arrayOperations | 18.07 | 2421556 | 6788145 | 192.16 |
| objectValidation | 12.60 | 3418443 | 9608161 | -68.99 |
| composition | 21.18 | 2925524 | 3427904 | -26.32 |
| conditionals | 45.36 | 8265371 | 1987345 | -42.23 |

## FORMATS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| regexFormats | 20.28 | 338534 | 4361529 | 127.76 |
| functionFormats | 36.74 | 513377 | 8297566 | 403.48 |
| mixedFormats | 22.00 | 380819 | 8556977 | -107.27 |
| integerFormats | 12.28 | 25173029 | 14047063 | 13.75 |

## STRESS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| deepNesting | 16.51 | 5221971 | 7664659 | 438.48 |
| wideObject | 19.93 | 923676 | 2859281 | -42.42 |
| largeEnum | 19.89 | 11355649 | 4542308 | -71.77 |
| complexRefs | 22.12 | 494803 | 9228632 | 37.77 |

## COMPLEXITY-COMPOSITION

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| deepAllOf | 15.56 | 17912279 | 13338850 | 71.77 |
| deepAnyOf | 15.45 | 4294099 | 4599923 | 439.19 |
| deepOneOf | 23.43 | 4605791 | 4032878 | -63.14 |
| mixedComposition | 17.26 | 866706 | 7237043 | -44.48 |
| complexNot | 15.03 | 8752537 | 5358762 | -87.39 |
| multiLayeredComposition | 14.36 | 2659186 | 4770247 | -19.85 |
| wideComposition | 21.07 | 3956300 | 1641204 | 234.41 |
| recursiveComposition | 14.38 | 4626502 | 9841797 | -64.05 |

## COMPLEXITY-FORMATS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| bulkEmailValidation | 13.24 | 45516 | 14217801 | 404.03 |
| bulkUuidValidation | 12.40 | 52764 | 13020710 | -58.46 |
| bulkDateTimeValidation | 19.40 | 4321 | 7764468 | -29.76 |
| bulkUriValidation | 30.45 | 9731 | 11598458 | -56.12 |
| mixedFormats100Items | 40.06 | 4990 | 7381244 | 517.77 |
| nestedFormats | 20.12 | 12521 | 13234353 | -105.14 |
| allFormatsObject | 27.89 | 259559 | 5883668 | -12.09 |
| repeatedFormatValidation | 29.69 | 25338 | 11500563 | -34.73 |
| deepFormatNesting | 42.45 | 386531 | 4535426 | 6.18 |
| formatIntensive | 25.87 | 24201 | 3756258 | 445.06 |

## COMPLEXITY-PATTERNS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| manySimplePatterns | 41.81 | 311729 | 3298140 | 68.63 |
| complexPatterns | 40.02 | 819318 | 6545959 | -110.37 |
| arrayWithPatterns | 31.63 | 22867 | 11958200 | -42.58 |
| nestedPatterns | 30.07 | 3360961 | 8210484 | 8.06 |
| patternProperties50 | 33.09 | 108891 | 7759689 | -56.23 |

## SCALE-ARRAYS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| array1KItems | 14.48 | 15086 | 8264387 | 467.47 |
| array10KItems | 26.15 | 7706 | 13256041 | -75.91 |
| arrayNestedArrays | 26.81 | 42531 | 6294831 | -31.20 |
| arrayMixedTypes1K | 30.25 | 16951676 | 13522178 | -13.47 |

## SCALE-NESTING

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| nesting50Levels | 25.32 | 1923180 | 6521346 | 746.57 |
| nestingAllOfChain | 31.24 | 10189518 | 3503066 | -138.55 |

## SCALE-OBJECTS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| object50Props | 43.35 | 249829 | 3370096 | 570.30 |
| object100Props | 49.63 | 136062 | 2370192 | 68.53 |
| object500Props | 27.30 | 3636 | 9669847 | -117.15 |
| object1000Props | 39.32 | 1826 | 9045594 | 461.50 |

## SCALE-REFS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| references | 26.14 | 6753264 | 2571494 | -75.21 |
| refs100Times | 91.94 | 114984 | 2011517 | 291.66 |
| refs500Times | 42.50 | 8811 | 12283225 | -352.47 |
| refs1000Times | 21.97 | 3118 | 12575850 | -7.51 |
| recursiveRefs | 12.93 | 3153301 | 11228574 | 6.63 |
| chainedRefs | 32.46 | 13005526 | 29126010 | 444.13 |
| complexRefGraph | 17.37 | 3291642 | 1073077 | 45.78 |

