import { readFile } from "node:fs/promises";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

// Node strips TypeScript in the existing tests, but JSX uses the same SWC compiler as the app.
export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  await loadBindings();
  const source = await readFile(new URL(url), "utf8");
  return {
    format: "module", shortCircuit: true,
    source: (await transform(source, {
      filename: new URL(url).pathname,
      jsc: { target: "es2022", parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
      module: { type: "es6" },
    })).code,
  };
}
