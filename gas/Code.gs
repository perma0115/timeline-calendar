/**
 * タイムラインカレンダー — Google Apps Script（中継役）
 *
 * GitHub Pages の画面から呼ばれ、あなたのGoogleカレンダーを読み書きします。
 * 設定手順は README.md を参照してください。
 *
 * 必要なサービス：Google Calendar API（識別子は「Calendar」のまま）
 */

// 祝日の判定に使うカレンダー（上から順に試す）
const HOLIDAY_CALENDARS = [
  'ja.japanese.official#holiday@group.v.calendar.google.com',
  'ja.japanese#holiday@group.v.calendar.google.com',
];

/** 最初に1回だけ実行：接続用のキーを作り、カレンダーへのアクセスを許可します */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) {
    key = newKey_();
    props.setProperty('API_KEY', key);
  }
  Calendar.CalendarList.list({ maxResults: 1 });
  console.log('キー: ' + key);
}

/** キーを作り直したいときに実行（古い埋め込みURLは使えなくなります） */
function resetKey() {
  const key = newKey_();
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  console.log('新しいキー: ' + key);
}

function newKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

// ---------------------------------------------------------------- 入口

function doGet(e) {
  return respond_((e && e.parameter) || {});
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'リクエストの形式が正しくありません' });
  }
  return respond_(body);
}

function respond_(p) {
  try {
    checkKey_(p.key);
    let result;
    switch (p.action) {
      case 'ping':
        result = { calendars: listCalendars_().length };
        break;
      case 'load':
        result = load_(p);
        break;
      case 'create':
        result = create_(p);
        break;
      case 'update':
        result = update_(p);
        break;
      case 'delete':
        result = remove_(p);
        break;
      default:
        throw new Error('不明な操作です: ' + p.action);
    }
    return json_(Object.assign({ ok: true }, result));
  } catch (err) {
    return json_({ ok: false, error: errorText_(err) });
  }
}

function checkKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!expected) throw new Error('GASで setup() がまだ実行されていません');
  if (!key || String(key) !== expected) throw new Error('キーが正しくありません');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorText_(err) {
  return String((err && err.message) || err);
}

// ---------------------------------------------------------------- 読み込み

function load_(p) {
  const timeMin = toIso_(p.start);
  const timeMax = toIso_(p.end);
  const calendars = listCalendars_();
  const known = {};
  calendars.forEach(function (c) { known[c.id] = true; });

  // cals が無ければ「Googleカレンダーで表示中」のものを使う
  let ids;
  if (p.cals === undefined || p.cals === null) {
    ids = calendars.filter(function (c) { return c.selected; }).map(function (c) { return c.id; });
  } else {
    ids = String(p.cals).split(',').filter(function (id) { return id && known[id]; });
  }

  const events = [];
  const errors = [];
  ids.forEach(function (id) {
    try {
      listEvents_(id, timeMin, timeMax).forEach(function (ev) { events.push(ev); });
    } catch (err) {
      errors.push({ calendarId: id, error: errorText_(err) });
    }
  });

  return {
    calendars: calendars,
    visible: ids,
    events: events,
    holidays: listHolidays_(timeMin, timeMax),
    errors: errors,
  };
}

function listCalendars_() {
  const out = [];
  let pageToken = null;
  do {
    const args = { maxResults: 250 };
    if (pageToken) args.pageToken = pageToken;
    const res = Calendar.CalendarList.list(args);
    (res.items || []).forEach(function (c) {
      out.push({
        id: c.id,
        name: c.summaryOverride || c.summary || c.id,
        color: c.backgroundColor || '#9e9e9e',
        accessRole: c.accessRole,
        editable: c.accessRole === 'owner' || c.accessRole === 'writer',
        primary: !!c.primary,
        selected: !!c.selected,
      });
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  // メインのカレンダーを先頭に
  out.sort(function (a, b) { return (b.primary ? 1 : 0) - (a.primary ? 1 : 0); });
  return out;
}

function listEvents_(calId, timeMin, timeMax) {
  const out = [];
  let pageToken = null;
  do {
    const args = { timeMin: timeMin, timeMax: timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 2500 };
    if (pageToken) args.pageToken = pageToken;
    const res = Calendar.Events.list(calId, args);
    (res.items || []).forEach(function (ev) {
      if (ev.status !== 'cancelled') out.push(mapEvent_(ev, calId));
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

function listHolidays_(timeMin, timeMax) {
  for (let i = 0; i < HOLIDAY_CALENDARS.length; i++) {
    try {
      const res = Calendar.Events.list(HOLIDAY_CALENDARS[i], {
        timeMin: timeMin, timeMax: timeMax, singleEvents: true, maxResults: 250,
      });
      return (res.items || [])
        .filter(function (ev) {
          return ev.start && ev.start.date && !/記念日|Observance/i.test(ev.description || '');
        })
        .map(function (ev) { return { date: ev.start.date, name: ev.summary || '祝日' }; });
    } catch (err) {
      // 次の候補を試す
    }
  }
  return [];
}

function mapEvent_(ev, calId) {
  const allDay = !!(ev.start && ev.start.date);
  return {
    id: ev.id,
    calendarId: calId,
    title: ev.summary || '',
    allDay: allDay,
    start: allDay ? ev.start.date : ev.start.dateTime,
    end: allDay ? ev.end.date : ev.end.dateTime,
    location: ev.location || '',
    description: ev.description || '',
    colorId: ev.colorId || '',
    htmlLink: ev.htmlLink || '',
    recurring: !!ev.recurringEventId,
  };
}

// ---------------------------------------------------------------- 書き込み

function create_(p) {
  const resource = {};
  applyFields_(resource, p.event || {}, p.tz);
  if (!resource.start) throw new Error('日時が指定されていません');
  const created = Calendar.Events.insert(resource, p.calendarId);
  return { event: mapEvent_(created, p.calendarId) };
}

function update_(p) {
  let calId = p.calendarId;
  const current = Calendar.Events.get(calId, p.eventId);
  applyFields_(current, p.event || {}, p.tz);
  let saved = Calendar.Events.update(current, calId, p.eventId);
  // 別のカレンダーへ移動
  if (p.targetCalendarId && p.targetCalendarId !== calId) {
    saved = Calendar.Events.move(calId, saved.id, p.targetCalendarId);
    calId = p.targetCalendarId;
  }
  return { event: mapEvent_(saved, calId) };
}

function remove_(p) {
  Calendar.Events.remove(p.calendarId, p.eventId);
  return {};
}

function applyFields_(r, e, tz) {
  if (e.title !== undefined) r.summary = e.title;
  if (e.location !== undefined) r.location = e.location;
  if (e.description !== undefined) r.description = e.description;
  if (e.start && e.end) {
    if (e.allDay) {
      r.start = { date: e.start };
      r.end = { date: e.end };
    } else {
      r.start = { dateTime: e.start };
      r.end = { dateTime: e.end };
      if (tz) {
        r.start.timeZone = tz;
        r.end.timeZone = tz;
      }
    }
  }
}

function toIso_(v) {
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error('日付が正しくありません: ' + v);
  return d.toISOString();
}
