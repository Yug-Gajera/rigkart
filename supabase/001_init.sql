-- RigKart schema. Paste into Supabase SQL editor (or psql) once.

-- Canonical parts the demo builds are assembled from.
create table if not exists parts (
  slug        text primary key,
  category    text not null check (category in ('cpu','gpu','ram','motherboard','psu','case')),
  label       text not null,
  -- The exact string sent to Google Shopping as `q`.
  search_term text not null
);

-- Raw SerpApi responses, keyed by a hash of the request params.
-- This table is the credit saver: one row == one search spent, forever.
create table if not exists lookups (
  query_hash text primary key,
  params     jsonb not null,
  raw        jsonb not null,
  created_at timestamptz not null default now()
);

-- One row per (part, seller, price) observed in a run. Append-only; the delta
-- and sparkline in the UI are just `select ... order by captured_at`.
create table if not exists snapshots (
  id          bigserial primary key,
  part_slug   text not null,
  seller      text not null,
  title       text not null,
  price_inr   numeric(12,2) not null check (price_inr > 0),
  link        text,
  captured_at timestamptz not null default now()
);

create index if not exists snapshots_part_time on snapshots (part_slug, captured_at desc);

insert into parts (slug, category, label, search_term) values
  ('ryzen-5-7600',      'cpu',         'AMD Ryzen 5 7600',            'AMD Ryzen 5 7600 processor'),
  ('rtx-4060',          'gpu',         'NVIDIA RTX 4060 8GB',         'NVIDIA RTX 4060 8GB graphics card'),
  ('ddr5-16gb-6000',    'ram',         'DDR5 16GB 6000MHz',           'Corsair Vengeance DDR5 16GB 6000MHz'),
  ('b650m-ds3h',        'motherboard', 'Gigabyte B650M DS3H',         'Gigabyte B650M DS3H motherboard'),
  ('psu-650w-gold',     'psu',         'Corsair RM650 650W Gold',     'Corsair RM650 650W 80 Plus Gold PSU'),
  ('nzxt-h5-flow',      'case',        'NZXT H5 Flow',                'NZXT H5 Flow cabinet')
on conflict (slug) do nothing;
