// 左側の月カレンダー

import { WEEKDAYS, addDays, isoWeek, sameDay, startOfMonth, startOfWeek } from './dates.js';
import { h, icon } from './ui.js';

/**
 * o: { month, weekStart, rangeStart, rangeDays, onPick(date), onMonth(delta), onToday() }
 */
export function renderMiniCal(el, o) {
  const today = new Date();
  const first = startOfMonth(o.month);
  const gridStart = startOfWeek(first, o.weekStart);
  const rangeEnd = addDays(o.rangeStart, o.rangeDays);

  const head = h('div', { class: 'mc-head' },
    h('button', { class: 'mc-title', title: '今日に戻る', onclick: o.onToday }, `${first.getFullYear()}年${first.getMonth() + 1}月`),
    h('div', { class: 'mc-nav' },
      h('button', { class: 'icon-btn sm', title: '前の月', html: icon.chevL, onclick: () => o.onMonth(-1) }),
      h('button', { class: 'icon-btn sm', title: '次の月', html: icon.chevR, onclick: () => o.onMonth(1) })));

  const grid = h('div', { class: 'mc-grid' }, h('span', { class: 'mc-dow' }));
  for (let i = 0; i < 7; i++) {
    const dow = (o.weekStart + i) % 7;
    grid.append(h('span', { class: `mc-dow${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}` }, WEEKDAYS[dow]));
  }
  for (let r = 0; r < 6; r++) {
    const rowStart = addDays(gridStart, r * 7);
    const weekNo = isoWeek(addDays(rowStart, o.weekStart === 0 ? 1 : 0));
    grid.append(h('button', { class: 'mc-wk', title: `${weekNo}週目を表示`, onclick: () => o.onPick(rowStart) }, String(weekNo)));
    for (let i = 0; i < 7; i++) {
      const d = addDays(rowStart, i);
      const inRange = d >= o.rangeStart && d < rangeEnd;
      const cls = [
        'mc-day',
        d.getMonth() !== first.getMonth() ? 'other' : '',
        sameDay(d, today) ? 'today' : '',
        inRange ? 'in' : '',
        inRange && sameDay(d, o.rangeStart) ? 'in-first' : '',
        inRange && sameDay(addDays(d, 1), rangeEnd) ? 'in-last' : '',
        i === 0 ? 'col-first' : '',
        i === 6 ? 'col-last' : '',
      ].filter(Boolean).join(' ');
      grid.append(h('button', { class: cls, onclick: () => o.onPick(d) }, h('span', null, String(d.getDate()))));
    }
  }
  el.replaceChildren(head, grid);
}
