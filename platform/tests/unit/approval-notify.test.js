// بريد الاعتمادات بسياسة المالك الجديدة — القرار النقي بجدول قواعده، ثم الكنسة على القاعدة.
//
// السياسة الافتراضية (قرار المالك): رسالة الطلب الجديد فورية (تهدئة صفر) وفي **أي ساعة**؛
// والتذكير الدوري مُطفأ. وحين يُفعَّل: بفاصلٍ يضبطه مدير النظام وداخل ٨–١٨ بتوقيت الرياض.
// و«الجديد» عضويةٌ لا زمن: صفوفٌ لم تُختم بإخطار (`notified_at IS NULL`) — والختمُ المشروط
// هو حَكَم التزامن بين نسخ الخادم.
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
const { approvalMailDecision, sweepApprovalMail, DEFAULT_RULES } = await import('../../src/modules/workflow/approval-notify.js');

const at = (iso) => new Date(iso);
const T = '2026-08-01T00:00:00Z';
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });
const EMP = { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', employee_id: 'e_emp', projectIds: new Set(['PRJ']) };
const REM_ON = { ...DEFAULT_RULES, reminderEnabled: true };

// أدوات القرار النقي: «مختوم» و«غير مختوم» صراحةً، والحالُ آخرَ إرسال.
const fresh = () => ({ notified_at: null });
const seen = () => ({ notified_at: '2026-08-10T05:00:00Z' });
const st = (lastSent) => ({ last_sent_at: lastSent || null });

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

test('لا معلَّق ⟵ لا رسالة، وغير المختوم يُرسَل فوراً في أي ساعة — الليل ليس عذراً', () => {
  assert.equal(approvalMailDecision(at('2026-08-11T06:00:00Z'), null, []).action, 'none');
  for (const iso of ['2026-08-11T20:00:00Z', '2026-08-11T02:00:00Z', '2026-08-11T10:00:00Z']) {
    const d = approvalMailDecision(at(iso), null, [fresh()]);
    assert.deepEqual([d.action, d.kind], ['send', 'new'], iso);
  }
});

test('التهدئة إن رُفعت عن الصفر تُمسك الجديد وتُطلقه بعدها — ولا تذكير يتسلّل من تحتها', () => {
  const rules = { ...REM_ON, newCooldownMs: 30 * 60000 };
  const held = approvalMailDecision(at('2026-08-11T07:10:00Z'), st('2026-08-11T07:00:00Z'), [seen(), fresh()], rules);
  assert.equal(held.action, 'none', 'جديدٌ داخل التهدئة أُرسل');
  const freed = approvalMailDecision(at('2026-08-11T07:31:00Z'), st('2026-08-11T07:00:00Z'), [seen(), fresh()], rules);
  assert.deepEqual([freed.action, freed.kind], ['send', 'new']);
  const first = approvalMailDecision(at('2026-08-11T07:00:00Z'), null, [fresh()], rules);
  assert.equal(first.action, 'send', 'أول رسالةٍ لا تهدئة قبلها');
});

test('كلُّه مختومٌ والتذكير مُطفأ ⟵ صمتٌ ولو مضت أيام — هذا هو الافتراض المطلوب', () => {
  const d = approvalMailDecision(at('2026-08-13T06:00:00Z'), st('2026-08-11T06:00:00Z'), [seen(), seen()]);
  assert.equal(d.action, 'none');
  assert.equal(d.reason, 'التذكير موقوف');
});

test('التذكير المُفعَّل: بفاصله وداخل النافذة وحدها — وحدود الساعة بالدقيقة', () => {
  const old = [seen()];
  // مضى الفاصل (٢٤ ساعة) داخل النافذة ⟵ تذكير
  const rem = approvalMailDecision(at('2026-08-12T06:30:00Z'), st('2026-08-11T06:00:00Z'), old, REM_ON);
  assert.deepEqual([rem.action, rem.kind], ['send', 'reminder']);
  // لم يمض الفاصل ⟵ لا شيء
  assert.equal(approvalMailDecision(at('2026-08-12T05:30:00Z'), st('2026-08-11T06:30:00Z'), old, REM_ON).action, 'none');
  // خارج النافذة لا تذكير — ٠٤:٥٩Z=٠٧:٥٩ لا، ٠٥:٠٠Z=٠٨:٠٠ نعم، ١٤:٥٩Z=١٧:٥٩ نعم، ١٥:٠٠Z=١٨:٠٠ لا
  const oldSent = st('2026-08-10T06:00:00Z');
  assert.equal(approvalMailDecision(at('2026-08-12T04:59:00Z'), oldSent, old, REM_ON).action, 'none');
  assert.equal(approvalMailDecision(at('2026-08-12T05:00:00Z'), oldSent, old, REM_ON).action, 'send');
  assert.equal(approvalMailDecision(at('2026-08-12T14:59:00Z'), oldSent, old, REM_ON).action, 'send');
  assert.equal(approvalMailDecision(at('2026-08-12T15:00:00Z'), oldSent, old, REM_ON).action, 'none');
  // فاصلٌ قصير (ساعتان) يُحترم
  const two = { ...REM_ON, reminderIntervalMs: 2 * 3600000 };
  assert.equal(approvalMailDecision(at('2026-08-12T08:30:00Z'), st('2026-08-12T07:00:00Z'), old, two).action, 'none');
  assert.equal(approvalMailDecision(at('2026-08-12T09:01:00Z'), st('2026-08-12T07:00:00Z'), old, two).action, 'send');
  // هيئة التعافي: مختومٌ كله بلا حالِ إرسال ⟵ تذكيرٌ فوراً (داخل النافذة)
  const rec = approvalMailDecision(at('2026-08-12T06:00:00Z'), null, old, REM_ON);
  assert.deepEqual([rec.action, rec.kind], ['send', 'reminder']);
});

test('الأولوية للجديد: غير مختومٍ وتذكيرٌ مستحق معاً ⟵ رسالة «جديد» واحدة', () => {
  const d = approvalMailDecision(at('2026-08-12T06:00:00Z'), st('2026-08-11T05:00:00Z'), [seen(), fresh()], REM_ON);
  assert.deepEqual([d.action, d.kind], ['send', 'new']);
});

// ═══ الكنسة على القاعدة الحقيقية — بالسياسة الافتراضية (فوري، بلا تذكير) ═══════════

const reqTitles = ['إعداد خطة الاختبار', 'تجهيز العرض الفني'];

test('كنسة ليلية أولى: رسالة واحدة مجمَّعة فوراً — وتختم الطلبات وتقيّد الحال', async () => {
  for (const title of reqTitles) {
    await tasks.quickAddTask(ctx(EMP), { title, project_id: 'PRJ' });
  }
  await db.run("UPDATE approval_request SET created_at = ? WHERE assignee_user_id = 'u_mgr'", ['2026-08-11T04:00:00Z']);

  // ٢٣:٠٠ بتوقيت الرياض — خارج نافذة العمل، والجديد يخرج رغم ذلك: هذا هو المطلوب.
  const res = await sweepApprovalMail(at('2026-08-11T20:00:00Z'));
  assert.equal(res.enqueued, 1, 'رسالة واحدة مجمَّعة لا رسالة لكل طلب');
  const q = await db.all("SELECT * FROM email_queue WHERE status = 'QUEUED' ORDER BY created_at");
  assert.equal(q.length, 1);
  assert.equal(q[0].subject, 'اعتمادات بانتظارك في سند');
  for (const title of reqTitles) assert.ok(q[0].html.includes(title), `البند «${title}» غائب عن الرسالة`);
  assert.ok(q[0].html.includes('طلبها سجى لشكر'), 'اسم طالب الاعتماد غائب');
  assert.deepEqual(JSON.parse(q[0].to_json), ['mgr@evc.test']);

  const unclaimed = await db.all("SELECT * FROM approval_request WHERE assignee_user_id = 'u_mgr' AND notified_at IS NULL");
  assert.equal(unclaimed.length, 0, 'طلبٌ بقي بلا ختم إخطار');
  const state = await db.get("SELECT * FROM approval_mail_state WHERE user_id = 'u_mgr'");
  assert.equal(state.last_sent_at, '2026-08-11T20:00:00.000Z');
  assert.equal(state.notified_count, 2);
});

test('كنسة تالية بلا جديد: صمتٌ رغم التهدئة الصفرية — الختم هو الحَكَم لا الوقت', async () => {
  const res = await sweepApprovalMail(at('2026-08-11T20:01:00Z'));
  assert.equal(res.enqueued, 0);
  assert.equal((await db.all('SELECT * FROM email_queue')).length, 1);
});

test('طلبٌ ثالث يصل: رسالةٌ فورية تسرد الثلاثة كلها — الجديدُ يفتح والقائمةُ كاملة', async () => {
  await tasks.quickAddTask(ctx(EMP), { title: 'مراجعة العقد النهائي', project_id: 'PRJ' });
  const res = await sweepApprovalMail(at('2026-08-11T21:00:00Z'));
  assert.equal(res.enqueued, 1);
  const q = await db.all('SELECT * FROM email_queue ORDER BY created_at');
  assert.equal(q.length, 2);
  for (const title of [...reqTitles, 'مراجعة العقد النهائي']) {
    assert.ok(q[1].html.includes(title), `الرسالة لا تسرد «${title}»`);
  }
});

test('واليوم التالي بلا جديد: لا تذكير — السياسة الافتراضية مُطفأتُه', async () => {
  const res = await sweepApprovalMail(at('2026-08-12T06:00:00Z'));
  assert.equal(res.enqueued, 0);
});

test('وبتفعيل التذكير (سياسة محقونة): تذكيرٌ واحد بفاصله — والثاني داخل الفاصل صامت', async () => {
  // آخر رسالةٍ كانت 2026-08-11T21:00Z — بعد ٣٣ ساعة (داخل نافذة العمل) يستحق التذكير.
  const on = { ...DEFAULT_RULES, reminderEnabled: true };
  const res = await sweepApprovalMail(at('2026-08-13T06:30:00Z'), on);
  assert.equal(res.enqueued, 1);
  const q = await db.all('SELECT * FROM email_queue ORDER BY created_at');
  assert.equal(q[2].subject, 'تذكير: اعتمادات بانتظارك في سند');
  const again = await sweepApprovalMail(at('2026-08-13T07:30:00Z'), on);
  assert.equal(again.enqueued, 0, 'تذكيرٌ ثانٍ داخل الفاصل');
});

test('ختم الإخطار حَكَمُ التزامن: من ظفر بالتحديث المشروط مرةً لا يظفر به ثانية', async () => {
  await tasks.quickAddTask(ctx({ ...EMP, id: 'u_gemp', username: 'gemp', employee_id: 'e_gemp', projectIds: new Set(['PRJ']) }),
    { title: 'مهمة لمدير بلا بريد', project_id: 'PRJ' });
  const req = await db.get("SELECT * FROM approval_request WHERE assignee_user_id = 'u_ghost' AND status = 'PENDING'");
  const claim = () => db.run(
    'UPDATE approval_request SET notified_at = ? WHERE id IN (?) AND notified_at IS NULL',
    ['2026-08-12T08:00:00Z', req.id]);
  const first = await claim();
  assert.equal(first.changes, 1, 'الختم الأول لم يقع');
  const second = await claim();
  assert.equal(second.changes, 0, 'نسختان ختمتا نفس الطلب');
  await db.run('UPDATE approval_request SET notified_at = NULL WHERE id = ?', [req.id]);
});

test('معتمِدٌ بلا بريد يُتخطّى بلا ختم — فإن أُضيف بريدُه وصلته طلباتُه القائمة فوراً', async () => {
  const before = (await db.all('SELECT * FROM email_queue')).length;
  await sweepApprovalMail(at('2026-08-12T08:30:00Z'));
  assert.equal((await db.all('SELECT * FROM email_queue')).length, before, 'أُرسلت رسالة لعنوانٍ لا وجود له');
  assert.equal((await db.get("SELECT * FROM approval_request WHERE assignee_user_id = 'u_ghost'")).notified_at, null,
    'خُتم طلبٌ لم تُرسَل عنه رسالة');

  await db.run("UPDATE app_user SET email = 'ghost@evc.test' WHERE id = 'u_ghost'");
  const res = await sweepApprovalMail(at('2026-08-12T08:31:00Z'));
  assert.equal(res.enqueued, 1, 'البريد المضاف حديثاً لم يلتقط المعلَّق القائم');
});
