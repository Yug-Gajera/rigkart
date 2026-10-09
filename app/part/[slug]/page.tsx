import Link from "next/link";
import { notFound } from "next/navigation";
import { DEFAULT_BUILD } from "@/lib/parts";
import { productOffers, type Offer, type PricePoint } from "@/lib/product";
import { searchPart } from "@/lib/serp";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Categorical slots 1-4, dark-mode steps, validated as a set against this
 * surface (lightness band, chroma floor, CVD separation, normal-vision floor,
 * contrast). Assigned in fixed order and never cycled — a fifth seller folds
 * into the table instead of inventing a hue.
 */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const MAX_SERIES = SERIES.length;

export default async function PartPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ live?: string }>;
}) {
  const { slug } = await params;
  const part = DEFAULT_BUILD.find((p) => p.slug === slug);
  if (!part) notFound();

  const live = (await searchParams).live !== undefined;
  const opts = { live, refresh: false };

  let view: Awaited<ReturnType<typeof productOffers>> | null = null;
  let error: string | null = null;
  try {
    // The product engine needs a token from a shopping result, so the SKU shown
    // here is the cheapest listing that carries one.
    const { listings } = await searchPart(part, opts);
    const pick = listings.filter((l) => l.pageToken).sort((a, b) => a.price - b.price)[0];
    view = await productOffers(slug, pick?.pageToken ?? "", opts);
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
        ← back to the build
      </Link>

      <header className="mt-3 border-b border-zinc-800 pb-5">
        <h1 className="text-xl font-semibold tracking-tight">{part.label}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {view?.title || "Offers for one exact SKU"}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          <span className="font-mono text-zinc-300">engine=google_product</span> — who sells this
          one product, and for how much delivered.{" "}
          {view && (
            <>
              source <span className="font-mono text-zinc-300">{view.source}</span>
              {view.priceRange && <> · Google&rsquo;s range {view.priceRange}</>}
            </>
          )}
        </p>
      </header>

      {error && (
        <p className="mt-6 rounded-lg border border-amber-900/60 bg-amber-950/20 p-4 text-sm text-amber-400">
          {error}
        </p>
      )}

      {view && <Offers offers={view.offers} />}
      {view && <History history={view.history} />}

      <footer className="mt-12 border-t border-zinc-800 pt-5 text-xs text-zinc-600">
        Shipping here is <strong className="font-medium text-zinc-400">not</strong> an estimate —
        `google_product` reports it per seller, so these totals are what each shop actually charges.
        The basket optimizer on the main page still uses a flat per-seller figure, because
        `google_shopping` does not expose delivery reliably across 40 listings.
      </footer>
    </main>
  );
}

function Offers({ offers }: { offers: Offer[] }) {
  if (!offers.length) {
    return <p className="mt-6 text-sm text-zinc-500">This SKU reported no sellers.</p>;
  }
  const byTotal = [...offers].sort((a, b) => a.total - b.total);
  const cheapestItem = Math.min(...offers.map((o) => o.price));
  const bestTotal = byTotal[0];
  // The point of the whole project: the cheapest sticker price is not always
  // the cheapest delivered price.
  const flipped = bestTotal.price !== cheapestItem;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Sellers of this exact SKU
      </h2>
      {flipped && (
        <p className="mt-2 text-sm text-emerald-400">
          Delivery changes the ranking: the lowest sticker price is {inr(cheapestItem)}, but the
          cheapest delivered is {inr(bestTotal.total)} from {bestTotal.seller}.
        </p>
      )}
      <table className="mt-3 w-full text-sm">
        <thead className="text-xs uppercase text-zinc-600">
          <tr className="border-b border-zinc-800">
            <th className="py-2 text-left font-medium">Seller</th>
            <th className="py-2 text-right font-medium">Item</th>
            <th className="py-2 text-right font-medium">Delivery</th>
            <th className="py-2 pr-4 text-right font-medium">Total</th>
            <th className="py-2 pl-4 text-left font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {byTotal.map((o, i) => (
            <tr key={o.seller + i} className="border-b border-zinc-900">
              <td className="py-3 pr-4">
                <a
                  href={o.link}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-zinc-100 hover:underline"
                >
                  {o.seller}
                </a>
                {o.tag && (
                  <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                    {o.tag}
                  </span>
                )}
                {o.rating && (
                  <div className="text-xs text-zinc-600">
                    {o.rating}★ ({o.reviews})
                  </div>
                )}
              </td>
              <td className="py-3 text-right font-mono tabular-nums text-zinc-400">
                {inr(o.price)}
              </td>
              <td className="py-3 text-right font-mono tabular-nums">
                {!Number.isFinite(o.shipping) ? (
                  <span className="text-amber-600" title="Seller reported no delivery charge and no total">
                    unknown
                  </span>
                ) : !o.shippingStated ? (
                  <span
                    className="text-zinc-500"
                    title="Seller itemised no delivery charge; derived from Google's delivered total"
                  >
                    {o.shipping === 0 ? "not itemised" : inr(o.shipping)}
                  </span>
                ) : o.shipping === 0 ? (
                  <span className="text-emerald-400">free</span>
                ) : (
                  <span className="text-zinc-400">{inr(o.shipping)}</span>
                )}
              </td>
              <td
                className={`py-3 pr-4 text-right font-mono tabular-nums ${
                  i === 0 ? "font-semibold text-emerald-400" : "text-zinc-300"
                }`}
              >
                {Number.isFinite(o.total) ? inr(o.total) : "—"}
              </td>
              <td className="py-3 pl-4 text-xs text-zinc-600">{o.notes.join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Per-seller price over time, straight from `price_insights`. Bounds are rounded
 * out to a readable step rather than tightly padded, so the axis labels are
 * numbers a reader recognises. Line chart, so identity is carried by a legend
 * plus a direct label at each series' last point, never by color alone.
 */
function History({ history }: { history: { seller: string; points: PricePoint[] }[] }) {
  const series = history
    .filter((s) => s.points.length >= 2)
    .sort((a, b) => b.points.length - a.points.length)
    .slice(0, MAX_SERIES);

  if (!series.length) {
    return (
      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Price history</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Google reported no multi-point price history for this SKU. Nothing is drawn rather than a
          trend inferred from a single observation.
        </p>
      </section>
    );
  }

  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => +new Date(p.date));
  const ys = all.map((p) => p.price);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [lo, hi] = [Math.min(...ys), Math.max(...ys)];
  // Round the bounds out to a readable step, so the axis reads ₹5,000 rather
  // than ₹316 — padding alone produces arbitrary-looking numbers.
  const step = Math.pow(10, Math.floor(Math.log10(hi - lo || hi))) / 2;
  const yLo = Math.max(0, Math.floor((lo - (hi - lo) * 0.1) / step) * step);
  const yHi = Math.ceil((hi + (hi - lo) * 0.1) / step) * step;

  const W = 760;
  const H = 300;
  const M = { top: 16, right: 132, bottom: 32, left: 64 };
  const px = (t: number) =>
    M.left + ((t - x0) / (x1 - x0 || 1)) * (W - M.left - M.right);
  const py = (v: number) =>
    M.top + (1 - (v - yLo) / (yHi - yLo || 1)) * (H - M.top - M.bottom);

  const ticks = [yLo, (yLo + yHi) / 2, yHi];
  // "Oct 25" reads as a day; spell the year out.
  const fmtDate = (t: number) =>
    new Date(t).toLocaleDateString("en-IN", { month: "short", year: "numeric" });

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Price history, per seller
      </h2>
      <p className="mt-1 text-xs text-zinc-600">
        Reported by <span className="font-mono">price_insights</span> — real dated observations, not
        our own snapshots.
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={py(t)} y2={py(t)} stroke="#27272a" strokeWidth="1" />
            <text x={M.left - 8} y={py(t) + 4} textAnchor="end" fill="#71717a" fontSize="11" fontFamily="ui-monospace, monospace">
              {inr(t)}
            </text>
          </g>
        ))}
        {[x0, x1].map((t, i) => (
          <text key={t} x={px(t)} y={H - 10} textAnchor={i === 0 ? "start" : "end"} fill="#71717a" fontSize="11">
            {fmtDate(t)}
          </text>
        ))}

        {series.map((s, i) => {
          const colour = SERIES[i];
          const pts = s.points.map((p) => [px(+new Date(p.date)), py(p.price)] as const);
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.seller}>
              <polyline
                points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke={colour}
                strokeWidth="2"
                strokeLinecap="round"
              />
              {pts.map(([x, y], j) => (
                <circle key={j} cx={x} cy={y} r="4" fill={colour} stroke="#09090b" strokeWidth="2">
                  <title>{`${s.seller} · ${s.points[j].date} · ${inr(s.points[j].price)}`}</title>
                </circle>
              ))}
              <text
                x={W - M.right + 10}
                y={py(last.price) + 4}
                fill="#a1a1aa"
                fontSize="11"
                fontFamily="ui-monospace, monospace"
              >
                {inr(last.price)}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
        {series.map((s, i) => (
          <li key={s.seller} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: SERIES[i] }} />
            {s.seller}
            <span className="text-zinc-600">({s.points.length} obs)</span>
          </li>
        ))}
      </ul>
      {history.length > series.length && (
        <p className="mt-2 text-xs text-zinc-600">
          {history.length - series.length} further seller(s) had too few observations to plot.
        </p>
      )}
    </section>
  );
}
