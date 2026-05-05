-- Drop and recreate everything cleanly
drop policy if exists "allow all readings" on readings;
drop policy if exists "allow all medications" on medications;
drop table if exists readings;
drop table if exists medications;

create table readings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  date date not null,
  slot integer not null check (slot between 0 and 4),
  value integer not null check (value between 20 and 600),
  note text,
  created_at timestamptz default now()
);

create table medications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  dosage text,
  time text not null,
  frequency text default 'daily',
  enabled boolean default true,
  created_at timestamptz default now()
);

create index readings_user_date on readings(user_id, date desc);

alter table readings enable row level security;
alter table medications enable row level security;

create policy "allow all readings" on readings for all using (true) with check (true);
create policy "allow all medications" on medications for all using (true) with check (true);
