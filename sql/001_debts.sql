-- =====================================================================
-- Debts app schema v1 (applied 2026-10-12) — separate from HomeApp: own tables + functions.
-- Reuses (read-only) HomeApp's login, members, households and is_member().
-- Written with RLS/triggers/role checks only (no revoke/grant), so nothing existing is altered.
-- =====================================================================

-- ===== [1] RESULTS: one row per check; members read, may only flip "paid"; inserts = edge function (service role) =====
create table if not exists public.debt_checks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  provider     text not null check (provider ~ '^[a-z_]{2,20}$'),
  title        text not null check (length(title) <= 40),
  total        numeric(12,2) not null default 0,     -- everything open, incl. bills not yet due
  overdue      numeric(12,2) not null default 0,     -- past due only
  due          date,                                 -- earliest due date of the open debt
  items        jsonb not null default '[]' check (pg_column_size(items) < 8192),
  paid         boolean not null default false,       -- user marked it paid
  created_by   uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists debt_checks_idx on public.debt_checks (household_id, created_at desc);
create index if not exists debt_checks_creator_idx on public.debt_checks (created_by);
alter table public.debt_checks enable row level security;          -- no insert/delete policy → users can't forge rows
create policy dc_read on public.debt_checks for select to authenticated using (is_member(household_id));
create policy dc_paid on public.debt_checks for update to authenticated
  using (is_member(household_id)) with check (is_member(household_id));

-- any update keeps every column except "paid"
create or replace function public.debt_checks_only_paid() returns trigger
language plpgsql set search_path = public as $$
declare p boolean := new.paid;
begin new := old; new.paid := p; return new; end $$;
create trigger debt_checks_only_paid before update on public.debt_checks
  for each row execute function public.debt_checks_only_paid();

-- ===== [2] ACCESS & QUOTA: provider logins send real SMS from one shared server IP =====
-- allowlist: families allowed to use provider logins (HomeApp has open signup). Service role only (RLS, no policies).
create table if not exists public.debt_households (
  household_id uuid primary key references public.households on delete cascade
);
alter table public.debt_households enable row level security;

create table if not exists public.debt_calls (
  id           bigint generated always as identity primary key,
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid references auth.users on delete set null,
  kind         text not null check (kind in ('start', 'verify')),
  at           timestamptz not null default now()
);
create index if not exists debt_calls_house_idx on public.debt_calls (household_id, kind, at desc);
create index if not exists debt_calls_user_idx on public.debt_calls (user_id);
alter table public.debt_calls enable row level security;           -- service role only

-- Service role only; caps fixed here. Lock per household, count 24h, log. false = not allowed / over quota.
create or replace function public.take_debt_quota(p_house uuid, p_user uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
declare cap int := case p_kind when 'start' then 5 when 'verify' then 15 end;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service only'; end if;
  if cap is null or not exists (select 1 from debt_households where household_id = p_house) then return false; end if;
  perform pg_advisory_xact_lock(hashtext('debt_quota:' || p_house::text));
  if (select count(*) from debt_calls where household_id = p_house and kind = p_kind and at > now() - interval '1 day') >= cap then
    return false;
  end if;
  insert into debt_calls (household_id, user_id, kind) values (p_house, p_user, p_kind);
  return true;
end $$;

-- ===== [3] DATA: enable the existing family (run once) =====
insert into public.debt_households (household_id) select id from public.households on conflict do nothing;
