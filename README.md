# RigKart — PC build price intelligence for India

Enter a PC parts list. RigKart queries Google Shopping (via SerpApi, `gl=in`)
for Indian sellers and answers the question price comparison sites never do:

**buying every part from its own cheapest seller means paying shipping N times.**
RigKart compares *cheapest-per-item* against *cheapest consolidated across the
fewest sellers* and shows the real rupee difference.

It also snapshots every lookup, so repeat searches show price movement.

## Run it

```bash
npm install
cp .env.example .env.local   # DEMO_MODE=true works with no keys at all
npm run dev
```

Open http://localhost:3000.

`DEMO_MODE=true` (the default) serves committed fixture JSON — the app is fully
demoable with zero SerpApi credits and no Supabase project. Set it to `false`
and fill in `SERPAPI_KEY` for live results.

## SerpApi usage

<!-- TODO: endpoints + params table -->

## Schema

`supabase/001_init.sql` — run it in the Supabase SQL editor.

## Not built (deliberately)

No auth, no deployment, no admin. Hackathon scope.
