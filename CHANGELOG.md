# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-04

Breaking release. Most changes correct flawed v1 behavior and affect little real-world code. See the [Upgrading to 2.0](https://jet-validator-docs.vercel.app/whats-new-2) guide for full migration details.

### Changed
- **Compilation now throws on invalid schemas.** When `validateSchema` is enabled, `compile` and `compileAsync` throw the schema-validation errors instead of returning a "failing validator". In v1, an invalid schema could return a function that reported `false` for all data, making a broken schema indistinguishable from invalid data. Compilation now stops loudly so the two can never be confused.

  ```typescript
  try {
    const validate = jetValidator.compile(invalidSchema);
  } catch (errors) {
    console.error(errors); // schema-validation errors array
  }
  ```

- **Error message resolution is unified across all keywords.** Every keyword now resolves a custom message through three levels in order — its own level, its parent level, then the root. In v1, boundary-creating keywords (`anyOf`, `then`, `else`, `prefixItems`, …) and several straying keywords refused to read a parent-level message, resolving only messages defined inside themselves or at the root. Messages defined inside a keyword or at the root behave identically to v1; a parent-level `errorMessage` that was silently ignored in v1 now activates.

- **Schema validation methods always return a result.** `validateSchemaSync` and `validateSchemaAsync` now return a `ValidationResult` and never throw, including when the requested meta-schema isn't loaded (they return a result with a descriptive error and a notFound flag). The async method's behavior was previously inconsistent with the sync one; the two are now identical.

- **`dependentRequired` error messages gained a third targeting level** — whole-keyword string, per-key string, and per-key-per-dependency — and now participate in parent-level resolution. Existing two-level configurations continue to work unchanged.

- **`strict` and `strictSchema` no longer block compilation of neutral keywords.** Keywords like `anyOf`, `allOf`, `oneOf`, `if`/`then`/`else`, `const`, and `enum` that don't require a `type` now compile correctly under `strict` and `strictSchema`, and strict rejections give clearer messages. (Also released as `1.1.0` on the v1 line.)

### Added
- **Legacy `id` accepted alongside `$id`.** The schema registry, compilation cache, and reference resolution now recognise a legacy `id` property in addition to `$id`, for backward compatibility with older JSON Schema drafts. Schemas using `$id` are unaffected.

### Removed
- **`strictSchema` option and `metaSchemaError` property.** Both existed only to support the old "return a failing validator instead of throwing" behavior, which is gone. Compilation now always throws on an invalid schema. Remove any `strictSchema` config and any `errors[].metaSchemaError` checks.

[2.0.0]: https://github.com/official-jetio/validator/releases/tag/v2.0.0

## [1.1.0] - 2026-07-04

### Fixed
- `strict` and `strictSchema` no longer block compilation of schemas built around neutral keywords that don't require a `type`. Keywords like `anyOf`, `allOf`, `oneOf`, `if`/`then`/`else`, `const`, and `enum` previously failed strict compilation because strict mode expected an explicit `type` that these keywords don't need. They now compile correctly under `strict` and `strictSchema`.

  Before (threw under `strict: true`):
```typescript
  const jetValidator = new JetValidator({ strict: true });

  // Rejected — strict wrongly demanded a `type`
  jetValidator.compile({
    anyOf: [{ type: "string" }, { type: "number" }],
  });
```

  After (compiles as expected):
```typescript
  const jetValidator = new JetValidator({ strict: true });

  jetValidator.compile({
    anyOf: [{ type: "string" }, { type: "number" }],
  }); // ✅ compiles
```

### Changed
- Clearer error messages when `strict` is enabled. Strict rejections now state precisely what is missing or invalid, instead of a generic failure.

### Removed
- Generic type parameters in v1.0.9

[1.1.0]: https://github.com/official-jetio/validator/releases/tag/v1.1.0

## [1.0.9] - 2026-06-17

### Added
- Generic type parameters on custom keyword function signatures (`MacroFunction`, `CompileFunction`, `ValidateFunction`, `CodeFunction`). Each accepts up to three type arguments — `TValue` for the schema value, `TData` for the data being validated, and `TRootData` for the root data passed to the validator. All default to `unknown`, so existing code continues to work without changes.

  Before:
```typescript
  const apiValidation = (config, parentSchema, context) => {
    return async (data, rootData, dataPath) => {
      // config, data, rootData all `any` or `unknown`
    };
  };
```

  After:
```typescript
  type ApiConfig = { endpoint: string; method?: "GET" | "POST" };
  type UserData = { username: string; email: string };

  const apiValidation: CompileFunction<ApiConfig, string, UserData> = (config) => {
    return async (data, rootData, dataPath) => {
      // config: ApiConfig (fully typed with autocomplete)
      // data:   string
      // rootData: UserData (rootData.username is typed)
    };
  };
```

### Changed
- `ValidateDataContext` now generic on `TRootData`, propagating type information from the validate function signature into the data context object.
- `CompiledValidateFunction` now generic on `TData` and `TRootData`, so the validator returned from a `compile` keyword carries the same type information as the factory.

### Documentation
- Launched the official documentation site at https://jet-validator-docs.vercel.app
- Full Nextra v4 site with Pagefind search, covering all features across 13 pages.

[1.0.9]: https://github.com/official-jetio/validator/releases/tag/v1.0.9