// حراسةٌ على ما يغادر الخادم في ردود الكتابة وعلى نطاق الأرقام المالية:
//   • ردّ تعديل الموظف يُهرِّب الراتب لمن لا يملك بوابته (كان يُعاد خاماً في كل ردّ كتابة).
//   • قائمة الحسابات لا تُصدِّر بصمة كلمة المرور ولا عدّاد القفل إلى المتصفّح.
//   • تغيير كلمة المرور يشترط الحالية ويُنهي بقية الجلسات.
//   • الإيراد المحقق لا يتّسع من نطاق المشروع/الفرد إلى القطاع كله.
//   • قيمةٌ غير رقمية للفرصة تُردّ بخطأ لا تُخزَّن NaN.
//   • فكّ دمج جهةٍ في قطاعٍ آخر مرفوض.
//   • مؤشّرات المشروع خلف حارس القراءة (لا تُعدّ لأي فرصةٍ بالمعرّف وحده).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-writescope-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { config } = await import('../../src/core/config.js');
const org = await import('../../src/modules/org/org.js');
const identity = await import('../../src/modules/identity/identity.js');
const { changePassword } = await import('../../src/core/auth/service.js');
const { hashPassword, verifyPassword } = await import('../../src/core/auth/password.js');
const { financeSummary } = await import('../../src/modules/finance/finance.js');
const { createOpportunity } = await import('../../src/modules/crm/opportunities.js');
const { unmergeClient } = await import('../../src/modules/clients/clients.js');
const { apiRouter } = await import('../../src/modules/api.routes.js');
const { errorHandler } = await import('../../src/core/http/errors.js');
const express = (await import('express')).default;

const YR = config.fiscalYear;
const T = `${YR}-01-05T08:00:00.000Z`;
const SALARY = 987_654; // رقم مميّز يُبحث عنه حرفياً
const admin = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'S1' };
const hr = { id: 'u_hr', username: 'hr', role_id: 'hr', scope: 'company', sector_id: 'S1' };
const lead1 = { id: 'u_l1', username: 'lead1', role_id: 'sector_lead', scope: 'sector', sector_id: 'S1' };
const pm = { id: 'u_pm', username: 'pm', role_id: 'project_manager', scope: 'project', sector_id: 'S1', projectIds: new Set() };
const ext2 = { id: 'u_ext2', username: 'ext2', role_id: 'external', scope: 'own', sector_id: 'S2', projectIds: new Set() };

let server, base, asUser = admin;

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع أ', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع ب', kind: 'delivery', active: 1, created_at: T });
  for (const u of [admin, hr, lead1, pm, ext2]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.username, role_id: u.role_id,
      scope: u.scope, sector_id: u.sector_id, active: 1, created_at: T });
  }
  await db.insert('revenue_line', { id: 'RL1', sector_id: 'S1', amount_halalas: 100_000, year: YR, created_at: T });
  await db.insert('revenue_line', { id: 'RL2', sector_id: 'S2', amount_halalas: 200_000, year: YR, created_at: T });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع أ', sector_id: 'S1', owner_user_id: 'u_admin',
    status: 'IN_PROGRESS', created_at: T });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { user: asUser, ip: '127.0.0.1' }; next(); });
  app.use('/api', apiRouter);
  app.use(errorHandler());
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── ردّ تعديل الموظف يُهرِّب الراتب لمن لا يملك بوابته ──
test('ردّ إنشاء/تعديل الموظف يُهرِّب الراتب لمن لا يقرؤه', async () => {
  const created = await org.createEmployee({ user: admin, ip: '::1' },
    { name_ar: 'سارة', sector_id: 'S1', job_title: 'مستشار', salary_sar: SALARY / 100 });
  assert.equal(created.salary_halalas, SALARY, 'مدير النظام يقرأ الراتب في ردّ الإنشاء');

  const asAdmin = await org.updateEmployee({ user: admin, ip: '::1' }, created.id, { job_title: 'مستشار أول' });
  assert.equal(asAdmin.salary_halalas, SALARY, 'الراتب يبقى لمن يقرؤه');

  const asHr = await org.updateEmployee({ user: hr, ip: '::1' }, created.id, { job_title: 'مستشار خبير' });
  assert.equal(asHr.salary_halalas, null, 'الراتب يُهرَّب في ردّ الكتابة لمن لا يقرؤه');
  assert.equal(asHr._redacted_salary_halalas, true, 'ويُعلَّم أنه مُهرَّب');
  assert.ok(!JSON.stringify(asHr).includes(String(SALARY)), 'ولا يظهر رقم الراتب في الحمولة');
});

// ── قائمة الحسابات لا تُصدِّر بصمة كلمة المرور ──
test('قائمة الحسابات لا تحمل بصمة كلمة المرور ولا عدّاد القفل', async () => {
  await db.run("UPDATE app_user SET password_hash = ?, failed_attempts = 3, locked_until = ? WHERE id = 'u_hr'",
    [hashPassword('x'), '2030-01-01T00:00:00.000Z']);
  const rows = await identity.listUsers(admin, {});
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(!('password_hash' in r), 'بصمة كلمة المرور غادرت الخادم');
    assert.ok(!('failed_attempts' in r), 'عدّاد المحاولات غادر الخادم');
    assert.ok(!('locked_until' in r), 'ختم القفل غادر الخادم');
  }
  const hrRow = rows.find((r) => r.id === 'u_hr');
  assert.equal(hrRow.is_locked, true, 'حالة القفل تبقى كإشارة مجرَّدة');
});

// ── تغيير كلمة المرور: يشترط الحالية ويُنهي بقية الجلسات ──
test('تغيير كلمة المرور يشترط الحالية ويُنهي الجلسات الأخرى', async () => {
  const OLD = 'Old-Pass-9', NEW = 'New-Pass-99';
  await db.insert('app_user', { id: 'u_pw', username: 'pw', name_ar: 'pw', role_id: 'employee',
    scope: 'own', sector_id: 'S1', password_hash: hashPassword(OLD), active: 1, created_at: T });
  const mkSess = (sid) => db.insert('session', { id: sid, user_id: 'u_pw', created_at: T,
    expires_at: '2030-01-01T00:00:00.000Z' });
  await mkSess('s_cur'); await mkSess('s_other');

  await assert.rejects(
    () => changePassword({ user: { id: 'u_pw' }, ip: '::1' }, { currentPassword: 'wrong', newPassword: NEW, currentSessionId: 's_cur' }),
    /الحالية/, 'قُبِل تغييرٌ دون كلمة المرور الحالية الصحيحة');

  await changePassword({ user: { id: 'u_pw' }, ip: '::1' }, { currentPassword: OLD, newPassword: NEW, currentSessionId: 's_cur' });
  const u = await db.get("SELECT password_hash FROM app_user WHERE id = 'u_pw'");
  assert.ok(verifyPassword(NEW, u.password_hash), 'كلمة المرور لم تتغيّر');
  const cur = await db.get("SELECT revoked_at FROM session WHERE id = 's_cur'");
  const other = await db.get("SELECT revoked_at FROM session WHERE id = 's_other'");
  assert.equal(cur.revoked_at, null, 'الجلسة الحالية تبقى');
  assert.ok(other.revoked_at, 'الجلسات الأخرى تُنهى');
});

// ── الإيراد المحقق لا يتّسع من نطاق أضيق إلى القطاع كله ──
test('الإيراد المحقق: الشركة تراه كاملاً، القطاع قطاعه، والمشروع لا رقم له', async () => {
  const company = await financeSummary(admin, YR);
  const sector = await financeSummary(lead1, YR);
  const project = await financeSummary(pm, YR);
  assert.equal(company.revenue_gross_halalas, 300_000, 'الشركة ترى إيراد القطاعين');
  assert.equal(sector.revenue_gross_halalas, 100_000, 'القطاع يرى إيراد قطاعه وحده');
  assert.equal(project.revenue_gross_halalas, 0, 'نطاق المشروع لا يتّسع إلى إيراد القطاع كله');
});

// ── قيمةٌ غير رقمية للفرصة تُردّ بخطأ لا تُخزَّن NaN ──
test('قيمة الفرصة غير الرقمية تُردّ بخطأ عربي', async () => {
  await assert.rejects(
    () => createOpportunity({ user: admin, ip: '::1' }, { title_ar: 'فرصة', sector_id: 'S1', value_sar: 'abc' }),
    /رقم/, 'قُبِلت قيمةٌ غير رقمية');
});

// ── فكّ دمج جهةٍ خارج نطاق القارئ مرفوض (النطاق على الجهة الباقية) ──
test('فكّ دمج جهةٍ خارج نطاق القارئ مرفوض، ومسموحٌ لمن يراها', async () => {
  await db.insert('client', { id: 'KEEP', name_ar: 'الجهة الباقية', created_by: 'u_admin', active: 1, created_at: T });
  await db.insert('client', { id: 'C_MERGED', name_ar: 'جهة مدموجة', merged_into_client_id: 'KEEP',
    active: 0, deleted_at: T, created_at: T });
  await assert.rejects(
    () => unmergeClient({ user: lead1, ip: '::1' }, 'C_MERGED'),
    (e) => e.status === 403, 'من لا يرى الجهة الباقية فكّ دمجها');
  const res = await unmergeClient({ user: admin, ip: '::1' }, 'C_MERGED');
  assert.ok(res, 'من يرى الجهة الباقية يفكّ الدمج');
  const back = await db.get("SELECT merged_into_client_id, deleted_at FROM client WHERE id = 'C_MERGED'");
  assert.equal(back.merged_into_client_id, null, 'أُعيدت الجهة ظاهرة');
});

// ── مؤشّرات المشروع خلف حارس القراءة (IDOR) ──
test('مؤشّرات المشروع تُردّ 403 لمن لا يقرأ المشروع، و200 لمن يقرؤه', async () => {
  asUser = ext2;
  const denied = await fetch(`${base}/api/projects/P1/kpis`, { headers: { connection: 'close' } });
  assert.equal(denied.status, 403, 'مؤشّرات مشروعٍ لا يقرؤه المستخدم كانت مكشوفة');
  asUser = admin;
  const ok = await fetch(`${base}/api/projects/P1/kpis`, { headers: { connection: 'close' } });
  assert.equal(ok.status, 200, 'من يقرأ المشروع يرى مؤشّراته');
});
