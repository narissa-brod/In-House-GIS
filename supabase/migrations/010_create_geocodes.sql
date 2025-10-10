-- Cache for address -> lat/lng geocodes
create table if not exists public.geocodes (
  id bigserial primary key,
  address text unique not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamp with time zone default now()
);

-- Enable RLS and allow read/insert from anon role (adjust if you need stricter rules)
alter table public.geocodes enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'geocodes' and policyname = 'geocodes_select'
  ) then
    create policy geocodes_select on public.geocodes for select to anon using (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'geocodes' and policyname = 'geocodes_insert'
  ) then
    create policy geocodes_insert on public.geocodes for insert to anon with check (true);
  end if;
end $$;

create index if not exists geocodes_address_idx on public.geocodes using btree (address);

