/**
 * Smoke check over the committed fixtures: `npm run smoke`.
 * Guards the three failure modes that would silently corrupt every price on
 * screen: decoy listings, wrong-product matches, and duplicate seller identity.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_BUILD } from "../lib/parts";
import { canonicalSeller, fixtureName, normalize, rejectDecoys, relevant, type Listing } from "../lib/serp";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const bySeller = new Map<string, Set<string>>();

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

// Small sets pass through rather than self-filtering into junk.
assert.equal(rejectDecoys([{ price: 5 }, { price: 9000 }] as Listing[]).length, 2);

console.log(`\nok — ${bySeller.size} sellers, ${multi} carry 2+ parts`);
for (const [s, p] of [...bySeller].sort((a, b) => b[1].size - a[1].size).slice(0, 6))
  console.log(`  ${p.size}/6  ${s}`);
