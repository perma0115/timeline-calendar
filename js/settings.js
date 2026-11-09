// 設定の読み書き
// ・接続情報（api / key）は埋め込みURLの「#」以降を優先
// ・表示の好み（時間帯・テーマなど）は、画面で変えたもの（ブラウザに保存）を優先

const LS_KEY = 'tlcal.v1';

export const DEFAULTS = {
  theme: 'auto',
  startHour: 8,
  endHour: 20,
  weekStart: 0,
  view: 'week',
  zoom: 'S',
  refreshMin: 5,
  sidebar: true,
};
export const PREF_KEYS = Object.keys(DEFAULTS);

function readParams() {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of new URLSearchParams(location.hash.replace(/^#/, ''))) p.set(k, v);
  return p;
}

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function loadSettings() {
  const p = readParams();
  const saved = readStore();
  const fromUrl = {};

  const theme = p.get('theme');
  if (['auto', 'light', 'dark'].includes(theme)) fromUrl.theme = theme;
  const hours = /^(\d{1,2})-(\d{1,2})$/.exec(p.get('hours') || '');
  if (hours) {
    const a = +hours[1];
    const b = +hours[2];
    if (a >= 0 && b <= 24 && a < b) Object.assign(fromUrl, { startHour: a, endHour: b });
  }
  if (p.has('ws')) fromUrl.weekStart = p.get('ws') === '1' ? 1 : 0;
  if (['day', 'week', '2week'].includes(p.get('view'))) fromUrl.view = p.get('view');

  const base = Object.assign({}, DEFAULTS, fromUrl);
  const s = Object.assign({}, base, saved.prefs || {});
  // 画面で変えた項目だけを保存するための基準値
  Object.defineProperty(s, 'base', { value: base, enumerable: false });
  s.connFromUrl = !!(p.get('api') && p.get('key'));
  s.api = p.get('api') || saved.api || '';
  s.key = p.get('key') || saved.key || '';
  s.demo = p.get('demo') === '1';
  s.calPrefs = saved.calPrefs && typeof saved.calPrefs === 'object' ? saved.calPrefs : {};
  s.visibleIds = Array.isArray(saved.visibleIds) ? saved.visibleIds : null;
  return s;
}

export function saveSettings(s) {
  const prefs = {};
  for (const k of PREF_KEYS) {
    if (!s.base || s[k] !== s.base[k]) prefs[k] = s[k];
  }
  const data = { prefs, calPrefs: s.calPrefs, visibleIds: s.visibleIds };
  // URLで渡された接続情報はブラウザに残さない
  if (s.api && s.key && !s.connFromUrl) Object.assign(data, { api: s.api, key: s.key });
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // 保存できない環境でも動作は続ける
  }
}

/** Notionに貼る埋め込みURL */
export function embedUrl(s) {
  const p = new URLSearchParams();
  p.set('api', s.api);
  p.set('key', s.key);
  if (s.theme && s.theme !== 'auto') p.set('theme', s.theme);
  if (s.startHour !== DEFAULTS.startHour || s.endHour !== DEFAULTS.endHour) p.set('hours', `${s.startHour}-${s.endHour}`);
  if (s.weekStart) p.set('ws', '1');
  return `${location.origin}${location.pathname}#${p.toString()}`;
}
