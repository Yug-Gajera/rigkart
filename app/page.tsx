import { SHIPPING_PER_SELLER } from "@/lib/basket";
import { BasketExplorer } from "./basket-explorer";
import { priceHistory, type Point } from "@/lib/history";
import { DEFAULT_BUILD, DEFAULT_BUILD_TEXT, parseBuild, type Part } from "@/lib/parts";
import { searchPart, type Listing } from "@/lib/serp";
import Link from "next/link";

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
        const { listings, source, fetchedAt, relaxedTo } = await searchPart(part, opts);
        return { part, listings, source, fetchedAt, relaxedTo, error: null as string | null };
      } catch (e) {
        return {
          part,
          listings: [] as Listing[],
          source: null,
          fetchedAt: "",
          relaxedTo: null,
          error: (e as Error).message,
        };
      }
    }),
  );

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

      <BasketExplorer
        rows={results.map(({ part, listings }) => ({ part, listings }))}
        initialShipping={SHIPPING_PER_SELLER}
      />

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
            {results.map(({ part, listings, error, source, relaxedTo }) => {
              const cheapest = listings.length
                ? listings.reduce((b, l) => (l.price < b.price ? l : b))
                : null;
              /**
               * A real market price has company. One seller alone at a price no
               * other shop comes near is usually a decoy or a mislisting, and
               * the decoy floor cannot catch it in a small result set — so say
               * so rather than presenting it as the market rate.
               */
              const corroborating = cheapest
                ? new Set(
                    listings.filter((l) => l.price <= cheapest.price * 2).map((l) => l.seller),
                  ).size
                : 0;
              return (
                <tr key={part.slug} className="border-b border-zinc-900">
                  <td className="py-3 pr-4">
                    {DEFAULT_BUILD.some((p) => p.slug === part.slug) ? (
                      <Link
                        href={`/part/${part.slug}`}
                        className="font-medium text-zinc-100 underline decoration-zinc-700 underline-offset-2 hover:decoration-zinc-400"
                      >
                        {part.label}
                      </Link>
                    ) : (
                      <div className="font-medium text-zinc-100">{part.label}</div>
                    )}
                    <div className="text-xs uppercase text-zinc-600">
                      {part.category ?? `match: ${relaxedTo ?? part.must.join(" + ")}`}
                    </div>
                    {relaxedTo && (
                      <div className="text-xs text-amber-600/80">
                        no listing matched {part.must.join(" + ")} — relaxed to {relaxedTo}
                      </div>
                    )}
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
                    {cheapest && corroborating < 2 && (
                      <div
                        className="text-[10px] font-sans uppercase text-amber-600"
                        title="No other seller is within 2x this price — treat it as unverified"
                      >
                        uncorroborated
                      </div>
                    )}
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

        <div className="mt-4 space-y-2">
          {results
            .filter((r) => r.listings.length > 1)
            .map(({ part, listings }) => (
              <details key={part.slug} className="group rounded-lg border border-zinc-900 bg-zinc-900/30">
                <summary className="cursor-pointer list-none px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300">
                  <span className="mr-2 inline-block transition-transform group-open:rotate-90">▸</span>
                  all {listings.length} offers for {part.label}
                </summary>
                <table className="w-full px-3 pb-2 text-xs">
                  <tbody>
                    {[...listings]
                      .sort((a, b) => a.price - b.price)
                      .map((l, i) => (
                        <tr key={l.link + i} className="border-t border-zinc-900/80">
                          <td className="py-1.5 pl-8 pr-3 text-zinc-500">{l.seller}</td>
                          <td className="py-1.5 pr-3 text-zinc-600">
                            <a href={l.link} target="_blank" rel="noreferrer" className="hover:text-zinc-300 hover:underline">
                              {l.title.slice(0, 68)}
                            </a>
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-zinc-400">
                            {inr(l.price)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </details>
            ))}
        </div>
        {failures.length > 0 && (
          <p className="mt-3 text-xs text-amber-600/80">
            {plural(failures.length, "part")} returned nothing usable. Google Shopping matches loosely;
            parts carry title-token filters, and a query with no genuine listings is reported as
            empty rather than filled with the nearest wrong product.
          </p>
        )}
      </section>

      <footer className="mt-12 border-t border-zinc-800 pt-5 text-xs text-zinc-600">
        Delivery is a flat per-seller estimate, adjustable above. Google Shopping reports delivery
        only as free text on a minority of listings, so there is no honest per-seller figure to read
        here — the per-part pages use <span className="font-mono">google_product</span>, which does
        report it. <span className="font-mono">SHIPPING_PER_SELLER</span> sets the starting value.
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
