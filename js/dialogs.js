// ダイアログ（予定の編集・設定・初回の接続設定）
// ※Notionの埋め込み内では confirm() などが使えないことがあるため、すべて自前で表示する

import { addDays, combine, hhmm, parseYmd, ymd } from './dates.js';
import { copyText, h, icon, toast } from './ui.js';

let openCount = 0;
export const isModalOpen = () => openCount > 0;

export function openModal(content, { dismissible = true, wide = false, solid = false, onClose } = {}) {
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const back = h('div', { class: `modal-back${solid ? ' solid' : ''}` }, box);
  let downOnBack = false;
  let closed = false;
  back.addEventListener('pointerdown', (e) => {
    downOnBack = e.target === back;
  });
  back.addEventListener('click', (e) => {
    if (dismissible && downOnBack && e.target === back) close();
  });
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  document.getElementById('modal-root').append(back);
  openCount++;
  requestAnimationFrame(() => back.classList.add('show'));

  function close() {
    if (closed) return;
    closed = true;
    openCount--;
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    onClose?.();
  }
  return { close, box };
}

// ------------------------------------------------------------ 予定の編集

/**
 * o: { ev, isNew, readOnly, calendars:[{id,name,color,editable}], onSave(data), onDelete() | null }
 */
export function openEventEditor(o) {
  const { ev, isNew, readOnly } = o;
  const cals = o.calendars.filter((c) => c.editable);
  const calOf = (id) => o.calendars.find((c) => c.id === id);
  const endIncl = ev.allDay ? addDays(ev.e, -1) : ev.e;
  const lockedCal = !isNew && ev.recurring;
  let busy = false;

  const pill = h('span', { class: 'cal-pill', style: { '--c': calOf(ev.calendarId)?.color || '#888' } },
    h('i'), isNew ? '新しい予定' : readOnly ? '予定の詳細（閲覧のみ）' : '予定を編集');

  const title = h('input', {
    class: 'f-title', type: 'text', value: ev.title || '', maxlength: 500,
    placeholder: readOnly ? '' : 'タイトルを追加', disabled: readOnly,
  });

  let calSel = null;
  let calField;
  if (readOnly) {
    calField = h('span', null, calOf(ev.calendarId)?.name || '');
  } else {
    calSel = h('select', { class: 'f-input', disabled: lockedCal },
      cals.map((c) => h('option', { value: c.id, selected: c.id === ev.calendarId }, c.name)));
    calSel.addEventListener('change', () => pill.style.setProperty('--c', calOf(calSel.value)?.color || '#888'));
    calField = calSel;
  }

  const allDay = h('input', { type: 'checkbox', checked: !!ev.allDay, disabled: readOnly });
  const sDate = h('input', { class: 'f-input', type: 'date', value: ymd(ev.s), disabled: readOnly });
  const sTime = h('input', { class: 'f-input f-time', type: 'time', step: 300, value: ev.allDay ? '09:00' : hhmm(ev.s), disabled: readOnly });
  const eDate = h('input', { class: 'f-input', type: 'date', value: ymd(endIncl), disabled: readOnly });
  const eTime = h('input', { class: 'f-input f-time', type: 'time', step: 300, value: ev.allDay ? '10:00' : hhmm(ev.e), disabled: readOnly });
  const loc = h('input', { class: 'f-input', type: 'text', value: ev.location || '', placeholder: readOnly ? '' : '場所を追加', disabled: readOnly });
  const memo = h('textarea', { class: 'f-input', rows: 3, placeholder: readOnly ? '' : 'メモを追加', disabled: readOnly });
  memo.value = ev.description || '';
  const err = h('div', { class: 'f-error' });

  // 開始を変えたら、長さを保ったまま終了もずらす
  const readStart = () => (allDay.checked ? parseYmd(sDate.value) : combine(sDate.value, sTime.value));
  const readEnd = () => (allDay.checked ? parseYmd(eDate.value) : combine(eDate.value, eTime.value));
  let prevStart = readStart();
  const onStartChange = () => {
    const ns = readStart();
    const oe = readEnd();
    if (ns && prevStart && oe) {
      const ne = new Date(oe.getTime() + (ns - prevStart));
      eDate.value = ymd(ne);
      if (!allDay.checked) eTime.value = hhmm(ne);
    }
    prevStart = readStart();
  };
  sDate.addEventListener('change', onStartChange);
  sTime.addEventListener('change', onStartChange);

  const saveBtn = readOnly ? null : h('button', { class: 'btn primary' }, isNew ? '作成' : '保存');
  const cancelBtn = h('button', { class: 'btn' }, readOnly ? '閉じる' : 'キャンセル');
  let delBtn = null;
  if (o.onDelete) {
    let armed = false;
    let timer = 0;
    delBtn = h('button', { class: 'btn danger' }, '削除');
    delBtn.addEventListener('click', async () => {
      if (busy) return;
      if (!armed) {
        armed = true;
        delBtn.textContent = 'もう一度押すと削除';
        delBtn.classList.add('confirm');
        timer = setTimeout(() => {
          armed = false;
          delBtn.textContent = '削除';
          delBtn.classList.remove('confirm');
        }, 4000);
        return;
      }
      clearTimeout(timer);
      setBusy(true);
      try {
        await o.onDelete();
        modal.close();
      } catch (x) {
        err.textContent = x.message || String(x);
        setBusy(false);
      }
    });
  }
  const link = ev.htmlLink
    ? h('a', { class: 'link-btn', href: ev.htmlLink, target: '_blank', rel: 'noopener', html: `Googleカレンダーで開く ${icon.external}` })
    : null;

  const notes = [];
  if (readOnly) notes.push('このカレンダーは閲覧のみのため、編集できません。');
  else if (lockedCal) notes.push('繰り返し予定です。変更はこの回だけに反映されます（カレンダーの移動はできません）。');

  const form = h('div', { class: `editor${ev.allDay ? ' is-allday' : ''}` },
    h('div', { class: 'ed-head' }, pill),
    title,
    h('div', { class: 'f-grid' },
      h('span', { class: 'f-label' }, 'カレンダー'), calField,
      h('span', { class: 'f-label' }, '日時'),
      h('div', null,
        h('label', { class: 'f-check' }, allDay, '終日'),
        h('div', { class: 'f-dt', style: { marginTop: '6px' } },
          h('span', { class: 'f-pair' }, sDate, sTime),
          h('span', { class: 'tilde' }, '〜'),
          h('span', { class: 'f-pair' }, eDate, eTime))),
      h('span', { class: 'f-label' }, '場所'), loc,
      h('span', { class: 'f-label top' }, 'メモ'), memo),
    notes.map((n) => h('p', { class: 'f-note' }, n)),
    err,
    h('div', { class: 'f-actions' }, delBtn, h('span', { class: 'spacer' }), link, cancelBtn, saveBtn));

  allDay.addEventListener('change', () => {
    form.classList.toggle('is-allday', allDay.checked);
    prevStart = readStart();
  });

  function setBusy(b) {
    busy = b;
    for (const btn of [saveBtn, delBtn]) if (btn) btn.disabled = b;
  }

  async function save() {
    if (readOnly || busy) return;
    err.textContent = '';
    let s;
    let e;
    if (allDay.checked) {
      s = parseYmd(sDate.value);
      const last = parseYmd(eDate.value);
      e = last ? addDays(last, 1) : null;
    } else {
      s = combine(sDate.value, sTime.value);
      e = combine(eDate.value, eTime.value);
    }
    if (!s || !e) return void (err.textContent = '日付と時刻を入力してください');
    if (e <= s) return void (err.textContent = '終了は開始より後にしてください');
    const calendarId = calSel ? calSel.value : ev.calendarId;
    if (!calendarId) return void (err.textContent = '保存先のカレンダーがありません');
    setBusy(true);
    saveBtn.textContent = '保存中…';
    try {
      await o.onSave({ title: title.value.trim(), allDay: allDay.checked, s, e, location: loc.value.trim(), description: memo.value, calendarId });
      modal.close();
    } catch (x) {
      err.textContent = x.message || String(x);
      saveBtn.textContent = isNew ? '作成' : '保存';
      setBusy(false);
    }
  }

  saveBtn?.addEventListener('click', save);
  cancelBtn.addEventListener('click', () => modal.close());
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target === title) && !e.isComposing) {
      e.preventDefault();
      save();
    }
  });

  const modal = openModal(form);
  if (!readOnly) {
    setTimeout(() => {
      title.focus();
      if (isNew) title.select();
    }, 30);
  }
  return modal;
}

// ------------------------------------------------------------ 設定

function hourOptions(selected, from, to) {
  const out = [];
  for (let v = from; v <= to; v++) out.push(h('option', { value: v, selected: v === selected }, `${v}時`));
  return out;
}

function select(options, value) {
  return h('select', { class: 'f-input' }, options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
}

function embedField(initial) {
  const box = h('textarea', { class: 'f-input embed-box', readonly: true });
  box.value = initial;
  const copy = h('button', { class: 'btn' }, 'コピー');
  copy.addEventListener('click', async () => {
    box.select();
    const ok = await copyText(box.value);
    toast(ok ? 'コピーしました' : 'コピーできませんでした。選択された文字を Ctrl+C でコピーしてください');
  });
  return { box, copy };
}

/**
 * o: { settings, calendars:[{id, original, name}], embedUrl(s), onTest(url,key), onSave(s, names) }
 */
export function openSettings(o) {
  const s = o.settings;
  const startH = h('select', { class: 'f-input' }, hourOptions(s.startHour, 0, 23));
  const endH = h('select', { class: 'f-input' }, hourOptions(s.endHour, 1, 24));
  const ws = select([[0, '日曜日'], [1, '月曜日']], s.weekStart);
  const theme = select([['auto', 'OSの設定に合わせる'], ['dark', 'ダーク'], ['light', 'ライト']], s.theme);
  const refresh = select([[0, 'しない'], [1, '1分ごと'], [5, '5分ごと'], [10, '10分ごと'], [30, '30分ごと']], s.refreshMin);
  const apiIn = h('input', { class: 'f-input', type: 'url', value: s.api || '', placeholder: 'https://script.google.com/macros/s/…/exec' });
  const keyIn = h('input', { class: 'f-input', type: 'password', value: s.key || '', autocomplete: 'off' });
  const testBtn = h('button', { class: 'btn' }, '接続テスト');
  const testMsg = h('span', { class: 'test-msg' });
  const embed = embedField('');
  const err = h('div', { class: 'f-error' });
  const names = o.calendars.map((c) => ({
    id: c.id,
    input: h('input', { class: 'f-input', type: 'text', value: c.name, placeholder: c.original }),
    original: c.original,
    color: c.color,
  }));

  const current = () => ({
    ...s,
    startHour: +startH.value,
    endHour: +endH.value,
    weekStart: +ws.value,
    theme: theme.value,
    refreshMin: +refresh.value,
    api: apiIn.value.trim(),
    key: keyIn.value.trim(),
  });
  const updateEmbed = () => {
    const c = current();
    embed.box.value = c.api && c.key ? o.embedUrl(c) : '（GASのURLとキーを入れると表示されます）';
  };
  for (const el of [startH, endH, ws, theme, apiIn, keyIn]) el.addEventListener('input', updateEmbed);
  updateEmbed();

  testBtn.addEventListener('click', async () => {
    testMsg.textContent = '確認中…';
    try {
      await o.onTest(apiIn.value.trim(), keyIn.value.trim());
      testMsg.textContent = '接続できました';
    } catch (x) {
      testMsg.textContent = x.message || String(x);
    }
  });

  const saveBtn = h('button', { class: 'btn primary' }, '保存');
  const cancelBtn = h('button', { class: 'btn' }, 'キャンセル');

  const body = h('div', null,
    h('h2', { class: 'm-title' }, '設定'),
    h('div', { class: 'f-grid' },
      h('span', { class: 'f-label' }, '表示する時間'),
      h('div', { class: 'f-inline' }, startH, '〜', endH),
      h('span', { class: 'f-label' }, '週の始まり'), ws,
      h('span', { class: 'f-label' }, 'テーマ'), theme,
      h('span', { class: 'f-label' }, '自動更新'), refresh),
    names.length
      ? h('div', { class: 'm-section' },
        h('h3', null, 'カレンダーの表示名（空欄なら元の名前）'),
        h('div', { class: 'f-grid' }, names.flatMap((n) => [
          h('span', { class: 'f-label cal-pill', title: n.original, style: { '--c': n.color } }, h('i'), '名前'),
          n.input,
        ])))
      : null,
    h('div', { class: 'm-section' },
      h('h3', null, 'GASとの接続'),
      h('div', { class: 'f-grid' },
        h('span', { class: 'f-label' }, 'URL'), apiIn,
        h('span', { class: 'f-label' }, 'キー'), keyIn,
        h('span'), h('div', { class: 'f-inline' }, testBtn, testMsg))),
    h('div', { class: 'm-section' },
      h('h3', null, 'Notionに埋め込むURL'),
      h('p', { class: 'f-note', style: { marginTop: '0' } }, 'Notionで「/埋め込み」を選び、このURLを貼り付けます。キーが含まれるので他の人には共有しないでください。'),
      embed.box,
      h('div', { class: 'f-actions', style: { marginTop: '6px' } }, embed.copy)),
    err,
    h('div', { class: 'f-actions' }, h('span', { class: 'spacer' }), cancelBtn, saveBtn));

  const modal = openModal(body, { wide: true });
  cancelBtn.addEventListener('click', () => modal.close());
  saveBtn.addEventListener('click', () => {
    const c = current();
    if (c.startHour >= c.endHour) {
      err.textContent = '表示する時間は「始まり < 終わり」にしてください';
      return;
    }
    o.onSave(c, names.map((n) => ({ id: n.id, name: n.input.value })));
    modal.close();
  });
  return modal;
}

// ------------------------------------------------------------ 初回の接続設定

const GAS_URL_RE = /^https:\/\/script\.google\.com\/.+\/exec\/?(\?.*)?$/;

/**
 * o: { onConnect(url,key) → {api, embed}, onStart(api), onDemo() }
 */
export function openSetup(o) {
  const apiIn = h('input', { class: 'f-input', type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec' });
  const keyIn = h('input', { class: 'f-input', type: 'password', autocomplete: 'off', placeholder: 'GASの setup() で表示されたキー' });
  const msg = h('div', { class: 'f-error' });
  const connectBtn = h('button', { class: 'btn primary' }, '接続する');
  const demoBtn = h('button', { class: 'btn' }, 'デモデータで試す');

  const body = h('div', null,
    h('h2', { class: 'm-title' }, 'タイムラインカレンダー'),
    h('p', { class: 'f-note', style: { marginTop: '0' } },
      'Googleカレンダーと接続するため、Google Apps Script（GAS）の「ウェブアプリのURL」と「キー」を入力してください。作り方はリポジトリの README.md にあります。'),
    h('div', { class: 'f-grid' },
      h('span', { class: 'f-label' }, 'GASのURL'), apiIn,
      h('span', { class: 'f-label' }, 'キー'), keyIn),
    msg,
    h('div', { class: 'f-actions' }, demoBtn, h('span', { class: 'spacer' }), connectBtn));

  const modal = openModal(body, { dismissible: false, wide: true, solid: true });

  connectBtn.addEventListener('click', async () => {
    msg.textContent = '';
    const url = apiIn.value.trim();
    const key = keyIn.value.trim();
    if (!GAS_URL_RE.test(url)) return void (msg.textContent = 'URLは https://script.google.com/macros/s/…/exec の形で入力してください');
    if (!key) return void (msg.textContent = 'キーを入力してください');
    connectBtn.disabled = true;
    connectBtn.textContent = '確認中…';
    try {
      const r = await o.onConnect(url, key);
      const embed = embedField(r.embed);
      const openBtn = h('button', { class: 'btn primary' }, 'カレンダーを開く');
      openBtn.addEventListener('click', () => {
        modal.close();
        o.onStart(r.api);
      });
      body.replaceChildren(
        h('h2', { class: 'm-title' }, '接続できました'),
        h('p', { class: 'f-note', style: { marginTop: '0' } },
          'Notionでは「/埋め込み」を選び、次のURLを貼り付けてください。キーが含まれるので、他の人には共有しないでください。'),
        embed.box,
        h('div', { class: 'f-actions' }, embed.copy, h('span', { class: 'spacer' }), openBtn));
    } catch (x) {
      msg.textContent = x.message || String(x);
      connectBtn.disabled = false;
      connectBtn.textContent = '接続する';
    }
  });
  demoBtn.addEventListener('click', () => {
    modal.close();
    o.onDemo();
  });
  setTimeout(() => apiIn.focus(), 30);
}
