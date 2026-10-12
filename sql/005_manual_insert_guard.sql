-- ===== 005 — manual rows can't fake time/paid/title (a future created_at would silence reminders) =====
-- Provider ids/titles must match js/providers.js and the dc_manual policy (sql/004).
create or replace function public.debt_checks_manual_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or coalesce(current_setting('role', true), '') = 'service_role' then
    return new;                                   -- edge function rows are trusted
  end if;
  new.created_at := now(); new.paid := false; new.next_bill := null;
  new.title := case new.provider when 'water' then 'מים' when 'arnona' then 'ארנונה' when 'hit' then 'שכר לימוד' else new.title end;
  if new.due is not null and (new.due < current_date - 366 or new.due > current_date + 366) then raise exception 'due out of range'; end if;
  return new;
end $$;
create trigger debt_checks_manual_guard before insert on public.debt_checks
  for each row execute function public.debt_checks_manual_guard();
