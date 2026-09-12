/**
 * Run with: node --experimental-strip-types --test lib/format.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  compact,
  num,
  price,
  diamonds,
  diamondsCompact,
  itemLabel,
  itemSlug,
  itemIconUrl,
  dateTime,
  dateOnly,
  relativeTime,
} from "@/lib/format";

test("num() renders — for null/undefined/non-finite", () => {
  assert.equal(num(null), "—");
  assert.equal(num(undefined), "—");
  assert.equal(num(NaN), "—");
});

test("num() thousands-separates at the requested precision", () => {
  assert.equal(num(1284), "1,284");
  assert.equal(num(1284.5, 2), "1,284.50");
});

test("compact() keeps full digits under 1000", () => {
  assert.equal(compact(284), "284");
  assert.equal(compact(4.5), "4.5");
});

test("compact() uses two decimals under 10K, one above", () => {
  assert.equal(compact(2984), "2.98K");
  assert.equal(compact(12900), "12.9K");
});

test("compact() carries a bucket rounded up to 1000 into the next unit", () => {
  assert.equal(compact(999980), "1M");
});

test("compact() spans K/M/B", () => {
  assert.equal(compact(1500), "1.5K");
  assert.equal(compact(2_500_000), "2.5M");
  assert.equal(compact(3_000_000_000), "3B");
});

test("price() scales precision to magnitude", () => {
  assert.equal(price(0), "0");
  assert.equal(price(0.0058), "0.0058");
  assert.equal(price(0.0102), "0.010");
  assert.equal(price(0.5), "0.500");
  assert.equal(price(31.65), "31.65");
  assert.equal(price(1284.5), "1,284.50");
});

test("price() renders — for null/undefined/non-finite", () => {
  assert.equal(price(null), "—");
  assert.equal(price(undefined), "—");
  assert.equal(price(Infinity), "—");
});

test("diamonds() appends the currency glyph, or — when absent", () => {
  assert.equal(diamonds(31.65), "31.65◇");
  assert.equal(diamonds(null), "—");
});

test("diamondsCompact() compacts before appending the glyph", () => {
  assert.equal(diamondsCompact(12900), "12.9K◇");
  assert.equal(diamondsCompact(undefined), "—");
});

test("itemLabel() title-cases the item name but keeps the variant verbatim", () => {
  assert.equal(itemLabel({ itemName: "diamond_pickaxe", variantName: "maxsilk" }), "Diamond Pickaxe · maxsilk");
  assert.equal(itemLabel({ itemName: "diamond_pickaxe", variantName: null }), "Diamond Pickaxe");
});

test("itemLabel() falls back to unknown for a missing/non-string name", () => {
  assert.equal(itemLabel({ itemName: null, variantName: null }), "Unknown");
});

test("itemSlug() prefers listingName, else itemName:variantName, else itemName", () => {
  assert.equal(
    itemSlug({ itemName: "diamond_pickaxe", variantName: "maxsilk", listingName: "op-pick" }),
    "op-pick",
  );
  assert.equal(
    itemSlug({ itemName: "diamond_pickaxe", variantName: "maxsilk", listingName: null }),
    "diamond_pickaxe:maxsilk",
  );
  assert.equal(itemSlug({ itemName: "diamond_pickaxe", variantName: null, listingName: null }), "diamond_pickaxe");
});

test("itemIconUrl() serves the local fallback for the one upstream 404", () => {
  assert.equal(itemIconUrl("bulba_stock"), "/bulba-icon.webp");
  assert.equal(itemIconUrl(null), "/bulba-icon.webp");
});

test("dateTime()/dateOnly() don't take down the table on a bad timestamp", () => {
  assert.equal(dateTime(null), "—");
  assert.equal(dateTime("not-a-date"), "—");
  assert.equal(dateOnly(undefined), "—");
  assert.equal(dateOnly("not-a-date"), "—");
});

test("dateTime()/dateOnly() render a valid ISO timestamp in UTC", () => {
  assert.equal(dateTime("2026-03-04T09:05:00Z"), "04 Mar, 09:05");
  assert.equal(dateOnly("2026-03-04T09:05:00Z"), "04 Mar");
});

test("relativeTime() falls back to — for a missing/bad timestamp", () => {
  assert.equal(relativeTime(null), "—");
  assert.equal(relativeTime("not-a-date"), "—");
});

test("relativeTime() buckets by minutes/hours/days given a fixed now", () => {
  const now = Date.parse("2026-03-04T12:00:00Z");
  assert.equal(relativeTime("2026-03-04T11:59:30Z", now), "30 seconds ago");
  assert.equal(relativeTime("2026-03-04T11:30:00Z", now), "30 minutes ago");
  assert.equal(relativeTime("2026-03-04T09:00:00Z", now), "3 hours ago");
  assert.equal(relativeTime("2026-03-02T12:00:00Z", now), "2 days ago");
});
