/**
 * Spend exactly one SerpApi credit and save the raw response as a fixture.
 *
 *   SERPAPI_KEY=... npx tsx scripts/fetch-fixture.ts "NVIDIA RTX 4060 8GB graphics card"
 *
 * Refuses to overwrite an existing fixture, so a stray re-run can't quietly
 * burn a credit off the 250/month budget.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fixtureName } from "../lib/serp";

const query = process.argv[2];
if (!query) throw new Error('usage: tsx scripts/fetch-fixture.ts "<search term>"');

const key = process.env.SERPAPI_KEY;
if (!key) throw new Error("SERPAPI_KEY unset");

const file = path.join("fixtures", `${fixtureName(query)}.json`);
if (existsSync(file)) {
  console.log(`${file} exists — not spending a credit. Delete it to refetch.`);
  process.exit(0);
}

const url = new URL("https://serpapi.com/search.json");
for (const [k, v] of Object.entries({
  engine: "google_shopping",
  q: query,
  gl: "in",
  hl: "en",
  num: "20",
  api_key: key,
})) url.searchParams.set(k, v);

const res = await fetch(url);
const raw = await res.json();
if (!res.ok || raw.error) throw new Error(`SerpApi ${res.status}: ${raw.error ?? ""}`);

raw.__fetched_at = new Date().toISOString();
writeFileSync(file, JSON.stringify(raw, null, 2));
console.log(
  `wrote ${file} — ${raw.shopping_results?.length ?? 0} shopping_results, ` +
  `${raw.search_metadata?.total_time_taken ?? "?"}s`,
);
