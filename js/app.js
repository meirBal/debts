// ===== APP — login, providers, check flow (ID → code → result), history, reminders =====
import { h, toast, act, dialog, fmtDate, fmtMoney } from './ui.js';
import { auth, householdOf, checks, refs, provider } from './api.js';
import { PROVIDERS, CHECK_DAYS, REMIND_DAYS, validId, latest, status, attention, nextBill, googleCalendarUrl } from './providers.js';
import { VERSION, APP_URL } from './config.js';

const root = document.getElementById('app');
const S = { hid: null, uid: null };

// ---- [Boot: session → family (HomeApp household) → main] ----
async function boot() {
  const user = await auth.user();
  if (!user) return login();
  S.uid = user.id;
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
const today = () => new Intl.DateTimeFormat('sv', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const nextChip = (r) => { const n = nextBill(r, today()); return n && h('span', { class: 'chip' }, n.soon ? 'חשבון חדש צפוי בקרוב' : `חשבון הבא בערך ${fmtDate(n.date)}`); };

async function render() {
  const rows = await checks.list(S.hid), last = latest(rows), need = attention(rows);
  root.replaceChildren(...[
    h('h1', {}, '💰 בדיקת חובות'),
    need.length > 0 && h('div', { class: 'banner', role: 'status' }, `כדאי לבדוק עכשיו: ${need.map((p) => p.title).join(', ')}`),

    h('div', { class: 'list' }, ...PROVIDERS.map((p) => {
      const r = last.get(p.id), st = status(r);
      return h('div', { class: `item${st === 'late' ? ' late' : ''}` },
        h('strong', { class: 'grow' }, `${p.icon} ${p.title}`),
        r && chip(r), r && nextChip(r), r && h('span', { class: 'chip' }, `נבדק ${fmtDate(r.created_at)}`),
        r && (st === 'late' || st === 'due') && h('button', { class: 'ghost', onclick: act(async () => {
          await checks.markPaid(r.id); toast('סומן כשולם'); await render();
        }) }, 'שילמתי'),
        h('div', { class: 'row' },
          p.refs ? h('button', { class: 'ghost', 'aria-label': `לתשלום ${p.title}`, onclick: act(() => payWithRefs(p)) }, 'לתשלום ↗')
            : h('a', { class: 'btn ghost', href: p.pay, target: '_blank', rel: 'noopener', 'aria-label': `לתשלום ${p.title}` }, 'לתשלום ↗'),
          p.area && h('a', { class: 'btn ghost', href: p.area, target: '_blank', rel: 'noopener', 'aria-label': `אזור אישי ${p.title}` }, 'אזור אישי ↗'),
          p.auto ? h('button', { 'aria-label': `בדוק ${p.title}`, onclick: () => askId(p) }, 'בדוק')
            : h('button', { 'aria-label': `עדכון ${p.title}`, onclick: () => askManual(p) }, 'עדכון')),
        p.tip && h('p', { class: 'hint', style: 'width:100%;margin:0' }, p.tip));
    })),

    h('section', { class: 'card', style: 'margin-top: var(--gap)' }, h('h2', {}, 'היסטוריה'),
      h('div', { class: 'list' }, ...(rows.length ? rows.map((r) => h('div', { class: 'row' },
        h('span', { class: 'grow' }, `${iconOf(r.provider)} ${r.title} · ${fmtDate(r.created_at)}`), chip(r)))
        : [h('p', { class: 'hint' }, 'עוד לא נבדק')]))),

    installCard(),
    h('section', { class: 'card' }, h('h2', {}, '⏰ תזכורות'),
      h('p', { class: 'hint' }, `תזכורת ביומן ב-${REMIND_DAYS.join(', ')} בכל חודש עם קישור לכאן (בלי שרת ובלי עלות).`),
      h('div', { class: 'row' },
        h('a', { class: 'btn ghost', href: googleCalendarUrl(APP_URL), target: '_blank', rel: 'noopener' }, 'יומן Google (אנדרואיד)'),
        h('a', { class: 'btn ghost', href: APP_URL.replace(/^https:/, 'webcal:') + 'reminders.ics' }, 'יומן אייפון'))),
    h('p', { class: 'hint' }, `גרסה ${VERSION} · מספר הזהות והקוד לא נשמרים בשרת · מומלץ לבדוק כל ${CHECK_DAYS} ימים`),
  ].filter(Boolean));
}

// ---- [Pay with reference numbers: copy, then open the official page] ----
async function payWithRefs(p) {
  const saved = new Map((await refs.list(S.hid)).filter((r) => r.provider === p.id).map((r) => [r.k, r.value]));
  const lkey = (k) => `debts.ref.${p.id}.${k}`;                         // local refs: this phone only, never the server
  const local = { get: (k) => { try { return localStorage.getItem(lkey(k)) || store.get(); } catch { return ''; } },
    set: (k, v) => { try { localStorage.setItem(lkey(k), v); } catch { /* private mode */ } } };
  const row = (ref) => {
    const cur = ref.local ? local.get(ref.k) : saved.get(ref.k) || '';
    const inp = h('input', { value: cur, inputMode: 'numeric', dir: 'ltr', maxLength: 40, 'aria-label': ref.label });
    return h('label', {}, h('span', {}, ref.label + (ref.local ? ' (נשמר רק בטלפון הזה)' : '')),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, inp),
        h('button', { type: 'button', onclick: act(async () => {
          const v = inp.value.trim();
          if (!v) throw new Error('אין מספר להעתקה');
          if (ref.local) local.set(ref.k, v);
          else if (v !== saved.get(ref.k)) { await refs.set(S.hid, p.id, ref.k, v); saved.set(ref.k, v); }   // edited → saved for the family
          await navigator.clipboard.writeText(v); toast(`הועתק: ${v}`);
        }) }, 'העתק')));
  };
  dialog(`${p.icon} תשלום ${p.title}`, h('div', { class: 'form' },
    h('p', { class: 'hint' }, 'מספרים קבועים שלא משתנים בין חשבונות: מעתיקים ומדביקים באתר התשלום.'),
    ...p.refs.map(row)), [
    h('a', { class: 'btn', href: p.pay, target: '_blank', rel: 'noopener' }, 'המשך לתשלום ↗')]);
}

// ---- [Manual providers: record what the official site shows] ----
function askManual(p) {
  const now = today(), year = (n) => `${+now.slice(0, 4) + n}${now.slice(4)}`;
  const amount = h('input', { type: 'number', inputMode: 'decimal', min: 0, step: '0.01', dir: 'ltr', required: true });
  const due = h('input', { type: 'date', dir: 'ltr', min: year(-1), max: year(1) });
  const save = async (total) => {
    if (!(total >= 0) || total > 1e6) throw new Error('נא להזין סכום');
    if (due.value && (due.value < due.min || due.value > due.max)) throw new Error('תאריך לא תקין');
    const d2 = total > 0 && due.value ? due.value : null;
    await checks.addManual({ household_id: S.hid, created_by: S.uid, provider: p.id, title: p.title, total,
      overdue: d2 && d2 < now ? total : 0, due: d2 });                // past due date → overdue
    d.close(); toast(total > 0 ? `${p.title}: נרשם חוב ${fmtMoney(total)}` : `${p.title}: אין חוב ✓`); await render();
  };
  const d = dialog(`${p.icon} עדכון ${p.title}`, h('div', { class: 'form' },
    h('p', { class: 'hint' }, 'בדקו באתר הרשמי ורשמו כאן מה ראיתם.'),
    h('label', {}, h('span', {}, 'סכום לתשלום (₪)'), amount),
    h('label', {}, h('span', {}, 'לתשלום עד'), due)), [
    h('button', { class: 'ghost', onclick: act(() => save(0)) }, 'אין חוב ✓'),
    h('button', { onclick: act(() => save(amount.value === '' ? NaN : Math.round(+amount.value * 100) / 100)) }, 'שמירה')]);
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

// ---- [PWA: offline shell; install button (Android/Chrome) or iPhone instructions] ----
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.error('sw', e));
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; document.getElementById('install')?.removeAttribute('hidden'); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const installCard = () => standalone() ? null : h('section', { class: 'card' }, h('h2', {}, '📲 התקנה במסך הבית'),
  isIos ? h('p', { class: 'hint' }, 'בספארי: כפתור השיתוף (ריבוע עם חץ) ← "הוספה למסך הבית".')
    : h('p', { class: 'hint' }, 'אם הכפתור לא מופיע: תפריט ⋮ של Chrome ← "התקנת אפליקציה" / "הוספה למסך הבית".'),
  h('button', { id: 'install', hidden: !installEvt, onclick: act(async () => {
    installEvt.prompt(); await installEvt.userChoice; installEvt = null; await render();
  }) }, 'התקנה'));
boot().catch((e) => { console.error(e); toast('אין חיבור לשרת', true); });
