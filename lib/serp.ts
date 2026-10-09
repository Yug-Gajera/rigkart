import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import type { Part } from "./parts";

const DEMO_MODE = process.env.DEMO_MODE !== "false";

/** The only SerpApi engine this project uses. */
const ENGINE = "google_shopping";

export type Listing = {
  title: string;
  /** Rupees. SerpApi gives `extracted_price` as a number when it can parse it. */
  price: number;
  seller: string;
  link: string;
  thumbnail?: string;
  delivery?: string;
};

export type SearchResult = {
  query: string;
  listings: Listing[];
  /** Where the bytes came from — surfaced in the UI so credit use is honest. */
  source: "fixture" | "cache" | "live";
  fetchedAt: string;
};

/**
 * `gl=in` alone is not enough: SerpApi still searches google.com, which fills
 * the results with import resellers (ubuy.co.in, desertcart) quoting marked-up
 * prices. `google_domain=google.co.in` returns the retailers Indian builders
 * actually buy from — mdcomputers.in, primeabgb, Computech.
 */
function paramsFor(query: string) {
  return { engine: ENGINE, q: query, gl: "in", hl: "en", num: "20", google_domain: "google.co.in" };
}

function hashOf(params: Record<string, string>) {
  return createHash("sha256")
    .update(JSON.stringify(Object.entries(params).sort()))
    .digest("hex")
    .slice(0, 32);
}

export function fixtureName(query: string) {
  return query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * SerpApi reports the same shop under different spellings — this build's
 * fixtures contain both "amazon.in" and "Amazon.in". Left unmerged, the basket
 * optimizer treats them as two shops and charges shipping twice, which is
 * exactly the number the whole product exists to get right.
 */
export function canonicalSeller(raw: string) {
  return raw.trim().toLowerCase().replace(/^www\./, "");
}

/** Rupees. Decoy listings sit far below the real market price, so use median. */
const DECOY_FLOOR_RATIO = 0.25;

function median(ns: number[]) {
  const s = [...ns].sort((a, b) => a - b);
  const m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
}

/**
 * Google Shopping mixes decoys into real results. The live RTX 4060 query came
 * back with a "₹3" and a "₹4" listing from amazon.in — accessories or price
 * bait, not GPUs. `extracted_price` parses them perfectly; they are simply not
 * the product. A naive min() picks one every time, so drop anything sitting far
 * below the median of the result set.
 *
 * ponytail: median floor, self-calibrating per query, no per-category table to
 * maintain. If a legitimately cheap tier ever gets dropped, upgrade to matching
 * title tokens against the query instead.
 */
export function rejectDecoys(listings: Listing[]): Listing[] {
  if (listings.length < 4) return listings; // too few to infer a market price
  const floor = median(listings.map((l) => l.price)) * DECOY_FLOOR_RATIO;
  return listings.filter((l) => l.price >= floor);
}

/** SerpApi `shopping_results[]` -> our shape. Drops unpriced rows only. */
export function normalize(raw: any): Listing[] {
  const listings = (raw?.shopping_results ?? [])
    .map((r: any) => ({
      title: r.title ?? "",
      price: typeof r.extracted_price === "number" ? r.extracted_price : NaN,
      seller: canonicalSeller(r.source ?? r.seller ?? "unknown"),
      link: r.product_link ?? r.link ?? "",
      thumbnail: r.thumbnail,
      delivery: r.delivery,
    }))
    .filter((l: Listing) => Number.isFinite(l.price) && l.price > 0 && l.seller !== "unknown");
  return listings;
}

async function fromFixture(query: string) {
  const file = path.join(process.cwd(), "fixtures", `${fixtureName(query)}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(
      `no committed fixture for this search. Run \`npm run fixture "${query}"\` ` +
        `(1 SerpApi credit) or set DEMO_MODE=false to search live.`,
    );
  }
}

/**
 * One Google Shopping search. Order: fixture (DEMO_MODE) -> Postgres cache ->
 * live SerpApi. A live call is the only path that spends a credit, and the
 * result is written to the cache immediately so the same query never costs twice.
 */
export async function shoppingSearch(
  query: string,
  { refresh = false, live = false }: { refresh?: boolean; live?: boolean } = {},
): Promise<SearchResult> {
  const params = paramsFor(query);
  const hash = hashOf(params);

  if (DEMO_MODE && !live) {
    const raw = await fromFixture(query);
    return { query, listings: normalize(raw), source: "fixture", fetchedAt: raw.__fetched_at ?? "fixture" };
  }

  if (!refresh && db) {
    const { data } = await db
      .from("lookups")
      .select("raw, created_at")
      .eq("query_hash", hash)
      .maybeSingle();
    if (data) {
      return { query, listings: normalize(data.raw), source: "cache", fetchedAt: data.created_at };
    }
  }

  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY is unset — a live search needs a key");

  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries({ ...params, api_key: key })) url.searchParams.set(k, v);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`SerpApi ${res.status}: ${await res.text()}`);
  const raw = await res.json();
  if (raw.error) throw new Error(`SerpApi: ${raw.error}`);

  const fetchedAt = new Date().toISOString();
  if (db) {
    await db.from("lookups").upsert(
      { query_hash: hash, params, raw, created_at: fetchedAt },
      { onConflict: "query_hash" },
    );
  }
  return { query, listings: normalize(raw), source: "live", fetchedAt };
}

/**
 * Whole systems that merely *contain* the part. The "Ryzen 5 7600" query came
 * back with ₹79k-₹230k prebuilt gaming PCs, which are not a CPU purchase.
 * Shared across every part, since no component search wants them.
 */
const PREBUILT = [
  "prebuilt", "pre", "desktop", "pc", "laptop", "workstation", "računalo", "combo", "bundle",
];

/** Keep only listings that are plausibly the requested part itself. */
export function relevant(listings: Listing[], part: Part): Listing[] {
  const word = (t: string) => new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`, "i");
  return listings.filter((l) => {
    const title = l.title.toLowerCase();
    if (!part.must.every((t) => title.includes(t.toLowerCase()))) return false;
    if (PREBUILT.some((t) => word(t).test(title))) return false;
    return !(part.not ?? []).some((t) => word(t).test(title));
  });
}

/** `shoppingSearch` plus part-aware relevance filtering. Use this, not the raw search. */
/**
 * `shoppingSearch` plus filtering, in the order that matters: relevance FIRST,
 * then the decoy floor. Reversed, the floor is computed over a result set full
 * of wrong products — the DDR5 query medians at ₹65k, giving a ₹16k floor that
 * would delete every correctly-priced 16GB stick. Use this, not the raw search.
 */
export async function searchPart(part: Part, opts: { refresh?: boolean; live?: boolean } = {}) {
  const result = await shoppingSearch(part.searchTerm, opts);
  return { ...result, listings: rejectDecoys(relevant(result.listings, part)) };
}
