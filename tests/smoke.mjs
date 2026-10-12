// Smoke test: serve the app, swap supabase-js for an in-memory mock, click through the check flow.
// usage: (npm i playwright) node tests/smoke.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'text/plain' }); s.end(b); });
}).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/`;

// mock of the few supabase-js calls js/api.js makes; window.__db is inspectable
const MOCK = `
const db = window.__db = { rows: [], session: null };
const q = (rows) => { const c = { rows, eq: (k, v) => (c.rows = c.rows.filter((r) => r[k] === v), c), order: () => c, limit: () => c,
  select: () => c, maybeSingle: () => Promise.resolve({ data: c.rows[0] ?? null, error: null }),
  then: (f) => Promise.resolve({ data: c.rows, error: null }).then(f),
  update: (p) => ({ eq: (k, v) => { db.rows.filter((r) => r[k] === v).forEach((r) => Object.assign(r, p)); return Promise.resolve({ data: null, error: null }); } }) }; return c; };
export const createClient = () => ({
  auth: { getSession: async () => ({ data: { session: db.session } }), signOut: async () => { db.session = null; },
    signInWithPassword: async ({ password }) => password === 'pw12345678' ? (db.session = { user: { id: 'u1' } }, { data: {}, error: null }) : { data: null, error: new Error('x') } },
  from: (t) => t === 'members' ? q([{ user_id: 'u1', household_id: 'h1' }])
    : Object.assign(q(db.rows), { insert: (row) => { db.rows.unshift({ id: 'm' + db.rows.length, paid: false, created_at: new Date().toISOString(), ...row }); return Promise.resolve({ data: null, error: null }); } }),
  functions: { invoke: async (name, { body }) => {
    if (body.op === 'start') return { data: { flow: { st: 's', fid: 'f' }, via: 'sms' }, error: null };
    if (body.code !== '111111') return { data: null, error: { context: { status: 400, json: async () => ({ error: 'הקוד שגוי — נסו שוב' }) } } };
    const row = { id: 'd1', household_id: 'h1', provider: 'iec', title: 'חשמל', total: 245.3, overdue: 100, due: '2026-10-20', next_bill: '2099-01-01', paid: false, created_at: new Date().toISOString() };
    db.rows.unshift(row); return { data: row, error: null };
  } },
});`;

const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined }).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.route(/cdn\.jsdelivr\.net/, (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK }));

let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { failed++; console.log('✗', name, e.message.split('\n')[0]); } };

await page.goto(url);
await step('login with HomeApp account', async () => {
  await page.locator('input[type=email]').fill('a@b.c'); await page.locator('input[type=password]').fill('bad');
  await page.getByRole('button', { name: 'כניסה' }).click(); await page.getByText('מייל או סיסמה שגויים').waitFor();
  await page.locator('input[type=password]').fill('pw12345678'); await page.getByRole('button', { name: 'כניסה' }).click();
  await page.getByText('כדאי לבדוק עכשיו: חשמל, מים, ארנונה, שכר לימוד').waitFor();
});
await step('ID check digit blocks a typo before any SMS', async () => {
  await page.getByRole('button', { name: 'בדוק חשמל' }).click();
  await page.locator('dialog input').first().fill('123456789');
  await page.getByRole('button', { name: 'שלח לי קוד' }).click(); await page.getByText('מספר הזהות לא תקין').waitFor();
});
await step('wrong code keeps the dialog; right code saves the result', async () => {
  await page.locator('dialog input').first().fill('123456782');
  await page.getByRole('button', { name: 'שלח לי קוד' }).click();
  const code = page.locator('dialog', { hasText: 'קוד אימות' }).locator('input');
  await code.fill('222222'); await page.getByRole('button', { name: 'בדוק', exact: true }).click();
  await page.getByText('הקוד שגוי — נסו שוב').waitFor();
  await code.fill('111111'); await page.getByRole('button', { name: 'בדוק', exact: true }).click();
  await page.locator('.item .chip.bad', { hasText: 'באיחור' }).waitFor();
});
await step('mark paid', async () => {
  await page.getByRole('button', { name: 'שילמתי' }).click(); await page.getByText('סומן כשולם').waitFor();
  if (!(await page.evaluate(() => window.__db.rows[0].paid))) throw new Error('not paid');
  await page.locator('.item .chip.ok', { hasText: 'שולם' }).waitFor();
  await page.locator('.item .chip', { hasText: 'חשבון הבא בערך' }).waitFor();
  if (/\bfalse\b|undefined/.test(await page.locator('#app').innerText())) throw new Error('stray false/undefined on screen');
});
await step('manual provider: direct payment link + record debt', async () => {
  const pay = await page.getByRole('link', { name: 'לתשלום מים' }).getAttribute('href');
  if (pay !== 'https://mei-ashkelon.co.il/?id=48') throw new Error(pay);
  await page.getByRole('button', { name: 'עדכון מים' }).click();
  await page.locator('dialog input[type=number]').fill('120.5');
  await page.locator('dialog input[type=date]').fill('2026-11-05');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await page.getByText('מים: נרשם חוב').waitFor();
  const r = await page.evaluate(() => window.__db.rows.find((x) => x.provider === 'water'));
  if (r.total !== 120.5 || r.due !== '2026-11-05' || r.overdue !== 0) throw new Error(JSON.stringify(r));
  await page.getByRole('button', { name: 'עדכון ארנונה' }).click();
  await page.getByRole('button', { name: 'אין חוב ✓' }).click();
  await page.getByText('ארנונה: אין חוב ✓').waitFor();
});
await step('calendar reminder links', async () => {
  const g = await page.getByRole('link', { name: 'יומן Google (אנדרואיד)' }).getAttribute('href');
  const i = await page.getByRole('link', { name: 'יומן אייפון' }).getAttribute('href');
  if (!g.includes('BYMONTHDAY%3D1%2C11%2C21') || !/^webcal:.*reminders\.ics$/.test(i)) throw new Error(g + ' ' + i);
});
await step('service worker keeps other apps\' caches (shared origin)', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  if (!src.includes("k.startsWith('debts-')")) throw new Error('would delete HomeApp caches');
});

await browser.close(); srv.close();
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
console.log(failed || errors.length ? 'FAILED' : 'ALL PASSED'); process.exit(failed || errors.length ? 1 : 0);
