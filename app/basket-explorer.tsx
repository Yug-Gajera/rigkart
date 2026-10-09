"use client";

import { useMemo, useState } from "react";
import { breakevenShipping, compare, sellerCurve, type Basket } from "@/lib/basket";
import type { Part } from "@/lib/parts";
import type { Listing } from "@/lib/serp";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The comparison, with delivery as a dial rather than an env var.
 *
 * The optimizer is pure arithmetic over a few hundred listings, so it reruns in
 * the browser on every drag — no round trip and no extra SerpApi calls. Moving
 * the slider past the breakeven flips the verdict, which is the whole argument
 * of the project made visible.
 */
export function BasketExplorer({
  rows,
  initialShipping,
}: {
  rows: { part: Part; listings: Listing[] }[];
  initialShipping: number;
}) {
  const [shipping, setShipping] = useState(initialShipping);

  const byPart = useMemo(() => new Map(rows.map((r) => [r.part, r.listings])), [rows]);
  const { perItem, consolidated, saving } = useMemo(
    () => compare(byPart, shipping),
    [byPart, shipping],
  );
  const curve = useMemo(() => sellerCurve(byPart, 3, shipping), [byPart, shipping]);
  // Every candidate basket, not just today's winner — a different seller count
  // can cross first.
  const breakeven = useMemo(
    () => breakevenShipping(perItem, curve.map((c) => c.basket)),
    [perItem, curve],
  );

  if (!consolidated) return null;

  const tied = Math.abs(saving) < 1;
  const consolidating = saving > 0;
  /**
   * The slider must be able to reach the crossover, or the control cannot
   * demonstrate the thing it exists to demonstrate. Real Indian delivery sits
   * well under ₹500, so a breakeven far above that is itself the finding —
   * the range stretches rather than hiding it.
   */
  const sliderMax = Math.max(1500, Math.ceil(((breakeven ?? 0) * 1.3) / 500) * 500);

  return (
    <>
      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Shipping is charged per seller
          </h2>
          <label className="flex items-center gap-3 text-xs text-zinc-500">
            <span>delivery per seller</span>
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={50}
              value={shipping}
              onChange={(e) => setShipping(Number(e.target.value))}
              className="h-1 w-48 cursor-pointer accent-emerald-500"
              aria-label="Delivery charge per seller, in rupees"
            />
            <span className="w-16 text-right font-mono tabular-nums text-zinc-200">
              {inr(shipping)}
            </span>
            {shipping !== initialShipping && (
              <button
                type="button"
                onClick={() => setShipping(initialShipping)}
                className="text-zinc-600 hover:text-zinc-300"
                title={`Back to ${inr(initialShipping)}`}
              >
                reset
              </button>
            )}
          </label>
        </div>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Card basket={perItem} winner={!tied && !consolidating} />
          <Card basket={consolidated} winner={!tied && consolidating} />
        </div>

        <p className="mt-4 text-sm text-zinc-300">
          {tied ? (
            <>Same total either way at {inr(shipping)} delivery.</>
          ) : consolidating ? (
            <>
              Consolidating to {plural(consolidated.sellers.length, "seller")} saves{" "}
              <span className="font-mono font-semibold text-emerald-400">{inr(saving)}</span>.
            </>
          ) : (
            <>
              Buying each part from its own cheapest seller wins by{" "}
              <span className="font-mono font-semibold text-emerald-400">{inr(-saving)}</span>.
            </>
          )}{" "}
          {breakeven === null ? (
            <span className="text-zinc-500">
              Consolidating is cheaper at any delivery charge, including free.
            </span>
          ) : (
            <span className="text-zinc-400">
              The crossover is{" "}
              <button
                type="button"
                onClick={() => setShipping(Math.ceil(breakeven / 50) * 50)}
                className="font-mono font-semibold text-amber-400 underline decoration-amber-700
                           underline-offset-2 hover:decoration-amber-400"
                title="Set the slider to the breakeven"
              >
                {inr(breakeven)}
              </button>{" "}
              per seller — below that, buying separately wins; above it, consolidating does.
            </span>
          )}
        </p>
      </section>

      <Curve curve={curve} perItem={perItem} breakeven={breakeven} shipping={shipping} />
    </>
  );
}

function Card({ basket, winner }: { basket: Basket; winner: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
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
      <dt className="shrink-0">{k}</dt>
      <dd className={`text-right text-zinc-400 ${mono ? "font-mono tabular-nums" : ""}`}>{v}</dd>
    </div>
  );
}

function Curve({
  curve,
  perItem,
  breakeven,
  shipping,
}: {
  curve: { k: number; basket: Basket }[];
  perItem: Basket;
  breakeven: number | null;
  shipping: number;
}) {
  // Key by sellers actually used, not the cap: a cap of 3 can still produce a
  // 1-seller basket, which would otherwise render as identical bars.
  const best = new Map<number, Basket>();
  for (const { basket } of [...curve, { basket: perItem }]) {
    const n = basket.sellers.length;
    if (!best.has(n) || basket.total < best.get(n)!.total) best.set(n, basket);
  }
  const rows = [...best.entries()].sort((a, b) => a[0] - b[0]);
  if (rows.length < 2) return null;

  const max = Math.max(...rows.map(([, b]) => b.total));
  const cheapest = Math.min(...rows.map(([, b]) => b.total));

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Total by number of sellers
      </h2>
      <p className="mt-1 text-xs text-zinc-600">
        Delivery falls as you consolidate; item prices rise.{" "}
        {breakeven !== null && (
          <>
            At {inr(shipping)} per seller the bars below show today&rsquo;s answer; past{" "}
            {inr(breakeven)} the order reverses.
          </>
        )}
      </p>
      <div className="mt-4 space-y-2">
        {rows.map(([n, basket]) => (
          <div key={n} className="flex items-center gap-3 text-xs">
            <span className="w-32 shrink-0 text-zinc-500">
              {plural(n, "seller")}
              {n === perItem.sellers.length && <span className="text-zinc-700"> · per item</span>}
            </span>
            <div className="flex h-6 flex-1 overflow-hidden rounded bg-zinc-900" title={`items ${inr(basket.subtotal)} + delivery ${inr(basket.shipping)}`}>
              <div
                className="h-full bg-sky-900/70 transition-all"
                style={{ width: `${(basket.subtotal / max) * 100}%` }}
              />
              <div
                className="h-full bg-amber-600/70 transition-all"
                style={{ width: `${(basket.shipping / max) * 100}%` }}
              />
            </div>
            <span
              className={`w-24 shrink-0 text-right font-mono tabular-nums ${
                basket.total === cheapest ? "font-semibold text-emerald-400" : "text-zinc-300"
              }`}
            >
              {inr(basket.total)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-zinc-600">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-900/70" />
          items
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-600/70" />
          delivery
        </span>
      </div>
    </section>
  );
}
