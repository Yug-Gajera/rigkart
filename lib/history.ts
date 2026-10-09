import { db } from "./db";

export type Point = { captured_at: string; min_price: number };

/**
 * Cheapest observed price per snapshot run, oldest first. Returns [] when there
 * is no database, no table yet, or only one run — the UI simply omits history
 * rather than inventing a trend line.
 */
export async function priceHistory(partSlug: string): Promise<Point[]> {
  if (!db) return [];
  const { data, error } = await db
    .from("snapshots")
    .select("captured_at, price_inr")
    .eq("part_slug", partSlug)
    .order("captured_at", { ascending: true });
  if (error || !data) return [];

  const byRun = new Map<string, number>();
  for (const row of data) {
    const at = row.captured_at as string;
    const price = Number(row.price_inr);
    if (!byRun.has(at) || price < byRun.get(at)!) byRun.set(at, price);
  }
  return [...byRun].map(([captured_at, min_price]) => ({ captured_at, min_price }));
}
