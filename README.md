# jet-validator

**Compiles JSON Schema into specialized JavaScript validation functions.** 99% compliance from Draft 06 to 2020-12, compiles in ~0.2ms (14x faster than ajv on average), and emits zero-runtime standalone code(custom keywords included) that runs with no library and no `new Function()`.

[![npm version](https://img.shields.io/npm/v/@jetio/validator.svg)](https://www.npmjs.com/package/@jetio/validator) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Bundle Size](https://img.shields.io/bundlephobia/minzip/@jetio/validator)](https://bundlephobia.com/package/@jetio/validator)

> **Want TypeScript types inferred from the same schema?** Install **[@jetio/schema-builder](https://www.npmjs.com/package/@jetio/schema-builder)**, a separate package that adds spec-compliant inference on top of this validator. AJV-grade speed, Zod-grade types.

---

**passed over 99% of json schema test suite, Draft 06 to 2020-12**

**14x faster compilation(sub-millisecond)** 

**competitive validation**

**zero-runtime standalone**

**39KB gzipped**

**zero dependencies**

jet-validator compiles JSON Schemas into optimized validation functions tailored to your exact schema, and can emit them as a standalone module so production ships pre-built functions instead of compiling on boot.

*One import handles all drafts. For Draft-07 and earlier, see the docs on specifying the draft for `$ref`.*

---

## Compile Schemas to Functions

Most validators keep your schema and interpret it on every call. jet-validator reads the schema once and emits straight-line JavaScript specialized to that shape: property loops, type checks, and `$ref` calls unrolled into one function. Then it runs.

```typescript
const validate = jetValidator.compile(schema);
validate(data); // true | false
```

---

## Zero-Runtime Standalone Output

Compile at build time. Ship functions, not schemas.

jet-validator emits a standalone module: plain validation functions with no runtime library dependency and no `new Function()`. It runs where `eval`/`Function` is forbidden, like strict CSP, edge runtimes, and Workers.

```typescript
import { JetValidator } from "@jetio/validator";
import { writeFileSync } from "fs";

const jetValidator = new JetValidator();
const { code, functionName } = jetValidator.generateStandalone(schema, { functionName: "validateUser" }, { async: true });

writeFileSync(
  "./validators/user.js",
  `${code}\nexport default ${functionName};`,
);
```

```typescript
// production: import and run, nothing to compile on boot
import validateUser from "./validators/user.js";
validateUser(data); // true | false
```

**Why it matters:**

- **Cold starts drop to zero compile time.** The function already exists.
- **CSP, edge, and Workers safe.** No `new Function()`, no `eval`.


> **Note:** base schemas (types, ranges, `required`, `$ref`) emit with zero imports. Custom formats or keywords are inlined or imported explicitly, still with no library dependency.

**[Standalone Code Generation Guide](https://jet-validator-docs.vercel.app/standalone/basics)**

---

## ~14x Faster Compilation

Fast enough to compile on demand, even per request.

```typescript
app.post("/validate", (req, res) => {
  const validate = jetValidator.compile(req.body.schema);
  res.json(validate(req.body.data));
});
```

**Benchmarks (65 schemas, single 1.6 GHz Linux laptop):**

- **Compilation:** ~14x faster than AJV on average (6.7x–46x depending on schema), faster on all 65 schemas.
- **Validation:** matches or beats AJV — wins 60% of valid-data and 65% of invalid-data throughput comparisons.

Full per-schema tables and methodology: **[Benchmark report](https://github.com/official-jetio/validator/blob/main/benchmark.md)**


## Run it yourself

The benchmark runs in CI, there's a `benchmark.yml` GitHub Action you can trigger to generate a fresh report and review the results yourself. Numbers will vary with hardware, Node version, and system load (these were run on a single 1.6 GHz Linux
laptop), so treat the exact figures as a snapshot, not a guarantee. The rankings hold up better than the precise percentages.

---

## Fastify Plugin

At least 3x faster end-to-end through Fastify. The raw compile gap is larger, but Fastify's fixed startup cost is added to both validators and compresses the ratio. More on complex schemas.

```bash
npm install @jetio/fastify-validator
```

```js
const fastify = Fastify({
  schemaController: createJetValidatorController({
    removeAdditional: true,
    useDefaults: true,
    coerceTypes: true,
    async: true,
    debug: true,
    strict: true,
    logFunction: true,
    loadSchema: () => {},
    cache: true,
    // ...and more
  }),
});
```

**[See @jetio/fastify-validator](https://www.npmjs.com/package/@jetio/fastify-validator)**

---

## Installation

```bash
npm install @jetio/validator
# or
pnpm add @jetio/validator
# or
yarn add @jetio/validator
# or
bun add @jetio/validator 
```

---

## Quick Start

```typescript
import { JetValidator } from "@jetio/validator";

const jetValidator = new JetValidator();

const schema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 2 },
    age: { type: "number", minimum: 0, maximum: 120 },
    email: { type: "string", format: "email" },
  },
  required: ["name", "age"],
};

const validate = jetValidator.compile(schema);

validate({ name: "Alice", age: 25, email: "alice@example.com" }); // true
validate({ name: "A", age: 150 }); // false

console.log(validate.errors);
// [
//   { dataPath: '/name', keyword: 'minLength', message: 'must have at least 2 characters.' },
//   { dataPath: '/age',  keyword: 'maximum',   message: 'must be <= 120' }
// ]
```

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/edit/node-x8tsfmth?file=index.js)

**[Getting Started Guide](https://jet-validator-docs.vercel.app/#-installation)**

---

## TypeScript Inference (companion package)

The validator consumes plain JSON Schema. If you want a fluent, type-safe builder where the schema, the TypeScript type, and the validator all come from one `.build()`, install **[@jetio/schema-builder](https://www.npmjs.com/package/@jetio/schema-builder)** (a separate package that bundles this validator).

The part no other TypeScript schema library can do: a discriminated union from `oneOf` and a fully-inferred `if / then / elseIf / else` chain, in one schema, producing one exact type.

```typescript
import { SchemaBuilder, Jet, JetValidator } from "@jetio/schema-builder";

const accountSchema = new SchemaBuilder()
  .object()
  .properties({
    accountType: (s) => s.string(),
    username: (s) => s.string(),
    companyName: (s) => s.string(),
    email: (s) => s.string().format("email"),
  })
  .required(["accountType", "email"])
  // exclusive branch: the other branch's keys are marked `never`, no `kind` tag needed
  .oneOf(
    (s) => s.object().properties({ accountType: (s) => s.const("personal") }),
    (s) => s.object().properties({ accountType: (s) => s.const("business") }),
  )
  // conditional chain, inferred all the way through elseIf
  .if((s) => s.object().properties({ accountType: (s) => s.const("personal") }))
  .then((s) => s.object().required(["username"]))
  .elseIf((s) => s.object().properties({ accountType: (s) => s.const("business") }))
  .then((s) => s.object().required(["companyName"]))
  .end()
  .build();

type Account = Jet.Infer<typeof accountSchema>;
// {
//   accountType: "personal";
//   username: string;
//   email: string;
//   companyName?: string | undefined;
// } | {
//   accountType: "business";
//   companyName: string;
//   email: string;
//   username?: string | undefined;
// }

const validate = new JetValidator({ allErrors: true }).compile(accountSchema);
validate({ accountType: "personal", email: "a@b.com", username: "alice" }); // true
validate({ accountType: "personal", email: "a@b.com" });                    // false, username missing
```

One object gave you the JSON Schema, the exact TypeScript type, and the compiled validator, all enforcing the same rules and unable to drift apart.

**[See @jetio/schema-builder](https://www.npmjs.com/package/@jetio/schema-builder)**

---

## Core Features

### elseIf Conditionals

Flat conditional chains instead of deeply nested `if`/`else`.

```typescript
// Standard JSON Schema (nested)
{
  if:   { properties: { type: { const: "A" } } },
  then: { properties: { value: { minimum: 100 } } },
  else: {
    if:   { properties: { type: { const: "B" } } },
    then: { properties: { value: { minimum: 50 } } },
    else: { properties: { value: { minimum: 0 } } }
  }
}

// jet-validator (flat)
{
  if:   { properties: { type: { const: "A" } } },
  then: { properties: { value: { minimum: 100 } } },
  elseIf: [
    { if: { properties: { type: { const: "B" } } },
      then: { properties: { value: { minimum: 50 } } } }
  ],
  else: { properties: { value: { minimum: 0 } } }
}
```

**[elseIf Guide](https://jet-validator-docs.vercel.app/advanced/else-if)**

---

### Advanced `$data` References

Compare values within your data at validation time.

```typescript
const schema = {
  type: "object",
  properties: {
    password: { type: "string", minLength: 8 },
    confirmPassword: { type: "string", const: { $data: "1/password" } },
    minPrice: { type: "number" },
    maxPrice: { type: "number" },
    currentPrice: {
      type: "number",
      minimum: { $data: "1/minPrice" },
      maximum: { $data: "1/maxPrice" },
    },
  },
};

const jetValidator = new JetValidator({ $data: true });
```

Works with `const`, `enum`, min/max, `pattern`, and more.

**[$data Guide](https://jet-validator-docs.vercel.app/advanced/data-keyword)**

---

### Custom Keywords

Build your own validation vocabulary. Each type plugs in at a different stage of compilation, so you can layer domain rules into the schema instead of scattering them across handlers.

```typescript
// 1. code: inline generated JS, no call overhead.
jetValidator.addKeyword({
  keyword: "range",
  code: (value, schema, ctx) => `if (data < ${schema[0]} || data > ${schema[1]}) { /* fail */ }`,
});

// 2. compile: a purpose-built function per schema instance, for closure state.
jetValidator.addKeyword({
  keyword: "divisibleBy",
  compile: (v) => (data) => data % v === 0,
});

// 3. validate: arbitrary logic, async-capable. Databases, services, anything.
jetValidator.addKeyword({
  keyword: "uniqueEmail",
  async: true,
  validate: async (v, data) => !(await db.emailExists(data)),
});

// 4. macro: expand one keyword into a sub-schema at compile time.
jetValidator.addKeyword({
  keyword: "username",
  macro: () => ({ type: "string", minLength: 3, maxLength: 20, pattern: "^[a-zA-Z0-9_]+$" }),
});
```

Define the vocabulary once (`username`, `strongPassword`, `uniqueEmail`), then author schemas in your domain's language. Ship it as a package and every schema in your codebase speaks it.

**[Custom Keywords Guide](https://jet-validator-docs.vercel.app/keywords/types)**

---

### Built-in Formats and Error Messages

Formats (`email`, `uri`, `date-time`, `uuid`, `ipv4`, and more) and custom error messages are built in. No extra dependencies.

```typescript
const jetValidator = new JetValidator({ allErrors: true, errorMessage: true });

const schema = {
  type: "object",
  properties: {
    email: { type: "string", format: "email", errorMessage: "Enter a valid email" },
  },
};

jetValidator.addFormat("phone", /^\+?[1-9]\d{1,14}$/);
```

**[Format Validation](https://jet-validator-docs.vercel.app/formats/configuration)** · **[Error Handling](https://jet-validator-docs.vercel.app/errors/error-handling)**

---

### Recursive and Circular Refs

Recursive and circular `$ref`s compile cleanly and never overflow the stack; recursion follows your data, not your schema. Refs are inlined when possible, when enabled.

Inlining stats are available when debug is enabled.

```typescript
const schema = {
  $id: "https://example.com/tree",
  type: "object",
  properties: {
    value: { type: "number" },
    left: { $ref: "#" },
    right: { $ref: "#" },
  },
};
```

**[Resolution Process](https://jet-validator-docs.vercel.app/references/resolution)**

---

## JSON Schema Compliance

99% compliant across Draft 06 to 2020-12, measured against the official [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite) (optional tests skipped).

| Draft | jet-validator |
| --- | --- |
| 2020-12 | **99.2%** (1289/1299) |
| 2019-09 | **98.3%** (1238/1259) |
| Draft 07 | **99.5%** (922/927) |
| Draft 06 | **99.4%** (834/839) |

<details>
<summary>Remaining failures (by draft)</summary>

**Draft 2020-12 (10):** `dynamicRef` edge cases (4), `__proto__`-as-property-name tests (5), custom-vocabulary metaschema (1).

**Draft 2019-09 (21):** `$recursiveRef`/`$recursiveAnchor` intentionally not supported (11, see below), plus assorted `__proto__` and metaschema edge cases.

**Draft 07 (5) and Draft 06 (5):** the `__proto__`-as-property-name tests, which use `__proto__` as a legitimate property key. This is a JavaScript object-model quirk, not a prototype-pollution vulnerability.

</details>

**Intentionally not supported:** `$recursiveRef`/`$recursiveAnchor` (superseded by `$dynamicRef`/`$dynamicAnchor` in 2020-12) and `$vocabulary` (niche).

Upgrade to Draft 2020-12 for dynamic references.

---

## Migrating from AJV

Near drop-in. The compile/validate shape is the same:

```typescript
// Before
import Ajv from "ajv";
const validate = new Ajv().compile(schema);

// After
import { JetValidator } from "@jetio/validator";
const validate = new JetValidator().compile(schema);
```

**You gain:** ~14x faster compilation, standalone/zero-runtime output, built-in formats and error messages, and `elseIf`.

**What differs:** the error-object shape, the custom-keyword API, and meta-schema setup (via CLI). See the migration notes in the docs.

**[Full docs](https://jet-validator-docs.vercel.app)**

---

## Where jet-validator shines

- **Edge, CSP, Workers.** Standalone output runs where `new Function()` can't.
- **Serverless.** Zero boot-time compilation with standalone; fast compile if you don't.
- **High-throughput APIs.** Validate thousands of requests per second.
- **Dynamic schemas.** Compile on the fly without a caching layer.
- **Complex schemas.** Deep `$ref` graphs, conditional logic, circular references.

- **Complex $ref resolution stats.** Insights into how your schema resolves: what was inlined and the total reference count.


**Consider alternatives if** you need specific AJV plugins with a matching API surface, or streaming validation for very large documents.

---

## Documentation

- [Full Documentation](https://jet-validator-docs.vercel.app)
- [Standalone Codegen](https://jet-validator-docs.vercel.app/standalone/basics)
- [Configuration Options](https://jet-validator-docs.vercel.app/configuration/getting-started)
- [Schema References and Composition](https://jet-validator-docs.vercel.app/references/static-refs)
- [Meta-Schema System](https://jet-validator-docs.vercel.app/meta-schemas/meta-schema-basics)

## Running the Benchmarks Yourself

```bash
npm ci
npm run bench          # jet + ajv + comparison, in sequence
```

Results land in `benchmarks/results/`. Cold compile samples default to 5; lower them for a quicker run:

```bash
COMPILE_SAMPLES=3 npm run bench
```

Hosted CI runners don't pin CPU frequency, so absolute ops/sec differ from the published numbers; the compile speedup and win/loss ratios stay stable. Figures in [benchmark.md](https://github.com/official-jetio/validator/blob/main/benchmark.md) were measured on a fixed 1.6 GHz Ubuntu laptop.

## Contributing

Bug reports and PRs welcome. Run `npm run test:<test-name>` after building. **[Bug report](https://github.com/official-jetio/validator/issues/new?labels=bug)** · **[Feature request](https://github.com/official-jetio/validator/issues/new?labels=enhancement)** · **[Discussions](https://github.com/official-jetio/validator/discussions)**

## Acknowledgments

The feature set was inspired by AJV, though the internals are entirely different. Thanks to the JSON Schema community for the specs and test suites.

## License

MIT © [Great Venerable](https://github.com/greatvenerable)

## Links

**[npm](https://www.npmjs.com/package/@jetio/validator)** · **[GitHub](https://github.com/official-jetio/validator)** · **[Docs](https://jet-validator-docs.vercel.app)** · **[schema-builder](https://www.npmjs.com/package/@jetio/schema-builder)**