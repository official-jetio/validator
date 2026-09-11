// import { promises as fs } from "fs";
// import path from "path";
// import { compile } from "./adapter";
// import { corpus } from "./cases";

// const DIR = path.join(__dirname, "__snapshots__");
// const MODES = [
//   { tag: "failfast", opts: { allErrors: false } },
//   { tag: "allerrors", opts: { allErrors: true } },
// ];

// export async function runSnapshots(update = false) {
//   await fs.mkdir(DIR, { recursive: true });
//   let failed = 0;

//   for (const c of corpus) {
//     for (const m of MODES) {
//       const { source } = await compile(c.schema, { ...c.options, ...m.opts });
//       const file = path.join(DIR, `${c.id}.${m.tag}.js`);

//       let prev: string | null = null;
//       try {
//         prev = await fs.readFile(file, "utf8");
//       } catch {}

//       if (update || prev === null) {
//         await fs.writeFile(file, source);
//         console.log(`${prev === null ? "NEW " : "UPD "} ${c.id}.${m.tag}`);
//       } else if (prev !== source) {
//         failed++;
//         console.error(`DIFF ${c.id}.${m.tag}`);
//         console.error(firstDiff(prev, source));
//       }
//     }
//   }
//   if (failed) throw new Error(`${failed} snapshot diffs`);
//   console.log("snapshots clean");
// }

// function firstDiff(a: string, b: string): string {
//   let i = 0;
//   while (i < a.length && i < b.length && a[i] === b[i]) i++;
//   const at = Math.max(0, i - 40);
//   return `  @${i}\n  old: …${a.slice(at, i + 40)}\n  new: …${b.slice(at, i + 40)}`;
// }

// if (require.main === module) runSnapshots(process.argv.includes("--update"));
