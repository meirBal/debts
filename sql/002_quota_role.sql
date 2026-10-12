-- ===== 002 — take_debt_quota: accept service role by claim (legacy JWT key) or by SET ROLE (new secret keys) =====
create or replace function public.take_debt_quota(p_house uuid, p_user uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
declare cap int := case p_kind when 'start' then 5 when 'verify' then 15 end;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'service only';
  end if;
  if cap is null or not exists (select 1 from debt_households where household_id = p_house) then return false; end if;
  perform pg_advisory_xact_lock(hashtext('debt_quota:' || p_house::text));
  if (select count(*) from debt_calls where household_id = p_house and kind = p_kind and at > now() - interval '1 day') >= cap then
    return false;
  end if;
  insert into debt_calls (household_id, user_id, kind) values (p_house, p_user, p_kind);
  return true;
end $$;
