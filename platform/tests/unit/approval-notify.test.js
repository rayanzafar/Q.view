// بريد الاعتمادات — القرار النقي بكل صفوف جدول القواعد، ثم الكنسة على القاعدة الحقيقية.
//
// النموذج هو `report-schedule.test.js`: الدوال النقية تُختبر بحقن اللحظة (لا انتظار ولا
// ساعة حقيقية)، والكنسة تُثبَت على طلبات اعتماد حقيقية من المسار الحقيقي (موظف يضيف مهمة
// مرتبطة بمشروع ⟵ طلب موجَّه إلى مديره) لا على صفوف مصنوعة.
//
// حدود النافذة تُقرأ بتوقيت الرياض (+٣): ‏04:59Z = ‏07:59 (خارجها) و05:00Z = ‏08:00 (داخلها)
// و14:59Z = ‏17:59 (داخلها) و15:00Z = ‏18:00 (خارجها).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-aprmail-'));
process.env.SANAD_DB = join(dir, 'a.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const tasks = await import('../../src/modules/pmo/tasks.js');
const {
  approvalMailDecision, sweepApprovalMail,
  COOLDOWN_MS, BACKLOG_COOLDOWN_MS, BACKLOG_THRESHOLD,
} = await import('../../src/modules/workflow/approval-notify.js');

const at = (iso) => new Date(iso);
const T = '2026-08-01T00:00:00Z';
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });
const EMP = { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', employee_id: 'e_emp', projectIds: new Set(['PRJ']) };

// أدوات القرار النقي: صفوف معلَّقة بأزمنة إنشاء صريحة، وحالٌ صريح.
const p = (createdAt) => ({ created_at: createdAt });
const st = (lastSent, reminderDate) => ({ last_sent_at: lastSent || null, last_reminder_date: reminderDate || null });

before(async () => {
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_mgr', username: 'mgr', name_ar: 'مدير الابتكار', role_id: 'department_manager',
    scope: 'department', sector_id: 'SOL', email: 'mgr@evc.test', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', employee_id: 'e_emp', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_ghost', username: 'ghost', name_ar: 'مدير بلا بريد', role_id: 'department_manager',
    scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL',
    manager_user_id: 'u_mgr', active: 1, created_at: T });
  await db.insert('department', { id: 'D_GHOST', name_ar: 'إدارة بلا بريد لمديرها', sector_id: 'SOL',
    manager_user_id: 'u_ghost', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_emp', name_ar: 'سجى لشكر', sector_id: 'SOL', department_id: 'D_INNO',
    user_id: 'u_emp', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_gemp', username: 'gemp', name_ar: 'موظف الإدارة الثانية', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', employee_id: 'e_gemp', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_gemp', name_ar: 'موظف الإدارة الثانية', sector_id: 'SOL', department_id: 'D_GHOST',
    user_id: 'u_gemp', active: 1, created_at: T });
  await db.insert('project', { id: 'PRJ', name_ar: 'منصة تحليلات', sector_id: 'SOL', status: 'IN_PROGRESS',
    owner_user_id: 'u_mgr', created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ═══ القرار النقي — جدول القواعد صفاً صفاً ═══════════════════════════════════════

test('لا معلَّق ⟵ لا رسالة، وخارج النافذة ⟵ لا رسالة مهما تراكم', () => {
  assert.equal(approvalMailDecision(at('2026-08-11T06:00:00Z'), null, []).action, 'none');
  for (const iso of ['2026-08-11T16:30:00Z', '2026-08-11T19:00:00Z', '2026-08-11T02:00:00Z']) {
    assert.equal(approvalMailDecision(at(iso), null, [p('2026-08-10T05:00:00Z')]).action, 'none', iso);
  }
});

test('حدود النافذة بالدقيقة: 07:59 لا، 08:00 نعم، 17:59 نعم، 18:00 لا', () => {
  const pending = [p('2026-08-10T05:00:00Z')];
  assert.equal(approvalMailDecision(at('2026-08-11T04:59:00Z'), null, pending).action, 'none');
  assert.equal(approvalMailDecision(at('2026-08-11T05:00:00Z'), null, pending).action, 'send');
  assert.equal(approvalMailDecision(at('2026-08-11T14:59:00Z'), null, pending).action, 'send');
  assert.equal(approvalMailDecision(at('2026-08-11T15:00:00Z'), null, pending).action, 'none');
});

test('أول رسالة تخرج فوراً، والجديد داخل نصف الساعة يُمسَك ثم يُطلَق بعدها', () => {
  const first = approvalMailDecision(at('2026-08-11T07:00:00Z'), null, [p('2026-08-11T06:50:00Z'), p('2026-08-11T06:55:00Z')]);
  assert.deepEqual([first.action, first.kind], ['send', 'new']);
  // أُرسلت 07:00Z؛ بند جديد 07:05Z — عند 07:10Z ممسوك، وعند 07:31Z يُطلَق.
  const held = approvalMailDecision(at('2026-08-11T07:10:00Z'), st('2026-08-11T07:00:00Z'), [p('2026-08-11T06:50:00Z'), p('2026-08-11T07:05:00Z')]);
  assert.equal(held.action, 'none');
  const freed = approvalMailDecision(at('2026-08-11T07:31:00Z'), st('2026-08-11T07:00:00Z'), [p('2026-08-11T06:50:00Z'), p('2026-08-11T07:05:00Z')]);
  assert.deepEqual([freed.action, freed.kind, freed.cooldownMs], ['send', 'new', COOLDOWN_MS]);
});

test('ركامٌ مُخطَرٌ به يفوق ثلاثة يمدّ التهدئة إلى أربع ساعات — وثلاثة بالضبط لا يمدّها', () => {
  const olds = ['2026-08-11T05:10:00Z', '2026-08-11T05:20:00Z', '2026-08-11T05:30:00Z', '2026-08-11T05:40:00Z', '2026-08-11T05:50:00Z'].map(p);
  const state = st('2026-08-11T06:00:00Z');
  // خمسة قديمة (مُخطَر بها) + جديد — بعد ساعة ونصف: ممسوك (٤ ساعات)، وبعد أربعٍ ودقيقة: يُطلَق.
  const six = [...olds, p('2026-08-11T08:00:00Z')];
  const held = approvalMailDecision(at('2026-08-11T09:00:00Z'), state, six);
  assert.equal(held.action, 'none');
  const freed = approvalMailDecision(at('2026-08-11T10:01:00Z'), state, six);
  assert.deepEqual([freed.action, freed.kind, freed.cooldownMs], ['send', 'new', BACKLOG_COOLDOWN_MS]);
  // ثلاثة قديمة بالضبط (= العتبة لا فوقها) + جديد — نصف ساعة تكفي.
  const four = [...olds.slice(0, BACKLOG_THRESHOLD), p('2026-08-11T08:00:00Z')];
  const soon = approvalMailDecision(at('2026-08-11T08:31:00Z'), st('2026-08-11T08:00:00Z'), four);
  assert.deepEqual([soon.action, soon.cooldownMs], ['send', COOLDOWN_MS]);
});

test('التذكير الصباحي: مرة كل يوم رياض ما دام معلَّق، وأول فرصةٍ داخل النافذة إن فات الصباح', () => {
  const olds = [p('2026-08-10T05:00:00Z')];
  // ذُكِّر أمس ولا جديد — اليوم 08:30: تذكير.
  const rem = approvalMailDecision(at('2026-08-12T05:30:00Z'), st('2026-08-11T06:00:00Z', '2026-08-11'), olds);
  assert.deepEqual([rem.action, rem.kind], ['send', 'reminder']);
  // ذُكِّر اليوم ولا جديد — لا شيء.
  assert.equal(approvalMailDecision(at('2026-08-12T08:00:00Z'), st('2026-08-12T05:30:00Z', '2026-08-12'), olds).action, 'none');
  // تعطّل الخادم حتى الظهر: التذكير يخرج ظهراً لا يسقط.
  const late = approvalMailDecision(at('2026-08-12T10:00:00Z'), st('2026-08-11T06:00:00Z', '2026-08-11'), olds);
  assert.deepEqual([late.action, late.kind], ['send', 'reminder']);
  // والتذكير يشارك في التهدئة: ذُكِّر 08:00 وبند جديد 08:05 — عند 08:10 ممسوك.
  const held = approvalMailDecision(at('2026-08-12T05:10:00Z'), st('2026-08-12T05:00:00Z', '2026-08-12'),
    [...olds, p('2026-08-12T05:05:00Z')]);
  assert.equal(held.action, 'none');
});

test('وما وصل ليلاً يلتقطه بريد الصباح رسالةً واحدة — «جديد» لا تذكيراً ثانياً بعدها', () => {
  const state = st('2026-08-11T14:50:00Z', '2026-08-11');
  const overnight = [p('2026-08-11T05:00:00Z'), p('2026-08-11T20:00:00Z')];
  const d = approvalMailDecision(at('2026-08-12T05:00:00Z'), state, overnight);
  assert.deepEqual([d.action, d.kind], ['send', 'new']);
  // القيد يكتب الحقلين معاً — فلا تذكير ثانٍ في نفس اليوم بعد رسالة «الجديد» الصباحية.
  const after8 = approvalMailDecision(at('2026-08-12T06:00:00Z'), st('2026-08-12T05:00:00Z', '2026-08-12'), overnight);
  assert.equal(after8.action, 'none');
});

// ═══ الكنسة على القاعدة الحقيقية ═══════════════════════════════════════════════

let reqTitles = ['إعداد خطة الاختبار', 'تجهيز العرض الفني'];

test('كنسة أولى: رسالة واحدة للمعتمِد تسرد البندين معاً باسم طالبهما — وتدخل طابور البريد', async () => {
  for (const title of reqTitles) {
    await tasks.quickAddTask(ctx(EMP), { title, project_id: 'PRJ' });
  }
  // أزمنة الإنشاء تُثبَّت كي لا تتأرجح النتيجة بساعة تشغيل الاختبار الحقيقية.
  await db.run("UPDATE approval_request SET created_at = ? WHERE assignee_user_id = 'u_mgr'", ['2026-08-11T04:00:00Z']);

  const res = await sweepApprovalMail(at('2026-08-11T06:00:00Z'));
  assert.equal(res.enqueued, 1, 'رسالة واحدة مجمَّعة لا رسالة لكل طلب');
  const q = await db.all("SELECT * FROM email_queue WHERE status = 'QUEUED' ORDER BY created_at");
  assert.equal(q.length, 1);
  assert.equal(q[0].subject, 'اعتمادات بانتظارك في سند');
  for (const title of reqTitles) assert.ok(q[0].html.includes(title), `البند «${title}» غائب عن الرسالة`);
  assert.ok(q[0].html.includes('طلبها سجى لشكر'), 'اسم طالب الاعتماد غائب');
  assert.ok(q[0].html.includes('/app/home'), 'رابط الفتح لا يقود إلى «صفحتي»');
  assert.deepEqual(JSON.parse(q[0].to_json), ['mgr@evc.test']);

  const state = await db.get("SELECT * FROM approval_mail_state WHERE user_id = 'u_mgr'");
  assert.equal(state.last_sent_at, '2026-08-11T06:00:00.000Z');
  assert.equal(state.last_reminder_date, '2026-08-11');
  assert.equal(state.notified_count, 2);
});

test('كنسة بعد دقيقة: لا شيء — التهدئة تحكم', async () => {
  const res = await sweepApprovalMail(at('2026-08-11T06:01:00Z'));
  assert.equal(res.enqueued, 0);
  assert.equal((await db.all("SELECT * FROM email_queue")).length, 1);
});

test('وصباح الغد: تذكيرٌ واحد ما دام المعلَّق معلَّقاً', async () => {
  const res = await sweepApprovalMail(at('2026-08-12T05:00:00Z'));
  assert.equal(res.enqueued, 1);
  const q = await db.all("SELECT * FROM email_queue ORDER BY created_at");
  assert.equal(q.length, 2);
  assert.equal(q[1].subject, 'تذكير صباحي: اعتمادات بانتظارك في سند');
  for (const title of reqTitles) assert.ok(q[1].html.includes(title));
});

test('القيد المشروط حكَمُ التزامن: من ظفر به مرة لا يظفر به ثانية بنفس الشرط', async () => {
  // نفس عبارة القيد التي تنفّذها الكنسة، مرتين بنفس الحدّ — الأولى تكتب والثانية تسكت.
  const claim = (ts, cutoff) => db.run(
    `INSERT INTO approval_mail_state (user_id, last_sent_at, last_reminder_date, notified_count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       last_sent_at = excluded.last_sent_at, last_reminder_date = excluded.last_reminder_date,
       notified_count = excluded.notified_count, updated_at = excluded.updated_at
     WHERE approval_mail_state.last_sent_at IS NULL OR approval_mail_state.last_sent_at <= ?`,
    ['u_ghost', ts, '2026-08-12', 1, ts, cutoff]);
  const first = await claim('2026-08-12T06:00:00Z', '2026-08-12T05:30:00Z');
  assert.equal(first.changes, 1, 'القيد الأول لم يُكتب');
  const second = await claim('2026-08-12T06:00:30Z', '2026-08-12T05:30:00Z');
  assert.equal(second.changes, 0, 'نسختان كتبتا نفس الرسالة');
  await db.run("DELETE FROM approval_mail_state WHERE user_id = 'u_ghost'");
});

test('معتمِدٌ بلا بريد يُتخطّى بلا قيد — فإن أُضيف بريده وصلته من أول كنسة', async () => {
  const GEMP = { id: 'u_gemp', username: 'gemp', name_ar: 'موظف الإدارة الثانية', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', employee_id: 'e_gemp', projectIds: new Set(['PRJ']) };
  await tasks.quickAddTask(ctx(GEMP), { title: 'مهمة لمدير بلا بريد', project_id: 'PRJ' });
  await db.run("UPDATE approval_request SET created_at = ? WHERE assignee_user_id = 'u_ghost'", ['2026-08-12T04:00:00Z']);

  const before = (await db.all('SELECT * FROM email_queue')).length;
  await sweepApprovalMail(at('2026-08-12T06:30:00Z'));
  assert.equal((await db.all('SELECT * FROM email_queue')).length, before, 'أُرسلت رسالة لعنوانٍ لا وجود له');
  assert.equal(await db.get("SELECT * FROM approval_mail_state WHERE user_id = 'u_ghost'"), undefined,
    'قُيِّد حالٌ لمن لم يُحاوَل له إرسال');

  await db.run("UPDATE app_user SET email = 'ghost@evc.test' WHERE id = 'u_ghost'");
  const res = await sweepApprovalMail(at('2026-08-12T06:31:00Z'));
  assert.equal(res.enqueued, 1, 'البريد المضاف حديثاً لم يلتقط المعلَّق القائم');
});
