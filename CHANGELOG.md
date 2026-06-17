# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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