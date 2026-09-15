// سحب الفرصة — التابع يُسحب معها، والأثر يبقى، والباب يظهر عاقبته قبل الضغط.
//
// الفرصة ليست صفاً وحيداً: معها مستندات وفريق ومهام وإسناد إدارات وسجل مراحل. وقبل هذه
// الدفعة كان سحبها يترك كل ذلك يتيماً — عضويةٌ تفتح نطاق قراءةٍ على فرصةٍ لا وجود لها،
// ومستندٌ يشير إلى ما حُذف. وهذه الفحوص تثبّت العقد كاملاً:
//   · المستند والعضوية والمهمة تُسحب سحباً ناعماً مع فرصتها في نفس المعاملة.
//   · إسناد الإدارة المشاركة (جدول ربطٍ بلا حذفٍ ناعم) يُمحى.
//   · سجل المراحل يبقى — أثر التدقيق لا يُمَسّ.
//   · العضوية المسحوبة تُغلق نطاق القراءة فعلاً (resolveUser لا يعيد الفرصة).
//   · ساعة عملٍ مسجَّلة على الفرصة تمنع السحب برسالةٍ عربية تسمّيها.
//   · والمعاينة (removalPreview) تعدّ ما سيُسحب قبل أن يُسحب.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-opp-rm-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let remove, db, rbac, contextMod;
const T = new Date().toISOString();
const FUTURE = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
const ADMIN = { id: 'u_a', username: 'a', role_id: 'admin', scope: 'company' };
const ctx = { user: ADMIN, ip: '127.0.0.1' };

before(async () => {
  remove = await import('../../src/core/lifecycle/remove.js');
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  contextMod = await import('../../src/core/http/context.js');
  await rbac.initRbac();
  // صفُّ المدير يُكتب فعلاً: `opportunity_department.created_by` مرجعٌ مقيَّد إلى جدول الحسابات
  await db.insert('app_user', { id: 'u_a', username: 'a', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع', active: 1, created_at: T });
  await db.insert('department', { id: 'D1', name_ar: 'إدارة مشاركة', sector_id: 'S1', active: 1, created_at: T });
  await db.insert('employee', { id: 'e1', name_ar: 'موظف الفريق', sector_id: 'S1', active: 1, created_at: T });
  // حسابٌ مرتبط بالموظف وجلسةٌ حيّة — لفحص نطاق القراءة عبر resolveUser نفسه لا عبر محاكاة
  await db.insert('app_user', {
    id: 'u_m', username: 'member', name_ar: 'عضو الفريق', role_id: 'consultant', scope: 'own',
    employee_id: 'e1', active: 1, created_at: T,
  });
  await db.insert('session', { id: 'sess_m', user_id: 'u_m', created_at: T, expires_at: FUTURE });

  // الفرصة وكامل توابعها
  await db.insert('opportunity', { id: 'o_full', title_ar: 'فرصة بكامل توابعها', sector_id: 'S1', created_at: T, created_by: 'u_a' });
  await db.insert('document', { id: 'doc1', opportunity_id: 'o_full', name: 'العرض الفني', created_at: T });
  await db.insert('membership', { id: 'm1', employee_id: 'e1', group_kind: 'opportunity', group_id: 'o_full', role_in_group: 'member', created_at: T });
  // عضويةُ نوعٍ آخر بنفس المعرّف — الشرط الثابت (group_kind) يجب أن يحميها من السحب
  await db.insert('membership', { id: 'm2', employee_id: 'e1', group_kind: 'project', group_id: 'o_full', role_in_group: 'member', created_at: T });
  await db.insert('task', { id: 'tk1', opportunity_id: 'o_full', title: 'مهمة على الفرصة', status: 'TODO', created_at: T });
  await db.insert('opportunity_department', { opportunity_id: 'o_full', department_id: 'D1', created_at: T, created_by: 'u_a' });
  await db.insert('opportunity_stage_history', { id: 'osh1', opportunity_id: 'o_full', from_stage_id: 'LEAD', to_stage_id: 'QUALIFIED', changed_by: 'u_a', changed_at: T });

  // فرصةٌ عليها ساعة عمل مسجَّلة — تمنع السحب
  await db.insert('opportunity', { id: 'o_hours', title_ar: 'فرصة عليها ساعات', sector_id: 'S1', created_at: T, created_by: 'u_a' });
  await db.insert('time_entry', { id: 'te1', user_id: 'u_m', opportunity_id: 'o_hours', work_kind: 'opportunity', entry_date: T.slice(0, 10), hours: 3, created_at: T });
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('المعاينة قبل السحب تعدّ التوابع بأسمائها — فالشاشة تقول ما سيُسحب لا «شيئاً ما»', async () => {
  const p = await remove.removalPreview('opportunity', 'o_full');
  assert.equal(p.removable, true);
  assert.deepEqual(p.blockers, []);
  const byLabel = Object.fromEntries(p.cascades.map((c) => [c.label, c.count]));
  assert.equal(byLabel['مستند'], 1, 'المستند لم يُعدّ في المعاينة');
  assert.equal(byLabel['عضوية فريق'], 1, 'عضوية الفريق لم تُعدّ — أو عُدّت معها عضويةُ نوعٍ آخر');
  assert.equal(byLabel['مهمة'], 1, 'المهمة لم تُعدّ');
  assert.equal(byLabel['إسناد إدارة مشاركة'], 1, 'إسناد الإدارة لم يُعدّ');
});

test('والسحب يطوي التابع معه: مستندٌ وعضويةٌ ومهمةٌ ناعماً، وإسنادُ الإدارة محواً', async () => {
  const r = await remove.removeRecord(ctx, 'opportunity', 'o_full', { reason: 'فرصة تجريبية أُدخلت للفحص' });
  assert.equal(r.ok, true);
  assert.equal(r.cascaded['مستند'], 1);
  assert.equal(r.cascaded['عضوية فريق'], 1);
  assert.equal(r.cascaded['مهمة'], 1);
  assert.equal(r.cascaded['إسناد إدارة مشاركة'], 1);
  for (const [t, id] of [['document', 'doc1'], ['membership', 'm1'], ['task', 'tk1']]) {
    const row = await db.get(`SELECT deleted_at FROM ${t} WHERE id = ?`, [id]);
    assert.ok(row.deleted_at, `${t} بقي يتيماً يشير إلى فرصةٍ مسحوبة`);
  }
  const od = await db.get("SELECT COUNT(*) n FROM opportunity_department WHERE opportunity_id = 'o_full'");
  assert.equal(Number(od.n), 0, 'إسناد الإدارة المشاركة بقي بعد السحب');
});

test('وعضويةُ النوع الآخر لم تُمَسّ — الشرط الثابت يحمي الجدول العام', async () => {
  const m2 = await db.get("SELECT deleted_at FROM membership WHERE id = 'm2'");
  assert.equal(m2.deleted_at, null, 'سُحبت عضويةُ مشروعٍ مع فرصةٍ تطابق معرّفها');
});

test('وسجل المراحل يبقى — أثر التدقيق لا يُمَسّ', async () => {
  const h = await db.get("SELECT COUNT(*) n FROM opportunity_stage_history WHERE opportunity_id = 'o_full'");
  assert.equal(Number(h.n), 1, 'سجل المراحل مُحي مع الفرصة');
});

test('والعضوية المسحوبة تُغلق نطاق القراءة فعلاً — resolveUser لا يعيد الفرصة', async () => {
  const u = await contextMod.resolveUser('sess_m');
  assert.ok(u, 'الجلسة الحيّة لم تُحلّ إلى مستخدم');
  assert.equal(u.opportunityIds.has('o_full'), false, 'فرصةٌ مسحوبة ما زالت تفتح نطاق قراءة عبر عضويتها');
});

test('وساعة عملٍ مسجَّلة على الفرصة تمنع السحب — برسالةٍ تسمّيها بعددها', async () => {
  const p = await remove.removalPreview('opportunity', 'o_hours');
  assert.equal(p.removable, false);
  assert.match(p.blockers.join(' '), /ساعة عمل مسجَّلة واحدة/, 'المعاينة لا تسمّي مانع الساعات');
  await assert.rejects(() => remove.removeRecord(ctx, 'opportunity', 'o_hours'), (e) => {
    assert.match(e.message, /ساعة عمل مسجَّلة/, 'الرفض لا يسمّي المانع');
    return true;
  });
  assert.equal((await db.get("SELECT deleted_at FROM opportunity WHERE id = 'o_hours'")).deleted_at, null,
    'سُحبت فرصةٌ عليها ساعات مسجَّلة');
});
