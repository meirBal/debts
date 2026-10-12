// ===== API — all server access (login shared with HomeApp; data in debt_checks only) =====
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const ok = ({ data, error }) => { if (error) throw error; return data; };

export const auth = {
  user: async () => (await sb.auth.getSession()).data.session?.user ?? null,
  signIn: (email, password) => sb.auth.signInWithPassword({ email, password }).then(ok),
  signOut: () => sb.auth.signOut({ scope: 'local' }),   // this phone only (also signs out HomeApp here: shared login)
};

// the family = HomeApp household (read only)
export const householdOf = async (uid) => ok(await sb.from('members').select('household_id').eq('user_id', uid).maybeSingle())?.household_id ?? null;

export const checks = {
  list: (hid) => sb.from('debt_checks').select('id, provider, title, total, overdue, due, next_bill, paid, created_at')
    .eq('household_id', hid).order('created_at', { ascending: false }).limit(60).then(ok),
  addManual: (row) => sb.from('debt_checks').insert(row).then(ok),
  markPaid: (id) => sb.from('debt_checks').update({ paid: true }).eq('id', id).then(ok),
};

// payment reference numbers (family-shared, DB only)
export const refs = {
  list: (hid) => sb.from('debt_refs').select('provider, k, value').eq('household_id', hid).then(ok),
  set: (hid, provider, k, value) => sb.from('debt_refs').upsert({ household_id: hid, provider, k, value, updated_at: new Date().toISOString() }).then(ok),
};

// edge function: {op:'start'|'verify', ...} — error body {error} is shown as is
export async function provider(body) {
  const { data, error } = await sb.functions.invoke('debts', { body });
  if (!error) return data;
  if (error.context?.status === 404) throw new Error('השירות עוד לא הופעל בשרת');
  let msg = 'אין חיבור לשרת';
  try { msg = (await error.context.json()).error || msg; } catch { /* network / non-JSON */ }
  throw new Error(msg);
}
