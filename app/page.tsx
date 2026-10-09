import { DEFAULT_BUILD } from "@/lib/parts";
import { shoppingSearch, type Listing } from "@/lib/serp";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Scaffold page: cheapest listing per part, nothing more. The basket optimizer
 * and snapshot history land on top of this.
 */
export default async function Home() {
  const rows = await Promise.all(
    DEFAULT_BUILD.map(async (part) => {
      try {
        const { listings, source } = await shoppingSearch(part.searchTerm);
        const cheapest = listings.reduce<Listing | null>(
          (best, l) => (!best || l.price < best.price ? l : best),
          null,
        );
        return { part, cheapest, source, error: null as string | null };
      } catch (e) {
        return { part, cheapest: null, source: null, error: (e as Error).message };
      }
    }),
  );

  const total = rows.reduce((sum, r) => sum + (r.cheapest?.price ?? 0), 0);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">RigKart</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Cheapest Indian listing per part, via SerpApi Google Shopping (gl=in).
      </p>

      <table className="mt-8 w-full text-sm">
        <tbody>
          {rows.map(({ part, cheapest, source, error }) => (
            <tr key={part.slug} className="border-b border-zinc-800">
              <td className="py-3 pr-4 align-top">
                <div className="font-medium">{part.label}</div>
                <div className="text-xs uppercase text-zinc-500">{part.category}</div>
              </td>
              <td className="py-3 pr-4 align-top text-zinc-400">
                {cheapest ? (
                  <>
                    {cheapest.seller}
                    <span className="ml-2 text-xs text-zinc-600">[{source}]</span>
                  </>
                ) : (
                  <span className="text-amber-500">{error ?? "no listings"}</span>
                )}
              </td>
              <td className="py-3 text-right align-top font-mono">
                {cheapest ? inr(cheapest.price) : "—"}
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-3 font-medium" colSpan={2}>
              Cheapest per item
            </td>
            <td className="py-3 text-right font-mono font-medium">{inr(total)}</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
