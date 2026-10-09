/**
 * Smoke check: run the real committed fixture through normalize() and assert
 * the decoy filter holds. `npm run smoke`. Fails loudly if pricing breaks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize, rejectDecoys, type Listing } from "../lib/serp";

const raw = JSON.parse(readFileSync("fixtures/nvidia-rtx-4060-8gb-graphics-card.json", "utf8"));
const listings = normalize(raw);
const cheapest = listings.reduce((b, l) => (l.price < b.price ? l : b));

// The raw response really does contain ₹3 and ₹4 "RTX 4060" listings.
const rawPrices = raw.shopping_results.map((r: any) => r.extracted_price);
assert.ok(Math.min(...rawPrices) < 10, "fixture should still contain decoys to filter");

assert.ok(listings.length > 10, `kept too few listings: ${listings.length}`);
assert.ok(cheapest.price > 10_000, `decoy leaked through: ₹${cheapest.price}`);
assert.ok(cheapest.seller && cheapest.link, "cheapest listing missing seller or link");
assert.ok(
  listings.every((l: Listing) => Number.isFinite(l.price) && l.price > 0),
  "non-finite price survived normalize()",
);

// Small result sets must pass through untouched rather than self-filter to junk.
const tiny = [{ price: 5 }, { price: 9000 }] as Listing[];
assert.equal(rejectDecoys(tiny).length, 2, "should not filter sets smaller than 4");

console.log(
  `ok — ${raw.shopping_results.length} raw -> ${listings.length} kept, ` +
  `cheapest ₹${cheapest.price.toLocaleString("en-IN")} @ ${cheapest.seller}`,
);
