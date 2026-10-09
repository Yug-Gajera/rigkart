import { SHIPPING_PER_SELLER, compare, sellerCurve, type Basket } from "@/lib/basket";
import { priceHistory, type Point } from "@/lib/history";
import { DEFAULT_BUILD, type Part } from "@/lib/parts";
import { searchPart, type Listing } from "@/lib/serp";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default async function Home() {
  const results = await Promise.all(
    DEFAULT_BUILD.map(async (part) => {
      try {
        const { listings, source, fetchedAt } = await searchPart(part);
        return { part, listings, source, fetchedAt, error: null as string | null };
      } catch (e) {
        return { part, listings: [] as Listing[], source: null, fetchedAt: "", error: (e as Error).message };
      }
    }),
  );

  const byPart = new Map<Part, Listing[]>(results.map((r) => [r.part, r.listings]));
  const { perItem, consolidated, saving } = compare(byPart);
  const curve = sellerCurve(byPart);
  const history = Object.fromEntries(
    await Promise.all(DEFAULT_BUILD.map(async (p) => [p.slug, await priceHistory(p.slug)] as const)),
  ) as Record<string, Point[]>;

  const source = results.find((r) => r.source)?.source ?? "none";
  const failures = results.filter((r) => r.error || !r.listings.length);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">RigKart</h1>
          <p className="mt-1 text-sm text-zinc-400">
            PC build price intelligence for India · Google Shopping via SerpApi
          </p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div>
            data source <span className="font-mono text-zinc-300">{source}</span>
          </div>
          <div className="mt-0.5">
            <span className="font-mono text-zinc-300">gl=in</span> ·{" "}
            <span className="font-mono text-zinc-300">google_domain=google.co.in</span>
          </div>
        </div>
      </header>

      {consolidated && <Verdict perItem={perItem} consolidated={consolidated} saving={saving} />}

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">The build</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-xs uppercase text-zinc-600">
            <tr className="border-b border-zinc-800">
              <th className="py-2 text-left font-medium">Part</th>
              <th className="py-2 text-left font-medium">Cheapest seller</th>
              <th className="py-2 text-right font-medium">Price</th>
              <th className="py-2 text-right font-medium">Offers</th>
              <th className="py-2 text-right font-medium">History</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ part, listings, error }) => {
              const cheapest = listings.length
                ? listings.reduce((b, l) => (l.price < b.price ? l : b))
                : null;
              return (
                <tr key={part.slug} className="border-b border-zinc-900">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-zinc-100">{part.label}</div>
                    <div className="text-xs uppercase text-zinc-600">{part.category}</div>
                  </td>
                  <td className="py-3 pr-4 text-zinc-400">
                    {cheapest ? (
                      <a href={cheapest.link} target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline">
                        {cheapest.seller}
                      </a>
                    ) : (
                      <span className="text-amber-500">{error ?? "no matching listings"}</span>
                    )}
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums">
                    {cheapest ? inr(cheapest.price) : "—"}
                  </td>
                  <td className="py-3 text-right font-mono text-zinc-600">{listings.length || "—"}</td>
                  <td className="py-3 text-right">
                    <Spark points={history[part.slug] ?? []} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {failures.length > 0 && (
          <p className="mt-3 text-xs text-amber-600/80">
            {failures.length} part(s) returned nothing usable. Google Shopping matches loosely;
            parts carry title-token filters, and a query with no genuine listings is reported as
            empty rather than filled with the nearest wrong product.
          </p>
        )}
      </section>

      {curve.length > 1 && <Curve curve={curve} perItem={perItem} />}

      <footer className="mt-12 border-t border-zinc-800 pt-5 text-xs text-zinc-600">
        Shipping is estimated at {inr(SHIPPING_PER_SELLER)} per seller. Google Shopping exposes
        delivery only as free text on a minority of listings, so a flat per-seller estimate is used
        rather than a fabricated exact figure. Set <span className="font-mono">SHIPPING_PER_SELLER</span> to change it.
      </footer>
    </main>
  );
}

function Verdict({ perItem, consolidated, saving }: { perItem: Basket; consolidated: Basket; saving: number }) {
  const consolidating = saving > 0;
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Shipping is charged per seller
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Card basket={perItem} winner={!consolidating} />
        <Card basket={consolidated} winner={consolidating} />
      </div>
      <p className="mt-4 text-sm text-zinc-300">
        {consolidating ? (
          <>
            Consolidating to {consolidated.sellers.length} seller(s) saves{" "}
            <span className="font-mono font-semibold text-emerald-400">{inr(saving)}</span> — the
            higher item prices cost less than {perItem.sellers.length}× delivery.
          </>
        ) : (
          <>
            Buying each part from its own cheapest seller wins by{" "}
            <span className="font-mono font-semibold text-emerald-400">{inr(-saving)}</span>. Paying
            delivery {perItem.sellers.length} times costs less than the premium the shops carrying
            the whole build charge on items.
          </>
        )}
      </p>
    </section>
  );
}

function Card({ basket, winner }: { basket: Basket; winner: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        winner ? "border-emerald-700/60 bg-emerald-950/20" : "border-zinc-800 bg-zinc-900/40"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-zinc-400">{basket.label}</span>
        {winner && <span className="text-xs font-medium uppercase text-emerald-400">cheaper</span>}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">{inr(basket.total)}</div>
      <dl className="mt-3 space-y-1 text-xs text-zinc-500">
        <Row k="items" v={inr(basket.subtotal)} />
        <Row k={`delivery × ${basket.sellers.length}`} v={inr(basket.shipping)} />
        <Row k="sellers" v={basket.sellers.join(", ")} mono={false} />
      </dl>
    </div>
  );
}

function Row({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{k}</dt>
      <dd className={`text-right text-zinc-400 ${mono ? "font-mono tabular-nums" : ""}`}>{v}</dd>
    </div>
  );
}

function Curve({ curve, perItem }: { curve: { k: number; basket: Basket }[]; perItem: Basket }) {
  const rows = [...curve.map(({ k, basket }) => ({ label: `${k} seller${k > 1 ? "s" : ""}`, basket })),
    { label: `${perItem.sellers.length} sellers (per item)`, basket: perItem }];
  const max = Math.max(...rows.map((r) => r.basket.total));
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Total by number of sellers
      </h2>
      <p className="mt-1 text-xs text-zinc-600">
        Delivery falls as you consolidate; item prices rise. This is where they cross.
      </p>
      <div className="mt-4 space-y-2">
        {rows.map(({ label, basket }) => (
          <div key={label} className="flex items-center gap-3 text-xs">
            <span className="w-36 shrink-0 text-zinc-500">{label}</span>
            <div className="flex h-6 flex-1 overflow-hidden rounded bg-zinc-900">
              <div className="h-full bg-sky-900/70" style={{ width: `${(basket.subtotal / max) * 100}%` }} />
              <div className="h-full bg-amber-600/70" style={{ width: `${(basket.shipping / max) * 100}%` }} />
            </div>
            <span className="w-24 shrink-0 text-right font-mono tabular-nums text-zinc-300">
              {inr(basket.total)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-zinc-600">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-900/70" />items</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-600/70" />delivery</span>
      </div>
    </section>
  );
}

/** Inline sparkline. Renders nothing until two runs exist — no invented trend. */
function Spark({ points }: { points: Point[] }) {
  if (points.length < 2) return <span className="text-xs text-zinc-700">—</span>;
  const prices = points.map((p) => p.min_price);
  const [lo, hi] = [Math.min(...prices), Math.max(...prices)];
  const span = hi - lo || 1;
  const d = prices
    .map((p, i) => `${(i / (prices.length - 1)) * 56},${16 - ((p - lo) / span) * 14}`)
    .join(" ");
  const delta = prices[prices.length - 1] - prices[0];
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="56" height="18" className="overflow-visible">
        <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5"
          className={delta > 0 ? "text-rose-400" : "text-emerald-400"} />
      </svg>
      <span className={`font-mono text-xs ${delta > 0 ? "text-rose-400" : "text-emerald-400"}`}>
        {delta > 0 ? "+" : ""}{inr(delta)}
      </span>
    </span>
  );
}
