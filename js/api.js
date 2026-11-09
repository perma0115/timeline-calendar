// GAS（Googleカレンダー）との通信と、デモ用のダミーデータ

import { addDays, parseYmd, startOfWeek, toRfc3339, ymd } from './dates.js';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';

/** サーバーの形 → 画面で使う形（s / e に Date を持たせる） */
function fromWire(ev) {
  return {
    ...ev,
    s: ev.allDay ? parseYmd(ev.start) : new Date(ev.start),
    e: ev.allDay ? parseYmd(ev.end) : new Date(ev.end),
  };
}

function toWire(ev) {
  return {
    title: ev.title ?? '',
    allDay: !!ev.allDay,
    start: ev.allDay ? ymd(ev.s) : toRfc3339(ev.s),
    end: ev.allDay ? ymd(ev.e) : toRfc3339(ev.e),
    location: ev.location ?? '',
    description: ev.description ?? '',
  };
}

export class GasApi {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.demo = false;
  }

  async _get(params) {
    const u = new URL(this.url);
    for (const [k, v] of Object.entries({ ...params, key: this.key })) {
      if (v !== undefined) u.searchParams.set(k, v);
    }
    return this._fetch(u.toString(), { method: 'GET' });
  }

  async _post(body) {
    // text/plain にすると事前確認（CORSプリフライト）なしで送れる
    return this._fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key: this.key, tz: TZ }),
    });
  }

  async _fetch(url, opts) {
    let res;
    try {
      res = await fetch(url, { ...opts, redirect: 'follow', cache: 'no-store' });
    } catch {
      throw new Error('GASに接続できません。URLと、デプロイ設定「アクセスできるユーザー：全員」を確認してください。');
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`GASの応答を読み取れませんでした（HTTP ${res.status}）。URLが「/exec」で終わっているか確認してください。`);
    }
    if (!data.ok) throw new Error(data.error || '不明なエラーです');
    return data;
  }

  ping() {
    return this._get({ action: 'ping' });
  }

  async load(start, end, cals) {
    const d = await this._get({
      action: 'load',
      start: start.toISOString(),
      end: end.toISOString(),
      cals: cals ? cals.join(',') : undefined,
    });
    return {
      calendars: d.calendars || [],
      visible: d.visible || [],
      events: (d.events || []).map(fromWire),
      holidays: d.holidays || [],
      errors: d.errors || [],
    };
  }

  async create(calendarId, ev) {
    const d = await this._post({ action: 'create', calendarId, event: toWire(ev) });
    return fromWire(d.event);
  }

  async update(calendarId, eventId, ev, targetCalendarId) {
    const d = await this._post({ action: 'update', calendarId, eventId, event: toWire(ev), targetCalendarId });
    return fromWire(d.event);
  }

  async remove(calendarId, eventId) {
    await this._post({ action: 'delete', calendarId, eventId });
  }
}

// ---------------------------------------------------------------- デモ

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (e) => ({ ...e, s: new Date(e.s), e: new Date(e.e) });

const DEMO_HOLIDAYS = [
  ['2026-09-21', '敬老の日'], ['2026-09-22', '国民の休日'], ['2026-09-23', '秋分の日'],
  ['2026-10-12', 'スポーツの日'], ['2026-11-03', '文化の日'], ['2026-11-23', '勤労感謝の日'],
  ['2027-01-01', '元日'], ['2027-01-11', '成人の日'], ['2027-02-11', '建国記念の日'],
  ['2027-02-23', '天皇誕生日'], ['2027-03-22', '振替休日'],
];

export class DemoApi {
  constructor() {
    this.demo = true;
    this.seq = 0;
    this.calendars = [
      { id: 'me', name: 'マイカレンダー', color: '#4986e7', primary: true, selected: true, editable: true, accessRole: 'owner' },
      { id: 'work', name: '仕事', color: '#16a765', primary: false, selected: true, editable: true, accessRole: 'owner' },
      { id: 'family', name: '家族', color: '#f691b2', primary: false, selected: true, editable: true, accessRole: 'writer' },
      { id: 'holiday', name: '日本の祝日', color: '#d06b64', primary: false, selected: false, editable: false, accessRole: 'reader' },
    ];
    this.events = [];

    const w0 = startOfWeek(new Date(), 0);
    for (let wk = -3; wk <= 6; wk++) {
      const w = addDays(w0, wk * 7);
      const at = (d, hh, mm = 0) => {
        const x = addDays(w, d);
        x.setHours(hh, mm, 0, 0);
        return x;
      };
      const days = (d, n = 1) => [addDays(w, d), addDays(w, d + n)];

      this.add('me', '朝会', at(1, 9, 30), at(1, 10), { recurring: true });
      this.add('work', '週次定例', at(3, 10), at(3, 11), { recurring: true, location: '会議室A' });

      if (wk === 0) {
        this.add('me', 'テレワーク', ...days(1), { allDay: true });
        this.add('me', '顧客訪問', at(2, 13), at(2, 15), { location: '渋谷' });
        this.add('me', '資料作成', at(3, 14), at(3, 15));
        this.add('me', '1on1', at(3, 14, 30), at(3, 16));
        this.add('me', 'ジム', at(4, 6), at(4, 7, 30));
        this.add('me', '会食', at(5, 18, 30), at(5, 21), { location: '銀座' });
        this.add('work', '大阪出張', ...days(1, 2), { allDay: true });
        this.add('work', '企画レビュー', at(4, 10), at(4, 12));
        this.add('work', '採用面接', at(5, 15), at(5, 16));
        this.add('work', '振り返り', at(5, 16), at(5, 16, 30));
        this.add('family', '夕食当番', at(3, 19), at(3, 20));
        this.add('family', '買い物', at(6, 10), at(6, 12));
        this.add('family', '習い事の送迎', at(0, 13), at(0, 17));
      } else {
        this.add('me', 'フレックス 8時〜17時', ...days(2 + (wk & 1)), { allDay: true });
        this.add('work', 'プロジェクトMTG', at(2, 14), at(2, 15));
        this.add('work', '月次報告', at(4, 16), at(4, 17));
        this.add('family', '公園', at(6, 11), at(6, 12));
      }
    }
    for (const [date, name] of DEMO_HOLIDAYS) {
      const d = parseYmd(date);
      this.add('holiday', name, d, addDays(d, 1), { allDay: true });
    }
  }

  add(calendarId, title, s, e, extra = {}) {
    this.events.push({
      id: `d${++this.seq}`,
      calendarId,
      title,
      s,
      e,
      allDay: !!extra.allDay,
      location: extra.location || '',
      description: extra.description || '',
      colorId: '',
      htmlLink: '',
      recurring: !!extra.recurring,
    });
  }

  async ping() {
    return { ok: true };
  }

  async load(start, end, cals) {
    await sleep(200);
    const ids = cals
      ? cals.filter((id) => this.calendars.some((c) => c.id === id))
      : this.calendars.filter((c) => c.selected).map((c) => c.id);
    const inRange = (e) => e.s < end && e.e > start;
    return {
      calendars: this.calendars.map((c) => ({ ...c })),
      visible: ids,
      events: this.events.filter((e) => ids.includes(e.calendarId) && inRange(e)).map(clone),
      holidays: this.events
        .filter((e) => e.calendarId === 'holiday' && inRange(e))
        .map((e) => ({ date: ymd(e.s), name: e.title })),
      errors: [],
    };
  }

  async create(calendarId, ev) {
    await sleep(250);
    this.add(calendarId, ev.title, new Date(ev.s), new Date(ev.e), ev);
    return clone(this.events[this.events.length - 1]);
  }

  async update(calendarId, eventId, ev, targetCalendarId) {
    await sleep(250);
    const cur = this.events.find((x) => x.id === eventId && x.calendarId === calendarId);
    if (!cur) throw new Error('予定が見つかりません');
    Object.assign(cur, {
      title: ev.title ?? cur.title,
      allDay: !!ev.allDay,
      s: new Date(ev.s),
      e: new Date(ev.e),
      location: ev.location ?? '',
      description: ev.description ?? '',
    });
    if (targetCalendarId) cur.calendarId = targetCalendarId;
    return clone(cur);
  }

  async remove(calendarId, eventId) {
    await sleep(200);
    this.events = this.events.filter((x) => !(x.id === eventId && x.calendarId === calendarId));
  }
}
