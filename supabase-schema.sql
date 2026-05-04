-- Run this in your Supabase SQL Editor

-- Readings table
create table if not exists readings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  date date not null,
  slot integer not null check (slot between 0 and 4),
  value integer not null check (value between 20 and 600),
  note text,
  created_at timestamptz default now()
);

-- Index for fast queries
create index if not exists readings_user_date on readings(user_id, date desc);

-- Medications table
create table if not exists medications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  time text not null,
  enabled boolean default true,
  created_at timestamptz default now()
);

-- Enable RLS (Row Level Security)
alter table readings enable row level security;
alter table medications enable row level security;

-- Allow all for now (you can add auth later)
create policy "allow all readings" on readings for all using (true) with check (true);
create policy "allow all medications" on medications for all using (true) with check (true);
