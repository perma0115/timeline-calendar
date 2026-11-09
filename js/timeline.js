// 横向きタイムライン（行＝カレンダー、列＝日、日の中を時間で区切る）
// 空いている所をクリック/ドラッグ → 新規作成
// 予定をドラッグ → 移動（別の行に落とすとカレンダー移動）、端をドラッグ → 長さ変更

import { DAY_MS, addDays, addMinutes, clamp, dayDiff, fmtRange, hm, isMidnight, sameDay, wd, ymd } from './dates.js';
import { h, hideTip, icon, showTip } from './ui.js';

const LANE_H = 22; // 予定1段の高さ
const PAD_T = 5;
const PAD_B = 12; // 行の下に残す空き（クリックで作成できるように）
const MIN_ROW_H = 46;
const MIN_W = 14; // 短い予定の最小幅
const ZOOM_PX = { S: 0, M: 22, L: 46 }; // 1時間あたりの最小px（S は画面幅に合わせる）

export function createTimeline(scroller, cb) {
  let m = null; // 表示中のデータ
  let g = null; // 表示中の寸法
  let drag = null;
  let tipTimer = 0;
  const tipPos = { x: 0, y: 0 };

  const root = h('div', { class: 'timeline' });
  scroller.append(root);

  // ------------------------------------------------------------ 寸法と座標

  function geometry() {
    const width = scroller.clientWidth || 900;
    const labelW = width < 560 ? 96 : 148;
    const hourSpan = m.endHour - m.startHour;
    const avail = Math.max(240, width - labelW - 1);
    const minDay = m.days === 1 ? 0 : 56;
    const dayW = Math.max(Math.floor(avail / m.days), Math.ceil(hourSpan * (ZOOM_PX[m.zoom] || 0)), minDay);
    const pxH = dayW / hourSpan;
    const snapMin = pxH >= 44 ? 15 : pxH >= 16 ? 30 : 60;
    return { labelW, hourSpan, dayW, pxH, snapMin, trackW: dayW * m.days };
  }

  /** 日時 → 横位置。表示時間の外は日の端に寄せる */
  function timeToX(t, isEnd = false) {
    let di = dayDiff(m.start, t);
    let hr = t.getHours() + t.getMinutes() / 60;
    if (isEnd && isMidnight(t)) {
      di -= 1;
      hr = 24;
    }
    if (di < 0) return 0;
    if (di >= m.days) return g.trackW;
    return di * g.dayW + clamp((hr - m.startHour) / g.hourSpan, 0, 1) * g.dayW;
  }

  const dayX = (d) => clamp(dayDiff(m.start, d), 0, m.days) * g.dayW;

  /** 横位置 → 日時。mode: raw / floor / ceil / round（刻みに合わせる） */
  function xToTime(x, mode = 'raw') {
    x = clamp(x, 0, g.trackW - 0.01);
    const di = Math.floor(x / g.dayW);
    const f = (x - di * g.dayW) / g.dayW;
    let min = (m.startHour + f * g.hourSpan) * 60;
    const s = g.snapMin;
    if (mode === 'floor') min = Math.floor(min / s) * s;
    else if (mode === 'ceil') min = Math.ceil(min / s) * s;
    else if (mode === 'round') min = Math.round(min / s) * s;
    const d = addDays(m.start, di);
    d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() + min * 60000);
  }

  function snapAbs(d) {
    const x = new Date(d);
    const min = x.getHours() * 60 + x.getMinutes() + x.getSeconds() / 60;
    x.setHours(0, Math.round(min / g.snapMin) * g.snapMin, 0, 0);
    return x;
  }

  const isBar = (ev) => ev.allDay || ev.e - ev.s >= DAY_MS;

  function trackLeft() {
    const t = root.querySelector('.tl-track');
    return t ? t.getBoundingClientRect().left : scroller.getBoundingClientRect().left + g.labelW - scroller.scrollLeft;
  }

  // ------------------------------------------------------------ 描画

  function render(model) {
    m = model;
    g = geometry();
    // 描き直すと元の要素が消えて pointerout が来ないため、ここで閉じる
    clearTimeout(tipTimer);
    hideTip();
    const sl = scroller.scrollLeft;
    const st = scroller.scrollTop;
    root.style.width = `${g.labelW + g.trackW}px`;
    root.replaceChildren(renderHead(), renderBody());
    scroller.scrollLeft = sl;
    scroller.scrollTop = st;
  }

  function renderHead() {
    const today = new Date();
    const step = g.pxH >= 26 ? 1 : g.pxH >= 13 ? 2 : g.pxH >= 7 ? 3 : 6;
    const cells = [];
    for (let i = 0; i < m.days; i++) {
      const d = addDays(m.start, i);
      const hol = m.holidays.get(ymd(d));
      const dow = d.getDay();
      const cls = ['tl-dayhead', hol || dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', sameDay(d, today) ? 'today' : '']
        .filter(Boolean)
        .join(' ');
      const label = m.days === 1 ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getMonth() + 1}/${d.getDate()}`;
      const ticks = [];
      for (let hr = m.startHour; hr < m.endHour; hr += step) {
        const x = (hr - m.startHour) * g.pxH;
        if (x + 15 > g.dayW) break; // 日の右端で数字が欠けるものは出さない
        ticks.push(h('span', { class: 'dh-hour', style: { left: `${x}px` } }, String(hr)));
      }
      cells.push(
        h('div', { class: cls, style: { width: `${g.dayW}px` }, title: hol || null },
          h('div', { class: 'dh-date' },
            h('span', { class: 'dh-num' }, label),
            h('span', { class: 'dh-wd' }, `(${wd(d)})`),
            hol && g.dayW >= 120 ? h('span', { class: 'dh-hol' }, hol) : null),
          h('div', { class: 'dh-hours' }, ticks)),
      );
    }
    return h('div', { class: 'tl-head' },
      h('div', { class: 'tl-corner', style: { width: `${g.labelW}px` } }, `${m.startHour}時〜${m.endHour}時`),
      h('div', { class: 'tl-dayheads' }, cells));
  }

  function renderBody() {
    const body = h('div', { class: 'tl-body' }, renderGrid());
    if (!m.rows.length) {
      body.append(h('div', { class: 'tl-empty' }, m.emptyText || '表示するカレンダーがありません'));
      return body;
    }
    for (const row of m.rows) body.append(renderRow(row));
    return body;
  }

  function renderGrid() {
    const today = new Date();
    const grid = h('div', { class: 'tl-grid', style: { left: `${g.labelW}px`, width: `${g.trackW}px`, '--hw': `${g.pxH}px` } });
    for (let i = 0; i < m.days; i++) {
      const d = addDays(m.start, i);
      const dow = d.getDay();
      const cls = ['tl-col', m.holidays.has(ymd(d)) || dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', sameDay(d, today) ? 'today' : '']
        .filter(Boolean)
        .join(' ');
      grid.append(h('div', { class: cls, style: { left: `${i * g.dayW}px`, width: `${g.dayW}px` } }));
    }
    const now = new Date();
    const di = dayDiff(m.start, now);
    const hr = now.getHours() + now.getMinutes() / 60;
    if (di >= 0 && di < m.days && hr >= m.startHour && hr <= m.endHour) {
      grid.append(h('div', { class: 'tl-now', style: { left: `${timeToX(now)}px` } }));
    }
    return grid;
  }

  function renderRow(row) {
    const bars = [];
    const timed = [];
    for (const ev of m.events) {
      if (ev.calendarId !== row.id) continue;
      let x1 = ev.allDay ? dayX(ev.s) : timeToX(ev.s);
      let x2 = ev.allDay ? dayX(ev.e) : timeToX(ev.e, true);
      if (x2 < x1) x2 = x1;
      (isBar(ev) ? bars : timed).push({ ev, x1, x2, cutL: ev.s < m.start, cutR: ev.e > m.end });
    }
    // 終日・複数日の予定を上の段、時間指定の予定をその下の段に
    const nBar = pack(bars);
    const nTimed = pack(timed);
    for (const it of timed) it.lane += nBar;
    const height = Math.max(MIN_ROW_H, PAD_T + (nBar + nTimed) * LANE_H + PAD_B);

    const track = h('div', { class: 'tl-track', style: { width: `${g.trackW}px` } });
    for (const it of bars) track.append(renderEvent(it, row));
    for (const it of timed) track.append(renderEvent(it, row));

    return h('div', { class: `tl-row${row.editable ? '' : ' readonly'}`, dataset: { cal: row.id }, style: { height: `${height}px` } },
      h('div', { class: 'tl-label', style: { width: `${g.labelW}px` }, title: row.editable ? row.name : `${row.name}（閲覧のみ）` },
        h('span', { class: 'dot', style: { background: row.color } }),
        h('span', { class: 'name' }, row.name),
        row.editable ? null : h('span', { class: 'lock', html: icon.lock })),
      track);
  }

  /** 重ならないように段（レーン）を割り当てる。戻り値は段数 */
  function pack(items) {
    items.sort((a, b) => a.x1 - b.x1 || b.x2 - b.x1 - (a.x2 - a.x1));
    const ends = [];
    for (const it of items) {
      it.w = Math.max(it.x2 - it.x1, MIN_W);
      if (it.x1 + it.w > g.trackW) it.x1 = Math.max(0, g.trackW - it.w);
      let lane = ends.findIndex((end) => end <= it.x1 + 0.5);
      if (lane < 0) {
        lane = ends.length;
        ends.push(0);
      }
      ends[lane] = it.x1 + it.w;
      it.lane = lane;
    }
    return ends.length;
  }

  function renderEvent(it, row) {
    const { ev } = it;
    const title = ev.title || '(タイトルなし)';
    const tiny = it.w < 34;
    const cls = [
      'ev',
      ev.allDay ? 'allday' : isBar(ev) ? 'long' : 'timed',
      tiny ? 'tiny' : '',
      row.editable ? 'editable' : 'ro',
      it.cutL ? 'cut-l' : '',
      it.cutR ? 'cut-r' : '',
      ev._saving ? 'saving' : '',
    ].filter(Boolean).join(' ');
    const el = h('div', {
      class: cls,
      dataset: { key: cb.keyOf(ev) },
      style: { left: `${it.x1}px`, width: `${Math.max(it.w - 2, 10)}px`, top: `${PAD_T + it.lane * LANE_H}px`, '--c': cb.colorOf(ev) },
    });
    if (tiny) {
      el.append(h('span', { class: 'ev-title' }, Array.from(title)[0]));
    } else {
      if (!ev.allDay) el.append(h('span', { class: 'ev-time' }, hm(ev.s)));
      el.append(h('span', { class: 'ev-title' }, title));
    }
    if (row.editable && it.w >= 30) el.append(h('i', { class: 'hd hd-l' }), h('i', { class: 'hd hd-r' }));
    return el;
  }

  function scrollToNow() {
    if (!m || g.labelW + g.trackW <= scroller.clientWidth + 1) return;
    const now = new Date();
    const di = dayDiff(m.start, now);
    if (di < 0 || di >= m.days) return;
    const x = m.days === 1 ? timeToX(now) : di * g.dayW;
    scroller.scrollLeft = Math.max(0, x - (scroller.clientWidth - g.labelW) * 0.15);
  }

  // ------------------------------------------------------------ ツールチップ

  function tipNode(ev) {
    return h('div', null,
      h('div', { class: 'tip-title', style: { '--c': cb.colorOf(ev) } }, h('i'), ev.title || '(タイトルなし)'),
      h('div', { class: 'tip-row' }, fmtRange(ev.s, ev.e, ev.allDay)),
      ev.location ? h('div', { class: 'tip-row' }, `場所：${ev.location}`) : null,
      h('div', { class: 'tip-row' }, cb.calNameOf(ev)));
  }

  function onOver(e) {
    if (drag) return;
    const el = e.target.closest('.ev');
    if (!el || el.classList.contains('ghost')) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      const ev = cb.getEvent(el.dataset.key);
      if (ev && !drag && el.isConnected) showTip(tipNode(ev), tipPos.x, tipPos.y);
    }, 380);
  }

  function onOut(e) {
    const el = e.target.closest('.ev');
    if (el && !el.contains(e.relatedTarget)) {
      clearTimeout(tipTimer);
      hideTip();
    }
  }

  // ------------------------------------------------------------ ドラッグ操作

  function onDown(e) {
    if (e.button !== 0 || drag || !m) return;
    const track = e.target.closest('.tl-track');
    if (!track) return;
    const row = track.closest('.tl-row');
    const evEl = e.target.closest('.ev');
    clearTimeout(tipTimer);
    hideTip();
    const base = {
      pointerId: e.pointerId,
      cx: e.clientX,
      cy: e.clientY,
      x0: e.clientX - trackLeft(),
      moved: false,
      touch: e.pointerType === 'touch',
      calId: row.dataset.cal,
      track,
    };
    if (evEl) {
      const ev = cb.getEvent(evEl.dataset.key);
      if (!ev) return;
      const mode = e.target.classList.contains('hd-l') ? 'start' : e.target.classList.contains('hd-r') ? 'end' : 'move';
      drag = { ...base, kind: 'event', ev, el: evEl, mode, editable: cb.canEditCal(ev.calendarId), top: parseFloat(evEl.style.top) || PAD_T };
    } else {
      drag = { ...base, kind: 'create', editable: true };
    }
    if (!drag.touch) {
      try {
        scroller.setPointerCapture(e.pointerId);
      } catch {
        // 取得できなくても続行
      }
      e.preventDefault();
    }
  }

  function onMove(e) {
    tipPos.x = e.clientX;
    tipPos.y = e.clientY;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < (drag.touch ? 8 : 4)) return;
      drag.moved = true;
      if (drag.touch || !drag.editable) return;
      startVisual();
    }
    if (drag.touch || !drag.editable) return;
    autoScroll(e);
    if (drag.kind === 'create') updateCreate(e);
    else updateEventDrag(e);
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    endDrag();
    if (!d.moved) {
      if (d.kind === 'event') cb.onOpen(d.ev);
      else {
        const s = xToTime(d.x0, 'floor');
        cb.onCreate({ calendarId: d.calId, s, e: addMinutes(s, 60), allDay: false });
      }
      return;
    }
    if (d.touch || !d.editable) return;
    if (d.kind === 'create') {
      if (d.s) cb.onCreate({ calendarId: d.calId, s: d.s, e: d.e, allDay: false });
    } else if (d.result) {
      const r = d.result;
      const ev = d.ev;
      if (r.s.getTime() !== ev.s.getTime() || r.e.getTime() !== ev.e.getTime() || r.calendarId !== ev.calendarId) {
        cb.onChange(ev, r);
      }
    }
  }

  function startVisual() {
    if (drag.kind === 'create') {
      drag.sel = h('div', { class: 'tl-sel' });
      drag.track.append(drag.sel);
      document.body.classList.add('drag-create');
    } else {
      drag.el.classList.add('dragging');
      drag.ghost = h('div', {
        class: `ev ghost ${drag.ev.allDay ? 'allday' : isBar(drag.ev) ? 'long' : 'timed'}`,
        style: { '--c': cb.colorOf(drag.ev) },
      }, h('span', { class: 'ev-title' }));
      document.body.classList.add(drag.mode === 'move' ? 'drag-move' : 'drag-resize');
    }
  }

  function endDrag() {
    if (!drag) return;
    try {
      scroller.releasePointerCapture(drag.pointerId);
    } catch {
      // 既に解放済み
    }
    drag.sel?.remove();
    drag.ghost?.remove();
    drag.el?.classList.remove('dragging');
    document.body.classList.remove('drag-create', 'drag-move', 'drag-resize');
    drag = null;
  }

  function cancelDrag() {
    if (drag) endDrag();
  }

  function updateCreate(e) {
    const x = clamp(e.clientX - trackLeft(), 0, g.trackW);
    const a = Math.min(drag.x0, x);
    const b = Math.max(drag.x0, x);
    const s = xToTime(a, 'floor');
    let en = xToTime(b, 'ceil');
    if (en <= s) en = addMinutes(s, g.snapMin);
    drag.s = s;
    drag.e = en;
    const x1 = timeToX(s);
    const x2 = timeToX(en, true);
    drag.sel.style.left = `${x1}px`;
    drag.sel.style.width = `${Math.max(x2 - x1, 4)}px`;
    drag.sel.textContent = sameDay(s, en) || isMidnight(en) ? `${hm(s)}〜${isMidnight(en) ? '24:00' : hm(en)}` : fmtRange(s, en, false);
  }

  function updateEventDrag(e) {
    const ev = drag.ev;
    const x = e.clientX - trackLeft();
    let s = ev.s;
    let en = ev.e;
    if (ev.allDay) {
      const dd = Math.round((x - drag.x0) / g.dayW);
      if (drag.mode === 'move') {
        s = addDays(ev.s, dd);
        en = addDays(ev.e, dd);
      } else if (drag.mode === 'end') {
        en = addDays(ev.e, dd);
        if (en <= s) en = addDays(s, 1);
      } else {
        s = addDays(ev.s, dd);
        if (s >= en) s = addDays(en, -1);
      }
    } else {
      const delta = xToTime(x).getTime() - xToTime(drag.x0).getTime();
      if (drag.mode === 'move') {
        // 移動量を刻みに合わせる（元の分単位のずれは保つ）
        const step = g.snapMin * 60000;
        s = new Date(ev.s.getTime() + Math.round(delta / step) * step);
        en = new Date(s.getTime() + (ev.e - ev.s));
      } else if (drag.mode === 'end') {
        en = snapAbs(new Date(ev.e.getTime() + delta));
        if (en <= s) en = addMinutes(s, g.snapMin);
      } else {
        s = snapAbs(new Date(ev.s.getTime() + delta));
        if (s >= en) s = addMinutes(en, -g.snapMin);
      }
    }

    // 別の行（カレンダー）へ移動。繰り返し予定は時間の変更のみ
    let calId = ev.calendarId;
    if (drag.mode === 'move' && !ev.recurring) {
      const rowEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tl-row');
      if (rowEl && cb.canEditCal(rowEl.dataset.cal)) calId = rowEl.dataset.cal;
    }
    drag.result = { s, e: en, calendarId: calId };

    const rowEl = [...root.querySelectorAll('.tl-row')].find((r) => r.dataset.cal === calId);
    const track = rowEl?.querySelector('.tl-track');
    if (!track) return;
    if (drag.ghost.parentNode !== track) track.append(drag.ghost);
    const x1 = ev.allDay ? dayX(s) : timeToX(s);
    const x2 = ev.allDay ? dayX(en) : timeToX(en, true);
    const w = Math.max(x2 - x1, MIN_W);
    drag.ghost.style.left = `${Math.min(x1, g.trackW - w)}px`;
    drag.ghost.style.width = `${Math.max(w - 2, 10)}px`;
    drag.ghost.style.top = `${calId === ev.calendarId ? drag.top : PAD_T}px`;
    drag.ghost.style.setProperty('--c', cb.colorOf({ ...ev, calendarId: calId }));
    const label = ev.allDay || isBar(ev) ? fmtRange(s, en, ev.allDay) : `${hm(s)}〜${isMidnight(en) ? '24:00' : hm(en)}`;
    drag.ghost.firstChild.textContent = `${label}  ${ev.title || ''}`;
  }

  function autoScroll(e) {
    const r = scroller.getBoundingClientRect();
    const edge = 32;
    if (e.clientX > r.right - edge) scroller.scrollLeft += 14;
    else if (e.clientX < r.left + g.labelW + edge) scroller.scrollLeft -= 14;
    if (e.clientY > r.bottom - edge) scroller.scrollTop += 10;
  }

  scroller.addEventListener('pointerdown', onDown);
  scroller.addEventListener('pointermove', onMove);
  scroller.addEventListener('pointerup', onUp);
  scroller.addEventListener('pointercancel', cancelDrag);
  scroller.addEventListener('lostpointercapture', (e) => {
    if (drag && e.pointerId === drag.pointerId && !drag.touch) cancelDrag();
  });
  scroller.addEventListener('pointerover', onOver);
  scroller.addEventListener('pointerout', onOut);
  scroller.addEventListener('scroll', () => hideTip(), { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag) cancelDrag();
  });

  return {
    render,
    scrollToNow,
    isDragging: () => !!drag,
  };
}
