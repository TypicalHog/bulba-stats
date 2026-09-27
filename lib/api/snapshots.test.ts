/**
 * Run with: node --experimental-strip-types --import ./test/loader.mjs --test lib/api/snapshots.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { hourlySlots, type MarketSample } from "@/lib/api/snapshots";

/** A complete series row; only `at` varies between tests. */
function sample(at: string): MarketSample {
  return {
    at,
    listings: 181,
    quoted: 118,
    twoSided: 96,
    medianSpreadPct: 4.2,
    bidValue: 1200,
    askValue: 3400,
    bidValueNearMid: 150,
    askValueNearMid: 260,
    treasury: 90,
  };
}

/** Each slot's hour, and the capture it holds by its timestamp. */
const shape = (slots: ReturnType<typeof hourlySlots>) =>
  slots.map((s) => [s.hour, s.sample?.at ?? null]);

test("hourlySlots() leaves an hour with no capture empty instead of closing the gap", () => {
  const slots = hourlySlots([
    sample("2026-09-26T23:05:12.000Z"),
    sample("2026-09-27T01:40:03.000Z"),
  ]);
  assert.deepEqual(shape(slots), [
    ["2026-09-26T23:00:00.000Z", "2026-09-26T23:05:12.000Z"],
    ["2026-09-27T00:00:00.000Z", null],
    ["2026-09-27T01:00:00.000Z", "2026-09-27T01:40:03.000Z"],
  ]);
});

test("hourlySlots() keeps the later capture when two land in the same hour", () => {
  const slots = hourlySlots([
    sample("2026-09-27T10:50:00.000Z"),
    sample("2026-09-27T10:05:00.000Z"),
  ]);
  assert.deepEqual(shape(slots), [
    ["2026-09-27T10:00:00.000Z", "2026-09-27T10:50:00.000Z"],
  ]);
});

test("hourlySlots() skips a capture whose timestamp does not parse", () => {
  const slots = hourlySlots([
    sample("2026-09-27T10:05:00.000Z"),
    sample("not a timestamp"),
    sample("2026-09-27T11:10:00.000Z"),
  ]);
  assert.deepEqual(shape(slots), [
    ["2026-09-27T10:00:00.000Z", "2026-09-27T10:05:00.000Z"],
    ["2026-09-27T11:00:00.000Z", "2026-09-27T11:10:00.000Z"],
  ]);
});

test("hourlySlots() has no slots without captures", () => {
  assert.deepEqual(hourlySlots([]), []);
});
