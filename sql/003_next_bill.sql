-- ===== 003 — estimated next bill date (last bill + billing frequency) =====
alter table public.debt_checks add column if not exists next_bill date;
