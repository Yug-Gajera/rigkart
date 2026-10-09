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

Type any parts list into the page, one part per line. Three ways to run a search,
each visible in the per-part **Source** column so credit spend is never hidden:

| Button | Path | Cost |
|---|---|---|
| Price this build | committed fixtures (`DEMO_MODE=true`) | zero |
| Search live | skips fixtures, answers from the Postgres cache | zero unless the query is new |
| force fresh | bypasses the cache | 1 credit per part |

Typed parts get their match tokens derived from model numbers, so a line like
`Crucial P3 Plus 1TB NVMe SSD` filters on `p3` + `1tb`.

Optional, for price history: create a Supabase project, run
`supabase/001_init.sql` in its SQL editor, fill the two Supabase vars, then:

```bash
npm run snapshot -- --live
```

Run it twice, hours apart, and sparklines appear. With one run or no database,
history is omitted rather than faked. `npm run fixture "<search term>"` commits
a new fixture. Both scripts read `.env.local` via Node's `--env-file-if-exists`.

## SerpApi usage

Two engines, each answering a different question. Everything on screen derives
from them — there is no seeded catalog and no scraped price list.

### 1. `engine=google_shopping` — what matches these words, across sellers

**`GET https://serpapi.com/search.json`**

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
of listings, so the basket optimizer uses a flat per-seller estimate instead of
a fabricated exact figure.

### 2. `engine=google_product` — who sells THIS exact SKU, delivered

Every shopping result carries a `serpapi_product_api` URL; its `page_token` is
the handle for this engine. One call per SKU, same cache and fixture path.

| Param | Value | Why |
|---|---|---|
| `engine` | `google_product` | Collapses 40 loose listings into one product's real offers. |
| `page_token` | from `serpapi_product_api` | Identifies the SKU. |
| `offers` | `1` | Asks for the seller list. |
| `gl` / `hl` / `google_domain` | `in` / `en` / `google.co.in` | As above. |

This endpoint supplies two things `google_shopping` cannot, and both are visible
on each part's page:

- **`stores[].shipping_extracted` and `extracted_total`** — real per-seller
  delivery, not an estimate. Sellers who itemise nothing but report a delivered
  total get their shipping derived from the difference and labelled *not
  itemised*, because that is a weaker claim than *free*. A seller reporting
  neither stays **unknown** and is never silently treated as free.
- **`price_insights.stores[].prices[]`** — a dated price series per seller.
  Google's own history goes back a year: one 16GB DDR5 SKU runs from ₹5,664 to
  ₹28,190 across 74 observations, which is the 2025-26 DRAM spike in the data.

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
5. **Short tokens match too much.** Requiring `"h5"` as a substring matched
   *NZXT H510i*, a different case, and the product lookup then resolved to the
   wrong SKU entirely. Tokens under four characters are matched as whole words;
   longer ones stay substrings so `"rm650"` still finds *RM650e*.
6. **Thin coverage is reported, not padded.** The NZXT H5 Flow has essentially
   one genuine Indian listing, so that part became a brand-agnostic cabinet
   search. A query with no real listings renders empty rather than filled with
   the nearest wrong product, and a price no second seller comes within 2× of is
   labelled **uncorroborated** instead of presented as the market rate.
7. **Indian brands do not write the form factor.** Requiring `"atx"` on the
   cabinet search dropped every Ant Esports and Zebronics listing titled only
   "Mid Tower Cabinet" — including a *cheaper copy of the very model being
   shown* (₹4,625 against the ₹4,879 on screen). Category parts now match
   any-of `cabinet / case / tower`, and the cheapest case is an Ant Esports at
   ₹3,449. Ant Esports, Zebronics, Chiptronex and Gamdias all reach the results.
8. **Derived tokens get one retry.** Typing `Ant Esports VS650L 650W SMPS`
   yields `vs650l` + `650w`, but the real listing reads "VS650L 650 Watt" and
   matches neither pair. Rather than guess harder, a search that matches nothing
   retries with the single most identifying token — a model number beats a
   wattage — and the UI says the match was loosened.

### Credit discipline

The free tier is 250 searches/month, so spending is deliberate:

- **`DEMO_MODE=true`** serves fixtures. Development and demo recording cost zero.
- **Postgres cache** (`lookups`) keys raw responses by a hash of the request
  params. One query is paid for once, ever; a repeat is a `select`.
- **`scripts/fetch-fixture.mts`** refuses to overwrite an existing fixture, so a
  stray re-run cannot quietly burn credits.

Total spend building this: 44 searches — 23 on the shopping queries and their
dead ends, 6 on the first price snapshot, 1 live UI test, 7 on product lookups,
and a handful retargeting parts Google Shopping India does not stock.

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
