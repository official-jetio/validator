import typescript from "@rollup/plugin-typescript";
import bundleSize from 'rollup-plugin-bundle-size';
export default [
  // ===========================================
  // CLI Build (metaschema loader)
  // ===========================================
  {
    input: "scripts/load-metaschemas.ts",
    output: {
      file: "dist/cli.js",
      format: "cjs",
      banner: "#!/usr/bin/env node",
      sourcemap: false,
      indent: true,
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.cli.json",
      }),
    ],
    external: ["path", "fs/promises"],
  },

  // ===========================================
  // ESM Build (modern bundlers, Node.js ESM)
  // ===========================================
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.esm.js",
      format: "esm",
      sourcemap: false,
      exports: "named",
      indent: true,
      strict: true,
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.rollup.json",
      }),
      bundleSize(),
    ],
    external: [],
  },

  // ===========================================
  // CommonJS Build (Node.js require)
  // ===========================================
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.cjs.js",
      format: "cjs",
      sourcemap: false,
      exports: "named",
      indent: true,
      strict: true,
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.rollup.json",
      }),
      bundleSize(),
    ],
    external: [],
  },

  // ===========================================
  // UMD Build (browser globals, CDN usage)
  // ===========================================
  {
    input: "src/index.ts",
    output: {
      file: "dist/validator.umd.js",
      format: "umd",
      name: "JetValidator",
      sourcemap: false,
      exports: "named",
      indent: true,
      strict: true,
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.rollup.json",
        compilerOptions: {
          module: "ES2015",
          target: "ES2018",
        },
      }),
      bundleSize(),
      // visualizer({
      //   filename: "bundle-analysis.html",
      //   open: false,
      // }),
    ],
    external: [],
  },
];
