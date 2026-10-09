# RigKart — PC build price intelligence for India

Enter a PC parts list. RigKart queries Google Shopping through SerpApi for
Indian sellers and answers the question price-comparison sites never do:

**buying every part from its own cheapest seller means paying delivery N times.**

RigKart prices the whole basket both ways — cheapest-per-item against cheapest
consolidated across the fewest sellers — and shows which actually wins in
rupees. Every lookup is snapshotted, so repeat searches show price movement.

On the current live data the answer is counterintuitive and the tool says so:
buying per item wins by **₹18,237**, because the only shops that carry the whole
build charge far more per item than five deliveries cost.

## Run it

```bash
npm install
cp .env.example .env.local   # works as-is: DEMO_MODE=true needs no keys at all
npm run dev                  # http://localhost:3000
npm run smoke                # asserts pricing, filtering and basket arithmetic
```

`DEMO_MODE=true` (the default) serves the committed fixtures in `fixtures/`, so
the app is fully demoable with **zero SerpApi credits and no Supabase project**.
Set `DEMO_MODE=false` and add `SERPAPI_KEY` for live results.

Optional, for price history: create a Supabase project, run
`supabase/001_init.sql` in its SQL editor, fill the two Supabase vars, then
`npx tsx scripts/snapshot.mts --live`. Run it twice, hours apart, and sparklines
appear. With one run or no database, history is omitted rather than faked.

## SerpApi usage

One engine, one endpoint. Everything on screen derives from it — there is no
seeded catalog and no scraped price list.

**`GET https://serpapi.com/search.json`** with `engine=google_shopping`

| Param | Value | Why |
|---|---|---|
| `engine` | `google_shopping` | Shopping results carry per-seller prices, which is the whole input to the optimizer. |
| `q` | e.g. `Ryzen 5 7600 AM5 CPU` | Per part, from `lib/parts.ts`. |
| `gl` | `in` | India as the search geography. |
| `hl` | `en` | English result language. |
| `google_domain` | `google.co.in` | **Not optional.** `gl=in` alone still searches google.com, which fills results with import resellers (ubuy.co.in, desertcart) quoting marked-up prices. The Indian domain returns the retailers builders actually use: mdcomputers.in, theitdepot, primeabgb. |
| `num` | `20` | Enough sellers per part for consolidation to have options. |

Response fields consumed, from `shopping_results[]`:
`title`, `extracted_price`, `source` (the seller), `product_link`, `thumbnail`,
`delivery`.

`extracted_price` is trusted as the price and parses Indian lakh grouping
correctly (`₹1,34,045` → `134045`). `delivery` is **not** trusted as a number —
it is free text (`"Free delivery"`, `"₹40 delivery"`) present on under a quarter
of listings, so shipping is a flat per-seller estimate instead of a fabricated
exact figure.

### What the live data forced us to handle

Each of these came out of real responses, not speculation:

1. **Decoys.** The RTX 4060 query returns genuine `₹3` and `₹4` listings from
   amazon.in. `extracted_price` is correct; they simply aren't GPUs. A naive
   `min()` picks one every time. Listings below 0.25× the set median are dropped.
2. **Loose matching.** `"AMD Ryzen 5 7600 processor"` returns Van Heusen track
   pants and H&M baby sets; the motherboard query returns keyboards. Each part
   declares `must`/`not` title tokens, plus a shared exclusion for whole
   prebuilt systems — a ₹230k gaming PC containing a Ryzen is not a CPU purchase.
3. **Order matters.** Relevance filtering runs *before* the decoy floor.
   Reversed, the floor is a fraction of a median over wrong products: the DDR5
   set medians at ₹65k, giving a ₹16k floor that deletes every correctly priced
   stick.
4. **Seller identity.** SerpApi reports `amazon.in` and `Amazon.in` as separate
   `source` values. Unmerged, the optimizer charges delivery twice for one shop —
   the exact number this product exists to get right. Seller names are canonical.

### Credit discipline

The free tier is 250 searches/month, so spending is deliberate:

- **`DEMO_MODE=true`** serves fixtures. Development and demo recording cost zero.
- **Postgres cache** (`lookups`) keys raw responses by a hash of the request
  params. One query is paid for once, ever; a repeat is a `select`.
- **`scripts/fetch-fixture.mts`** refuses to overwrite an existing fixture, so a
  stray re-run cannot quietly burn credits.

Total spend building this: ~24 searches, including the query-tuning dead ends.

## How the optimizer works

`lib/basket.ts`. Brute force over seller subsets: with ~35 sellers that is
35 + 595 + 6,545 combinations for up to 3 shops, each scored across six parts —
11ms, and exactly optimal within the cap rather than a greedy guess. The
seller-count curve is the real output: delivery falls as you consolidate while
item prices rise, and the chart shows where they cross for your build.

## Schema

`supabase/001_init.sql` — `parts` (catalog), `lookups` (the response cache),
`snapshots` (append-only price observations).

## Not built, deliberately

No auth, no accounts, no payments, no deployment pipeline, no admin panel. If it
isn't visible in a 3-minute demo, it isn't here.
