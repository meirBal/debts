// ===== PROVIDERS & RULES — pure logic (unit-tested in tests/logic.test.mjs) =====
// auto: checked by the server with a one-time code. Others: user checks the official site and records the result.
// Manual ids/titles must match sql/004 (policy) and sql/005 (titles).
export const PROVIDERS = [
  { id: 'iec', title: 'חשמל', icon: '⚡', auto: true, pay: 'https://www.iec.co.il/payments/single' },
  { id: 'water', title: 'מים', icon: '💧', pay: 'https://www.mast.co.il/55/payment', area: 'https://www.mast.co.il/55/services' },
  { id: 'arnona', title: 'ארנונה', icon: '🏛️', pay: 'https://www.ashkelon.muni.il/service/Pages/payments.aspx',
    tip: 'אפשר לקבל כל חיוב ארנונה ישירות ב-bit: סורקים פעם אחת את קוד ה-QR שעל השובר.' },
  { id: 'hit', title: 'שכר לימוד', icon: '🎓', pay: 'https://www.hit.ac.il/students/tuition/', area: 'https://portal.hit.ac.il/' },
];
export const CHECK_DAYS = 10;                                           // ≈3 checks a month
export const REMIND_DAYS = [1, 11, 21];                                 // calendar reminders

// Israeli ID check digit — catches typos before a code is sent (the server checks too)
export const validId = (id) => /^\d{5,9}$/.test(id) && [...id.padStart(9, '0')]
  .reduce((s, d, i) => { const x = +d * (i % 2 + 1); return s + (x > 9 ? x - 9 : x); }, 0) % 10 === 0;

// rows newest first → newest per provider
export const latest = (rows) => {
  const m = new Map();
  for (const r of rows) if (!m.has(r.provider)) m.set(r.provider, r);
  return m;
};

// state of one check: ok | paid | due (bill not yet due) | late (past due)
export const status = (r) => (!r || !(r.total > 0) ? 'ok' : r.paid ? 'paid' : r.overdue > 0 ? 'late' : 'due');

// estimated next bill, shown when nothing is owed: a date; "soon" up to 30 days after the estimate; then nothing
export const nextBill = (r, todayIso) => {
  if (!r?.next_bill || ['late', 'due'].includes(status(r))) return null;
  if (r.next_bill > todayIso) return { soon: false, date: r.next_bill };
  return (Date.parse(todayIso) - Date.parse(r.next_bill)) / 864e5 <= 30 ? { soon: true, date: r.next_bill } : null;
};

// providers to look at now: never checked, last check too old, or an unpaid debt
export const attention = (rows, nowMs = Date.now()) => {
  const last = latest(rows);
  return PROVIDERS.filter((p) => {
    const r = last.get(p.id);
    return !r || ['late', 'due'].includes(status(r)) || (nowMs - Date.parse(r.created_at)) / 864e5 >= CHECK_DAYS;
  });
};

// Google Calendar (Android): pre-filled recurring event. iPhone: subscribe to the static reminders.ics (webcal://).
export const googleCalendarUrl = (url, now = new Date()) => {
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}01`;
  return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: '💰 בדיקת חובות',
    details: url, dates: `${d}T090000/${d}T091000`, ctz: 'Asia/Jerusalem',
    recur: `RRULE:FREQ=MONTHLY;BYMONTHDAY=${REMIND_DAYS.join(',')}` });
};
