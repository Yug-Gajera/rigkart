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
  category: Category;
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
  /** Whole-word exclusions — "RTX 4060 Ti" is a different, pricier card. */
  not?: string[];
};

export const DEFAULT_BUILD: Part[] = [
  { slug: "ryzen-5-7600",   category: "cpu",         label: "AMD Ryzen 5 7600",        searchTerm: "Ryzen 5 7600 AM5 CPU",     must: ["ryzen", "7600"], not: ["7600x", "7600x3d", "7800x3d", "rx"] },
  { slug: "rtx-4060",       category: "gpu",         label: "NVIDIA RTX 4060 8GB",     searchTerm: "NVIDIA RTX 4060 8GB graphics card", must: ["4060"],          not: ["ti", "4060ti"] },
  { slug: "ddr5-16gb-5600", category: "ram",         label: "Crucial DDR5 16GB",       searchTerm: "Crucial DDR5 16GB 5600",          must: ["ddr5", "16gb"],  not: ["32gb", "64gb", "sodimm", "ecc", "rdimm"] },
  { slug: "b650m",          category: "motherboard", label: "B650M board (any brand)", searchTerm: "B650M motherboard",        must: ["b650m"] },
  { slug: "psu-650w-gold",  category: "psu",         label: "Corsair RM650e 650W",     searchTerm: "Corsair RM650e",                   must: ["rm650"] },
  { slug: "nzxt-h5-flow",   category: "case",        label: "NZXT H5 Flow",            searchTerm: "NZXT H5 Flow",             must: ["nzxt", "h5"] },
];
