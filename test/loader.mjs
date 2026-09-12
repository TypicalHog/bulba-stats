/**
 * Entry point for `node --import ./test/loader.mjs`.
 *
 * Resolution hooks run on their own thread, so they have to be *registered*
 * rather than merely imported — this file is the one the test script loads, and
 * `./resolve-ts.mjs` is what it registers.
 */
import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
