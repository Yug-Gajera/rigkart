import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { canonicalSeller } from "./serp";

const DEMO_MODE = process.env.DEMO_MODE !== "false";

/**
 * Second SerpApi engine. `google_shopping` answers "what matches these words,
 * across sellers and SKUs"; `google_product` answers "who sells THIS exact SKU,
 * and for how much delivered". Only the second one carries real shipping
 * figures and a dated price series, so it is what the per-part view uses.
 */
const ENGINE = "google_product";

export type Offer = {
  seller: string;
  price: number;
  /** Rupees. 0 means free delivery, NaN means genuinely unknown. */
  shipping: number;
  /**
   * False when the seller itemised no delivery charge and the figure was
   * derived from Google's delivered total. Shown differently, because "not
   * itemised" is a weaker claim than "free".
   */
  shippingStated: boolean;
  /** Price + shipping, as Google reports it. */
  total: number;
  link: string;
  inStock: boolean;
  rating?: number;
  reviews?: number;
  /** Google's own badge, e.g. "Best price". */
  tag?: string;
  notes: string[];
};

export type PricePoint = { date: string; price: number };

export type ProductView = {
  title: string;
  priceRange?: string;
  offers: Offer[];
  /** Per-seller dated price series, straight from `price_insights`. */
  history: { seller: string; points: PricePoint[] }[];
  source: "fixture" | "cache" | "live";
};

export const productFixture = (slug: string) => `product-${slug}`;

export function productParams(pageToken: string) {
  return {
    engine: ENGINE,
    page_token: pageToken,
    gl: "in",
    hl: "en",
    google_domain: "google.co.in",
    offers: "1",
  };
}

/** `"+ ₹300"` -> 300, `"Free"` -> 0. Returns null when there is nothing to read. */
export function parseShipping(raw: unknown, extracted: unknown): number | null {
  if (typeof extracted === "number") return extracted;
  if (typeof raw !== "string") return null;
  if (/free/i.test(raw)) return 0;
  const digits = raw.replace(/[^0-9.]/g, "");
  return digits ? Number(digits) : null;
}

export function normalizeProduct(raw: any): Omit<ProductView, "source"> {
  const p = raw?.product_results ?? {};
  const offers: Offer[] = (p.stores ?? [])
    .map((s: any) => {
      const price = typeof s.extracted_price === "number" ? s.extracted_price : NaN;
      const stated = parseShipping(s.shipping, s.shipping_extracted);
      const reportedTotal = typeof s.extracted_total === "number" ? s.extracted_total : NaN;
      /**
       * Some sellers itemise nothing but Google still reports a delivered total
       * — theitdepot shows ₹7,875 for both. Derive the difference rather than
       * calling it unknown, but never silently treat unknown as free: that
       * would make a seller look cheaper than it is, which is the exact mistake
       * this project exists to catch.
       */
      const shipping =
        stated ?? (Number.isFinite(reportedTotal) ? Math.max(0, reportedTotal - price) : NaN);
      const notes: string[] = s.details_and_offers ?? [];
      return {
        seller: canonicalSeller(s.name ?? ""),
        price,
        shipping,
        shippingStated: stated !== null,
        total: Number.isFinite(reportedTotal) ? reportedTotal : price + shipping,
        link: s.link ?? "",
        inStock: notes.some((n) => /in stock/i.test(n)),
        rating: s.rating,
        reviews: s.reviews,
        tag: s.tag,
        notes,
      };
    })
    .filter((o: Offer) => o.seller && Number.isFinite(o.price) && o.price > 0);

  const history = (p.price_insights?.stores ?? [])
    .map((s: any) => ({
      seller: canonicalSeller(s.name ?? ""),
      points: (s.prices ?? [])
        .filter((pt: any) => typeof pt.price === "number" && pt.date)
        .map((pt: any) => ({ date: pt.date as string, price: pt.price as number }))
        .sort((a: PricePoint, b: PricePoint) => +new Date(a.date) - +new Date(b.date)),
    }))
    .filter((s: { points: PricePoint[] }) => s.points.length > 0);

  return { title: p.title ?? "", priceRange: p.price_range, offers, history };
}

/**
 * Offers for one SKU. Same three-tier read path as the shopping search —
 * fixture under DEMO_MODE, then the Postgres cache, then one live call.
 */
export async function productOffers(
  slug: string,
  pageToken: string,
  { refresh = false, live = false }: { refresh?: boolean; live?: boolean } = {},
): Promise<ProductView> {
  if (DEMO_MODE && !live) {
    const file = path.join(process.cwd(), "fixtures", `${productFixture(slug)}.json`);
    try {
      return { ...normalizeProduct(JSON.parse(await readFile(file, "utf8"))), source: "fixture" };
    } catch {
      throw new Error(
        `no committed product fixture for "${slug}". Run \`npm run fixture:product ${slug}\` ` +
          `(1 SerpApi credit) or set DEMO_MODE=false.`,
      );
    }
  }

  const params = productParams(pageToken);
  const hash = createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 32);

  if (!refresh && db) {
    const { data } = await db.from("lookups").select("raw").eq("query_hash", hash).maybeSingle();
    if (data) return { ...normalizeProduct(data.raw), source: "cache" };
  }

  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY is unset — a live product lookup needs a key");

  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries({ ...params, api_key: key })) url.searchParams.set(k, v);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`SerpApi ${res.status}: ${await res.text()}`);
  const raw = await res.json();
  if (raw.error) throw new Error(`SerpApi: ${raw.error}`);

  if (db) {
    await db
      .from("lookups")
      .upsert(
        { query_hash: hash, params, raw, created_at: new Date().toISOString() },
        { onConflict: "query_hash" },
      );
  }
  return { ...normalizeProduct(raw), source: "live" };
}
