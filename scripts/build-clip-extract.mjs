// Turns scripts/clip-extract.js (the bookmarklet's page extractor) into lib/clip-extract.ts.
// Run after editing the extractor: node scripts/build-clip-extract.mjs
import { readFile, writeFile } from "node:fs/promises";

const source = (await readFile(new URL("./clip-extract.js", import.meta.url), "utf8"))
  .split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n")
  .replace(/catch \{ \/\* ignore \*\/ \}/g, "catch { }");
new Function(source);
await writeFile(new URL("../lib/clip-extract.ts", import.meta.url),
  `// Generated from scripts/clip-extract.js by scripts/build-clip-extract.mjs: runs on the article page, not in Gist.\n// It finds the headline, date, canonical URL and the body paragraphs of the page.\nexport const extractSource = ${JSON.stringify(source)};\n`);
console.log("lib/clip-extract.ts updated");
