import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";

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

function paramsFor(query: string) {
  return { engine: ENGINE, q: query, gl: "in", hl: "en", num: "20" };
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

/** SerpApi `shopping_results[]` -> our shape. Drops entries with no usable price. */
function normalize(raw: any): Listing[] {
  return (raw?.shopping_results ?? [])
    .map((r: any) => ({
      title: r.title ?? "",
      price: typeof r.extracted_price === "number" ? r.extracted_price : NaN,
      seller: r.source ?? r.seller ?? "unknown",
      link: r.product_link ?? r.link ?? "",
      thumbnail: r.thumbnail,
      delivery: r.delivery,
    }))
    .filter((l: Listing) => Number.isFinite(l.price) && l.price > 0 && l.seller !== "unknown");
}

async function fromFixture(query: string) {
  const file = path.join(process.cwd(), "fixtures", `${fixtureName(query)}.json`);
  return JSON.parse(await readFile(file, "utf8"));
}

/**
 * One Google Shopping search. Order: fixture (DEMO_MODE) -> Postgres cache ->
 * live SerpApi. A live call is the only path that spends a credit, and the
 * result is written to the cache immediately so the same query never costs twice.
 */
export async function shoppingSearch(
  query: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<SearchResult> {
  const params = paramsFor(query);
  const hash = hashOf(params);

  if (DEMO_MODE) {
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
  if (!key) throw new Error("SERPAPI_KEY is unset and DEMO_MODE is false");

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
