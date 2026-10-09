import type { Part } from "./parts";
import type { Listing } from "./serp";

/**
 * Flat per-seller delivery estimate, in rupees. Google Shopping's `delivery`
 * field is free text and present on under a quarter of listings, so there is no
 * honest per-seller number to read. The UI labels this an estimate.
 * ponytail: one flat knob. Parse `delivery` per listing if it ever gets dense.
 */
export const SHIPPING_PER_SELLER = Number(process.env.SHIPPING_PER_SELLER ?? 400);

export type Pick = { part: Part; listing: Listing };

export type Basket = {
  label: string;
  picks: Pick[];
  sellers: string[];
  subtotal: number;
  shipping: number;
  total: number;
};

function price(picks: Pick[]) {
  return picks.reduce((s, p) => s + p.listing.price, 0);
}

function build(label: string, picks: Pick[]): Basket {
  const sellers = [...new Set(picks.map((p) => p.listing.seller))].sort();
  const subtotal = price(picks);
  const shipping = sellers.length * SHIPPING_PER_SELLER;
  return { label, picks, sellers, subtotal, shipping, total: subtotal + shipping };
}

/** Cheapest listing for each part, ignoring how many sellers that spans. */
export function cheapestPerItem(byPart: Map<Part, Listing[]>): Basket {
  const picks: Pick[] = [];
  for (const [part, listings] of byPart) {
    if (!listings.length) continue;
    picks.push({ part, listing: listings.reduce((b, l) => (l.price < b.price ? l : b)) });
  }
  return build("Cheapest per item", picks);
}

/** Every combination of `arr` with exactly `k` members. */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const [head, ...rest] = arr;
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/**
 * Cheapest basket buildable from at most `maxSellers` shops, so delivery is
 * paid that many times instead of once per part.
 *
 * Brute force over seller subsets. With ~35 sellers that is 35 + 595 + 6,545
 * combinations for k up to 3, each scored over six parts — microseconds, and
 * exactly optimal within the cap, which beats a greedy heuristic that can miss
 * the pairing that matters.
 * ponytail: exact to k=3. Raising the cap is exponential; switch to greedy or
 * set-cover LP if a build ever needs more than three shops.
 */
export function bestConsolidated(byPart: Map<Part, Listing[]>, maxSellers = 3): Basket | null {
  let best: Basket | null = null;
  for (let k = 1; k <= maxSellers; k++) {
    const basket = bestForExactly(byPart, k);
    if (basket && (!best || basket.total < best.total)) best = basket;
  }
  return best;
}

/** Cheapest complete basket using at most `k` distinct sellers, or null. */
export function bestForExactly(byPart: Map<Part, Listing[]>, k: number): Basket | null {
  const parts = [...byPart.keys()].filter((p) => (byPart.get(p) ?? []).length > 0);
  const sellers = [...new Set(parts.flatMap((p) => byPart.get(p)!.map((l) => l.seller)))];
  if (k > sellers.length) return null;

  let best: Basket | null = null;
  for (const combo of combinations(sellers, k)) {
    const set = new Set(combo);
    const picks: Pick[] = [];
    for (const part of parts) {
      const within = byPart.get(part)!.filter((l) => set.has(l.seller));
      if (!within.length) break; // this seller set cannot supply the whole build
      picks.push({ part, listing: within.reduce((b, l) => (l.price < b.price ? l : b)) });
    }
    if (picks.length !== parts.length) continue;
    const basket = build(k === 1 ? "Single seller" : `${k} sellers`, picks);
    if (!best || basket.total < best.total) best = basket;
  }
  return best;
}

/**
 * Cheapest achievable total for each seller-count cap. This is the actual
 * insight: shipping falls as you consolidate while item prices rise, and the
 * curve shows where the two cross for this specific build.
 */
export function sellerCurve(byPart: Map<Part, Listing[]>, maxSellers = 3) {
  const out: { k: number; basket: Basket }[] = [];
  for (let k = 1; k <= maxSellers; k++) {
    const basket = bestForExactly(byPart, k);
    if (basket) out.push({ k, basket });
  }
  return out;
}

/** The comparison the product exists to make. */
export function compare(byPart: Map<Part, Listing[]>) {
  const perItem = cheapestPerItem(byPart);
  const consolidated = bestConsolidated(byPart);
  if (!consolidated) return { perItem, consolidated: null, saving: 0, winner: perItem };
  const saving = perItem.total - consolidated.total;
  return {
    perItem,
    consolidated,
    saving,
    winner: saving > 0 ? consolidated : perItem,
  };
}
