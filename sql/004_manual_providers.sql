-- ===== 004 — manual providers: members record what they saw on the official site (electricity stays server-only) =====
-- Provider ids must match js/providers.js and sql/005 (titles).
create policy dc_manual on public.debt_checks for insert to authenticated
  with check (is_member(household_id) and created_by = (select auth.uid())
    and provider in ('water', 'arnona', 'hit') and items = '[]'::jsonb and total >= 0 and overdue >= 0 and overdue <= total);
