# jet-validator

**The fastest-compiling JSON Schema validator in JavaScript.** Matches AJV on validation speed, compiles 14-19x faster, and emits zero-runtime standalone code that runs with no library and no `new Function()`.

[![npm version](https://img.shields.io/npm/v/@jetio/validator.svg)](https://www.npmjs.com/package/@jetio/validator) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Bundle Size](https://img.shields.io/bundlephobia/minzip/@jetio/validator)](https://bundlephobia.com/package/@jetio/validator)

> **Want TypeScript types inferred from the same schema?** Install **[@jetio/schema-builder](https://www.npmjs.com/package/@jetio/schema-builder)**, a separate package that adds spec-compliant inference on top of this validator. AJV-grade speed, Zod-grade types.

---

**14-19x faster compilation** · **matches AJV on validation** · **zero-runtime standalone output** · **26KB gzipped** · **zero dependencies** · **Draft 06 to 2020-12**

jet-validator compiles JSON Schemas into highly optimized validation functions. Unlike validators that interpret schemas at runtime, it generates specialized code tailored to your exact schema. It can also emit that code as a standalone module, so production ships pre-built functions instead of compiling on boot.

*One import handles all drafts. For Draft-07 and earlier, see the docs on specifying the draft for `$ref`.*

---

## Zero-Runtime Standalone Output

**Compile at build time. Ship functions, not schemas.**

jet-validator can emit a standalone module: plain JavaScript validation functions with no dependency on the library at runtime and no `new Function()`. That means it runs in environments where `eval`/`Function` is forbidden, like strict CSP, edge runtimes, and Workers.

```typescript
import { JetValidator } from "@jetio/validator";

const jetValidator = new JetValidator();
const standaloneCode = jetValidator.generateStandalone(schema);

// Write it to a file at build time.
// build output: validators/user.js  (a plain function, zero imports for base schemas)

// Then in production, just import and run. No compilation on boot.
import validateUser from "./validators/user.js";
validateUser(data); // true | false
```

**Why it matters:**

- **Cold starts drop to zero compile time.** The function already exists; nothing to build on boot.
- **CSP, edge, and Workers safe.** No `new Function()`, no `eval`.
- **Smaller runtime.** Base-schema output imports nothing.

> **Note:** base schemas (types, ranges, `required`, `$ref`, etc.) emit with zero imports. Schemas using custom formats or custom keywords have those inlined or imported explicitly. Still no library dependency, but there's an explicit setup step for those pieces.

**[Standalone Code Generation Guide](https://jet-validator-docs.vercel.app/build/standalone-basics)**

---

## 14-19x Faster Compilation

If you do compile at runtime, it's fast enough to make caching optional.

```typescript
// Fast enough to compile on-demand, per request if you want
app.post("/validate", (req, res) => {
  const validate = jetValidator.compile(req.body.schema); // ~1-2ms
  res.json(validate(req.body.data));
});
```

- **Compilation:** 14-19x faster than AJV on average.
- **Validation:** competitive with AJV.
- **Serverless (runtime compile):** 20 routes goes from ~560ms to ~28ms boot compilation. Or go standalone above and pay 0ms.

> **Fresh benchmarks coming soon.** The current figures are from an earlier build on a modest Ubuntu laptop and are now considered stale. A full rerun against the latest version is in progress. Absolute numbers will shift; the compilation advantage holds.

---

## Installation

```bash
npm install @jetio/validator
# or
pnpm add @jetio/validator
# or
yarn add @jetio/validator
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
//   { dataPath: '/name', keyword: 'minLength', message: 'must NOT have fewer than 2 characters' },
//   { dataPath: '/age',  keyword: 'maximum',   message: 'must be <= 120' }
// ]
```

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/edit/node-x8tsfmth?file=index.js)

**[Getting Started Guide](https://jet-validator-docs.vercel.app/#-installation)**

---

## TypeScript Inference (companion package)

The validator consumes plain JSON Schema. If you want a fluent, type-safe builder where the schema, the TypeScript type, and the validator all come from one `.build()`, install **[@jetio/schema-builder](https://www.npmjs.com/package/@jetio/schema-builder)** (a separate package that bundles this validator).

Here's the part no other TypeScript schema library can do: a discriminated union from `oneOf` **and** a fully-inferred `if / then / elseIf / else` chain, in one schema, producing one exact type.

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
//   username: string;      // required by the `personal` branch
//   email: string;
//   companyName?: string | undefined;
// } | {
//   accountType: "business";
//   companyName: string;   // required by the `business` branch
//   email: string;
//   username?: string | undefined;
// }

// Same schema, same rules, at runtime:
const validate = new JetValidator({ allErrors: true }).compile(accountSchema);
validate({ accountType: "personal", email: "a@b.com", username: "alice" }); // true
validate({ accountType: "personal", email: "a@b.com" });                    // false, username missing
```

One object gave you the JSON Schema, the exact TypeScript type, and the compiled validator, all enforcing the same rules and unable to drift apart.

**What the builder adds:** exclusive discriminated unions from `oneOf` (no discriminator tag required), `if/then/elseIf/else` inference (which no other TS schema library supports), pattern properties as template literals, and `.extend()` that keeps full inference where `$ref` leaves you with `unknown`.

**[See @jetio/schema-builder](https://www.npmjs.com/package/@jetio/schema-builder)**

---

## Core Features

### elseIf Conditionals

**Flat conditional chains instead of deeply nested `if`/`else`.**

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

// jet-validator (flat and readable)
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

**Compare values within your data at validation time.**

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

### Custom Keywords: build your own validation vocabulary

Custom keywords aren't just for one-off checks. Because each type plugs in at a different stage of compilation, you can layer them into a complete, reusable validation pipeline where domain rules live in the schema instead of scattered across handlers. Four tools, each for a different job:

```typescript
// 1. code: inline generated JS. Fastest path; the check becomes part of the
//    compiled function itself, no call overhead.
jetValidator.addKeyword({
  keyword: "range",
  code: (value, schema, ctx) => `if (data < ${schema[0]} || data > ${schema[1]}) { /* fail */ }`,
});

// 2. compile: return a purpose-built validation function per schema instance.
//    Use when the check needs closure state computed once at compile time.
jetValidator.addKeyword({
  keyword: "divisibleBy",
  compile: (v) => (data) => data % v === 0,
});

// 3. validate: arbitrary logic, async-capable. Your escape hatch to
//    databases, services, anything at validation time.
jetValidator.addKeyword({
  keyword: "uniqueEmail",
  async: true,
  validate: async (v, data) => !(await db.emailExists(data)),
});

// 4. macro: expand one keyword into a whole sub-schema at COMPILE time.
//    The expansion is validated by the normal engine, so it composes with
//    everything else (formats, $data, other keywords).
jetValidator.addKeyword({
  keyword: "username",
  macro: () => ({ type: "string", minLength: 3, maxLength: 20, pattern: "^[a-zA-Z0-9_]+$" }),
});
```

**Composing them into a pipeline:** a `macro` can expand into a schema that itself uses your `code` keyword and a built-in `format`; a `validate` keyword can gate on a database while `$data` keywords cross-check other fields, all in a single compiled validator. You define the vocabulary once (`username`, `strongPassword`, `uniqueEmail`, `businessHours`, and so on), then author schemas in your domain's language while the engine folds it all into one fast function. Ship that vocabulary as a package and every schema across your codebase speaks it.

**[Custom Keywords Guide](https://jet-validator-docs.vercel.app/extensibility/keywords/keyword-types)**

---

### Built-in Formats and Custom Error Messages

Formats (`email`, `uri`, `date-time`, `uuid`, `ipv4`, and more) and custom error messages are built in. No `ajv-formats`, no `ajv-errors`, no extra installs.

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

**[Format Validation](https://jet-validator-docs.vercel.app/extensibility/format-validation)** · **[Error Handling](https://jet-validator-docs.vercel.app/errors/error-handling)**

---

### No Stack Overflow on Circular Refs

A three-phase resolution process (collect, assign, resolve) handles circular and deeply-nested references at compile time, so recursion only ever goes as deep as your *data*, never your *schema*. Schemas that make some validators throw `RangeError: Maximum call stack size exceeded` compile cleanly here.

```typescript
const schema = {
  $id: "https://example.com/tree",
  type: "object",
  properties: {
    value: { type: "number" },
    left: { $ref: "#" },   // circular, fine
    right: { $ref: "#" },  // circular, fine
  },
};
```

**[Resolution Process](https://jet-validator-docs.vercel.app/references/resolution)**

---

## JSON Schema Compliance

Measured against the official [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite) (optional tests skipped). jet-validator matches or beats AJV on every draft they both support.

| Draft | jet-validator | AJV |
| --- | --- | --- |
| 2020-12 | **99.2%** (1251/1261) | 95.8% (1208/1261) |
| 2019-09 | **98.3%** (1206/1227) | 98.3% (1206/1227), tie |
| Draft 07 | **99.5%** (908/913) | 99.1% (905/913) |
| Draft 06 | **99.4%** (824/829) | not supported by this AJV version |

So: 98-99.5% across Draft 06 to 2020-12. Draft 2019-09 is a genuine tie with AJV; 2020-12 and 07 are wins.

<details>
<summary>jet-validator remaining failures (by draft)</summary>

**Draft 2020-12 (10):** `dynamicRef` edge cases (4), `properties`/`required` `__proto__`-as-property-name tests (5, and AJV fails these too), custom-vocabulary metaschema (1).

**Draft 2019-09 (21):** `$recursiveRef`/`$recursiveAnchor` intentionally not supported (11, see below), plus assorted `__proto__` and metaschema edge cases.

**Draft 07 (5) and Draft 06 (5):** the `__proto__`-as-property-name tests, which check `__proto__` as a legitimate property name. AJV fails them as well.

</details>

> **On the `__proto__` failures:** these are JSON Schema Test Suite cases that use `__proto__` as an ordinary property key. They are a JavaScript object-model quirk, not a prototype-pollution vulnerability, and AJV fails the same tests.

**Intentionally not supported:** `$recursiveRef`/`$recursiveAnchor` (superseded by the better-designed `$dynamicRef`/`$dynamicAnchor` in 2020-12) and `$vocabulary` (niche). Upgrade to Draft 2020-12 for dynamic references.

---

## Migrating from AJV

Near drop-in. The compile/validate shape is the same:

```typescript
// Before (AJV)
import Ajv from "ajv";
const ajv = new Ajv();
const validate = ajv.compile(schema);

// After (jet-validator)
import { JetValidator } from "@jetio/validator";
const jetValidator = new JetValidator();
const validate = jetValidator.compile(schema);
```

**You gain:** 14-19x faster compilation, standalone/zero-runtime output, built-in formats and error messages (no extra packages), and `elseIf`.

**What differs:** the error-object shape, the custom-keyword API, and meta-schema setup (via CLI). See the migration notes in the docs.

**[Full docs](https://jet-validator-docs.vercel.app)**

---

## Where jet-validator shines

- **Edge, CSP, Workers.** Standalone output runs where `new Function()` can't.
- **Serverless.** Zero boot-time compilation with standalone; fast compile if you don't.
- **High-throughput APIs.** Validate thousands of requests per second.
- **Dynamic schemas.** Compile on the fly without a caching layer.
- **Complex schemas.** Deep `$ref` graphs, conditional logic, circular references.

**Consider alternatives if** you rely on specific AJV plugins with a matching API surface, or need streaming validation for very large documents.

---

## Documentation

- [Full Documentation](https://jet-validator-docs.vercel.app)
- [Standalone Codegen](https://jet-validator-docs.vercel.app/build/standalone-basics)
- [Configuration Options](https://jet-validator-docs.vercel.app/getting-started#%EF%B8%8F-configuration-options)
- [Schema References and Composition](https://jet-validator-docs.vercel.app/references/static-refs)
- [Meta-Schema System](https://jet-validator-docs.vercel.app/meta-schemas/meta-schema-basics)

## Contributing

Bug reports, feature requests, and PRs are welcome. The project tests against the official JSON Schema Test Suite. Run `npm test` after building, and aim to maintain or improve compliance. Open a **[bug report](https://github.com/official-jetio/validator/issues/new?labels=bug)** or **[feature request](https://github.com/official-jetio/validator/issues/new?labels=enhancement)**, and use **[Discussions](https://github.com/official-jetio/validator/discussions)** for questions.

## Acknowledgments

Heavily inspired by AJV, from the compilation approach to custom keywords and `$data`, though the internals are entirely different. Thanks to the JSON Schema community for the specs and test suites.

## License

MIT © [Great Venerable](https://github.com/greatvenerable)

## Links

**[npm](https://www.npmjs.com/package/@jetio/validator)** · **[GitHub](https://github.com/official-jetio/validator)** · **[Docs](https://jet-validator-docs.vercel.app)** · **[schema-builder](https://www.npmjs.com/package/@jetio/schema-builder)**