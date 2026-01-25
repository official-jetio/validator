# Ajv Benchmark Report

**Generated:** 2026-01-25T16:21:55.255Z

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
| packageJson | 46.74 | 5647538 | 6174904 | 658.06 |
| tsconfigJson | 27.46 | 6810590 | 11323572 | 590.38 |
| openApiPath | 22.56 | 1280298 | 10098213 | 41.33 |
| jsonResume | 23.17 | 612747 | 3345331 | 95.39 |
| geoJson | 22.19 | 4070096 | 7864498 | -49.61 |
| awsCloudFormation | 19.17 | 3152925 | 9326801 | 152.23 |
| graphqlSchema | 23.09 | 2401710 | 5295322 | -53.77 |

## FEATURES

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| simpleTypes | 15.83 | 17463494 | 11626853 | -53.98 |
| stringConstraints | 17.85 | 1326060 | 7720330 | -33.14 |
| numericConstraints | 19.25 | 18463775 | 12419626 | -44.23 |
| arrayOperations | 21.13 | 2902431 | 6426507 | -3.34 |
| objectValidation | 26.40 | 3304513 | 9336761 | -41.74 |
| composition | 21.47 | 10133739 | 10497422 | 460.55 |
| conditionals | 21.20 | 8892038 | 10329618 | -136.55 |

## FORMATS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| regexFormats | 20.50 | 529753 | 5924817 | 7.34 |
| functionFormats | 17.98 | 1841206 | 9765707 | 437.53 |
| mixedFormats | 22.99 | 417853 | 8106865 | -55.90 |
| integerFormats | 15.58 | 27747828 | 14408776 | -21.12 |

## STRESS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| deepNesting | 22.21 | 5908749 | 6244944 | -12.07 |
| wideObject | 28.18 | 8143793 | 4911059 | 82.75 |
| largeEnum | 22.65 | 11751310 | 4467197 | -60.55 |
| complexRefs | 19.60 | 618143 | 10007517 | 38.71 |

## COMPLEXITY-COMPOSITION

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| deepAllOf | 19.94 | 17485349 | 12721394 | -75.84 |
| deepAnyOf | 16.74 | 4951067 | 4969099 | 437.27 |
| deepOneOf | 19.62 | 4871327 | 4337459 | -45.00 |
| mixedComposition | 15.25 | 972584 | 7923175 | -20.39 |
| complexNot | 15.67 | 9269994 | 8130225 | -2.26 |
| multiLayeredComposition | 14.85 | 4311914 | 5266598 | 397.56 |
| wideComposition | 21.18 | 4953807 | 3651638 | -105.20 |
| recursiveComposition | 26.12 | 5356143 | 9824448 | 3.02 |

## COMPLEXITY-FORMATS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| bulkEmailValidation | 15.70 | 50098 | 12374269 | -112.29 |
| bulkUuidValidation | 15.89 | 3071949 | 10069939 | -6.41 |
| bulkDateTimeValidation | 16.83 | 5048 | 10619906 | -20.72 |
| bulkUriValidation | 18.44 | 9902 | 11709781 | 53.32 |
| mixedFormats100Items | 36.12 | 383449 | 10128388 | -102.27 |
| nestedFormats | 16.19 | 12045 | 13570065 | -28.86 |
| allFormatsObject | 19.78 | 458637 | 5698920 | 149.02 |
| repeatedFormatValidation | 25.60 | 28441 | 12430113 | -94.08 |
| deepFormatNesting | 23.00 | 476545 | 5575834 | 5.48 |
| formatIntensive | 20.22 | 26780 | 8815043 | 428.50 |

## COMPLEXITY-PATTERNS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| manySimplePatterns | 28.29 | 2989294 | 3413348 | 20.78 |
| complexPatterns | 17.78 | 1288256 | 6966886 | -78.20 |
| arrayWithPatterns | 16.38 | 24798 | 12647165 | -45.36 |
| nestedPatterns | 19.00 | 3766962 | 6955539 | 459.82 |
| patternProperties50 | 22.08 | 2753533 | 8823224 | -81.54 |

## SCALE-ARRAYS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| array1KItems | 12.14 | 16216 | 12401804 | -19.44 |
| array10KItems | 19.12 | 9492 | 14688789 | -34.24 |
| arrayNestedArrays | 19.24 | 47285 | 13036779 | 485.28 |
| arrayMixedTypes1K | 16.41 | 18667435 | 14054123 | -61.16 |

## SCALE-NESTING

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| nesting50Levels | 38.10 | 2179125 | 4965910 | 124.78 |
| nesting100Levels | 23.18 | 5824779 | 2351775 | -66.74 |
| nestingAllOfChain | 18.55 | 15767341 | 10060943 | 410.06 |

## SCALE-OBJECTS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| object50Props | 20.24 | 238464 | 3647599 | -41.91 |
| object100Props | 60.00 | 131729 | 2370904 | 80.95 |
| object500Props | 21.08 | 4230 | 10101709 | -127.11 |
| object1000Props | 18.54 | 1888 | 9530392 | 462.44 |

## SCALE-REFS

| Schema | Compilation (ms) | Valid (ops/sec) | Invalid (ops/sec) | Memory (KB) |
|--------|------------------|-----------------|-------------------|-------------|
| references | 13.94 | 5201496 | 11674188 | -48.85 |
| refs100Times | 48.87 | 2333786 | 1921070 | 204.26 |
| refs500Times | 18.74 | 8703 | 12818952 | 165.30 |
| refs1000Times | 13.04 | 3235 | 14703562 | -45.63 |
| recursiveRefs | 28.50 | 2738217 | 11589776 | 13.63 |
| chainedRefs | 15.01 | 15120679 | 30300343 | 451.90 |
| complexRefGraph | 14.17 | 3287154 | 1099010 | 9.66 |

