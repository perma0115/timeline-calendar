// 日付まわりの小さな関数（すべてブラウザのローカル時刻で扱う）

export const DAY_MS = 86400000;
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export const pad = (n) => String(n).padStart(2, '0');
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMinutes(d, n) {
  return new Date(d.getTime() + n * 60000);
}

export function startOfWeek(d, weekStart = 0) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() - weekStart + 7) % 7));
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** a の日から b の日まで何日あるか（時刻は無視） */
export function dayDiff(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

export function isMidnight(d) {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${d.getHours()}:${pad(d.getMinutes())}`;
export const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const wd = (d) => WEEKDAYS[d.getDay()];

export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** "2026-11-23" と "09:30" から Date を作る */
export function combine(dateStr, timeStr) {
  const d = parseYmd(dateStr);
  const m = /^(\d{1,2}):(\d{2})/.exec(timeStr || '');
  if (!d || !m) return null;
  d.setHours(+m[1], +m[2], 0, 0);
  return d;
}

/** 2026-11-23T09:00:00+09:00 の形 */
export function toRfc3339(d) {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${ymd(d)}T${hhmm(d)}:00${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / DAY_MS + 1) / 7);
}

const mdw = (x) => `${x.getMonth() + 1}/${x.getDate()}(${wd(x)})`;

/** 予定の日時を人が読む形に */
export function fmtRange(s, e, allDay) {
  if (allDay) {
    const last = addDays(e, -1);
    return last <= s ? `${mdw(s)} 終日` : `${mdw(s)} 〜 ${mdw(last)} 終日`;
  }
  const endsMidnight = isMidnight(e) && sameDay(addDays(e, -1), s);
  if (sameDay(s, e) || endsMidnight) return `${mdw(s)} ${hm(s)} 〜 ${endsMidnight ? '24:00' : hm(e)}`;
  return `${mdw(s)} ${hm(s)} 〜 ${mdw(e)} ${hm(e)}`;
}
