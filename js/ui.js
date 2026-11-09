// DOMを組み立てる小さな関数と、通知・ツールチップ

export const $ = (sel, root = document) => root.querySelector(sel);

/** h('div', { class: 'x', onclick: fn, style: { '--c': '#f00' } }, '子要素', ...) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === undefined || sv === null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function toast(message, type = 'info', ms = 3200) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const t = h('div', { class: `toast ${type}`, role: 'status' }, message);
  root.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function showTip(node, x, y) {
  const el = document.getElementById('tooltip');
  if (!el) return;
  el.replaceChildren(node);
  el.hidden = false;
  const r = el.getBoundingClientRect();
  let left = x + 12;
  let top = y + 16;
  if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width - 12);
  if (top + r.height > innerHeight - 8) top = Math.max(8, y - r.height - 12);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function hideTip() {
  const el = document.getElementById('tooltip');
  if (el) el.hidden = true;
}

/** クリップボードへコピー（埋め込み先で使えない場合は false） */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export const icon = {
  chevL: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevR: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="currentColor"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  external: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V13H3V4.5h3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
