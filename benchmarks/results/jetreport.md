# JetValidator Benchmark Report

**Generated:** 2026-01-26T15:34:15.774Z

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
| packageJson | 6.53 | 643305 | 2923405 | 1054.00 |
| tsconfigJson | 1.66 | 4839246 | 3820201 | 222.96 |
| openApiPath | 5.16 | 803430 | 11307637 | 540.42 |
| jsonResume | 4.63 | 330104 | 5137768 | 1264.46 |
| geoJson | 1.12 | 3733640 | 9698255 | -848.57 |
| awsCloudFormation | 1.20 | 3753323 | 11905420 | -955.53 |
| graphqlSchema | 1.19 | 2514602 | 8025066 | 1144.88 |

## FEATURES

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| simpleTypes | 0.67 | 21069893 | 9151447 | -215.77 |
| stringConstraints | 3.06 | 1082892 | 3490344 | 39.37 |
| numericConstraints | 1.19 | 26931222 | 15642437 | 353.12 |
| arrayOperations | 1.44 | 2809389 | 4765560 | -945.23 |
| objectValidation | 4.47 | 3663336 | 7008834 | 1412.16 |
| composition | 3.65 | 3697686 | 5041524 | -169.20 |
| conditionals | 2.13 | 11831703 | 10941762 | 627.22 |

## FORMATS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| regexFormats | 0.68 | 633520 | 6471952 | -2409.30 |
| functionFormats | 1.53 | 421197 | 10793470 | -1523.73 |
| mixedFormats | 2.32 | 241191 | 10683046 | -240.30 |
| integerFormats | 1.55 | 45704118 | 22063747 | 770.80 |

## STRESS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| deepNesting | 1.09 | 3421781 | 3592549 | 1263.27 |
| wideObject | 1.61 | 878445 | 7111586 | 2612.88 |
| largeEnum | 0.65 | 13919090 | 4743886 | -1856.12 |
| complexRefs | 3.03 | 558487 | 9446639 | -1073.91 |

## COMPLEXITY-COMPOSITION

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| deepAllOf | 0.75 | 24175604 | 18800040 | -2928.09 |
| deepAnyOf | 0.95 | 4425780 | 9475851 | -2900.11 |
| deepOneOf | 1.06 | 3616342 | 6157712 | 1172.10 |
| mixedComposition | 1.01 | 710683 | 10754121 | -1184.62 |
| complexNot | 0.75 | 18500297 | 18308960 | -2454.96 |
| multiLayeredComposition | 0.83 | 4752578 | 6090124 | 2029.74 |
| wideComposition | 1.24 | 3480129 | 5914757 | -645.60 |
| recursiveComposition | 1.42 | 3493907 | 7517325 | -37.27 |

## COMPLEXITY-FORMATS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| bulkEmailValidation | 0.56 | 45189 | 19274631 | -2670.25 |
| bulkUuidValidation | 0.56 | 56067 | 17916132 | -663.13 |
| bulkDateTimeValidation | 0.60 | 4283 | 11362721 | 37.27 |
| bulkUriValidation | 0.60 | 11840 | 17000836 | 721.91 |
| mixedFormats100Items | 0.71 | 5020 | 10018769 | 147.92 |
| nestedFormats | 0.74 | 13605 | 10769453 | -14611.20 |
| allFormatsObject | 0.74 | 383143 | 8220456 | 1076.06 |
| repeatedFormatValidation | 0.66 | 29089 | 17837092 | 84.70 |
| deepFormatNesting | 1.39 | 423679 | 5902701 | -14122.98 |
| formatIntensive | 0.62 | 25631 | 14349125 | -14554.45 |

## COMPLEXITY-PATTERNS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| manySimplePatterns | 1.62 | 416621 | 3235327 | 1352.36 |
| complexPatterns | 0.73 | 1160843 | 8351976 | -528.01 |
| arrayWithPatterns | 0.61 | 24481 | 15731873 | 246.96 |
| nestedPatterns | 0.76 | 4022068 | 10048568 | -48.81 |
| patternProperties50 | 0.61 | 113733 | 12687193 | -68.81 |

## SCALE-ARRAYS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| array1KItems | 0.59 | 18064 | 16170445 | -2675.42 |
| array10KItems | 0.51 | 10579 | 20068048 | 462.70 |
| arrayNestedArrays | 0.54 | 45842 | 15266739 | 327.18 |
| arrayMixedTypes1K | 0.65 | 15313700 | 23970407 | 7312.65 |

## SCALE-NESTING

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| nesting50Levels | 3.26 | 2572816 | 5952537 | 6333.61 |
| nestingAllOfChain | 0.81 | 20531292 | 15724590 | 1463.31 |

## SCALE-OBJECTS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| object50Props | 2.10 | 334334 | 6229408 | 3423.79 |
| object100Props | 2.67 | 167692 | 4222197 | 1351.73 |
| object500Props | 0.66 | 6511 | 16771863 | -6883.21 |
| object1000Props | 0.66 | 2703 | 3041676 | 1037.81 |

## SCALE-REFS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| references | 5.69 | 5285647 | 11927993 | 2034.41 |
| refs100Times | 6.22 | 109045 | 3725528 | 2322.77 |
| refs500Times | 0.69 | 7771 | 16753853 | 931.88 |
| refs1000Times | 0.60 | 3090 | 21261453 | -677.05 |
| recursiveRefs | 0.87 | 3046663 | 13545025 | -998.17 |
| chainedRefs | 1.09 | 14732056 | 28307324 | 215.02 |
| complexRefGraph | 1.22 | 3399819 | 2748388 | -3903.73 |

