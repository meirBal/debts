-- ===== 006 — payment reference numbers per family (e.g. water clearing no.), shown with a copy button before paying =====
-- Values live only in the DB (never in this public repo); members read/add/edit.
create table if not exists public.debt_refs (
  household_id uuid not null references public.households on delete cascade,
  provider     text not null check (provider ~ '^[a-z_]{2,20}$'),
  k            text not null check (k ~ '^[a-z_]{2,20}$'),
  value        text not null check (length(value) between 1 and 40),
  updated_at   timestamptz not null default now(),
  primary key (household_id, provider, k)
);
alter table public.debt_refs enable row level security;
create policy dr_read on public.debt_refs for select to authenticated using (is_member(household_id));
create policy dr_add on public.debt_refs for insert to authenticated with check (is_member(household_id));
create policy dr_edit on public.debt_refs for update to authenticated using (is_member(household_id)) with check (is_member(household_id));
