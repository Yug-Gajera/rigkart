/**
 * Default demo build. Source of truth for the app, because DEMO_MODE must run
 * with no Supabase project at all. `supabase/001_init.sql` seeds the same six
 * rows for persistence — keep them in sync by hand (six rows, not worth a
 * codegen step).
 */
export const CATEGORIES = ["cpu", "gpu", "ram", "motherboard", "psu", "case"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Part = {
  slug: string;
  /** Absent for a part typed in by hand — it is display metadata only. */
  category?: Category;
  label: string;
  /** Sent to Google Shopping as `q`. */
  searchTerm: string;
  /**
   * Every token must appear in a listing title (case-insensitive) for it to
   * count as this part. Google Shopping matches loosely: the Ryzen query
   * returned a ₹1,124 listing from Myntra, a clothing retailer. Model numbers
   * are the cheapest reliable filter.
   */
  must: string[];
  /**
   * At least one must appear. A category search needs this: requiring "atx" on
   * a cabinet search drops every Ant Esports and Zebronics listing that says
   * only "Mid Tower Cabinet", which is most of the Indian budget market.
   */
  anyOf?: string[];
  /** Whole-word exclusions — "RTX 4060 Ti" is a different, pricier card. */
  not?: string[];
};

export const DEFAULT_BUILD: Part[] = [
  { slug: "ryzen-5-7600",   category: "cpu",         label: "AMD Ryzen 5 7600",        searchTerm: "Ryzen 5 7600 AM5 CPU",     must: ["ryzen", "7600"], not: ["7600x", "7600x3d", "7800x3d", "rx", "pc", "desktop"] },
  { slug: "rtx-4060",       category: "gpu",         label: "NVIDIA RTX 4060 8GB",     searchTerm: "NVIDIA RTX 4060 8GB graphics card", must: ["4060"],  not: ["ti", "4060ti", "pc", "desktop"] },
  { slug: "ddr5-16gb-5600", category: "ram",         label: "Crucial DDR5 16GB",       searchTerm: "Crucial DDR5 16GB 5600",   must: ["ddr5", "16gb"],  not: ["32gb", "64gb", "sodimm", "ecc", "rdimm", "pc", "desktop"] },
  { slug: "b650m",          category: "motherboard", label: "B650M board (any brand)", searchTerm: "B650M motherboard",        must: ["b650m"] },
  { slug: "psu-650w-gold",  category: "psu",         label: "Corsair RM650e 650W",     searchTerm: "Corsair RM650e",                   must: ["rm650"] },
  { slug: "atx-case",       category: "case",        label: "PC case / cabinet",       searchTerm: "ATX mid tower cabinet",    must: [], anyOf: ["cabinet", "case", "tower"], not: ["panel", "bracket", "riser", "filter", "cable", "fan", "keyboard", "mouse", "chair", "desk", "rack"] },
];

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Turn one typed line into a searchable part.
 *
 * The hand-written `must` tokens in DEFAULT_BUILD are what stop Google Shopping
 * answering a CPU query with track pants, so typed lines need them too. Model
 * numbers are the distinctive part of a component name, so tokens containing a
 * digit ("4070", "16gb", "b650m") become the requirement — at most two, since
 * every extra token narrows the match and three is usually enough to return
 * nothing. A line with no digits falls back to its longest word.
 *
 * A line matching a default-build search term reuses that part, so its price
 * history stays attached to the same slug.
 */
export function parseLine(line: string): Part | null {
  const searchTerm = line.trim().replace(/\s+/g, " ");
  if (!searchTerm) return null;

  const known = DEFAULT_BUILD.find(
    (p) => p.searchTerm.toLowerCase() === searchTerm.toLowerCase(),
  );
  if (known) return known;

  // Lowercased to match the hand-written tokens; `relevant` compares case-insensitively.
  const words = searchTerm
    .toLowerCase()
    .split(" ")
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  const numbered = words.filter((w) => w.length >= 2 && /\d/.test(w));
  const must = numbered.length
    ? numbered.slice(0, 2)
    : [words.reduce((a, b) => (b.length > a.length ? b : a), "")].filter(Boolean);

  return { slug: slugify(searchTerm), label: searchTerm, searchTerm, must };
}

/** One part per line. Blank lines ignored, duplicates collapsed. */
export function parseBuild(text: string): Part[] {
  const seen = new Set<string>();
  return text
    .split("\n")
    .map(parseLine)
    .filter((p): p is Part => !!p)
    .filter((p) => !seen.has(p.slug) && seen.add(p.slug));
}

/** The default build as editable text for the textarea. */
export const DEFAULT_BUILD_TEXT = DEFAULT_BUILD.map((p) => p.searchTerm).join("\n");
