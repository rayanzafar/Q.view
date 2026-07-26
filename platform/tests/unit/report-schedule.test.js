// وحدة: مواعيد جدولة التقارير + التحكم فيها.
// كان وقت الإرسال ويوم الأسبوع/الشهر مخزَّنين في صف الجدولة ومُهمَلين تماماً: الموعد القادم
// كان يُحسب بإضافة أيام ثابتة (شهري = ٣٠ يوماً) فيزحف الموعد شهراً بعد شهر ويصل التقرير في
// ساعة عشوائية. وكان إيقاف جدولة أو حذفها مستحيلاً إلا بتعديل مباشر على البيانات.
// كل الحساب هنا بتوقيت UTC وفي JS (لا دوال تاريخ في الاستعلامات).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-sched-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { all, get, insert, run, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { nextRun, dueSchedules } = await import('../../src/core/jobs/scheduler.js');
const { createSchedule, setScheduleActive, deleteSchedule, nextRunAt, canControlSchedules } = await import('../../src/core/reports/engine.js');

const T = '2026-01-01T00:00:00.000Z';
const ADMIN = { user: { id: 'u-admin', username: 'demo.admin', role_id: 'admin', scope: 'company', sector_id: null }, ip: '10.0.0.1' };
const LEAD = { user: { id: 'u-lead', username: 'demo.lead', role_id: 'sector_lead', scope: 'sector', sector_id: 'S1' }, ip: '10.0.0.2' };
const LEAD2 = { user: { id: 'u-lead2', username: 'demo.lead2', role_id: 'sector_lead', scope: 'sector', sector_id: 'S2' }, ip: '10.0.0.3' };
const BD = { user: { id: 'u-bd', username: 'demo.bd', role_id: 'bd_manager', scope: 'own', sector_id: 'S1' }, ip: '10.0.0.4' };

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, sort_order: 2, created_at: T });
  await insert('report_definition', { id: 'RD1', key: 'weekly_exec_brief', name_ar: 'الموجز التنفيذي', level: 'company', active: 1, created_at: T });
  await insert('recipient_group', { id: 'RG1', name_ar: 'القيادة التنفيذية', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const auditRows = (resourceId) => all('SELECT * FROM audit_log WHERE resource = ? AND resource_id = ? ORDER BY at', ['report_schedule', resourceId]);
const isHttp = (status) => (e) => e.status === status;

// ── nextRun: احترام وقت الإرسال ويوم الأسبوع ─────────────────────────────────

test('الأسبوعي يقع على يوم الأسبوع المطلوب وبوقت الإرسال المخزَّن', () => {
  const s = { frequency: 'weekly', day_of_week: 2, send_time: '08:30' }; // 2 = الثلاثاء
  // من الأحد ٢٦ يوليو ٢٠٢٦ → الثلاثاء ٢٨ يوليو الساعة ٠٨:٣٠
  assert.equal(nextRun(s, new Date('2026-07-26T09:00:00.000Z')), '2026-07-28T08:30:00.000Z');
  // من صباح الثلاثاء نفسه قبل وقت الإرسال → اليوم نفسه لا الأسبوع القادم
  assert.equal(nextRun(s, new Date('2026-07-28T08:00:00.000Z')), '2026-07-28T08:30:00.000Z');
  // في لحظة الإرسال بالضبط (كما يستدعيها المجدول بعد الإرسال) → الثلاثاء التالي
  assert.equal(nextRun(s, new Date('2026-07-28T08:30:00.000Z')), '2026-08-04T08:30:00.000Z');
});

test('الأسبوعي يبقى على يوم الأسبوع نفسه عبر عشر دورات متتالية', () => {
  const s = { frequency: 'weekly', day_of_week: 4, send_time: '17:05' }; // 4 = الخميس
  let at = new Date('2026-03-01T00:00:00.000Z');
  for (let i = 0; i < 10; i++) {
    const iso = nextRun(s, at);
    const d = new Date(iso);
    assert.equal(d.getUTCDay(), 4, 'يوم الأسبوع يجب أن يبقى الخميس');
    assert.equal(iso.slice(11, 16), '17:05', 'وقت الإرسال يجب أن يبقى كما هو');
    at = d;
  }
});

test('كل أسبوعين: أسبوعان كاملان على يوم الأسبوع نفسه', () => {
  const s = { frequency: 'biweekly', day_of_week: 0, send_time: '08:00' }; // 0 = الأحد
  assert.equal(nextRun(s, new Date('2026-07-26T08:30:00.000Z')), '2026-08-09T08:00:00.000Z');
});

test('اليومي يحترم وقت الإرسال ولا يقفز يوماً كاملاً بلا داعٍ', () => {
  const s = { frequency: 'daily', send_time: '06:15' };
  assert.equal(nextRun(s, new Date('2026-07-26T05:00:00.000Z')), '2026-07-26T06:15:00.000Z');
  assert.equal(nextRun(s, new Date('2026-07-26T06:15:00.000Z')), '2026-07-27T06:15:00.000Z');
});

// ── nextRun: ثبات اليوم في الشهري وما فوقه ───────────────────────────────────

test('الشهري يثبت على اليوم نفسه من كل شهر (لا زحف ٣٠ يوماً)', () => {
  const s = { frequency: 'monthly', day_of_month: 5, send_time: '06:00' };
  let at = new Date('2026-01-05T06:00:00.000Z');
  const got = [];
  for (let i = 0; i < 6; i++) { const iso = nextRun(s, at); got.push(iso); at = new Date(iso); }
  assert.deepEqual(got, [
    '2026-02-05T06:00:00.000Z', '2026-03-05T06:00:00.000Z', '2026-04-05T06:00:00.000Z',
    '2026-05-05T06:00:00.000Z', '2026-06-05T06:00:00.000Z', '2026-07-05T06:00:00.000Z',
  ]);
});

test('الشهري في الأشهر القصيرة: يُقصَّر لآخر يوم ثم يعود لليوم المطلوب', () => {
  const s = { frequency: 'monthly', day_of_month: 31, send_time: '09:00' };
  assert.equal(nextRun(s, new Date('2026-01-31T09:00:00.000Z')), '2026-02-28T09:00:00.000Z');
  assert.equal(nextRun(s, new Date('2026-02-28T09:00:00.000Z')), '2026-03-31T09:00:00.000Z');
  // سنة كبيسة: ٢٩ فبراير
  assert.equal(nextRun(s, new Date('2028-01-31T09:00:00.000Z')), '2028-02-29T09:00:00.000Z');
});

test('ربع سنوي وسنوي: ثلاثة أشهر واثنا عشر شهراً على اليوم نفسه', () => {
  assert.equal(nextRun({ frequency: 'quarterly', day_of_month: 1, send_time: '08:00' }, new Date('2026-07-26T09:00:00.000Z')), '2026-10-01T08:00:00.000Z');
  assert.equal(nextRun({ frequency: 'yearly', day_of_month: 1, send_time: '08:00' }, new Date('2026-03-15T09:00:00.000Z')), '2027-03-01T08:00:00.000Z');
});

// ── nextRun: ضمانات عامة ──────────────────────────────────────────────────────

test('الموعد القادم دائماً في المستقبل مهما كانت اللحظة المرجعية', () => {
  const moments = ['2026-01-31T23:59:59.000Z', '2026-02-28T00:00:00.000Z', '2028-02-29T12:00:00.000Z',
    '2026-12-31T23:00:00.000Z', '2026-07-26T08:00:00.000Z', '2026-06-30T18:30:00.000Z'];
  const freqs = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'];
  for (const iso of moments) {
    const at = new Date(iso);
    for (const frequency of freqs) {
      for (const s of [{ frequency, send_time: '08:00', day_of_week: 3, day_of_month: 31 },
        { frequency, send_time: null, day_of_week: null, day_of_month: null },
        { frequency, send_time: '23:59', day_of_week: 0, day_of_month: 1 }]) {
        const next = new Date(nextRun(s, at));
        assert.ok(next > at, `${frequency} من ${iso} يجب أن يعطي موعداً لاحقاً وليس ${next.toISOString()}`);
        assert.ok(!Number.isNaN(next.getTime()), 'الموعد يجب أن يكون تاريخاً صالحاً');
      }
    }
  }
});

test('قيم ناقصة أو غير صالحة: وقت افتراضي ٠٨:٠٠ وتكرار غير معروف = أسبوعي', () => {
  assert.equal(nextRun({ frequency: 'weekly', day_of_week: 2 }, new Date('2026-07-26T09:00:00.000Z')), '2026-07-28T08:00:00.000Z');
  assert.equal(nextRun({ frequency: 'weekly', day_of_week: 9, send_time: 'غير صالح' }, new Date('2026-07-26T09:00:00.000Z')), '2026-08-02T08:00:00.000Z');
  assert.equal(nextRun({ frequency: 'custom', send_time: '08:00' }, new Date('2026-07-26T09:00:00.000Z')), '2026-08-02T08:00:00.000Z');
  assert.equal(nextRunAt({}, new Date('2026-07-26T09:00:00.000Z')), '2026-08-02T08:00:00.000Z');
});

// ── إنشاء الجدولة: تخزين اليوم والوقت وحساب الموعد القادم منهما ───────────────

test('إنشاء جدولة: يوم الأسبوع ووقت الإرسال يُخزَّنان ويُبنى منهما الموعد القادم', async () => {
  const s = await createSchedule(ADMIN, { reportId: 'RD1', frequency: 'weekly', recipientGroupId: 'RG1',
    sendTime: '7:45', dayOfWeek: 2, sectorId: 'S1' });
  assert.equal(s.day_of_week, 2);
  assert.equal(s.send_time, '07:45');
  assert.equal(s.active, 1);
  const next = new Date(s.next_run_at);
  assert.equal(next.getUTCDay(), 2, 'الموعد القادم يجب أن يقع يوم الثلاثاء');
  assert.equal(s.next_run_at.slice(11, 16), '07:45');
  assert.ok(next > new Date(), 'الموعد القادم يجب أن يكون في المستقبل');
  const rows = await auditRows(s.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'create');
  assert.equal(rows[0].user_id, 'u-admin');
});

test('إنشاء جدولة بلا يوم محدد: يوم الإنشاء يُثبَّت في الصف فلا يزحف الموعد لاحقاً', async () => {
  const at = new Date();
  const w = await createSchedule(ADMIN, { reportId: 'RD1', frequency: 'weekly', sectorId: 'S1', sendTime: '09:00' });
  assert.equal(w.day_of_week, at.getUTCDay());
  assert.equal(new Date(w.next_run_at).getUTCDay(), at.getUTCDay());
  const m = await createSchedule(ADMIN, { reportId: 'RD1', frequency: 'monthly', sectorId: 'S1', sendTime: '09:00' });
  assert.equal(m.day_of_month, at.getUTCDate());
  const d = new Date(m.next_run_at);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  assert.equal(d.getUTCDate(), Math.min(at.getUTCDate(), lastDay), 'اليوم نفسه من الشهر (أو آخر يوم في الأشهر القصيرة)');
});

test('إنشاء جدولة: وقت إرسال أو تكرار غير صالح يُرفض برسالة عربية', async () => {
  await assert.rejects(() => createSchedule(ADMIN, { reportId: 'RD1', frequency: 'weekly', sendTime: '25:00' }), isHttp(400));
  await assert.rejects(() => createSchedule(ADMIN, { reportId: 'RD1', frequency: 'كل ساعة' }), isHttp(400));
  await assert.rejects(() => createSchedule(ADMIN, { frequency: 'weekly' }), isHttp(400));
});

test('إنشاء جدولة: الأدوار غير الإدارية ممنوعة', async () => {
  await assert.rejects(() => createSchedule(BD, { reportId: 'RD1', frequency: 'weekly' }), isHttp(403));
});

test('الواجهة تسأل نفس مصدر القرار عمّن يملك التحكم في الجدولة', () => {
  assert.equal(canControlSchedules(ADMIN.user), true);
  assert.equal(canControlSchedules(LEAD.user), true);
  assert.equal(canControlSchedules(BD.user), false);
  assert.equal(canControlSchedules({ role_id: 'project_manager' }), false);
  assert.equal(canControlSchedules(null), false);
});

// ── الإيقاف والتفعيل ─────────────────────────────────────────────────────────

test('إيقاف الجدولة يمنع استحقاقها، والتفعيل يعيدها بموعد قادم في المستقبل', async () => {
  const s = await createSchedule(ADMIN, { reportId: 'RD1', frequency: 'daily', recipientGroupId: 'RG1',
    sendTime: '08:00', sectorId: 'S1' });
  // نجعلها مستحقة الآن (موعدها في الماضي) للتأكد أن الإيقاف — لا مرور الوقت — هو ما يمنع الإرسال.
  await run('UPDATE report_schedule SET next_run_at = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', s.id]);
  const dueBefore = await dueSchedules(new Date('2026-07-26T09:00:00.000Z'));
  assert.ok(dueBefore.some((r) => r.id === s.id), 'قبل الإيقاف: الجدولة مستحقة');

  const stopped = await setScheduleActive(ADMIN, s.id, 0);
  assert.equal(stopped.active, 0);
  const dueAfter = await dueSchedules(new Date('2026-07-26T09:00:00.000Z'));
  assert.ok(!dueAfter.some((r) => r.id === s.id), 'بعد الإيقاف: لا استحقاق ولا إرسال');

  const back = await setScheduleActive(ADMIN, s.id, 1);
  assert.equal(back.active, 1);
  assert.ok(new Date(back.next_run_at) > new Date(), 'التفعيل يعيد حساب الموعد القادم فلا يُرسَل فوراً بموعد قديم');
  assert.equal(back.next_run_at.slice(11, 16), '08:00');

  const rows = await auditRows(s.id);
  assert.deepEqual(rows.map((r) => r.action), ['create', 'update', 'update']);
  assert.equal(JSON.parse(rows[1].detail_json).active, 0);
  assert.equal(JSON.parse(rows[2].detail_json).active, 1);
  assert.equal(rows[1].sector_id, 'S1');
});

test('الإيقاف: قيم الحالة المقبولة وقيمة ناقصة مرفوضة', async () => {
  const s = await createSchedule(ADMIN, { reportId: 'RD1', frequency: 'weekly', sectorId: 'S1' });
  assert.equal((await setScheduleActive(ADMIN, s.id, false)).active, 0);
  assert.equal((await setScheduleActive(ADMIN, s.id, 'true')).active, 1);
  await assert.rejects(() => setScheduleActive(ADMIN, s.id, null), isHttp(400));
  await assert.rejects(() => setScheduleActive(ADMIN, '', 0), isHttp(400));
  await assert.rejects(() => setScheduleActive(ADMIN, 'rs_لا_وجود_له', 0), isHttp(404));
});

test('الإيقاف: نفس صلاحية الإنشاء — الأدوار غير الإدارية ممنوعة', async () => {
  const s = await createSchedule(ADMIN, { reportId: 'RD1', frequency: 'weekly', sectorId: 'S1' });
  await assert.rejects(() => setScheduleActive(BD, s.id, 0), isHttp(403));
  await assert.rejects(() => deleteSchedule(BD, s.id), isHttp(403));
  const rows = await auditRows(s.id);
  assert.equal(rows.length, 1, 'المحاولة المرفوضة لا تكتب شيئاً');
});

test('النطاق: قائد قطاع يتحكم بجدولة قطاعه فقط', async () => {
  const s = await createSchedule(LEAD, { reportId: 'RD1', frequency: 'weekly' });
  assert.equal(s.sector_id, 'S1', 'الجدولة تُنسب لقطاع منشئها');
  assert.equal((await setScheduleActive(LEAD, s.id, 0)).active, 0);
  await assert.rejects(() => setScheduleActive(LEAD2, s.id, 1), isHttp(403));
  const company = await createSchedule(ADMIN, { reportId: 'RD1', frequency: 'weekly' });
  assert.equal(company.sector_id, null);
  await assert.rejects(() => setScheduleActive(LEAD, company.id, 0), isHttp(403));
});

test('حذف الجدولة: توقف نهائياً مع أثر في سجل التدقيق', async () => {
  const s = await createSchedule(ADMIN, { reportId: 'RD1', frequency: 'monthly', dayOfMonth: 3, sectorId: 'S1' });
  assert.equal(s.day_of_month, 3);
  const res = await deleteSchedule(ADMIN, s.id);
  assert.equal(res.ok, true);
  const row = await get('SELECT * FROM report_schedule WHERE id = ?', [s.id]);
  assert.equal(row.active, 0);
  const dueAfter = await dueSchedules(new Date('2099-01-01T00:00:00.000Z'));
  assert.ok(!dueAfter.some((r) => r.id === s.id), 'المحذوفة لا تُرسِل شيئاً بعد اليوم');
  const rows = await auditRows(s.id);
  assert.deepEqual(rows.map((r) => r.action), ['create', 'delete']);
});
