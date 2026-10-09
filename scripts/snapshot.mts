/**
 * Capture one price snapshot of the whole build into Postgres.
 *
 *   npx tsx scripts/snapshot.mts            # reuse fixtures where they exist
 *   npx tsx scripts/snapshot.mts --live     # force fresh SerpApi calls (6 credits)
 *
 * Run it twice, hours apart, and the UI has real price movement to show. Every
 * listing is stored, not just the cheapest, so the basket optimizer can be
 * replayed against any past run.
 *
 * Fixtures are written only when absent, so --live refreshes prices for the
 * history without invalidating the committed DEMO_MODE fixtures.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { DEFAULT_BUILD } from "../lib/parts";
import { fixtureName, normalize, shoppingSearch } from "../lib/serp";

const live = process.argv.includes("--live");

if (!db) throw new Error("Supabase env vars missing — snapshots need a database");

let credits = 0;
const rows: any[] = [];

for (const part of DEFAULT_BUILD) {
  const file = path.join("fixtures", `${fixtureName(part.searchTerm)}.json`);
  const haveFixture = existsSync(file);

  // Without --live, an existing fixture is a real timestamped observation
  // already — reuse it rather than paying for the same data twice.
  const { listings, source, fetchedAt } = await shoppingSearch(part.searchTerm, {
    live: live || !haveFixture,
    refresh: live,
  });
  if (source === "live") credits++;

  if (!haveFixture && source === "live") {
    // Re-fetch of the raw payload is free here: shoppingSearch already cached it.
    console.log(`  (no fixture for ${part.slug}; run fetch-fixture.mts to commit one)`);
  }

  const captured_at = /^\d{4}-/.test(fetchedAt) ? fetchedAt : new Date().toISOString();
  for (const l of listings) {
    rows.push({
      part_slug: part.slug,
      seller: l.seller,
      title: l.title.slice(0, 300),
      price_inr: l.price,
      link: l.link,
      captured_at,
    });
  }

  const cheapest = listings.reduce((b, l) => (l.price < b.price ? l : b));
  console.log(
    `${part.slug.padEnd(16)} ${String(listings.length).padStart(3)} listings  ` +
    `cheapest ₹${cheapest.price.toLocaleString("en-IN")} @ ${cheapest.seller}  [${source}]`,
  );
}

const { error, count } = await db.from("snapshots").insert(rows, { count: "exact" });
if (error) throw new Error(`insert failed: ${error.message}`);

console.log(`\ninserted ${count ?? rows.length} snapshot rows, ${credits} SerpApi credits spent`);
