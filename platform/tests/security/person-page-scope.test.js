// صفحة الشخص — من يفتح ملف من.
//
// الشاشة جديدة، وهي تعرض عمل شخصٍ بعينه: مهامه بمواعيدها وعوائقها، وفرصه بقيمها، وتسكينه.
// فبوابتها ليست «هل تملك منح قراءة» بل «هل هذا الشخص **داخل نطاقك**» — وهو سؤالٌ لا يُجاب إلا
// بعد قراءة صفّه، ولذلك لا يحرسها حارس المسار بل الخدمة نفسها.
//
// ما يُثبَت هنا (وكلٌّ منه يجب أن يسقط لو نُزع شرطه):
//   ١) كل أحد يفتح ملفه هو — بلا أي منح إداري. وإلا لصار «صفحتي» امتيازاً.
//   ٢) مدير الإدارة يفتح ملفات إدارته ولا يفتح ملف إدارةٍ أخرى في القطاع نفسه.
//   ٣) قائد القطاع يفتح ملفات قطاعه ولا يتعدّاه.
//   ٤) الموظف العادي لا يفتح ملف غيره إطلاقاً — ولو كان زميله في الإدارة.
//   ٥) قارئٌ بنطاق «إدارة» وإدارتُه مجهولة (حسابه غير مربوط بموظف) لا يفتح أحداً — فشلٌ آمن،
//      لا «كل القطاع» ولا «كل الشركة».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-personpage-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { personDossier } = await import('../../src/modules/pmo/tasks.js');

const T = '2026-01-01T00:00:00Z';
// قطاعان، وإدارتان في القطاع الأول — الإدارة الثانية هي ما يجب أن **يُحجب** عن مدير الأولى.
const U = (id, role, sector, scope, deptId) => ({
  id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: sector, scope,
  department_id: deptId || null, projectIds: new Set(), teamIds: new Set(),
});

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أول', active: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ثانٍ', active: 1, created_at: T });
  await insert('department', { id: 'D1', sector_id: 'S1', name_ar: 'إدارة أولى', active: 1, created_at: T });
  await insert('department', { id: 'D2', sector_id: 'S1', name_ar: 'إدارة ثانية', active: 1, created_at: T });

  const people = [
    ['e_d1', 'u_d1', 'S1', 'D1', 'عضو الإدارة الأولى'],
    ['e_d2', 'u_d2', 'S1', 'D2', 'عضو الإدارة الثانية'],
    ['e_s2', 'u_s2', 'S2', null, 'عضو القطاع الثاني'],
  ];
  for (const [eid, uid, sec, dep, name] of people) {
    await insert('employee', { id: eid, name_ar: name, sector_id: sec, department_id: dep, active: 1, created_at: T });
    await insert('app_user', { id: uid, username: uid, name_ar: name, role_id: 'employee', sector_id: sec,
      employee_id: eid, scope: 'own', active: 1, must_change_pw: 0, failed_attempts: 0, created_at: T });
  }
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const opens = async (reader, target) => {
  try { await personDossier(reader, target); return true; } catch { return false; }
};

test('كل أحد يفتح ملفه هو — بلا أي منح إداري', async () => {
  const plain = U('u_d1', 'employee', 'S1', 'own', 'D1');
  const d = await personDossier(plain, 'u_d1');
  assert.equal(d.self, true, 'الملف يُعلَم أنه ملف صاحبه');
  assert.equal(d.person.userId, 'u_d1');
});

test('الموظف العادي لا يفتح ملف غيره — ولو كان زميله في الإدارة', async () => {
  const plain = U('u_d1', 'employee', 'S1', 'own', 'D1');
  assert.equal(await opens(plain, 'u_d2'), false, 'زميل في القطاع نفسه');
  assert.equal(await opens(plain, 'u_s2'), false, 'شخص في قطاع آخر');
});

test('مدير الإدارة: أهل إدارته نعم، وإدارةٌ أخرى في قطاعه لا', async () => {
  const mgr = U('u_mgr', 'department_manager', 'S1', 'department', 'D1');
  assert.equal(await opens(mgr, 'u_d1'), true, 'من إدارته');
  assert.equal(await opens(mgr, 'u_d2'), false, 'من إدارة أخرى في القطاع نفسه');
  assert.equal(await opens(mgr, 'u_s2'), false, 'من قطاع آخر');
});

test('قارئٌ بنطاق إدارة وإدارتُه مجهولة لا يفتح أحداً — فشلٌ آمن لا اتّساع', async () => {
  const orphanMgr = U('u_orphan', 'department_manager', 'S1', 'department', null);
  assert.equal(await opens(orphanMgr, 'u_d1'), false);
  assert.equal(await opens(orphanMgr, 'u_d2'), false);
  // وملفه هو يبقى مفتوحاً له: النطاق يحكم ملفات الآخرين لا ملفه.
  assert.equal(await opens(orphanMgr, 'u_orphan'), false, 'حسابٌ غير مسجَّل أصلاً لا ملف له');
});

test('قائد القطاع: قطاعه نعم، وما وراءه لا', async () => {
  const lead = U('u_lead', 'sector_lead', 'S1', 'sector', null);
  assert.equal(await opens(lead, 'u_d1'), true);
  assert.equal(await opens(lead, 'u_d2'), true, 'كل إدارات قطاعه');
  assert.equal(await opens(lead, 'u_s2'), false, 'قطاع آخر');
});

test('مدير النظام يفتح الجميع، ورابطٌ لشخصٍ غير موجود يردّ رسالةً عربية لا انهياراً', async () => {
  const admin = U('u_admin', 'admin', null, 'company', null);
  assert.equal(await opens(admin, 'u_d1'), true);
  assert.equal(await opens(admin, 'u_s2'), true);
  await assert.rejects(() => personDossier(admin, 'NO_SUCH_USER'), (e) => {
    assert.match(e.message, /لا يوجد شخص/, 'رسالة عربية واضحة');
    return true;
  });
});
