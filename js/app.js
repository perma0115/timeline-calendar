// 画面全体のまとめ役

import { addDays, addMinutes, startOfDay, startOfMonth, startOfWeek, wd } from './dates.js';
import { DemoApi, GasApi } from './api.js';
import { embedUrl, loadSettings, saveSettings } from './settings.js';
import { createTimeline } from './timeline.js';
import { renderMiniCal } from './minical.js';
import { isModalOpen, openEventEditor, openSettings, openSetup } from './dialogs.js';
import { $, h, icon, toast } from './ui.js';

// Googleカレンダーの「予定の色」（現行の色味）
const EVENT_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};

const S = loadSettings();
const state = {
  anchor: startOfDay(new Date()),
  miniMonth: null,
  calendars: [],
  visible: null, // Set
  events: [],
  holidays: new Map(),
  loaded: false,
  lastLoad: 0,
  seq: 0,
  pending: 0,
  sideOpenNarrow: false,
};
let api = null;
let timeline = null;
let refreshTimer = 0;

const els = {
  app: $('#app'),
  minical: $('#minical'),
  callist: $('#callist'),
  range: $('#range-label'),
  scroller: $('#tl-scroll'),
  badge: $('#badge'),
  refresh: $('#btn-refresh'),
};

// ------------------------------------------------------------ テーマ・表示

const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = S.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : S.theme;
}
mq.addEventListener?.('change', () => S.theme === 'auto' && applyTheme());

const isNarrow = () => innerWidth < 720;
function applySidebar() {
  const narrow = isNarrow();
  els.app.classList.toggle('narrow', narrow);
  els.app.classList.toggle('side-hidden', narrow ? !state.sideOpenNarrow : !S.sidebar);
}

function updateSegs() {
  for (const b of document.querySelectorAll('#seg-view button')) b.classList.toggle('on', b.dataset.v === S.view);
  for (const b of document.querySelectorAll('#seg-zoom button')) b.classList.toggle('on', b.dataset.z === S.zoom);
}

// ------------------------------------------------------------ 期間

const viewDays = () => (S.view === 'day' ? 1 : S.view === '2week' ? 14 : 7);
const rangeStart = () => (S.view === 'day' ? startOfDay(state.anchor) : startOfWeek(state.anchor, S.weekStart));
function range() {
  const start = rangeStart();
  const days = viewDays();
  return { start, days, end: addDays(start, days) };
}

function rangeLabel() {
  const { start, days } = range();
  const last = addDays(start, days - 1);
  const f = (d) => `${d.getMonth() + 1}月${d.getDate()}日（${wd(d)}）`;
  if (days === 1) return `${start.getFullYear()}年${f(start)}`;
  if (start.getFullYear() !== last.getFullYear()) return `${start.getFullYear()}年${f(start)} 〜 ${last.getFullYear()}年${f(last)}`;
  if (start.getMonth() !== last.getMonth()) return `${start.getFullYear()}年${f(start)} 〜 ${f(last)}`;
  return `${start.getFullYear()}年${f(start)} 〜 ${last.getDate()}日（${wd(last)}）`;
}

// ------------------------------------------------------------ カレンダー情報

const calById = (id) => state.calendars.find((c) => c.id === id);
const pref = (id) => S.calPrefs[id] || {};
const calName = (c) => pref(c.id).name || c.name;
const calColor = (c) => pref(c.id).color || c.color || '#8a8a8a';
const keyOf = (ev) => `${ev.calendarId}|${ev.id}`;
const canEditCal = (id) => !!calById(id)?.editable;

function eventColor(ev) {
  const c = calById(ev.calendarId);
  return EVENT_COLORS[ev.colorId] || (c ? calColor(c) : '#8a8a8a');
}

function setCalPref(id, patch, persist = true) {
  const next = { ...pref(id), ...patch };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  if (Object.keys(next).length) S.calPrefs[id] = next;
  else delete S.calPrefs[id];
  if (persist) saveSettings(S);
}

function defaultCal(preferred) {
  if (preferred && canEditCal(preferred)) return preferred;
  const c = state.calendars.find((x) => x.primary && x.editable) || state.calendars.find((x) => x.editable);
  return c ? c.id : null;
}

const busy = () => state.pending > 0 || isModalOpen() || timeline?.isDragging();

// ------------------------------------------------------------ 読み込み

async function load() {
  if (!api) return;
  const { start, end } = range();
  const seq = ++state.seq;
  state.lastLoad = Date.now();
  setLoading(true);
  try {
    const vis = state.visible ? [...state.visible] : S.visibleIds || undefined;
    const res = await api.load(start, end, vis);
    if (seq !== state.seq) return;
    state.calendars = res.calendars;
    state.visible = new Set(res.visible);
    state.events = res.events;
    state.holidays = new Map(res.holidays.map((x) => [x.date, x.name]));
    state.loaded = true;
    state.error = null;
    for (const er of res.errors) {
      const c = calById(er.calendarId);
      toast(`${c ? calName(c) : er.calendarId}：${er.error}`, 'error', 6000);
    }
  } catch (err) {
    if (seq === state.seq) {
      state.error = err.message || String(err);
      toast(state.error, 'error', 7000);
    }
  } finally {
    if (seq === state.seq) {
      setLoading(false);
      renderAll();
    }
  }
}

function setLoading(on) {
  els.refresh.classList.toggle('spin', on);
}

// ------------------------------------------------------------ 描画

function renderAll() {
  els.range.textContent = rangeLabel();
  renderMini();
  renderCalList();
  renderTimeline();
}

function renderTimeline() {
  if (!timeline || timeline.isDragging()) return;
  const { start, days, end } = range();
  const rows = state.calendars
    .filter((c) => state.visible?.has(c.id))
    .map((c) => ({ id: c.id, name: calName(c), color: calColor(c), editable: !!c.editable }));
  const ids = new Set(rows.map((r) => r.id));
  timeline.render({
    start,
    end,
    days,
    startHour: S.startHour,
    endHour: S.endHour,
    zoom: S.zoom,
    rows,
    events: state.events.filter((e) => ids.has(e.calendarId) && e.s < end && e.e > start),
    holidays: state.holidays,
    emptyText: !api
      ? 'Googleカレンダーとまだ接続していません。'
      : !state.loaded && state.error
        ? `読み込めませんでした（${state.error}）。右上の設定ボタンから接続情報を確認できます。`
        : state.loaded ? '表示するカレンダーがありません。左の一覧でチェックを入れてください。' : '読み込み中…',
  });
}

function renderMini() {
  const { start, days } = range();
  const month = state.miniMonth || startOfMonth(state.anchor);
  renderMiniCal(els.minical, {
    month,
    weekStart: S.weekStart,
    rangeStart: start,
    rangeDays: days,
    onPick: (d) => {
      goTo(d);
      if (isNarrow()) {
        state.sideOpenNarrow = false;
        applySidebar();
      }
    },
    onMonth: (delta) => {
      state.miniMonth = new Date(month.getFullYear(), month.getMonth() + delta, 1);
      renderMini();
    },
    onToday: () => goTo(new Date()),
  });
}

function renderCalList() {
  if (!state.calendars.length) {
    els.callist.replaceChildren(h('li', { class: 'empty' }, !api ? '未接続' : state.error ? '読み込めませんでした' : '読み込み中…'));
    return;
  }
  els.callist.replaceChildren(...state.calendars.map((c) => {
    const on = !!state.visible?.has(c.id);
    const color = calColor(c);
    const colorInput = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(color) ? color : '#888888', 'aria-label': '色を変更' });
    const li = h('li', { class: `cal-item${on ? ' on' : ''}`, style: { '--c': color } },
      h('button', { class: 'cal-toggle', title: on ? 'クリックで非表示' : 'クリックで表示', onclick: () => toggleCal(c.id) },
        h('span', { class: 'cal-check', html: on ? icon.check : '' }),
        h('span', { class: 'cal-name' }, calName(c)),
        c.editable ? null : h('span', { class: 'cal-ro', title: '閲覧のみ', html: icon.lock })),
      h('label', { class: 'cal-color', title: '色を変更' }, colorInput));
    colorInput.addEventListener('input', () => {
      li.style.setProperty('--c', colorInput.value);
      setCalPref(c.id, { color: colorInput.value }, false);
      renderTimeline();
    });
    colorInput.addEventListener('change', () => saveSettings(S));
    return li;
  }));
}

function toggleCal(id) {
  if (!state.visible) return;
  const showing = !state.visible.has(id);
  if (showing) state.visible.add(id);
  else state.visible.delete(id);
  S.visibleIds = [...state.visible];
  saveSettings(S);
  renderCalList();
  renderTimeline();
  if (showing) load();
}

// ------------------------------------------------------------ 移動

function goTo(d) {
  state.anchor = startOfDay(d);
  state.miniMonth = null;
  renderAll();
  load().then(() => timeline.scrollToNow());
}

function shift(dir) {
  state.anchor = addDays(S.view === 'day' ? state.anchor : rangeStart(), dir * viewDays());
  state.miniMonth = null;
  renderAll();
  load();
}

// ------------------------------------------------------------ 予定の操作

function editorCalendars() {
  return state.calendars.map((c) => ({ id: c.id, name: calName(c), color: calColor(c), editable: !!c.editable }));
}

function replaceEvent(old, updated) {
  let i = state.events.indexOf(old);
  if (i < 0) i = state.events.findIndex((x) => keyOf(x) === keyOf(old));
  if (i >= 0) state.events[i] = updated;
  else state.events.push(updated);
}

function openCreate(draft) {
  const calendarId = defaultCal(draft.calendarId);
  if (!calendarId) {
    toast('予定を追加できるカレンダーがありません', 'error');
    return;
  }
  openEventEditor({
    ev: { id: null, title: '', location: '', description: '', ...draft, calendarId },
    isNew: true,
    readOnly: false,
    calendars: editorCalendars(),
    onSave: async (data) => {
      const created = await api.create(data.calendarId, data);
      state.events.push(created);
      toast('予定を作成しました');
      if (!state.visible.has(created.calendarId)) {
        state.visible.add(created.calendarId);
        S.visibleIds = [...state.visible];
        saveSettings(S);
        load();
      }
      renderAll();
    },
  });
}

function openEdit(ev) {
  const readOnly = !canEditCal(ev.calendarId);
  openEventEditor({
    ev,
    isNew: false,
    readOnly,
    calendars: editorCalendars(),
    onSave: async (data) => {
      const target = data.calendarId !== ev.calendarId ? data.calendarId : undefined;
      state.pending++;
      try {
        const updated = await api.update(ev.calendarId, ev.id, data, target);
        replaceEvent(ev, updated);
      } finally {
        state.pending--;
      }
      toast('予定を更新しました');
      renderTimeline();
    },
    onDelete: readOnly
      ? null
      : async () => {
        await api.remove(ev.calendarId, ev.id);
        state.events = state.events.filter((x) => x !== ev && keyOf(x) !== keyOf(ev));
        toast('予定を削除しました');
        renderTimeline();
      },
  });
}

/** ドラッグで動かした予定を保存（先に画面を変え、失敗したら戻す） */
async function changeEvent(ev, ch) {
  const before = { s: ev.s, e: ev.e, calendarId: ev.calendarId };
  const data = { ...ev, s: ch.s, e: ch.e };
  const target = ch.calendarId !== ev.calendarId ? ch.calendarId : undefined;
  Object.assign(ev, { s: ch.s, e: ch.e, calendarId: ch.calendarId, _saving: true });
  state.pending++;
  renderTimeline();
  try {
    const updated = await api.update(before.calendarId, ev.id, data, target);
    replaceEvent(ev, updated);
  } catch (err) {
    Object.assign(ev, before);
    toast(`変更できませんでした：${err.message || err}`, 'error', 6000);
  } finally {
    ev._saving = false;
    state.pending--;
    renderTimeline();
  }
}

function newDraft() {
  const { start, end } = range();
  const now = new Date();
  let s;
  if (now >= start && now < end) {
    s = new Date(now);
    s.setMinutes(0, 0, 0);
    s.setHours(Math.min(s.getHours() + 1, 23));
  } else {
    s = new Date(start);
    s.setHours(Math.min(S.startHour + 2, 23), 0, 0, 0);
  }
  return { calendarId: null, s, e: addMinutes(s, 60), allDay: false };
}

// ------------------------------------------------------------ 設定

function showSettings() {
  openSettings({
    settings: { ...S },
    calendars: state.calendars.map((c) => ({ id: c.id, original: c.name, name: pref(c.id).name || '', color: calColor(c) })),
    embedUrl,
    onTest: (url, key) => new GasApi(url, key).ping(),
    onSave: (next, names) => {
      const connChanged = next.api !== S.api || next.key !== S.key;
      for (const k of ['theme', 'startHour', 'endHour', 'weekStart', 'refreshMin', 'api', 'key']) S[k] = next[k];
      if (connChanged) S.connFromUrl = false;
      for (const n of names) setCalPref(n.id, { name: n.name.trim() }, false);
      saveSettings(S);
      applyTheme();
      setupAutoRefresh();
      if (connChanged && S.api && S.key) {
        state.calendars = [];
        state.visible = null;
        state.events = [];
        S.visibleIds = null;
        start(new GasApi(S.api, S.key));
      } else {
        renderAll();
        load();
      }
    },
  });
}

function showSetup() {
  openSetup({
    onConnect: async (url, key) => {
      const a = new GasApi(url, key);
      await a.ping();
      Object.assign(S, { api: url, key, connFromUrl: false });
      saveSettings(S);
      return { api: a, embed: embedUrl(S) };
    },
    onStart: (a) => start(a),
    onDemo: () => start(new DemoApi()),
  });
}

function setupAutoRefresh() {
  clearInterval(refreshTimer);
  if (S.refreshMin > 0) {
    refreshTimer = setInterval(() => {
      if (api && document.visibilityState === 'visible' && !busy()) load();
    }, S.refreshMin * 60000);
  }
}

// ------------------------------------------------------------ 起動

function start(a) {
  api = a;
  els.badge.hidden = !a.demo;
  state.loaded = false;
  state.error = null;
  renderAll();
  load().then(() => timeline.scrollToNow());
  setupAutoRefresh();
}

function bindUi() {
  $('#btn-today').addEventListener('click', () => goTo(new Date()));
  $('#btn-prev').addEventListener('click', () => shift(-1));
  $('#btn-next').addEventListener('click', () => shift(1));
  $('#btn-refresh').addEventListener('click', () => load());
  $('#btn-new').addEventListener('click', () => api && openCreate(newDraft()));
  $('#btn-settings').addEventListener('click', () => (api ? showSettings() : showSetup()));
  $('#btn-sidebar').addEventListener('click', () => {
    if (isNarrow()) state.sideOpenNarrow = !state.sideOpenNarrow;
    else {
      S.sidebar = !S.sidebar;
      saveSettings(S);
    }
    applySidebar();
  });
  for (const b of document.querySelectorAll('#seg-view button')) {
    b.addEventListener('click', () => {
      if (S.view === b.dataset.v) return;
      S.view = b.dataset.v;
      saveSettings(S);
      updateSegs();
      renderAll();
      load().then(() => timeline.scrollToNow());
    });
  }
  for (const b of document.querySelectorAll('#seg-zoom button')) {
    b.addEventListener('click', () => {
      S.zoom = b.dataset.z;
      saveSettings(S);
      updateSegs();
      renderTimeline();
      timeline.scrollToNow();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (isModalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key === 't' || e.key === 'T') goTo(new Date());
    else if (e.key === 'ArrowLeft') shift(-1);
    else if (e.key === 'ArrowRight') shift(1);
    else if ((e.key === 'n' || e.key === 'N') && api) openCreate(newDraft());
  });

  window.addEventListener('resize', applySidebar);
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(renderTimeline);
  }).observe(els.scroller);

  // 画面に戻ってきたら最新にする
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && api && !busy() && Date.now() - state.lastLoad > 60000) load();
  });
  // 現在時刻の線を1分ごとに更新
  setInterval(() => {
    if (!busy()) renderTimeline();
  }, 60000);
}

function boot() {
  applyTheme();
  applySidebar();
  updateSegs();
  timeline = createTimeline(els.scroller, {
    keyOf,
    getEvent: (key) => state.events.find((x) => keyOf(x) === key),
    colorOf: eventColor,
    calNameOf: (ev) => {
      const c = calById(ev.calendarId);
      return c ? calName(c) : '';
    },
    canEditCal,
    onOpen: openEdit,
    onCreate: openCreate,
    onChange: changeEvent,
  });
  bindUi();
  renderAll();

  if (S.demo) start(new DemoApi());
  else if (S.api && S.key) start(new GasApi(S.api, S.key));
  else showSetup();
}

boot();
