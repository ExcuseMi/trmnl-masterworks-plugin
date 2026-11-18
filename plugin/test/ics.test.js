// The agenda: the ICS parser and what the strip picks from it. node --test test
const test = require('node:test');
const assert = require('node:assert');
const t = require('../src/transform.js');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { throw new Error('test touched the network'); };
test.afterEach(() => { globalThis.fetch = async () => { throw new Error('test touched the network'); }; });
test.after(() => { globalThis.fetch = realFetch; });

const Z = 'Europe/Brussels';
const cal = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.map((e) => `BEGIN:VEVENT\r\n${e.join('\r\n')}\r\nEND:VEVENT`).join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const day = (s) => t.dayNumber(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));
// the occurrences touching one day, as "HH:MM" in the zone (UTC for the instants) or "all-day"
const hhmm = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: Z, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
const on = (text, d1, d2 = d1) => t.icsOccurrences(text, Z, day(d1), day(d2)).map((o) => (o.allDay ? 'all-day ' : hhmm(o.start) + ' ') + o.title).sort();

test('times: UTC, a zone other than the account\'s, floating, all-day (end exclusive), duration', () => {
  const text = cal(
    ['UID:a', 'DTSTART:20261117T080000Z', 'DTEND:20261117T090000Z', 'SUMMARY:UTC'],
    ['UID:b', 'DTSTART;TZID=America/New_York:20261117T090000', 'DTEND;TZID=America/New_York:20261117T100000', 'SUMMARY:New York'],
    ['UID:c', 'DTSTART:20261117T100000', 'DTEND:20261117T110000', 'SUMMARY:Floating'],
    ['UID:d', 'DTSTART;VALUE=DATE:20261117', 'DTEND;VALUE=DATE:20261118', 'SUMMARY:Holiday'],
    ['UID:e', 'DTSTART;TZID=Europe/Brussels:20261117T120000', 'DURATION:PT1H30M', 'SUMMARY:Duration'],
    ['UID:f', 'DTSTART;VALUE=DATE:20261116', 'DTEND;VALUE=DATE:20261118', 'SUMMARY:Two days'],
    ['UID:g', 'DTSTART;VALUE=DATE:20261118', 'DTEND;VALUE=DATE:20261119', 'SUMMARY:Tomorrow only'],
  );
  assert.deepStrictEqual(on(text, '2026-11-17'), ['09:00 UTC', '10:00 Floating', '12:00 Duration', '15:00 New York', 'all-day Holiday', 'all-day Two days']);
  const d = t.icsOccurrences(text, Z, day('2026-11-17'), day('2026-11-17')).find((o) => o.title === 'Duration');
  assert.strictEqual(d.end - d.start, 90 * 60000);
});

test('text: folded lines and escapes', () => {
  const text = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261117T080000Z\r\nSUMMARY:Team sync\\, planning\; and a very long title that is\r\n  folded over two lines\r\nLOCATION:Room 1\\nBuilding\\\\A\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const [o] = t.icsOccurrences(text, Z, day('2026-11-17'), day('2026-11-17'));
  assert.strictEqual(o.title, 'Team sync, planning; and a very long title that is folded over two lines');
  assert.strictEqual(o.location, 'Room 1 Building\\A');
});

test('RRULE DAILY: interval, count, until', () => {
  const r = (rule) => cal(['UID:r', 'DTSTART;TZID=Europe/Brussels:20261110T090000', 'DTEND;TZID=Europe/Brussels:20261110T093000', `RRULE:${rule}`, 'SUMMARY:R']);
  assert.deepStrictEqual(on(r('FREQ=DAILY;INTERVAL=2'), '2026-11-12', '2026-11-17'), ['09:00 R', '09:00 R', '09:00 R'].slice(0, 0).concat(['09:00 R', '09:00 R', '09:00 R']), 'the 12th, 14th, 16th');
  assert.strictEqual(on(r('FREQ=DAILY;INTERVAL=2'), '2026-11-17').length, 0, 'the 17th is not in step');
  assert.strictEqual(on(r('FREQ=DAILY;COUNT=3'), '2026-11-12').length, 1, 'the third (the 12th)');
  assert.strictEqual(on(r('FREQ=DAILY;COUNT=3'), '2026-11-13').length, 0, 'the fourth is over the count');
  assert.strictEqual(on(r('FREQ=DAILY;UNTIL=20261115T235959Z'), '2026-11-15').length, 1);
  assert.strictEqual(on(r('FREQ=DAILY;UNTIL=20261115T235959Z'), '2026-11-16').length, 0);
  assert.strictEqual(on(r('FREQ=DAILY'), '2026-11-17').length, 1, 'a rule with no end, far from its start');
});

test('RRULE WEEKLY: BYDAY, interval, a start on another weekday', () => {
  const r = (rule, start = '20261102') => cal(['UID:w', `DTSTART;TZID=Europe/Brussels:${start}T090000`, 'DTEND;TZID=Europe/Brussels:' + start + 'T100000', `RRULE:${rule}`, 'SUMMARY:W']);
  assert.strictEqual(on(r('FREQ=WEEKLY;BYDAY=MO,WE'), '2026-11-16', '2026-11-18').length, 2, 'Monday and Wednesday');
  assert.strictEqual(on(r('FREQ=WEEKLY;BYDAY=MO,WE'), '2026-11-17').length, 0);
  assert.strictEqual(on(r('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), '2026-11-16').length, 1, 'two weeks after the 2nd');
  assert.strictEqual(on(r('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), '2026-11-09').length, 0, 'the week between');
  assert.strictEqual(on(r('FREQ=WEEKLY'), '2026-11-16').length, 1, 'no BYDAY: the weekday of the start');
  assert.strictEqual(on(r('FREQ=WEEKLY;COUNT=2;BYDAY=MO'), '2026-11-16').length, 0, 'COUNT=2: the 2nd and the 9th only');
});

test('RRULE MONTHLY and YEARLY: BYMONTHDAY, 1MO, -1FR, the day of the start, a day a month lacks', () => {
  const r = (rule, start = '20260101') => cal(['UID:m', `DTSTART;TZID=Europe/Brussels:${start}T090000`, 'DTEND;TZID=Europe/Brussels:' + start + 'T100000', `RRULE:${rule}`, 'SUMMARY:M']);
  assert.strictEqual(on(r('FREQ=MONTHLY;BYMONTHDAY=17'), '2026-11-17').length, 1);
  assert.strictEqual(on(r('FREQ=MONTHLY;BYMONTHDAY=-1'), '2026-11-30').length, 1, 'the last day');
  assert.strictEqual(on(r('FREQ=MONTHLY;BYDAY=1MO'), '2026-11-02').length, 1, 'the first Monday of November is the 2nd');
  assert.strictEqual(on(r('FREQ=MONTHLY;BYDAY=1MO'), '2026-11-09').length, 0);
  assert.strictEqual(on(r('FREQ=MONTHLY;BYDAY=-1FR'), '2026-11-27').length, 1, 'the last Friday');
  assert.strictEqual(on(r('FREQ=MONTHLY;BYDAY=2TU'), '2026-11-10').length, 1, 'the second Tuesday');
  assert.strictEqual(on(r('FREQ=MONTHLY', '20260117'), '2026-11-17').length, 1, 'the day of the start');
  assert.strictEqual(on(r('FREQ=MONTHLY', '20260131'), '2026-11-30').length, 0, 'the 31st: no occurrence in a month of 30 days');
  assert.strictEqual(on(r('FREQ=MONTHLY;INTERVAL=2', '20260117'), '2026-11-17').length, 1, 'every second month: Jan, Mar, ... Nov');
  assert.strictEqual(on(r('FREQ=MONTHLY;INTERVAL=2', '20260117'), '2026-10-17').length, 0);
  assert.strictEqual(on(r('FREQ=YEARLY', '20251117'), '2026-11-17').length, 1, 'a birthday');
  assert.strictEqual(on(r('FREQ=YEARLY;BYMONTH=11;BYDAY=3TU', '20250101'), '2026-11-17').length, 1, 'the third Tuesday of November');
  assert.strictEqual(on(r('FREQ=YEARLY;COUNT=1', '20251117'), '2026-11-17').length, 0, 'COUNT=1 is only the first');
});

test('a DST change day: the wall-clock time stays, the instant moves', () => {
  const text = cal(['UID:d', 'DTSTART;TZID=Europe/Brussels:20261019T090000', 'DTEND;TZID=Europe/Brussels:20261019T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'SUMMARY:Standup']);
  const before = t.icsOccurrences(text, Z, day('2026-10-19'), day('2026-10-19'))[0].start;
  const after = t.icsOccurrences(text, Z, day('2026-11-02'), day('2026-11-02'))[0].start;
  assert.strictEqual(new Date(before).toISOString(), '2026-10-19T07:00:00.000Z', 'CEST');
  assert.strictEqual(new Date(after).toISOString(), '2026-11-02T08:00:00.000Z', 'CET: still 09:00 on the wall');
  // the day the clocks change itself (25 Oct 2026, 03:00 -> 02:00)
  assert.strictEqual(t.wallToEpoch(2026, 10, 25, 9, 0, 0, Z), Date.UTC(2026, 9, 25, 8, 0, 0));
  assert.strictEqual(t.wallToEpoch(2026, 10, 25, 1, 0, 0, Z), Date.UTC(2026, 9, 24, 23, 0, 0));
  assert.strictEqual(t.wallToEpoch(2026, 3, 29, 9, 0, 0, Z), Date.UTC(2026, 2, 29, 7, 0, 0), 'the spring change');
});

test('EXDATE, RECURRENCE-ID overrides and cancelled events', () => {
  const master = ['UID:s', 'DTSTART;TZID=Europe/Brussels:20261116T090000', 'DTEND;TZID=Europe/Brussels:20261116T100000', 'RRULE:FREQ=DAILY;COUNT=5', 'EXDATE;TZID=Europe/Brussels:20261117T090000', 'SUMMARY:Series'];
  assert.deepStrictEqual(on(cal(master), '2026-11-16', '2026-11-18'), ['09:00 Series', '09:00 Series'], 'the 17th is excluded');
  const moved = ['UID:s2', 'DTSTART;TZID=Europe/Brussels:20261116T090000', 'DTEND;TZID=Europe/Brussels:20261116T100000', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Series'];
  const over = ['UID:s2', 'RECURRENCE-ID;TZID=Europe/Brussels:20261117T090000', 'DTSTART;TZID=Europe/Brussels:20261117T140000', 'DTEND;TZID=Europe/Brussels:20261117T150000', 'SUMMARY:Series (moved)'];
  assert.deepStrictEqual(on(cal(moved, over), '2026-11-17'), ['14:00 Series (moved)'], 'the override replaces its occurrence');
  const cancelledOcc = ['UID:s2', 'RECURRENCE-ID;TZID=Europe/Brussels:20261117T090000', 'DTSTART;TZID=Europe/Brussels:20261117T090000', 'STATUS:CANCELLED', 'SUMMARY:Series'];
  assert.deepStrictEqual(on(cal(moved, cancelledOcc), '2026-11-17'), [], 'a cancelled occurrence is gone');
  assert.deepStrictEqual(on(cal(moved, cancelledOcc), '2026-11-18'), ['09:00 Series'], 'the others stay');
  assert.deepStrictEqual(on(cal(['UID:c', 'DTSTART:20261117T080000Z', 'DTEND:20261117T090000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone']), '2026-11-17'), []);
  assert.deepStrictEqual(on(cal(['UID:c', 'DTSTART:20261117T080000Z', 'DTEND:20261117T090000Z', 'STATUS:CONFIRMED', 'SUMMARY:Here']), '2026-11-17'), ['09:00 Here']);
});

test('a broken or odd calendar never throws: bad dates, no summary, alarms, an unknown rule', () => {
  const text = cal(['UID:1', 'DTSTART:garbage', 'SUMMARY:Bad'], ['UID:2', 'DTSTART:20261117T080000Z'], ['UID:3', 'DTSTART:20261117T080000Z', 'RRULE:FREQ=SECONDLY', 'SUMMARY:Odd rule'],
    ['UID:4', 'DTSTART:20261117T080000Z', 'BEGIN:VALARM', 'SUMMARY:Alarm text', 'END:VALARM', 'SUMMARY:Real']);
  assert.deepStrictEqual(on(text, '2026-11-17'), ['09:00 Odd rule', '09:00 Real']);
});

const local = (iso) => ({ iso, hour: Number(iso.slice(11, 13)) });
const nowAt = (iso) => Date.parse(iso + ':00+01:00'); // Brussels in November
const pick = (text, iso) => t.pickAgenda(text, { zone: Z, shift: 0 }, nowAt(iso), local(iso), (ms) => hhmm(ms));
const DAYCAL = cal(
  ['UID:1', 'DTSTART;TZID=Europe/Brussels:20261117T090000', 'DTEND;TZID=Europe/Brussels:20261117T100000', 'SUMMARY:Morning', 'LOCATION:Room 1'],
  ['UID:2', 'DTSTART;TZID=Europe/Brussels:20261117T140000', 'DTEND;TZID=Europe/Brussels:20261117T150000', 'SUMMARY:Afternoon'],
  ['UID:3', 'DTSTART;TZID=Europe/Brussels:20261117T160000', 'DTEND;TZID=Europe/Brussels:20261117T170000', 'SUMMARY:Late'],
  ['UID:4', 'DTSTART;VALUE=DATE:20261117', 'DTEND;VALUE=DATE:20261118', 'SUMMARY:Birthday'],
  ['UID:5', 'DTSTART;TZID=Europe/Brussels:20261118T083000', 'DTEND;TZID=Europe/Brussels:20261118T090000', 'SUMMARY:Tomorrow first'],
);

test('agenda: the next two of today, all-day first, events already over dropped', () => {
  assert.deepStrictEqual(pick(DAYCAL, '2026-11-17T08:00').items.map((i) => `${i.time} ${i.title}`), ['All day Birthday', '09:00 Morning']);
  assert.deepStrictEqual(pick(DAYCAL, '2026-11-17T11:00').items.map((i) => `${i.time} ${i.title}`), ['All day Birthday', '14:00 Afternoon']);
  assert.deepStrictEqual(pick(DAYCAL, '2026-11-17T08:00').items[1].loc, 'Room 1');
  assert.strictEqual(pick(DAYCAL, '2026-11-17T08:00').day, 'today');
  assert.deepStrictEqual(pick(DAYCAL, '2026-11-17T14:30').items.map((i) => i.title), ['Birthday', 'Afternoon'], 'an event in progress still counts');
});

test('agenda: from 18:00, or when nothing is left today, tomorrow\'s', () => {
  const a = pick(DAYCAL, '2026-11-17T18:30');
  assert.strictEqual(a.day, 'tomorrow');
  assert.deepStrictEqual(a.items.map((i) => `${i.time} ${i.title}`), ['08:30 Tomorrow first']);
  assert.strictEqual(pick(DAYCAL, '2026-11-17T17:30').day, 'today', 'the Late event is over at 17:00 but the all-day one stays');
  const noToday = cal(['UID:5', 'DTSTART;TZID=Europe/Brussels:20261118T083000', 'DTEND;TZID=Europe/Brussels:20261118T090000', 'SUMMARY:Tomorrow first']);
  assert.strictEqual(pick(noToday, '2026-11-17T09:00').day, 'tomorrow', 'nothing today at all');
  assert.deepStrictEqual(pick(cal(), '2026-11-17T09:00'), { day: 'today', items: [] });
});

// the fetch: limits and failures
const bodyOf = (chunks) => ({ getReader: () => { let i = 0; return { read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }), cancel: async () => { chunks.cancelled = true; } }; } });
const ICSURL = 'https://calendar.example.org/private/SECRET-TOKEN-123/basic.ics';
const fa = (text) => t.fetchAgenda(ICSURL, 'en', { zone: Z, shift: 0 }, nowAt('2026-11-17T08:00'), local('2026-11-17T08:00'), '12h');

test('fetchAgenda: a calendar is read, shown with the user\'s time format; tomorrow labelled', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => DAYCAL });
  const a = await fa();
  assert.deepStrictEqual(a.items.map((i) => i.time), ['All day', '9:00 AM'], '12h setting');
  assert.strictEqual(a.label, '');
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => DAYCAL });
  const b = await t.fetchAgenda(ICSURL, 'de', { zone: Z, shift: 0 }, nowAt('2026-11-17T19:00'), local('2026-11-17T19:00'), '24h');
  assert.strictEqual(b.items[0].time, 'Mi 08:30', 'tomorrow in the account language: the weekday short, 24h setting');
});

test('fetchAgenda: the byte cap (stream and text), a failed or refused fetch, not a calendar: null', async () => {
  const big = new Uint8Array(900000).fill(65);
  const chunks = [big, big, big];
  globalThis.fetch = async () => ({ ok: true, status: 200, body: bodyOf(chunks) });
  assert.strictEqual(await fa(), null, 'a stream over 2 MB stops');
  assert.ok(chunks.cancelled, 'and is cancelled, not read to the end');
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(2000001) });
  assert.strictEqual(await fa(), null, 'text over the cap');
  globalThis.fetch = async () => ({ ok: true, status: 200, body: bodyOf([new TextEncoder().encode(DAYCAL)]) });
  assert.ok(await fa(), 'a stream under the cap is read');
  globalThis.fetch = async () => { throw new Error('offline ' + ICSURL); };
  await assert.rejects(fa());
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  assert.strictEqual(await fa(), null);
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>sign in</html>' });
  assert.strictEqual(await fa(), null, 'HTML is not a calendar');
});

test('icsUrl: https only (webcal and http are upgraded), anything else is no link', () => {
  const u = (v) => t.icsUrl({ trmnl: { plugin_settings: { custom_fields_values: { ics_url: v } } } });
  assert.strictEqual(u('webcal://x.org/a.ics'), 'https://x.org/a.ics');
  assert.strictEqual(u(' http://x.org/a.ics '), 'https://x.org/a.ics');
  assert.strictEqual(u('https://x.org/a.ics'), 'https://x.org/a.ics');
  for (const bad of ['', undefined, 'not a link', 'ftp://x.org/a.ics', 'javascript:alert(1)']) assert.strictEqual(u(bad), '');
});

// run(): no fetch without a link, and the link is nowhere in what run returns
const fs = require('node:fs');
const path = require('node:path');
const shardJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/fixtures/one-landscape.json'), 'utf8'));
const runWith = async (fields, icsAnswer) => {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (/calendar\.example\.org/.test(url)) return icsAnswer(url);
    return { ok: true, status: 200, json: async () => shardJson };
  };
  const out = await t.run({ trmnl: { device: { width: 2560, height: 1440, model: 'frame', orientation: 'landscape' }, user: { locale: 'en', time_zone_iana: Z }, plugin_settings: { custom_fields_values: fields }, state: {} } });
  return { out, asked };
};

test('run: the agenda toggle without a link fetches nothing and shows nothing; with a link it shows', async () => {
  const none = await runWith({ show_agenda: 'true' }, async () => { throw new Error('must not be asked'); });
  assert.ok(!none.asked.some((u) => /calendar/.test(u)));
  assert.strictEqual(none.out.info, null, 'only the agenda is on and it has nothing: no strip');
  const text = cal(['UID:z', `DTSTART:${new Date(Date.now() + 36e5).toISOString().replace(/[-:]|\.\d+/g, '')}`, 'SUMMARY:Soon']);
  const some = await runWith({ show_agenda: 'true', ics_url: ICSURL }, async () => ({ ok: true, status: 200, text: async () => text }));
  assert.ok(some.out.info.has_agenda);
  assert.ok(some.out.geo.full.info);
});

test('run: the calendar link is never in the merge variables, the state or an error', async () => {
  for (const answer of [async () => ({ ok: true, status: 200, text: async () => DAYCAL }), async () => { throw new Error('offline ' + ICSURL); }, async () => ({ ok: false, status: 500 })]) {
    const { out } = await runWith({ show_agenda: 'true', show_date: 'true', ics_url: ICSURL }, answer);
    const json = JSON.stringify(out);
    assert.ok(!json.includes('SECRET-TOKEN'), 'the link is not in the output');
    assert.ok(!json.includes('calendar.example.org'));
  }
  // and a failing shard fetch (the debug text) does not carry it either
  globalThis.fetch = async (url) => { throw new Error('boom ' + url); };
  const out = await t.run({ trmnl: { device: { width: 800, height: 480 }, plugin_settings: { custom_fields_values: { show_agenda: 'true', ics_url: ICSURL } } } });
  assert.ok(!JSON.stringify(out).includes('SECRET-TOKEN'));
});
