// اجتماعات الفعاليات (الترحيلة ٠٤٠): موعدٌ يُنشأ ويُدعى إليه، وتعارضٌ يُنبَّه ولا يمنع.
//
// كل سيناريو هنا يسأل عن قرارٍ معلن: من ينشئ ومن يعدّل ومن يحذف، ومتى يُنبَّه على التعارض،
// وماذا يصل المدعوين (إشعارٌ وبريد)، وما الذي يبقى في سجل التدقيق. والحكم على الخدمة مباشرةً
// بلا طبقة نقل — كاختبارات البطاقات المجاورة سطراً سطراً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-meetings-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, ev, mt;
const T = new Date().toISOString();
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const D1 = day(1);

const user = (id, role, extra = {}) => ({
  id, username: id.replace(/^u_/, ''), role_id: role, sector_id: 'SOL', scope: 'own',
  projectIds: new Set(), teamIds: new Set(), ...extra,
});
const LEAD = user('u_lead', 'sector_lead', { name_ar: 'قائد القطاع', scope: 'sector' });
const SARA = user('u_sara', 'consultant', { name_ar: 'سارة' });
const KHALID = user('u_khalid', 'consultant', { name_ar: 'خالد' });
const VIEWER = user('u_viewer', 'viewer', { name_ar: 'مشاهد', scope: 'sector' });
const BD_HEAD = user('u_bdhead', 'bd_head', { name_ar: 'رئيس تطوير الأعمال', scope: 'company' });
const EXT = user('u_ext', 'external', { name_ar: 'زائر', sector_id: null });
// موظفٌ يحمل منح v5.60 الشخصية «يعدّل الفعاليات» — يدير الاجتماعات دون أن يكون دوره إدارياً.
const MAZIN = user('u_mazin', 'employee', { name_ar: 'مازن',
  departmentGrants: [{ resource: 'event', action: 'update', department_id: 'D1' }] });
const CTX = (u) => ({ user: u, ip: '127.0.0.1' });

let EV1, EV2, M1;

const PROTECTED = [
  ['opportunity', 'COALESCE(updated_at, created_at)'], ['client', 'COALESCE(updated_at, created_at)'],
  ['contact', 'created_at'], ['project', 'COALESCE(updated_at, created_at)'],
  ['document', 'created_at'], ['document_blob', 'created_at'],
];
async function snapshot() {
  const out = {};
  for (const [t, col] of PROTECTED) {
    const agg = await db.get(`SELECT COUNT(*) AS n, MAX(${col}) AS t FROM ${t}`);
    out[t] = { n: Number(agg.n), t: agg.t, body: JSON.stringify(await db.all(`SELECT * FROM ${t} ORDER BY 1`)) };
  }
  return out;
}
let ISO_BEFORE;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ev = await import('../../src/modules/events/events.js');
  mt = await import('../../src/modules/events/meetings.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  for (const u of [LEAD, SARA, KHALID, VIEWER, BD_HEAD, EXT, MAZIN]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T,
      email: u.id === EXT.id ? null : u.username + '@evc.sa' });
  }
  // حسابان لحالات الرفض: موقوفٌ ومحذوف — الدعوة لا تصل إليهما.
  await db.insert('app_user', { id: 'u_stopped', username: 'stopped', name_ar: 'موقوف', role_id: 'employee',
    sector_id: 'SOL', scope: 'own', active: 0, created_at: T });
  await db.insert('app_user', { id: 'u_gone', username: 'gone', name_ar: 'محذوف', role_id: 'employee',
    sector_id: 'SOL', scope: 'own', active: 1, created_at: T, deleted_at: T });
  // شهودُ العزل — كاختبار البطاقات: الحكم على موجودٍ لا على فراغ.
  await db.insert('client', { id: 'ISO-CL', name_ar: 'عميل شاهد', created_at: T });
  await db.insert('contact', { id: 'ISO-CT', client_id: 'ISO-CL', name: 'جهة اتصال شاهدة', created_at: T });
  await db.insert('opportunity', { id: 'ISO-OPP', title_ar: 'فرصة شاهدة', client_id: 'ISO-CL', sector_id: 'SOL', created_at: T });
  await db.insert('project', { id: 'ISO-PRJ', name_ar: 'مشروع شاهد', sector_id: 'SOL', status: 'ACTIVE', created_at: T });
  await db.insert('document', { id: 'ISO-DOC', name: 'مستند شاهد', project_id: 'ISO-PRJ', created_at: T });
  await db.insert('document_blob', { document_id: 'ISO-DOC', content: Buffer.from('شاهد'), mime: 'text/plain', created_at: T });
  ISO_BEFORE = await snapshot();
  EV1 = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض الاختبار الأول', starts_on: day(0), ends_on: day(3) });
  EV2 = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض الاختبار الثاني', starts_on: day(0), ends_on: day(3) });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── الترحيلة ──────────────────────────────────────────────────────────────────
test('الترحيلة ٠٤٠ مطبَّقة مرة واحدة، وملفها بلا علامة استفهام لاتينية ولا ALTER TABLE، وكل عبارة فيها IF NOT EXISTS', async () => {
  const applied = await db.all("SELECT version FROM schema_migration WHERE version = '040_event_meetings.sql'");
  assert.equal(applied.length, 1);
  const sql = readFileSync(join(ROOT, 'migrations/040_event_meetings.sql'), 'utf8');
  assert.ok(!sql.includes('?'), 'علامة استفهام لاتينية في الترحيلة — تُفسد الربط على Postgres');
  const code = sql.replace(/--[^\n]*/g, '');
  assert.ok(!/ALTER\s+TABLE/i.test(code));
  const creates = code.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b[^\n]*/gi) || [];
  assert.equal(creates.length, 6, 'جدولان وأربعة فهارس');
  for (const c of creates) assert.match(c, /IF NOT EXISTS/, `عبارة بلا IF NOT EXISTS: ${c}`);
});

// ── الدوال الصرفة ─────────────────────────────────────────────────────────────
test('التداخل: جدول الصدق — التلامس ليس تداخلاً والاحتواء تداخل', () => {
  assert.equal(mt.overlaps('09:00', '10:00', '10:00', '11:00'), false, 'التلامس عند 10:00');
  assert.equal(mt.overlaps('09:00', '10:00', '09:30', '11:00'), true, 'تقاطع جزئي');
  assert.equal(mt.overlaps('09:00', '12:00', '10:00', '11:00'), true, 'احتواء كامل');
  assert.equal(mt.overlaps('09:00', '10:00', '11:00', '12:00'), false, 'منفصلان');
  assert.equal(mt.overlaps('10:00', '11:00', '09:00', '10:00'), false, 'التلامس معكوساً');
});

test('قراءة الوقت: الأرقام العربية تُطوى، والحشو يُكمَل، والمحال يُرفض', () => {
  assert.equal(mt.asTime('٠٩:٣٠'), '09:30');
  assert.equal(mt.asTime('9:30'), '09:30');
  assert.equal(mt.asTime('23:59'), '23:59');
  assert.equal(mt.asTime('25:00'), null);
  assert.equal(mt.asTime('09:60'), null);
  assert.equal(mt.asTime('0930'), null);
  assert.equal(mt.asTime(''), null);
});

test('حالة الاجتماع تُحسب من اليوم والساعة المحقونين — قادمٌ فجارٍ فمنتهٍ', () => {
  const m = { meeting_date: '2026-09-01', start_time: '09:00', end_time: '10:00' };
  assert.equal(mt.meetingState(m, { today: '2026-08-31', nowHm: '12:00' }), 'قادم');
  assert.equal(mt.meetingState(m, { today: '2026-09-01', nowHm: '08:59' }), 'قادم');
  assert.equal(mt.meetingState(m, { today: '2026-09-01', nowHm: '09:00' }), 'جارٍ الآن');
  assert.equal(mt.meetingState(m, { today: '2026-09-01', nowHm: '09:59' }), 'جارٍ الآن');
  assert.equal(mt.meetingState(m, { today: '2026-09-01', nowHm: '10:00' }), 'انتهى');
  assert.equal(mt.meetingState(m, { today: '2026-09-02', nowHm: '08:00' }), 'انتهى');
});

// ── الإنشاء ───────────────────────────────────────────────────────────────────
test('استشاريةٌ تنشئ اجتماعاً وتدعو زميليها: تُضاف هي تلقائياً، والأسماء تُنسخ، والأثر والإشعار والبريد تُكتب', async () => {
  const before = Number((await db.get('SELECT COUNT(*) AS n FROM email_queue')).n);
  const { meeting, conflicts } = await mt.createMeeting(CTX(SARA), EV1.id, {
    title: 'اجتماع تعريفي', meeting_date: D1, start_time: '09:00', end_time: '10:00',
    join_url: 'teams.microsoft.com/l/meetup/abc', location: 'الجناح',
    attendee_ids: [KHALID.id, LEAD.id],
  });
  M1 = meeting;
  assert.equal(conflicts.length, 0);
  assert.equal(meeting.join_url, 'https://teams.microsoft.com/l/meetup/abc', 'الرابط يُكمَّل https تلقائياً');
  const names = meeting.attendees.map((a) => a.user_name).sort();
  assert.deepEqual(names, ['خالد', 'سارة', 'قائد القطاع'], 'المنشئة ضمن المدعوين تلقائياً وبأسمائهم');
  const a = await db.get("SELECT detail_json FROM audit_log WHERE resource = 'event_meeting' AND action = 'create' AND resource_id = ?", [meeting.id]);
  assert.ok(a, 'إنشاء الاجتماع بلا أثر تدقيق');
  assert.equal(JSON.parse(a.detail_json).attendees, 3);
  // الإشعار لغير المنشئة فقط.
  const notifs = await db.all("SELECT user_id FROM notification WHERE ref_resource = 'event_meeting' AND ref_id = ?", [meeting.id]);
  assert.deepEqual(notifs.map((n) => n.user_id).sort(), [KHALID.id, LEAD.id].sort());
  // بريدٌ واحد إلى عناوين المدعوين الثلاثة.
  const q = await db.all('SELECT to_json, subject, status FROM email_queue ORDER BY created_at');
  assert.equal(q.length, before + 1, 'رسالة دعوة واحدة لا أكثر');
  const sent = JSON.parse(q[q.length - 1].to_json).sort();
  assert.deepEqual(sent, ['khalid@evc.sa', 'lead@evc.sa', 'sara@evc.sa']);
  assert.equal(q[q.length - 1].subject, 'دعوة اجتماع في سند', 'العنوان بلا تفصيل');
  const log = await db.get("SELECT detail FROM email_log ORDER BY at DESC, id DESC LIMIT 1");
  assert.equal(log.detail, 'meeting_invite');
});

test('التحقق: عنوانٌ فارغ ووقتٌ محالٌ ونهايةٌ قبل البداية وروابطُ ومدعوّون فاسدون — كلها تُرفض برسالة عربية', async () => {
  const base = { title: 'صالح', meeting_date: D1, start_time: '09:00', end_time: '10:00' };
  await assert.rejects(mt.createMeeting(CTX(SARA), EV1.id, { ...base, title: '' }), /عنوان الاجتماع/);
  await assert.rejects(mt.createMeeting(CTX(SARA), EV1.id, { ...base, meeting_date: 'غداً' }), /سنة-شهر-يوم/);
  await assert.rejects(mt.createMeeting(CTX(SARA), EV1.id, { ...base, start_time: '25:00' }), /وقت البداية/);
  await assert.rejects(mt.createMeeting(CTX(SARA), EV1.id, { ...base, end_time: '09:00' }), /وقت النهاية قبل/);
  await assert.rejects(mt.createMeeting(CTX(SARA), EV1.id, { ...base, end_time: '08:00' }), /وقت النهاية قبل/);
  await assert.rejects(mt.createMeeting(CTX(SARA), EV1.id, { ...base, join_url: 'javascript:alert(1)' }), /رابط الاجتماع/);
  await assert.rejects(mt.createMeeting(CTX(SARA), EV1.id, { ...base, attendee_ids: ['u_stopped'] }), /ليسوا حسابات نشطة/);
  await assert.rejects(mt.createMeeting(CTX(SARA), EV1.id, { ...base, attendee_ids: ['u_gone'] }), /ليسوا حسابات نشطة/);
  await assert.rejects(mt.createMeeting(CTX(SARA), EV1.id, { ...base, attendee_ids: ['u_majhool'] }), /ليسوا حسابات نشطة/);
  // والوقت بالأرقام العربية يُقبل.
  const ok = await mt.createMeeting(CTX(SARA), EV1.id, { ...base, title: 'وقتٌ عربي', start_time: '١١:٠٠', end_time: '١١:٣٠' });
  assert.equal(ok.meeting.start_time, '11:00');
  await mt.deleteMeeting(CTX(SARA), ok.meeting.id);
});

test('المشاهد لا ينشئ، والخارجي لا يقرأ أصلاً', async () => {
  await assert.rejects(mt.createMeeting(CTX(VIEWER), EV1.id, { title: 'س', meeting_date: D1, start_time: '09:00', end_time: '10:00' }), /للمشاهدة فقط/);
  await assert.rejects(mt.listMeetings(EXT, EV1.id), /خارج صلاحياتك/);
  const rows = await mt.listMeetings(VIEWER, EV1.id);
  assert.ok(rows.length >= 1, 'المشاهد يقرأ القائمة');
  assert.equal(rows[0].may_edit, false);
});

// ── التعارض ───────────────────────────────────────────────────────────────────
test('التعارض عبر الفعاليات: خالدٌ مدعوٌّ في التاسعة هنا، فدعوته في التاسعة هناك تنبيهٌ — ويُحفظ الاجتماع رغم ذلك', async () => {
  const { meeting, conflicts } = await mt.createMeeting(CTX(LEAD), EV2.id, {
    title: 'اجتماع متزامن', meeting_date: D1, start_time: '09:30', end_time: '10:30',
    attendee_ids: [KHALID.id],
  });
  assert.ok(conflicts.length >= 1, 'لا تنبيه تعارض');
  const k = conflicts.find((c) => c.user_id === KHALID.id);
  assert.ok(k, 'خالد ليس في التنبيه');
  assert.equal(k.title, 'اجتماع تعريفي');
  assert.equal(k.event_name, 'معرض الاختبار الأول', 'التنبيه يسمّي الفعالية الأخرى');
  assert.ok(await db.get('SELECT id FROM event_meeting WHERE id = ?', [meeting.id]), 'الاجتماع حُفظ رغم التعارض');
  await mt.deleteMeeting(CTX(LEAD), meeting.id);
});

test('التلامس ليس تعارضاً، والفحص الحيّ يستثني الاجتماع نفسه، والمحذوف لا يُحتسب', async () => {
  // ينتهي الأول 10:00 — بدايةٌ من 10:00 لا تتعارض.
  const touch = await mt.checkConflicts(SARA, { meeting_date: D1, start_time: '10:00', end_time: '11:00', attendee_ids: [KHALID.id] });
  assert.equal(touch.conflicts.filter((c) => c.meeting_id === M1.id).length, 0, 'التلامس حُسب تعارضاً');
  // تعديل الاجتماع نفسه لا يتعارض مع نفسه.
  const self = await mt.checkConflicts(SARA, { meeting_date: D1, start_time: '09:00', end_time: '10:00',
    attendee_ids: [KHALID.id], except_id: M1.id });
  assert.equal(self.conflicts.filter((c) => c.meeting_id === M1.id).length, 0, 'الاجتماع تعارض مع نفسه');
  // والفحص بلا استثناءٍ يرى التعارض فعلاً.
  const real = await mt.checkConflicts(SARA, { meeting_date: D1, start_time: '09:00', end_time: '10:00', attendee_ids: [KHALID.id] });
  assert.ok(real.conflicts.some((c) => c.meeting_id === M1.id));
  // مدخلٌ ناقص = لا تنبيه ولا خطأ (الفحص الحيّ يعمل أثناء الكتابة).
  const partial = await mt.checkConflicts(SARA, { meeting_date: D1, start_time: '09:00', attendee_ids: [KHALID.id] });
  assert.deepEqual(partial.conflicts, []);
});

// ── «اجتماعاتي» ───────────────────────────────────────────────────────────────
test('«اجتماعاتي»: المدعو يرى، وغير المدعو لا يرى، والمنشئ يرى ولو أُخرج من القائمة', async () => {
  const mine = await mt.listMeetings(KHALID, EV1.id, { mine: 1 });
  assert.ok(mine.some((m) => m.id === M1.id), 'المدعو لا يرى اجتماعه');
  const not = await mt.listMeetings(BD_HEAD, EV1.id, { mine: 1 });
  assert.equal(not.some((m) => m.id === M1.id), false, 'غير المدعو يراه في «اجتماعاتي»');
  const alls = await mt.listMeetings(BD_HEAD, EV1.id);
  assert.ok(alls.some((m) => m.id === M1.id), '«الكل» لا يعرضه');
  // سارة تُخرج نفسها من القائمة — وتبقى تراه لأنها المنشئة (والمنشئ يُعاد ضمّه دوماً).
  const upd = await mt.updateMeeting(CTX(SARA), M1.id, { attendee_ids: [KHALID.id, LEAD.id] });
  assert.ok(upd.meeting.attendees.some((a) => a.user_id === SARA.id), 'المنشئ أُخرج من قائمته');
});

// ── الملكية ───────────────────────────────────────────────────────────────────
test('الملكية: الزميل لا يعدّل اجتماع غيره، ومن يدير الفعالية يعدّل، وحامل المنح الشخصية يعدّل، والحذف أضيق', async () => {
  await assert.rejects(mt.updateMeeting(CTX(KHALID), M1.id, { title: 'اختطاف' }), /لمن أنشأه أو لمن يدير/);
  const byLead = await mt.updateMeeting(CTX(LEAD), M1.id, { location: 'قاعة الاجتماعات' });
  assert.equal(byLead.meeting.location, 'قاعة الاجتماعات');
  const byGrant = await mt.updateMeeting(CTX(MAZIN), M1.id, { note: 'ملاحظة من حامل المنح' });
  assert.equal(byGrant.meeting.note, 'ملاحظة من حامل المنح');
  const byBdHead = await mt.updateMeeting(CTX(BD_HEAD), M1.id, { note: 'ملاحظة المراجعة' });
  assert.equal(byBdHead.meeting.note, 'ملاحظة المراجعة');
  // رئيس تطوير الأعمال يعدّل أي اجتماع ولا يحذف اجتماع غيره — قاعدته «لا حذف» كما هي.
  await assert.rejects(mt.deleteMeeting(CTX(BD_HEAD), M1.id), /لمن أنشأه أو لقيادة الفريق/);
  await assert.rejects(mt.deleteMeeting(CTX(KHALID), M1.id), /لمن أنشأه أو لقيادة الفريق/);
  // واجتماعه هو يحذفه بنفسه.
  const own = await mt.createMeeting(CTX(BD_HEAD), EV1.id, { title: 'اجتماعه هو', meeting_date: D1, start_time: '15:00', end_time: '16:00' });
  assert.deepEqual(await mt.deleteMeeting(CTX(BD_HEAD), own.meeting.id), { ok: true });
});

// ── التعديل ───────────────────────────────────────────────────────────────────
test('تبديل المدعوين فرقاً لا مسحاً: المزال يُحذف صُلباً، والمضاف يُدعى ويُشعَر، والأثر يسمّيهما', async () => {
  const beforeQ = Number((await db.get('SELECT COUNT(*) AS n FROM email_queue')).n);
  const { meeting } = await mt.updateMeeting(CTX(SARA), M1.id, { attendee_ids: [BD_HEAD.id, LEAD.id] });
  const ids = meeting.attendees.map((a) => a.user_id).sort();
  assert.deepEqual(ids, [BD_HEAD.id, LEAD.id, SARA.id].sort(), 'المنشئة تبقى، خالد يُزال، الرئيس يُضاف');
  const rows = await db.all('SELECT user_id FROM event_meeting_attendee WHERE meeting_id = ?', [M1.id]);
  assert.equal(rows.length, 3, 'صف المُزال بقي في الجدول');
  const a = await db.get("SELECT detail_json FROM audit_log WHERE resource = 'event_meeting' AND action = 'update' AND resource_id = ? ORDER BY at DESC, id DESC LIMIT 1", [M1.id]);
  const detail = JSON.parse(a.detail_json);
  assert.deepEqual(detail.added, ['رئيس تطوير الأعمال']);
  assert.deepEqual(detail.removed, ['خالد']);
  // المضاف وحده يُدعى بالبريد (دعوة لا تنبيه موعد).
  const q = await db.all('SELECT to_json, subject FROM email_queue ORDER BY created_at');
  assert.equal(q.length, beforeQ + 1);
  assert.deepEqual(JSON.parse(q[q.length - 1].to_json), ['bdhead@evc.sa']);
  assert.equal(q[q.length - 1].subject, 'دعوة اجتماع في سند');
});

test('تغيير الموعد يُنبّه الجميع بريداً وإشعاراً، وتعديل الملاحظة وحدها لا يُرسل شيئاً', async () => {
  const beforeQ = Number((await db.get('SELECT COUNT(*) AS n FROM email_queue')).n);
  await mt.updateMeeting(CTX(SARA), M1.id, { start_time: '09:15' });
  const q1 = await db.all('SELECT to_json, subject FROM email_queue ORDER BY created_at');
  assert.equal(q1.length, beforeQ + 1, 'تغيير الموعد بلا بريد');
  assert.equal(q1[q1.length - 1].subject, 'تغيّر موعد اجتماع في سند');
  assert.deepEqual(JSON.parse(q1[q1.length - 1].to_json).sort(), ['bdhead@evc.sa', 'lead@evc.sa', 'sara@evc.sa']);
  await mt.updateMeeting(CTX(SARA), M1.id, { note: 'ملاحظة صامتة' });
  const q2 = Number((await db.get('SELECT COUNT(*) AS n FROM email_queue')).n);
  assert.equal(q2, beforeQ + 1, 'تعديل الملاحظة أرسل بريداً');
  await assert.rejects(mt.updateMeeting(CTX(SARA), M1.id, {}), /حدّد ما تريد تغييره/);
});

// ── الإغلاق والحذف والحدود ────────────────────────────────────────────────────
test('الفعالية المغلقة لا يُنشأ فيها اجتماع، والحذف ناعمٌ يُخفي ويُبطل التعارض ويبقى أثراً', async () => {
  const closed = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض مُغلق', starts_on: day(-5), ends_on: day(-3) });
  await ev.closeEvent(CTX(LEAD), closed.id);
  await assert.rejects(mt.createMeeting(CTX(SARA), closed.id, { title: 'س', meeting_date: D1, start_time: '09:00', end_time: '10:00' }), /مُغلقة/);

  const tmp = await mt.createMeeting(CTX(SARA), EV1.id, { title: 'سيُحذف', meeting_date: D1, start_time: '20:00', end_time: '21:00', attendee_ids: [KHALID.id] });
  await mt.deleteMeeting(CTX(SARA), tmp.meeting.id);
  const rows = await mt.listMeetings(SARA, EV1.id);
  assert.equal(rows.some((m) => m.id === tmp.meeting.id), false, 'المحذوف ما زال يُعرض');
  await assert.rejects(mt.getMeeting(SARA, tmp.meeting.id), /غير موجود/);
  const chk = await mt.checkConflicts(SARA, { meeting_date: D1, start_time: '20:00', end_time: '21:00', attendee_ids: [KHALID.id] });
  assert.equal(chk.conflicts.filter((c) => c.meeting_id === tmp.meeting.id).length, 0, 'المحذوف ما زال يتعارض');
  const a = await db.get("SELECT id FROM audit_log WHERE resource = 'event_meeting' AND action = 'delete' AND resource_id = ?", [tmp.meeting.id]);
  assert.ok(a, 'الحذف بلا أثر');
});

test('اجتماعٌ تحت فعالية محذوفة لا يُقرأ — كقاعدة البطاقات', async () => {
  const gone = await ev.createEvent(CTX(LEAD), { name_ar: 'معرض سيُحذف', starts_on: day(0), ends_on: day(1) });
  const m = await mt.createMeeting(CTX(SARA), gone.id, { title: 'يتيم', meeting_date: D1, start_time: '09:00', end_time: '10:00' });
  await ev.deleteEvent(CTX(LEAD), gone.id);
  await assert.rejects(mt.getMeeting(SARA, m.meeting.id), /غير موجود/);
  await assert.rejects(mt.listMeetings(SARA, gone.id), /الفعالية غير موجودة/);
});

// ── الختام: التغطية والعزل ────────────────────────────────────────────────────
test('كل كتابة اجتماعٍ خلّفت أثر تدقيق — إنشاءً وتعديلاً وحذفاً', async () => {
  for (const action of ['create', 'update', 'delete']) {
    const a = await db.get("SELECT id FROM audit_log WHERE resource = 'event_meeting' AND action = ?", [action]);
    assert.ok(a, `كتابةٌ «${action}» على «event_meeting» بلا أثر`);
  }
});

test('العزل قائم: الجداول المحمية الستة لم تتغيّر صفاً ولا حرفاً طوال السيناريو كله', async () => {
  const after = await snapshot();
  for (const [t] of PROTECTED) {
    assert.equal(after[t].n, ISO_BEFORE[t].n, `عدد صفوف «${t}» تغيّر`);
    assert.equal(after[t].body, ISO_BEFORE[t].body, `محتوى «${t}» تغيّر`);
  }
});
