# RigKart — PC build price intelligence for India

Enter a PC parts list. RigKart queries Google Shopping through SerpApi for
Indian sellers and answers the question price-comparison sites never do:

**buying every part from its own cheapest seller means paying delivery N times.**

RigKart prices the whole basket both ways — cheapest-per-item against cheapest
consolidated across the fewest sellers — and shows which actually wins in rupees.

On the committed data the answer is counterintuitive, and the tool says so
rather than flattering its own premise:

| | Sellers | Items | Delivery | **Total** |
|---|---|---|---|---|
| Cheapest per item | 6 | ₹89,026 | ₹2,400 | **₹91,426** |
| Cheapest consolidated | 3 | ₹98,050 | ₹1,200 | **₹99,250** |

Buying separately wins by **₹7,824** — the shops that stock everything charge
more per item than the extra deliveries cost. So the headline output is not a
verdict but a **breakeven: ₹3,008 of delivery per seller**. Below that, buy
separately; above it, consolidate. Real Indian delivery is nowhere near ₹3,008,
which is the honest answer for this build — and the slider on the page lets you
drag delivery past the crossover and watch the verdict flip.

*(Figures from `npm run smoke`, which asserts them on every run.)*

## What you see

- **A parts list you type**, one part per line. Match tokens are derived from
  model numbers, so `Crucial P3 Plus 1TB NVMe SSD` filters on `p3` + `1tb`.
- **Per-part cheapest listing**, with the seller, the number of competing
  offers, and a **source badge** — `fixture`, `cache` or `live` — so credit
  spend is never hidden. Expand any part for its full offer list.
- **The two baskets**, a draggable delivery charge, and the breakeven.
- **A seller-count curve**: delivery falls as you consolidate while item prices
  rise, and the bars show where they cross.
- **A page per part** (`/part/<slug>`) using a second SerpApi engine: every
  seller of that exact SKU with **real per-seller delivery**, plus Google's own
  dated price history.
- **Honesty markers** throughout: `uncorroborated` when no second seller comes
  within 2× of the cheapest price, `not itemised` when delivery is derived
  rather than stated, and a note when a match had to be loosened to find
  anything.

## Run it

```bash
npm install
cp .env.example .env.local   # works as-is: DEMO_MODE=true needs no keys at all
npm run dev                  # http://localhost:3000
```

Requires Node 20.6+ (the scripts use Node's own `--env-file-if-exists`).

| Script | What it does |
|---|---|
| `npm run dev` | The app, on port 3000 |
| `npm run smoke` | Asserts pricing, filtering, seller identity and basket arithmetic against the committed fixtures. No network, no keys |
| `npm run fixture "<term>"` | Spends 1 credit, commits a shopping fixture. Refuses to overwrite |
| `npm run fixture:product <slug>` | Spends 1 credit, commits a product fixture for that part |
| `npm run snapshot -- --live` | Records a price snapshot of the whole build to Postgres |

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
   The PSU is a category part for the same reason — pinned to a Corsair SKU it
   cost ₹8,699, and as a wattage band it is a Circle 500W at ₹1,829, with Ant
   Esports and Zebronics in between. **The band is deliberate**: no single
   wattage has enough Indian supply to compare (a 650W query returns one
   genuine 650W unit), so the part is a 500-650W class, every member of which
   powers this build. That is looser than like-for-like and the label says so.
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

Total spend building this: 48 searches — 23 on the shopping queries and their
dead ends, 6 on the first price snapshot, 1 live UI test, 7 on product lookups,
and a handful retargeting parts Google Shopping India does not stock.

## How the optimizer works

`lib/basket.ts`. Brute force over seller subsets: the committed data has 45
distinct sellers, so up to 3 shops is 45 + 990 + 14,190 = **15,225 combinations**,
each scored across six parts. Measured at **13.7ms**, which is why the delivery
slider can rerun the whole comparison in the browser on every drag instead of
round-tripping to the server. Exactly optimal within the cap, rather than a
greedy guess that can miss the pairing that matters.

The breakeven is not searched for — a basket's picks depend only on item prices,
so each candidate crosses the per-item basket at exact arithmetic:

```
Sp + n·S  vs  Sc + k·S    =>    S > (Sc − Sp) / (n − k)
```

taken as the minimum across every candidate, because a two-seller basket can
carry a bigger item premium yet save more deliveries and so overtake first.
`npm run smoke` asserts the crossover holds a rupee either side of it.

## Project layout

| Path | What lives there |
|---|---|
| `lib/serp.ts` | The SerpApi client, the three-tier read path, and all the filtering: decoy floor, relevance, seller canonicalisation |
| `lib/product.ts` | The `google_product` engine: per-SKU offers, real delivery, price history |
| `lib/basket.ts` | The optimizer and the breakeven. Pure functions, no I/O — which is why the slider can rerun it in the browser |
| `lib/parts.ts` | The demo build, and deriving match tokens from a typed line |
| `lib/history.ts` | Snapshot reads for the sparklines |
| `app/page.tsx` | Server component: fetches, filters, renders the table |
| `app/basket-explorer.tsx` | The only client component — the delivery slider and the comparison |
| `app/part/[slug]/page.tsx` | Per-SKU offers and the price-history chart |
| `scripts/smoke.mts` | The whole test suite, asserted against real committed responses |
| `fixtures/` | 12 committed SerpApi responses: 6 shopping, 6 product |

## Schema

`supabase/001_init.sql` — `parts` (catalog), `lookups` (the response cache,
keyed by a hash of the request params), `snapshots` (append-only price
observations).

Supabase is **optional**. With no credentials the client is `null`, the cache
and snapshot writes become no-ops, and the app runs entirely from fixtures.

## Known limits

Stated here rather than discovered by a reader:

- **Delivery on the main page is a flat estimate**, adjustable with the slider.
  `google_shopping` does not report it reliably across 40 listings. The per-part
  pages use `google_product`, which does report it, and say so.
- **The PSU is a wattage band (500-650W), not one SKU.** No single wattage has
  enough Indian supply to compare like-for-like; every member of the band powers
  this build, and the label says so.
- **The optimizer is exact up to 3 sellers.** Beyond that the subset search is
  exponential; it would need a greedy pass or a set-cover solver.
- **Price history needs two snapshot runs** to draw a sparkline. Google's own
  `price_insights` on the per-part pages is richer and needs none.

## Demo

**[Watch the 2:54 demo →](https://youtu.be/-5hlGUr-7hM)**

The video shows a live SerpApi call (the source badge going `cache` → `live`),
the two baskets, the delivery slider crossing the ₹3,008 breakeven and flipping
the verdict, and a per-part page with real per-seller delivery and Google's own
price history.

## Not built, deliberately

No auth, no accounts, no payments, no deployment pipeline, no admin panel. If it
isn't visible in a 3-minute demo, it isn't here.
