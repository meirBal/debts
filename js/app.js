// ===== APP — login, providers, check flow (ID → code → result), history, reminders =====
import { h, toast, act, dialog, fmtDate, fmtMoney } from './ui.js';
import { auth, householdOf, checks, provider } from './api.js';
import { PROVIDERS, CHECK_DAYS, REMIND_DAYS, validId, latest, status, attention, googleCalendarUrl } from './providers.js';
import { VERSION, APP_URL } from './config.js';

const root = document.getElementById('app');
const S = { hid: null };

// ---- [Boot: session → family (HomeApp household) → main] ----
async function boot() {
  const user = await auth.user();
  if (!user) return login();
  S.hid = await householdOf(user.id);
  if (!S.hid) return root.replaceChildren(h('div', { class: 'card' },
    h('h1', {}, '💰 בדיקת חובות'), h('p', {}, 'החשבון הזה עוד לא שייך למשפחה. היכנסו קודם לאפליקציית ניהול הבית והצטרפו למשק הבית.'),
    h('button', { class: 'ghost', onclick: act(signOut) }, 'החלפת משתמש (יוצא גם מאפליקציית הבית בטלפון הזה)')));
  await render();
}

function login() {
  const email = h('input', { type: 'email', required: true, autocomplete: 'email' });
  const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  root.replaceChildren(h('form', { class: 'card form', onsubmit: act(async (e) => {
    e.preventDefault();
    try { await auth.signIn(email.value.trim(), pw.value); } catch { throw new Error('מייל או סיסמה שגויים'); }
    await boot();
  }) },
    h('h1', {}, '💰 בדיקת חובות'),
    h('p', { class: 'hint' }, 'אותו מייל וסיסמה של אפליקציית ניהול הבית'),
    h('label', {}, h('span', {}, 'מייל'), email), h('label', {}, h('span', {}, 'סיסמה'), pw),
    h('button', { type: 'submit' }, 'כניסה')));
}

async function signOut() { await auth.signOut(); S.hid = null; login(); }

// ---- [Main screen] ----
const LABEL = {
  ok: () => ['אין חוב ✓', 'ok'], paid: () => ['שולם ✓', 'ok'],
  due: (r) => [`${fmtMoney(r.total)}${r.due ? ' עד ' + fmtDate(r.due) : ''}`, 'warn'],
  late: (r) => [`באיחור ${fmtMoney(r.overdue)}`, 'bad'],
};
const chip = (r) => { const [t, c] = LABEL[status(r)](r); return h('span', { class: `chip ${c}` }, t); };
const iconOf = (id) => PROVIDERS.find((p) => p.id === id)?.icon || '';

async function render() {
  const rows = await checks.list(S.hid), last = latest(rows), need = attention(rows);
  root.replaceChildren(...[
    h('h1', {}, '💰 בדיקת חובות'),
    need.length > 0 && h('div', { class: 'banner', role: 'status' }, `כדאי לבדוק עכשיו: ${need.map((p) => p.title).join(', ')}`),

    h('div', { class: 'list' }, ...PROVIDERS.map((p) => {
      const r = last.get(p.id), st = status(r);
      return h('div', { class: `item${st === 'late' ? ' late' : ''}` },
        h('strong', { class: 'grow' }, `${p.icon} ${p.title}`),
        r && chip(r), r && h('span', { class: 'chip' }, `נבדק ${fmtDate(r.created_at)}`),
        r && (st === 'late' || st === 'due') && h('button', { class: 'ghost', onclick: act(async () => {
          await checks.markPaid(r.id); toast('סומן כשולם'); await render();
        }) }, 'שילמתי'),
        h('button', { 'aria-label': `בדוק ${p.title}`, onclick: () => askId(p) }, 'בדוק'));
    })),

    h('section', { class: 'card', style: 'margin-top: var(--gap)' }, h('h2', {}, 'היסטוריה'),
      h('div', { class: 'list' }, ...(rows.length ? rows.map((r) => h('div', { class: 'row' },
        h('span', { class: 'grow' }, `${iconOf(r.provider)} ${r.title} · ${fmtDate(r.created_at)}`), chip(r)))
        : [h('p', { class: 'hint' }, 'עוד לא נבדק')]))),

    h('section', { class: 'card' }, h('h2', {}, '⏰ תזכורות'),
      h('p', { class: 'hint' }, `תזכורת ביומן ב-${REMIND_DAYS.join(', ')} בכל חודש עם קישור לכאן (בלי שרת ובלי עלות).`),
      h('div', { class: 'row' },
        h('a', { class: 'btn ghost', href: googleCalendarUrl(APP_URL), target: '_blank', rel: 'noopener' }, 'יומן Google (אנדרואיד)'),
        h('a', { class: 'btn ghost', href: APP_URL.replace(/^https:/, 'webcal:') + 'reminders.ics' }, 'יומן אייפון'))),
    h('p', { class: 'hint' }, `גרסה ${VERSION} · מספר הזהות והקוד לא נשמרים בשרת · מומלץ לבדוק כל ${CHECK_DAYS} ימים`),
  ].filter(Boolean));
}

// ---- [Check flow: ID → code sent → code (retry on typo) → result] ----
const ID_KEY = 'debts.id';                                              // opt-in, this device only
const store = { get: () => { try { return localStorage.getItem(ID_KEY) || ''; } catch { return ''; } },
  set: (v) => { try { v ? localStorage.setItem(ID_KEY, v) : localStorage.removeItem(ID_KEY); } catch { /* private mode */ } } };
const digits = (props) => h('input', { inputMode: 'numeric', pattern: '\\d*', dir: 'ltr', ...props });

function askId(p) {
  const saved = store.get();
  const id = digits({ autocomplete: 'off', maxLength: 9, value: saved, placeholder: '9 ספרות' });
  const keep = h('input', { type: 'checkbox', checked: !!saved });
  const d = dialog(`${p.icon} בדיקת ${p.title}`, h('div', { class: 'form' },
    h('label', {}, h('span', {}, 'מספר זהות של בעל החשבון'), id),
    h('label', { class: 'inline' }, keep, 'זכור בטלפון הזה (גלוי לכל מי שמשתמש בו)')), [
    h('button', { onclick: act(async () => {
      const v = id.value.trim();
      if (!validId(v)) throw new Error('מספר הזהות לא תקין');
      const r = await provider({ op: 'start', provider: p.id, id: v });
      store.set(keep.checked ? v : '');
      d.close();
      askCode(p, r);
    }) }, 'שלח לי קוד')]);
}

function askCode(p, { flow, via }) {
  const code = digits({ autocomplete: 'one-time-code', maxLength: 8 });
  const d = dialog(`${p.icon} קוד אימות`, h('div', { class: 'form' },
    h('p', { class: 'hint' }, via === 'sms' ? 'נשלח אליך SMS מהספק' : 'נשלח אליך מייל מהספק'),
    h('label', {}, h('span', {}, 'הקוד שקיבלת'), code)), [
    h('button', { onclick: act(async () => {                          // wrong code: dialog stays open for another try
      const r = await provider({ op: 'verify', provider: p.id, flow, code: code.value.trim() });
      d.close();
      toast(r.total > 0 ? `${p.title}: לתשלום ${fmtMoney(r.total)}${r.due ? ' עד ' + fmtDate(r.due) : ''}` : `${p.title}: אין חוב ✓`, r.overdue > 0);
      await render();
    }) }, 'בדוק')]);
  setTimeout(() => code.focus(), 50);
}

// ---- [PWA: offline shell; new version applies on next open] ----
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
boot().catch((e) => { console.error(e); toast('אין חיבור לשרת', true); });
