/**
 * Smoke check over the committed fixtures: `npm run smoke`.
 * Guards the three failure modes that would silently corrupt every price on
 * screen: decoy listings, wrong-product matches, and duplicate seller identity.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_BUILD, DEFAULT_BUILD_TEXT, parseBuild, parseLine } from "../lib/parts";
import { canonicalSeller, fixtureName, normalize, rejectDecoys, relevant, type Listing } from "../lib/serp";
import { SHIPPING_PER_SELLER, compare, sellerCurve } from "../lib/basket";
import type { Part } from "../lib/parts";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const bySeller = new Map<string, Set<string>>();
const byPart = new Map<Part, Listing[]>();

for (const part of DEFAULT_BUILD) {
  const raw = JSON.parse(readFileSync(`fixtures/${fixtureName(part.searchTerm)}.json`, "utf8"));
  const listings = rejectDecoys(relevant(normalize(raw), part));

  assert.ok(listings.length >= 3, `${part.slug}: only ${listings.length} relevant listings`);

  const sorted = [...listings].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0];

  /**
   * No absolute price floor: component prices moved enough through 2026 (DRAM
   * especially) that any hardcoded rupee bound would be wrong within weeks and
   * would start rejecting real data. Corroborate instead — a genuine market
   * price has company, a rogue listing stands alone.
   */
  const corroborating = new Set(
    sorted.filter((l) => l.price <= cheapest.price * 2).map((l) => l.seller),
  );
  assert.ok(
    corroborating.size >= 2,
    `${part.slug}: cheapest ${inr(cheapest.price)} @ ${cheapest.seller} is uncorroborated — ` +
      `no second seller within 2x. "${cheapest.title.slice(0, 55)}"`,
  );
  assert.ok(cheapest.link, `${part.slug}: cheapest listing has no link`);

  byPart.set(part, listings);
  for (const l of listings) {
    assert.ok(Number.isFinite(l.price) && l.price > 0, `${part.slug}: bad price`);
    assert.equal(l.seller, canonicalSeller(l.seller), `${part.slug}: non-canonical seller`);
    if (!bySeller.has(l.seller)) bySeller.set(l.seller, new Set());
    bySeller.get(l.seller)!.add(part.slug);
  }

  console.log(
    `${part.slug.padEnd(15)} ${String(listings.length).padStart(2)} listings  ` +
      `cheapest ${inr(cheapest.price).padStart(10)} @ ${cheapest.seller.padEnd(20)} ` +
      `(${corroborating.size} sellers within 2x)`,
  );
}

// Case-only duplicates must merge: the raw fixtures carry both "amazon.in" and
// "Amazon.in", which would otherwise be charged shipping twice.
assert.equal(canonicalSeller("Amazon.in"), canonicalSeller("amazon.in"));
assert.equal(canonicalSeller("WWW.Example.IN "), "example.in");

// Consolidation is the whole product; it needs sellers carrying multiple parts.
const multi = [...bySeller.values()].filter((p) => p.size >= 2).length;
assert.ok(multi >= 3, `only ${multi} sellers carry 2+ parts — consolidation has nothing to show`);

// --- typed build parsing ---
// Round-tripping the demo build must return the same parts, slugs included, or
// typed searches would lose their price history.
const round = parseBuild(DEFAULT_BUILD_TEXT);
assert.equal(round.length, DEFAULT_BUILD.length, "round-trip changed the part count");
for (let i = 0; i < round.length; i++) {
  assert.equal(round[i].slug, DEFAULT_BUILD[i].slug, `round-trip changed slug ${i}`);
  assert.deepEqual(round[i].must, DEFAULT_BUILD[i].must, `round-trip changed must ${i}`);
}

// Model numbers become the match filter, capped at two so the query still matches.
assert.deepEqual(parseLine("NVIDIA RTX 4070 Ti 12GB")!.must, ["4070", "12gb"]);
assert.deepEqual(parseLine("Crucial P3 Plus 1TB NVMe SSD")!.must, ["p3", "1tb"]);
// No digits anywhere: fall back to the longest word rather than matching everything.
assert.deepEqual(parseLine("Corsair cabinet")!.must, ["corsair"]);
assert.equal(parseLine("   "), null, "blank line should parse to null");
assert.equal(parseBuild("a 1\n\n a 1 \n").length, 1, "duplicates and blanks should collapse");

// Small sets pass through rather than self-filtering into junk.
assert.equal(rejectDecoys([{ price: 5 }, { price: 9000 }] as Listing[]).length, 2);

// --- optimizer ---
const { perItem, consolidated, saving } = compare(byPart);
assert.equal(perItem.picks.length, DEFAULT_BUILD.length, "per-item basket is incomplete");
assert.ok(consolidated, "no consolidated basket found — every seller set failed to cover the build");
assert.equal(consolidated.picks.length, DEFAULT_BUILD.length, "consolidated basket is incomplete");

// Shipping must scale with distinct sellers, and the subtotal must be the sum
// of the picks. These are the arithmetic the headline number rests on.
for (const b of [perItem, consolidated]) {
  assert.equal(b.shipping, b.sellers.length * SHIPPING_PER_SELLER, `${b.label}: shipping mismatch`);
  assert.equal(
    Math.round(b.subtotal),
    Math.round(b.picks.reduce((t, p) => t + p.listing.price, 0)),
    `${b.label}: subtotal mismatch`,
  );
  assert.equal(b.total, b.subtotal + b.shipping, `${b.label}: total mismatch`);
  assert.equal(b.sellers.length, new Set(b.sellers).size, `${b.label}: duplicate sellers`);
}
assert.ok(consolidated.sellers.length <= perItem.sellers.length, "consolidation used more sellers");
assert.equal(saving, perItem.total - consolidated.total);

// Each pick must actually be the cheapest listing available within its basket's sellers.
for (const b of [perItem, consolidated]) {
  const set = new Set(b.sellers);
  for (const pick of b.picks) {
    const options = byPart.get(pick.part)!.filter((l) => set.has(l.seller));
    const min = Math.min(...options.map((l) => l.price));
    assert.equal(pick.listing.price, min, `${b.label}/${pick.part.slug}: not the cheapest option`);
  }
}

// The curve must be monotonic in shipping: fewer sellers can never pay more of it.
const curve = sellerCurve(byPart);
assert.ok(curve.length >= 2, "curve needs at least two seller counts to compare");
for (let i = 1; i < curve.length; i++)
  assert.ok(curve[i].basket.shipping >= curve[i - 1].basket.shipping, "shipping not monotonic in k");

console.log(`\nok — ${bySeller.size} sellers, ${multi} carry 2+ parts`);
for (const [s, p] of [...bySeller].sort((a, b) => b[1].size - a[1].size).slice(0, 4))
  console.log(`  ${p.size}/6  ${s}`);
console.log(`\nbaskets (shipping ₹${SHIPPING_PER_SELLER}/seller):`);
console.log(`  ${perItem.label.padEnd(16)} ${perItem.sellers.length} sellers  ${inr(perItem.total)}`);
console.log(`  ${consolidated.label.padEnd(16)} ${consolidated.sellers.length} sellers  ${inr(consolidated.total)}`);
console.log(`  -> ${saving > 0 ? `consolidating saves ${inr(saving)}` : `buying per item wins by ${inr(-saving)}`}`);
for (const { k, basket } of curve)
  console.log(`  k=${k}: ${inr(basket.total)} (items ${inr(basket.subtotal)} + ship ${inr(basket.shipping)})`);
