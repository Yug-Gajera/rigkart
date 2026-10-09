import { SHIPPING_PER_SELLER, compare, sellerCurve, type Basket } from "@/lib/basket";
import { priceHistory, type Point } from "@/lib/history";
import { DEFAULT_BUILD_TEXT, parseBuild, type Part } from "@/lib/parts";
import { searchPart, type Listing } from "@/lib/serp";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ build?: string; live?: string }>;
}) {
  const params = await searchParams;
  const text = params.build ?? DEFAULT_BUILD_TEXT;
  const build = parseBuild(text);

  /**
   * `live` bypasses the committed fixtures but still answers from the Postgres
   * cache, so pressing it repeatedly costs nothing. `live=force` bypasses the
   * cache too and is the only path that spends a credit per part.
   */
  const live = params.live !== undefined;
  const opts = { live, refresh: params.live === "force" };

  const results = await Promise.all(
    build.map(async (part) => {
      try {
        const { listings, source, fetchedAt } = await searchPart(part, opts);
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
    await Promise.all(build.map(async (p) => [p.slug, await priceHistory(p.slug)] as const)),
  ) as Record<string, Point[]>;

  const sources = [...new Set(results.map((r) => r.source).filter(Boolean))].join(" + ");
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
            data source <span className="font-mono text-zinc-300">{sources || "none"}</span>
          </div>
          <div className="mt-0.5">
            <span className="font-mono text-zinc-300">gl=in</span> ·{" "}
            <span className="font-mono text-zinc-300">google_domain=google.co.in</span>
          </div>
        </div>
      </header>

      <BuildForm text={text} live={live} />

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
              <th className="py-2 text-right font-medium">Source</th>
              <th className="py-2 text-right font-medium">History</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ part, listings, error, source }) => {
              const cheapest = listings.length
                ? listings.reduce((b, l) => (l.price < b.price ? l : b))
                : null;
              return (
                <tr key={part.slug} className="border-b border-zinc-900">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-zinc-100">{part.label}</div>
                    <div className="text-xs uppercase text-zinc-600">
                      {part.category ?? `match: ${part.must.join(" + ")}`}
                    </div>
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
                    {source ? (
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                          source === "live"
                            ? "bg-emerald-900/50 text-emerald-300"
                            : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {source}
                      </span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
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
            {plural(failures.length, "part")} returned nothing usable. Google Shopping matches loosely;
            parts carry title-token filters, and a query with no genuine listings is reported as
            empty rather than filled with the nearest wrong product.
          </p>
        )}
      </section>

      {new Set([...curve.map((c) => c.basket.sellers.length), perItem.sellers.length]).size > 1 && (
        <Curve curve={curve} perItem={perItem} />
      )}

      <footer className="mt-12 border-t border-zinc-800 pt-5 text-xs text-zinc-600">
        Shipping is estimated at {inr(SHIPPING_PER_SELLER)} per seller. Google Shopping exposes
        delivery only as free text on a minority of listings, so a flat per-seller estimate is used
        rather than a fabricated exact figure. Set <span className="font-mono">SHIPPING_PER_SELLER</span> to change it.
      </footer>
    </main>
  );
}

/**
 * Plain GET form: the build lives in the URL, so a search is shareable and
 * reloadable with no client state. One part per line.
 */
function BuildForm({ text, live }: { text: string; live: boolean }) {
  return (
    <form method="GET" className="mt-6">
      <label htmlFor="build" className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Your parts list
      </label>
      <p className="mt-1 text-xs text-zinc-600">
        One part per line. Model numbers matter — they become the match filter, which is what keeps
        Google Shopping from answering a CPU query with clothing.
      </p>
      <textarea
        id="build"
        name="build"
        rows={6}
        defaultValue={text}
        spellCheck={false}
        className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-sm
                   text-zinc-100 outline-none focus:border-zinc-600"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white"
        >
          Price this build
        </button>
        <button
          type="submit"
          name="live"
          value="1"
          className="rounded-md border border-emerald-800 px-3 py-1.5 text-sm font-medium
                     text-emerald-300 hover:bg-emerald-950/40"
        >
          Search live
        </button>
        {live && (
          <button
            type="submit"
            name="live"
            value="force"
            className="rounded-md border border-amber-800/70 px-3 py-1.5 text-xs font-medium
                       text-amber-400 hover:bg-amber-950/30"
            title="Bypasses the cache — spends one SerpApi credit per part"
          >
            force fresh (spends credits)
          </button>
        )}
        <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          reset to demo build
        </a>
      </div>
      <p className="mt-2 text-xs text-zinc-600">
        &ldquo;Search live&rdquo; skips the committed fixtures and answers from the Postgres cache,
        so pressing it repeatedly is free; only a query never seen before costs a credit.
        &ldquo;Force fresh&rdquo; bypasses the cache and always spends one per part.
      </p>
    </form>
  );
}

function Verdict({ perItem, consolidated, saving }: { perItem: Basket; consolidated: Basket; saving: number }) {
  // Sub-rupee differences are rounding, not a real verdict.
  const tied = Math.abs(saving) < 1;
  const consolidating = saving > 0;
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Shipping is charged per seller
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Card basket={perItem} winner={!tied && !consolidating} />
        <Card basket={consolidated} winner={!tied && consolidating} />
      </div>
      <p className="mt-4 text-sm text-zinc-300">
        {tied ? (
          <>
            Same total either way — {plural(perItem.sellers.length, "seller")} already covers this
            build, so there is nothing to consolidate.
          </>
        ) : consolidating ? (
          <>
            Consolidating to {plural(consolidated.sellers.length, "seller")} saves{" "}
            <span className="font-mono font-semibold text-emerald-400">{inr(saving)}</span> — the
            higher item prices cost less than paying delivery {perItem.sellers.length}×.
          </>
        ) : (
          <>
            Buying each part from its own cheapest seller wins by{" "}
            <span className="font-mono font-semibold text-emerald-400">{inr(-saving)}</span>. Paying
            delivery {perItem.sellers.length}× costs less than the premium the shops carrying the
            whole build charge on items.
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
  /**
   * Key by the sellers actually used, not the cap: a cap of 3 can still produce
   * a 1-seller basket, which would otherwise render as three identical bars.
   * Cheapest wins per distinct seller count.
   */
  const best = new Map<number, Basket>();
  for (const { basket } of [...curve, { basket: perItem }]) {
    const n = basket.sellers.length;
    if (!best.has(n) || basket.total < best.get(n)!.total) best.set(n, basket);
  }
  const rows = [...best.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, basket]) => ({
      label: n === perItem.sellers.length ? `${plural(n, "seller")} (per item)` : plural(n, "seller"),
      basket,
    }));
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
