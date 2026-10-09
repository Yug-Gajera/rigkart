/**
 * Spend one SerpApi credit on the google_product endpoint for a part's cheapest
 * SKU, and commit the raw response as a fixture.
 *
 *   npm run fixture:product rtx-4060        # one part
 *   npm run fixture:product --all           # every part missing a fixture
 *
 * Refuses to overwrite, so a stray re-run cannot burn credits.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_BUILD } from "../lib/parts";
import { productFixture, productParams } from "../lib/product";
import { fixtureName, normalize, rejectDecoys, relevant } from "../lib/serp";

const key = process.env.SERPAPI_KEY;
if (!key) throw new Error("SERPAPI_KEY unset");

const args = process.argv.slice(2);
const all = args.includes("--all");
const wanted = all ? DEFAULT_BUILD : DEFAULT_BUILD.filter((p) => args.includes(p.slug));
if (!wanted.length) {
  throw new Error(
    `usage: npm run fixture:product <slug|--all>\\nslugs: ${DEFAULT_BUILD.map((p) => p.slug).join(", ")}`,
  );
}

let spent = 0;
for (const part of wanted) {
  const out = path.join("fixtures", `${productFixture(part.slug)}.json`);
  if (existsSync(out)) {
    console.log(`${part.slug.padEnd(16)} fixture exists — skipping`);
    continue;
  }

  const shopping = path.join("fixtures", `${fixtureName(part.searchTerm)}.json`);
  if (!existsSync(shopping)) {
    console.log(`${part.slug.padEnd(16)} no shopping fixture yet — run \`npm run fixture\` first`);
    continue;
  }

  const listings = rejectDecoys(relevant(normalize(JSON.parse(readFileSync(shopping, "utf8"))), part));
  // The cheapest listing that actually carries a product token.
  const pick = listings
    .filter((l) => l.pageToken)
    .sort((a, b) => a.price - b.price)[0];
  if (!pick) {
    console.log(`${part.slug.padEnd(16)} no listing exposes a product token — skipping`);
    continue;
  }

  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries({ ...productParams(pick.pageToken!), api_key: key }))
    url.searchParams.set(k, v);

  const res = await fetch(url);
  const raw = await res.json();
  if (!res.ok || raw.error) throw new Error(`SerpApi ${res.status}: ${raw.error ?? ""}`);
  spent++;

  raw.__fetched_at = new Date().toISOString();
  raw.__part_slug = part.slug;
  writeFileSync(out, JSON.stringify(raw, null, 2));
  const pr = raw.product_results ?? {};
  console.log(
    `${part.slug.padEnd(16)} ${(pr.stores ?? []).length} stores, ` +
      `${(pr.price_insights?.stores ?? []).length} with history — "${(pr.title ?? "").slice(0, 40)}"`,
  );
}
console.log(`\n${spent} SerpApi credit(s) spent`);
