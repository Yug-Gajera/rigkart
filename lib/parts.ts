/**
 * Default demo build. Source of truth for the app, because DEMO_MODE must run
 * with no Supabase project at all. `supabase/001_init.sql` seeds the same six
 * rows for persistence — keep them in sync by hand (six rows, not worth a
 * codegen step).
 */
export const CATEGORIES = ["cpu", "gpu", "ram", "motherboard", "psu", "case"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Part = { slug: string; category: Category; label: string; searchTerm: string };

export const DEFAULT_BUILD: Part[] = [
  { slug: "ryzen-5-7600",   category: "cpu",         label: "AMD Ryzen 5 7600",        searchTerm: "AMD Ryzen 5 7600 processor" },
  { slug: "rtx-4060",       category: "gpu",         label: "NVIDIA RTX 4060 8GB",     searchTerm: "NVIDIA RTX 4060 8GB graphics card" },
  { slug: "ddr5-16gb-6000", category: "ram",         label: "DDR5 16GB 6000MHz",       searchTerm: "Corsair Vengeance DDR5 16GB 6000MHz" },
  { slug: "b650m-ds3h",     category: "motherboard", label: "Gigabyte B650M DS3H",     searchTerm: "Gigabyte B650M DS3H motherboard" },
  { slug: "psu-650w-gold",  category: "psu",         label: "Corsair RM650 650W Gold", searchTerm: "Corsair RM650 650W 80 Plus Gold PSU" },
  { slug: "nzxt-h5-flow",   category: "case",        label: "NZXT H5 Flow",            searchTerm: "NZXT H5 Flow cabinet" },
];
