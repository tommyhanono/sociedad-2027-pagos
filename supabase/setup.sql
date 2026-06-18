-- Run this in the Supabase SQL Editor
-- https://app.supabase.com → your project → SQL Editor → New query

create table if not exists pagos (
  id              uuid         default gen_random_uuid() primary key,
  fecha           timestamptz  default now(),
  janij           text         not null,
  monto           numeric      not null,
  mes             text         not null,
  comprobante_url text,
  estado          text         default 'pendiente'
);

-- Optional: index for quick filtering by month or student
create index if not exists pagos_mes_idx   on pagos (mes);
create index if not exists pagos_janij_idx on pagos (janij);

-- Row-level security: allow anonymous inserts (the app uses the anon key)
alter table pagos enable row level security;

create policy "allow_anon_insert"
  on pagos for insert
  to anon
  with check (true);

-- NOTE: Storage bucket "comprobantes" must be created manually in
-- Supabase Dashboard → Storage → New bucket → name: comprobantes → Public: ON
-- Then add a policy that allows anon uploads:
--   Storage → comprobantes → Policies → New policy → "Allow anon upload"
--   Operation: INSERT, Role: anon, USING: true
