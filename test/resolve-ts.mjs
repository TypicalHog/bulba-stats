/**
 * Module resolution hook for `node --test`.
 *
 * The app is written for a bundler: imports are extensionless (`./api/constants`)
 * and use the `@/` alias from tsconfig. Node's ESM resolver honours neither, so
 * `node --test` cannot load anything that imports another module — which is most
 * of `lib/`. This closes that gap in about thirty lines rather than pulling in a
 * test framework and a second module pipeline to do the same job.
 *
 * Registered by the `test` script via `--import`. Type stripping itself is
 * Node's (`--experimental-strip-types`); this only answers "which file".
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTS = [".ts", ".tsx", ".mjs", ".js"];

/** First existing candidate for a bare path: the file, or its directory index. */
function probe(base) {
  if (existsSync(base) && path.extname(base)) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const index = path.join(base, "index" + ext);
    if (existsSync(index)) return index;
  }
  return null;
}

export function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = path.join(ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".") && context.parentURL) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }

  const hit = base && probe(base);
  /*
   * No `format` here on purpose: naming it "module" would route a .ts file
   * straight to the JavaScript parser and the first type annotation would be a
   * SyntaxError. Left unset, Node picks the format from the extension and
   * applies its own type stripping.
   */
  return hit
    ? { url: pathToFileURL(hit).href, shortCircuit: true }
    : next(specifier, context);
}
