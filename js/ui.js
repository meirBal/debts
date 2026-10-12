// ===== UI primitives — DOM helper, toast, dialog, formatters =====

// h('div', {class:'x', onclick: fn}, 'text', child) — text always via textContent (XSS-safe)
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((c) => c != null && c !== false));
  return el;
}

export function toast(msg, bad = false) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

// async action: errors become a toast; the button is disabled while it runs
export const act = (fn) => async (e) => {
  const b = e?.currentTarget;
  if (b) b.disabled = true;
  try { await fn(e); } catch (err) { console.error(err); toast(err.message || 'שגיאה', true); } finally { if (b) b.disabled = false; }
};

export function dialog(title, body, actions = []) {
  const d = h('dialog', {}, h('h2', {}, title), body,
    h('div', { class: 'actions' }, ...actions, h('button', { class: 'ghost', type: 'button', onclick: () => d.close() }, 'סגור')));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

const DATE = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' });
const MONEY = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmtDate = (d) => (d ? DATE.format(new Date(d.slice(0, 10) + 'T12:00')) : '');
export const fmtMoney = (n) => MONEY.format(+n || 0);
