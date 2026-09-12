/**
 * Run with: node --experimental-strip-types --test lib/round.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { r } from "@/lib/round";

test("r() rounds to the requested decimal places", () => {
  assert.equal(r(8.333333333333332, 2), 8.33);
  assert.equal(r(1.005, 4), 1.005);
});

test("r() defaults to 4dp", () => {
  assert.equal(r(1 / 3), 0.3333);
});

test("r() passes null/undefined through as null", () => {
  assert.equal(r(null), null);
  assert.equal(r(undefined), null);
});

test("r() rejects non-finite input", () => {
  assert.equal(r(NaN), null);
  assert.equal(r(Infinity), null);
  assert.equal(r(-Infinity), null);
});

test("r() preserves sign and integers", () => {
  assert.equal(r(-2.5, 1), -2.5);
  assert.equal(r(0, 2), 0);
  assert.equal(r(42, 0), 42);
});
