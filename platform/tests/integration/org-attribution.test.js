// الإسناد الإداري — العمل يُنسب إلى إدارة داخل قطاعه.
// الفجوة التي تغلقها هذه الحارة (مقيسة على البيئة الحيّة): المشاريع والفرص والتسكينات تحمل القطاع
// فقط، فتتكدّس مئات الفرص على «قطاع الحلول» ككتلة واحدة بينما جزء منها يخص «إدارة المدن الذكية»،
// وتبقى الإدارات في الشجرة بلا عمل. هذه الاختبارات تحرس الثوابت الأربعة:
//   ١) لا إسناد عبر القطاعات إطلاقاً (أسرع طريق لأرقام لا تتطابق مع نفسها).
//   ٢) الصلاحية تُفحص على **الصف نفسه** — can(user, action, resource) بلا هدف تُرجع صحيحاً لمجرد
//      وجود منح مطابق مهما كان نطاقه، وهذا الملف يثبت أن تلك الثغرة غير موجودة هنا.
//   ٣) الدفعة لا تُجهض عند أول فشل، وكل عنصر يعود بسببه العربي.
//   ٤) أرقام التوزيع تطابق حساباً يدوياً على بيانات ثابتة، وكل كتابة لها سطر تدقيق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-attr-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, all, run, close } = await import('../../src/core/db/index.js');
const { initRbac, can } = await import('../../src/core/rbac/index.js');
await initRbac();
const attr = await import('../../src/modules/org/attribution.js');

// خادم اختبار يركّب router الحارة وحده (api.routes.js تملكه جلسة التكامل — لا نلمسه)
let server = null, port = 0, CURRENT = null;
const api = async (method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const T = '2026-01-01T00:00:00Z';
const ctx = (user) => ({ user, ip: '127.0.0.1' });
const U = (id, role, sector, scope, projectIds = []) =>
  ({ id, username: id, role_id: role, sector_id: sector, scope, projectIds: new Set(projectIds), teamIds: new Set() });

const admin = U('u_admin', 'admin', null, 'company');
const leadSol = U('u_lead_sol', 'sector_lead', 'SOLUTIONS', 'sector');
const leadStrat = U('u_lead_strat', 'sector_lead', 'STRATEGIC', 'sector');
const bdStrat = U('u_bd_strat', 'bd_manager', 'STRATEGIC', 'sector');
const pmSol = U('u_pm_sol', 'project_manager', 'SOLUTIONS', 'project', ['P1']);
const worker = U('u_emp', 'employee', 'SOLUTIONS', 'own');

const auditCount = async (resource, resourceId) =>
  (await get('SELECT COUNT(*) n FROM audit_log WHERE resource = ? AND resource_id = ?', [resource, resourceId])).n;

before(async () => {
  // القطاعات الأربعة وحدها — لا يُخترع قطاع خامس في اختبار ولا في غيره.
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  await insert('sector', { id: 'STRATEGIC', name_ar: 'المشاريع الاستراتيجية', active: 1, sort_order: 3, created_at: T });
  await insert('department', { id: 'D_SMART', sector_id: 'SOLUTIONS', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await insert('department', { id: 'D_AI', sector_id: 'SOLUTIONS', name_ar: 'Ai&Data', active: 1, created_at: T });
  await insert('department', { id: 'D_PMO', sector_id: 'CONSULTING', name_ar: 'مكتب إدارة المشاريع', active: 1, created_at: T });
  await insert('department', { id: 'D_TRANS', sector_id: 'STRATEGIC', name_ar: 'إدارة التحول', active: 1, created_at: T });
  await insert('department', { id: 'D_GONE', sector_id: 'SOLUTIONS', name_ar: 'إدارة ملغاة', active: 0, created_at: T, deleted_at: T });
  for (const u of [admin, leadSol, leadStrat, bdStrat, pmSol, worker]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: 'مستخدم ' + u.id, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'QUALIFIED', name_ar: 'مؤهلة', default_win_pct: 30, sort_order: 2, is_won: 0, is_lost: 0 });

  // ── نموذج القراءة (قطاع الحلول) — لا يُكتب عليه في أي اختبار، فالأرقام أدناه محسوبة يدوياً ──
  const emp = (id, dept, extra = {}) => insert('employee', { id, name_ar: 'موظف ' + id, sector_id: 'SOLUTIONS',
    department_id: dept, status: 'نشط', active: 1, created_at: T, ...extra });
  await emp('E1', 'D_SMART'); await emp('E2', 'D_SMART'); await emp('E3', 'D_AI'); await emp('E4', null);
  await emp('E5', 'D_PMO');                       // إدارته تتبع قطاعاً آخر ⟵ دلو «الشاذ»
  await emp('E7', 'D_SMART', { deleted_at: T });  // محذوف ⟵ لا يُحتسب
  await insert('employee', { id: 'E6', name_ar: 'موظف استشارات', sector_id: 'CONSULTING', department_id: 'D_PMO', active: 1, created_at: T });

  const proj = (id, dept, value, start, end, extra = {}) => insert('project', { id, code: id, name_ar: 'مشروع ' + id,
    sector_id: 'SOLUTIONS', department_id: dept, owner_user_id: 'u_lead_sol', status: 'IN_PROGRESS',
    contract_value_halalas: value, start_date: start, end_date: end, created_at: T, ...extra });
  await proj('P1', 'D_SMART', 1000000, '2026-01-01', '2026-12-31');
  await proj('P2', 'D_SMART', 500000, null, null);                       // بلا تواريخ ⟵ يُحتسب دائماً
  await proj('P3', null, 250000, '2026-03-01', '2027-06-30');
  await proj('P4', null, 999999, '2023-01-01', '2024-12-31');            // خارج سنة 2026
  await proj('P5', 'D_SMART', 777777, '2026-01-01', '2026-12-31', { deleted_at: T });
  await insert('project', { id: 'PC1', name_ar: 'مشروع استشارات', sector_id: 'CONSULTING', contract_value_halalas: 400000, created_at: T });

  const opp = (id, sector, dept, value, win, year, stage, created, extra = {}) => insert('opportunity', { id, code: id,
    title_ar: 'فرصة ' + id, sector_id: sector, department_id: dept, owner_user_id: 'u_lead_sol', stage_id: stage,
    win_pct: win, value_halalas: value, year, created_at: created, ...extra });
  await opp('O1', 'SOLUTIONS', 'D_SMART', 400000, 50, 2026, 'QUALIFIED', '2026-05-01T00:00:00Z');
  await opp('O2', 'SOLUTIONS', null, 300000, 25, 2026, 'LEAD', '2026-06-01T00:00:00Z');
  await opp('O3', 'SOLUTIONS', null, 100000, null, 2026, 'LEAD', '2026-06-02T00:00:00Z');
  await opp('O4', 'SOLUTIONS', null, 900000, 100, 2025, 'LEAD', '2026-01-15T00:00:00Z');
  await opp('O5', 'SOLUTIONS', null, 50000, 10, null, 'LEAD', '2026-06-03T00:00:00Z');
  await opp('O6', 'CONSULTING', null, 700000, 40, 2026, 'LEAD', '2026-06-04T00:00:00Z');
  await opp('O7', 'SOLUTIONS', null, 1000000, 90, 2026, 'LEAD', '2026-06-05T00:00:00Z', { deleted_at: T });

  const alloc = (id, dept, empId, projId, year, created) => insert('allocation', { id, employee_id: empId, project_id: projId,
    sector_id: 'SOLUTIONS', department_id: dept, type: 'member', year, monthly_json: '{"1":1}', created_at: created });
  await alloc('A1', 'D_AI', 'E3', 'P1', 2026, '2026-02-01T00:00:00Z');
  await alloc('A2', null, 'E4', 'P3', 2026, '2026-02-02T00:00:00Z');
  await alloc('A3', null, 'E4', 'P3', 2025, '2026-02-03T00:00:00Z');

  // ── ساحة الكتابة (المشاريع الاستراتيجية + قطاع الاستشارات) ──
  for (const id of ['W1', 'W2', 'W3', 'W4', 'W5'])
    await opp(id, 'STRATEGIC', null, 100000, 20, 2026, 'LEAD', '2026-03-0' + id.slice(1) + 'T00:00:00Z');
  await opp('WD', 'STRATEGIC', null, 100000, 20, 2026, 'LEAD', '2026-03-09T00:00:00Z', { deleted_at: T });
  await opp('WX', null, null, 100000, 20, 2026, 'LEAD', '2026-03-10T00:00:00Z');   // فرصة بلا قطاع (حالة حيّة قائمة)
  await opp('OC1', 'CONSULTING', null, 200000, 30, 2026, 'LEAD', '2026-03-11T00:00:00Z');
  await insert('project', { id: 'WP1', name_ar: 'مشروع استراتيجي', sector_id: 'STRATEGIC', owner_user_id: 'u_lead_strat',
    status: 'IN_PROGRESS', contract_value_halalas: 800000, created_at: T });
  await insert('employee', { id: 'ES1', name_ar: 'موظف استراتيجي', sector_id: 'STRATEGIC', active: 1, created_at: T });
  await insert('allocation', { id: 'WA1', employee_id: 'ES1', project_id: 'WP1', sector_id: 'STRATEGIC', type: 'member',
    year: 2026, monthly_json: '{"1":1}', created_at: T });
  for (const id of ['H1', 'H2', 'H3'])                                    // صفوف اختبارات المسارات وحدها
    await opp(id, 'STRATEGIC', null, 100000, 20, 2026, 'LEAD', '2026-04-0' + id.slice(1) + 'T00:00:00Z');

  const express = (await import('express')).default;
  const { attributionRouter } = await import('../../src/modules/org/attribution.routes.js');
  const { errorHandler } = await import('../../src/core/http/errors.js');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.ctx = { user: CURRENT, ip: '127.0.0.1' }; next(); });
  app.use('/api', attributionRouter);
  app.use(errorHandler());
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await close();
  rmSync(dir, { recursive: true, force: true });
});

// ═══════════════ (٠) توافق الترحيلة مع القائم ═══════════════

test('الترحيلة متوافقة: إدخال قائم لا يذكر الإدارة يظل يعمل، والقيمة تبدأ فارغة', async () => {
  await insert('project', { id: 'PLEGACY', name_ar: 'مشروع بأعمدة قديمة', sector_id: 'SOLUTIONS', created_at: T });
  const row = await get('SELECT department_id FROM project WHERE id = ?', ['PLEGACY']);
  assert.equal(row.department_id, null, 'العمود اختياري بلا قيمة افتراضية — لا Backfill صامت');
  await run('DELETE FROM project WHERE id = ?', ['PLEGACY']);
});

// ═══════════════ (١) الثابت الأساسي: لا إسناد عبر القطاعات ═══════════════

test('الإسناد عبر القطاعات مرفوض — والرسالة تسمّي القطاعين معاً', async () => {
  await assert.rejects(
    () => attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'W1', departmentId: 'D_PMO' }),
    (e) => {
      assert.equal(e.code, 'bad_request');
      assert.match(e.message, /المشاريع الاستراتيجية/, 'يسمّي قطاع الصف');
      assert.match(e.message, /قطاع الاستشارات/, 'يسمّي قطاع الإدارة');
      assert.match(e.message, /اختر إدارة داخل/, 'يقول للمستخدم ما يفعل');
      return true;
    });
  const row = await get('SELECT department_id FROM opportunity WHERE id = ?', ['W1']);
  assert.equal(row.department_id, null, 'لا كتابة عند الرفض');
  assert.equal(await auditCount('opportunity', 'W1'), 0, 'لا سطر تدقيق لمحاولة مرفوضة');
});

test('صف بلا قطاع لا يُسند إلى إدارة — يُطلب تحديد قطاعه أولاً', async () => {
  await assert.rejects(
    () => attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'WX', departmentId: 'D_TRANS' }),
    (e) => e.code === 'bad_request' && /لا يتبع أي قطاع/.test(e.message));
});

test('إدارة غير موجودة أو محذوفة تُرفض برسالة قابلة للتنفيذ', async () => {
  for (const depId of ['dep_ghost', 'D_GONE']) {
    await assert.rejects(
      () => attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'W1', departmentId: depId }),
      (e) => e.code === 'bad_request' && /اختر إدارة من القائمة/.test(e.message), `الإدارة ${depId}`);
  }
});

// ═══════════════ (٢) الإسناد والإلغاء + التدقيق ═══════════════

test('الإسناد داخل القطاع نفسه يكتب العمود ويُدقَّق، وإعادته لا تُكرّر شيئاً', async () => {
  const r = await attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'W2', departmentId: 'D_TRANS' });
  assert.equal(r.changed, true);
  assert.equal(r.department_id, 'D_TRANS');
  assert.equal(r.department_name_ar, 'إدارة التحول');
  const row = await get('SELECT department_id, updated_at, updated_by FROM opportunity WHERE id = ?', ['W2']);
  assert.equal(row.department_id, 'D_TRANS');
  assert.ok(row.updated_at, 'يُختم وقت التعديل');
  assert.equal(row.updated_by, 'u_admin');

  const logs = await all('SELECT * FROM audit_log WHERE resource = ? AND resource_id = ?', ['opportunity', 'W2']);
  assert.equal(logs.length, 1, 'كتابة واحدة ⟵ سطر تدقيق واحد');
  assert.equal(logs[0].action, 'update');
  assert.equal(logs[0].sector_id, 'STRATEGIC');
  const detail = JSON.parse(logs[0].detail_json);
  assert.equal(detail.field, 'department_id');
  assert.equal(detail.from, null);
  assert.equal(detail.to, 'D_TRANS');

  // إعادة الإسناد نفسه: لا كتابة ولا سطر تدقيق جديد (إعادة إرسال الدفعة لا تُغرق السجل)
  const again = await attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'W2', departmentId: 'D_TRANS' });
  assert.equal(again.changed, false);
  assert.equal(await auditCount('opportunity', 'W2'), 1);
});

test('إلغاء الإسناد بقيمة فارغة إجراء مشروع — بـnull وبنص فارغ معاً', async () => {
  const cleared = await attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'W2', departmentId: null });
  assert.equal(cleared.changed, true);
  assert.equal(cleared.department_id, null);
  assert.equal((await get('SELECT department_id FROM opportunity WHERE id = ?', ['W2'])).department_id, null);
  assert.equal(await auditCount('opportunity', 'W2'), 2, 'الإلغاء كتابة تُدقَّق مثل الإسناد');

  await attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'W2', departmentId: 'D_TRANS' });
  const byEmpty = await attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'W2', department_id: '' });
  assert.equal(byEmpty.department_id, null, 'النص الفارغ من قائمة الواجهة = بلا إدارة');
});

test('غياب مفتاح الإدارة كلياً خطأ صريح — لا إلغاء إسناد صامت', async () => {
  await attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'W3', departmentId: 'D_TRANS' });
  await assert.rejects(
    () => attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id: 'W3' }),
    (e) => e.code === 'bad_request' && /حدّد الإدارة/.test(e.message));
  assert.equal((await get('SELECT department_id FROM opportunity WHERE id = ?', ['W3'])).department_id, 'D_TRANS',
    'الإسناد القائم لم يُمسّ');
});

test('المشروع والتسكين يُسندان كذلك — والتسكين يستمد قطاعه من صفّه', async () => {
  const p = await attr.setWorkDepartment(ctx(admin), { kind: 'project', id: 'WP1', departmentId: 'D_TRANS' });
  assert.equal(p.changed, true);
  assert.equal((await get('SELECT department_id FROM project WHERE id = ?', ['WP1'])).department_id, 'D_TRANS');
  assert.equal(await auditCount('project', 'WP1'), 1);

  const a = await attr.setWorkDepartment(ctx(admin), { kind: 'allocation', id: 'WA1', departmentId: 'D_TRANS' });
  assert.equal(a.sector_id, 'STRATEGIC', 'قطاع التسكين من صف التسكين نفسه');
  assert.equal((await get('SELECT department_id FROM allocation WHERE id = ?', ['WA1'])).department_id, 'D_TRANS');
  assert.equal(await auditCount('allocation', 'WA1'), 1);
  // التسكين لا يحمل عمودَي وقت التعديل — يجب ألا نكتبهما (وإلا انكسر الاستعلام على القاعدة الحيّة)
  await assert.rejects(() => get('SELECT updated_at FROM allocation WHERE id = ?', ['WA1']), /updated_at/);
});

test('نوع عمل غير معروف يُرفض — بما فيه أسماء خصائص سلسلة النماذج', async () => {
  for (const kind of ['client', '', null, 'constructor', 'toString', '__proto__']) {
    await assert.rejects(
      () => attr.setWorkDepartment(ctx(admin), { kind, id: 'W1', departmentId: 'D_TRANS' }),
      (e) => e.code === 'bad_request' && /نوع العمل غير معروف/.test(e.message), `النوع ${String(kind)}`);
  }
});

test('صف غير موجود أو محذوف: رسالة «حدّث الصفحة» لا خطأ داخلي', async () => {
  for (const id of ['opp_ghost', 'WD']) {
    await assert.rejects(
      () => attr.setWorkDepartment(ctx(admin), { kind: 'opportunity', id, departmentId: 'D_TRANS' }),
      (e) => e.code === 'not_found' && /حدّث الصفحة/.test(e.message), `الصف ${id}`);
  }
});

// ═══════════════ (٣) الصلاحية على الصف نفسه — لا على النوع مجرّداً ═══════════════

test('قائد قطاع لا يُسند عمل قطاع آخر — وهذه هي ثغرة can() بلا هدف مُغلقةً', async () => {
  // البرهان: نفس المستخدم «يملك» تعديل الفرص بالمعنى المجرّد…
  assert.equal(can(leadSol, 'update', 'opportunity'), true, 'المنح موجود (استدعاء بلا هدف يُرجع صحيحاً)');
  // …لكن الصف يتبع قطاع الاستشارات، فتمرير الصف يقلب القرار.
  assert.equal(can(leadSol, 'update', 'opportunity', { sector_id: 'CONSULTING' }), false);
  await assert.rejects(
    () => attr.setWorkDepartment(ctx(leadSol), { kind: 'opportunity', id: 'OC1', departmentId: 'D_PMO' }),
    (e) => e.code === 'forbidden' && /لا تملك صلاحية/.test(e.message));
  assert.equal((await get('SELECT department_id FROM opportunity WHERE id = ?', ['OC1'])).department_id, null);
  assert.equal(await auditCount('opportunity', 'OC1'), 0);
});

// منذ قلب الرؤية (قرار المالك ٢٠٢٦-٠٨: «BD يرى فرصه») صار إسنادُ BD محصوراً بفرصه المملوكة —
// فالإسناد كتابةٌ على الفرصة، والكتابة تتبع منح التعديل وهو «خاصتي». فرصُ زملائه في قطاعه
// يُسندها قائدُ القطاع لا هو.
test('مدير تطوير الأعمال يُسند فرصه هو ومشاريع قطاعه — لا فرص زملائه ولا مشاريع قطاع آخر', async () => {
  await insert('opportunity', { id: 'WBD', code: 'WBD', title_ar: 'فرصة WBD', sector_id: 'STRATEGIC',
    owner_user_id: 'u_bd_strat', stage_id: 'LEAD', win_pct: 20, value_halalas: 100000, year: 2026,
    created_at: '2026-03-08T00:00:00Z' });
  const ok = await attr.setWorkDepartment(ctx(bdStrat), { kind: 'opportunity', id: 'WBD', departmentId: 'D_TRANS' });
  assert.equal(ok.changed, true);
  assert.equal((await all('SELECT id FROM audit_log WHERE resource_id = ?', ['WBD'])).length, 1);
  // وفرصة زميلٍ في قطاعه نفسه تُرَدّ — وتبقى بلا إسناد وبلا سطر تدقيق.
  await assert.rejects(
    () => attr.setWorkDepartment(ctx(bdStrat), { kind: 'opportunity', id: 'W4', departmentId: 'D_TRANS' }),
    (e) => e.code === 'forbidden');
  assert.equal((await get('SELECT department_id FROM opportunity WHERE id = ?', ['W4'])).department_id, null);
  // قرار المالك ٢٠٢٦-٠٨-١٧: صار يدير مشاريع قطاعه — تعديلاً وإسناداً — فانقلب الشرط قصداً.
  assert.equal(can(bdStrat, 'update', 'project'), true, 'منح تعديل مشاريع قطاعه (قرار ٢٠٢٦-٠٨-١٧)');
  const okProj = await attr.setWorkDepartment(ctx(bdStrat), { kind: 'project', id: 'WP1', departmentId: 'D_TRANS' });
  assert.equal(okProj.ok, true, 'يُسند مشروع قطاعه إلى إدارة داخله');
  // ومشروع قطاعٍ آخر يبقى مردوداً — الحدود القطاعية لم تتغيّر.
  await insert('project', { id: 'WP_CONS', name_ar: 'مشروع استشاري', sector_id: 'CONSULTING',
    owner_user_id: 'u_lead_sol', status: 'IN_PROGRESS', created_at: T });
  await assert.rejects(
    () => attr.setWorkDepartment(ctx(bdStrat), { kind: 'project', id: 'WP_CONS', departmentId: 'D_PMO' }),
    (e) => e.code === 'forbidden');
});

// ═══════════════ (٤) الدفعة: لا إجهاض عند أول فشل ═══════════════

test('الدفعة تُكمل بعد الفشل وتُعيد سبب كل عنصر على حدة', async () => {
  const r = await attr.bulkSetWorkDepartment(ctx(admin),
    { kind: 'opportunity', ids: ['W5', 'OC1', 'opp_ghost', 'W1'], departmentId: 'D_TRANS' });
  assert.equal(r.updated, 2, 'العنصران الصحيحان نجحا رغم فشل ما بينهما');
  assert.equal(r.changed, 2);
  assert.equal(r.failed.length, 2);
  assert.deepEqual(r.failed.map((f) => f.id), ['OC1', 'opp_ghost'], 'الفشل مرتبط بمعرّفه لا برسالة عامة');
  assert.match(r.failed[0].reason, /قطاع الاستشارات/, 'سبب عربي يشرح تحديداً ما المشكلة');
  assert.equal(r.failed[0].code, 'bad_request');
  assert.equal(r.failed[1].code, 'not_found');
  for (const id of ['W5', 'W1']) {
    assert.equal((await get('SELECT department_id FROM opportunity WHERE id = ?', [id])).department_id, 'D_TRANS');
    assert.equal(await auditCount('opportunity', id), 1, 'كل عنصر ناجح له سطر تدقيقه');
  }
  assert.equal((await get('SELECT department_id FROM opportunity WHERE id = ?', ['OC1'])).department_id, null);
});

test('الدفعة: تكرار المعرّف لا يُحتسب مرتين، والإسناد القائم يُحسب «بلا تغيير»', async () => {
  const r = await attr.bulkSetWorkDepartment(ctx(admin), { kind: 'opportunity', ids: ['W1', 'W1', 'W5'], departmentId: 'D_TRANS' });
  assert.equal(r.requested, 2, 'المعرّف المكرّر يُطوى');
  assert.equal(r.updated, 2);
  assert.equal(r.changed, 0);
  assert.equal(r.unchanged, 2, 'كانا مُسندين سلفاً ⟵ لا كتابة جديدة');
  assert.equal(await auditCount('opportunity', 'W1'), 1, 'لا تدقيق مكرر لتغيير لم يحدث');
});

test('الدفعة ترفض ما يتجاوز السقف وما هو فارغ قبل لمس القاعدة', async () => {
  const many = Array.from({ length: attr.BULK_LIMIT + 1 }, (_, i) => 'x' + i);
  await assert.rejects(
    () => attr.bulkSetWorkDepartment(ctx(admin), { kind: 'opportunity', ids: many, departmentId: 'D_TRANS' }),
    (e) => e.code === 'bad_request' && /دفعات أصغر/.test(e.message));
  await assert.rejects(
    () => attr.bulkSetWorkDepartment(ctx(admin), { kind: 'opportunity', ids: [], departmentId: 'D_TRANS' }),
    (e) => e.code === 'bad_request');
});

test('الدفعة: نوع خاطئ يفشل مرة واحدة مبكراً لا مئتي مرة', async () => {
  await assert.rejects(
    () => attr.bulkSetWorkDepartment(ctx(admin), { kind: 'invoice', ids: ['W1'], departmentId: 'D_TRANS' }),
    (e) => e.code === 'bad_request' && /نوع العمل غير معروف/.test(e.message));
});

// ═══════════════ (٥) التوزيع على الإدارات — أرقام محسوبة يدوياً ═══════════════

test('توزيع الحلول لسنة 2026 يطابق الحساب اليدوي، و«غير المُسند» دلو منفصل', async () => {
  const r = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year: 2026 });
  assert.equal(r.sector.name_ar, 'قطاع الحلول');
  assert.equal(r.year, 2026);
  const dep = (id) => r.departments.find((d) => d.id === id);

  // إدارة المدن الذكية: موظفان (E1,E2) + مشروعان (P1 1,000,000 و P2 500,000) + فرصة واحدة
  const smart = dep('D_SMART');
  assert.equal(smart.employees, 2);
  assert.equal(smart.projects, 2);
  assert.equal(smart.project_value_halalas, 1500000);
  assert.equal(smart.opportunities, 1);
  assert.equal(smart.opportunity_value_halalas, 400000);
  assert.equal(smart.opportunity_weighted_halalas, 200000, '400,000 × 50%');
  assert.equal(smart.allocations, 0);

  // Ai&Data: موظف واحد + تسكين واحد ولا فرص ولا مشاريع
  const ai = dep('D_AI');
  assert.equal(ai.employees, 1);
  assert.equal(ai.allocations, 1);
  assert.equal(ai.projects, 0);
  assert.equal(ai.opportunities, 0);
  assert.equal(ai.project_value_halalas, 0);

  // غير المُسند: هذا هو رقم القرار — عمل داخل القطاع بلا إدارة
  assert.equal(r.unassigned.employees, 1, 'E4');
  assert.equal(r.unassigned.projects, 1, 'P3 (P4 خارج السنة)');
  assert.equal(r.unassigned.project_value_halalas, 250000);
  assert.equal(r.unassigned.opportunities, 3, 'O2 + O3 + O5 (O4 سنة 2025)');
  assert.equal(r.unassigned.opportunity_value_halalas, 450000);
  assert.equal(r.unassigned.opportunity_weighted_halalas, 80000, '75,000 + 0 + 5,000');
  assert.equal(r.unassigned.allocations, 1, 'A2 (A3 سنة 2025)');

  // الشاذ: موظف قطاعه الحلول وإدارته تتبع الاستشارات — يظهر كي تتطابق الإجماليات
  assert.equal(r.orphaned.employees, 1, 'E5');

  // الإجماليات تُصالح: مجموع الإدارات + غير المُسند + الشاذ
  assert.equal(r.totals.employees, 5);
  assert.equal(r.totals.projects, 3);
  assert.equal(r.totals.project_value_halalas, 1750000);
  assert.equal(r.totals.opportunities, 4);
  assert.equal(r.totals.opportunity_value_halalas, 850000);
  assert.equal(r.totals.opportunity_weighted_halalas, 280000);
  assert.equal(r.totals.allocations, 2);
  const sum = (k) => r.departments.reduce((a, d) => a + d[k], 0) + r.unassigned[k] + r.orphaned[k];
  for (const k of Object.keys(r.totals)) assert.equal(r.totals[k], sum(k), `الإجمالي يطابق التفصيل: ${k}`);
});

test('التوزيع محصور في قطاعه ولا يتسرب من قطاع آخر ولا من صف محذوف', async () => {
  const r = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year: 2026 });
  assert.ok(!r.departments.some((d) => d.id === 'D_PMO'), 'إدارة قطاع آخر ليست في القائمة');
  assert.ok(!r.departments.some((d) => d.id === 'D_GONE'), 'إدارة محذوفة ليست في القائمة');
  assert.equal(r.totals.opportunities, 4, 'O6 (استشارات) وO7 (محذوفة) خارج الحساب');
});

test('سنة أخرى تُغيّر الأرقام: 2025 تُظهر ما استُبعد من 2026', async () => {
  const r = await attr.departmentRollup(admin, { sectorId: 'SOLUTIONS', year: 2025 });
  // O4 (سنة 2025) + O5 (بلا سنة، تظهر دائماً كي لا يختفي عمل بسبب حقل ناقص)
  assert.equal(r.unassigned.opportunities, 2);
  assert.equal(r.unassigned.opportunity_value_halalas, 950000);
  // P4 (2023–2024) لا يزال خارج 2025، وP2 بلا تواريخ يبقى محسوباً
  assert.equal(r.departments.find((d) => d.id === 'D_SMART').projects, 1, 'P2 فقط — P1 يبدأ 2026');
  assert.equal(r.unassigned.allocations, 1, 'A3');
});

test('التوزيع محكوم بالنطاق: قائد قطاع لا يقرأ توزيع قطاع غيره، والموظف لا يقرأه إطلاقاً', async () => {
  await assert.doesNotReject(() => attr.departmentRollup(leadSol, { sectorId: 'SOLUTIONS', year: 2026 }));
  for (const [u, who] of [[leadStrat, 'قائد قطاع آخر'], [worker, 'موظف'], [pmSol, 'مدير مشروع']]) {
    await assert.rejects(
      () => attr.departmentRollup(u, { sectorId: 'SOLUTIONS', year: 2026 }),
      (e) => e.code === 'forbidden', who);
  }
});

test('التوزيع يطلب قطاعاً موجوداً برسالة عربية', async () => {
  await assert.rejects(() => attr.departmentRollup(admin, {}), (e) => e.code === 'bad_request' && /حدّد القطاع/.test(e.message));
  await assert.rejects(() => attr.departmentRollup(admin, { sectorId: 'GHOST' }), (e) => e.code === 'not_found');
});

// ═══════════════ (٦) كشف العمل غير المُسند — الشاشة التي يُصلَح منها التكدّس ═══════════════

test('الكشف يستبعد ما له إدارة، ويستبعد القطاعات الأخرى والمحذوف، والأحدث أولاً', async () => {
  const r = await attr.unassignedWork(admin, { sectorId: 'SOLUTIONS', kind: 'opportunity' });
  assert.deepEqual(r.rows.map((x) => x.id), ['O5', 'O3', 'O2', 'O4'], 'الأحدث أولاً');
  assert.ok(!r.rows.some((x) => x.id === 'O1'), 'O1 مُسندة لإدارة المدن الذكية ⟵ ليست في قائمة العمل');
  assert.ok(!r.rows.some((x) => x.id === 'O6'), 'قطاع آخر');
  assert.ok(!r.rows.some((x) => x.id === 'O7'), 'محذوفة');
  assert.equal(r.count, 4);
  assert.equal(r.sector.name_ar, 'قطاع الحلول');

  const o2 = r.rows.find((x) => x.id === 'O2');
  assert.equal(o2.title, 'فرصة O2');
  assert.equal(o2.code, 'O2');
  assert.equal(o2.value_halalas, 300000);
  assert.equal(o2.owner_user_id, 'u_lead_sol');
  assert.equal(o2.owner_name_ar, 'مستخدم u_lead_sol', 'اسم المسؤول جاهز للعرض');
  assert.equal(o2.stage_name_ar, 'ليدز', 'مرحلة الفرصة بالاسم لا بالرمز');
});

test('الكشف يخدم المشاريع والتسكينات أيضاً بنفس الشكل الموحّد', async () => {
  const p = await attr.unassignedWork(admin, { sectorId: 'SOLUTIONS', kind: 'project' });
  assert.deepEqual(p.rows.map((x) => x.id).sort(), ['P3', 'P4'], 'P1/P2 مُسندان وP5 محذوف');
  assert.equal(p.rows.find((x) => x.id === 'P3').value_halalas, 250000);
  assert.equal(p.rows.find((x) => x.id === 'P3').status, 'IN_PROGRESS');

  const a = await attr.unassignedWork(admin, { sectorId: 'SOLUTIONS', kind: 'allocation' });
  assert.deepEqual(a.rows.map((x) => x.id), ['A3', 'A2'], 'A1 مُسند إلى Ai&Data');
  assert.equal(a.rows[0].title, 'مشروع P3', 'اسم المشروع من الجدول لا النص المخزَّن');
  assert.equal(a.rows[0].value_halalas, null, 'التسكين بلا قيمة مالية — null لا صفر مضلِّل');
});

test('حد القائمة: افتراضي 100 وسقف 500 مهما طلب المستخدم', async () => {
  assert.equal((await attr.unassignedWork(admin, { sectorId: 'SOLUTIONS' })).limit, attr.LIST_LIMIT_DEFAULT);
  assert.equal((await attr.unassignedWork(admin, { sectorId: 'SOLUTIONS', limit: 9999 })).limit, attr.LIST_LIMIT_MAX);
  assert.equal((await attr.unassignedWork(admin, { sectorId: 'SOLUTIONS', limit: 0 })).limit, attr.LIST_LIMIT_DEFAULT);
  assert.equal((await attr.unassignedWork(admin, { sectorId: 'SOLUTIONS', limit: 'abc' })).limit, attr.LIST_LIMIT_DEFAULT);
  const two = await attr.unassignedWork(admin, { sectorId: 'SOLUTIONS', limit: 2 });
  assert.equal(two.rows.length, 2, 'الحد يُطبَّق في الاستعلام لا بعده');
});

// ═══════════════ (٧) المسارات — معالجات رفيعة فوق الخدمة نفسها ═══════════════

test('المسارات: القراءة تعيد نفس حمولة الخدمة', async () => {
  CURRENT = admin;
  const roll = await api('GET', '/org/rollup?sector=SOLUTIONS&year=2026');
  assert.equal(roll.status, 200);
  assert.equal(roll.body.totals.opportunities, 4);
  assert.equal(roll.body.sector.name_ar, 'قطاع الحلول');

  const un = await api('GET', '/org/unassigned?sector=SOLUTIONS&kind=opportunity&limit=2');
  assert.equal(un.status, 200);
  assert.equal(un.body.rows.length, 2);
  assert.equal(un.body.rows[0].id, 'O5');
});

test('المسارات: الإسناد والإلغاء والدفعة عبر PATCH', async () => {
  CURRENT = admin;
  const set = await api('PATCH', '/org/attribution', { kind: 'opportunity', id: 'H1', department_id: 'D_TRANS' });
  assert.equal(set.status, 200);
  assert.equal(set.body.changed, true);
  assert.equal((await get('SELECT department_id FROM opportunity WHERE id = ?', ['H1'])).department_id, 'D_TRANS');

  // null صريح ⟵ إلغاء إسناد (لا يُخلط بغياب المفتاح)
  const clear = await api('PATCH', '/org/attribution', { kind: 'opportunity', id: 'H1', department_id: null });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.department_id, null);

  const bulk = await api('PATCH', '/org/attribution/bulk', { kind: 'opportunity', ids: ['H2', 'H3'], department_id: 'D_TRANS' });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.updated, 2);
  assert.equal(bulk.body.failed.length, 0);
});

test('المسارات: غياب مفتاح الإدارة يعود 400 برسالة عربية، والرفض يعود 403', async () => {
  CURRENT = admin;
  const missing = await api('PATCH', '/org/attribution', { kind: 'opportunity', id: 'H2' });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error.message, /حدّد الإدارة/);
  assert.equal((await get('SELECT department_id FROM opportunity WHERE id = ?', ['H2'])).department_id, 'D_TRANS',
    'الطلب الناقص لم يمسّ الإسناد القائم');

  CURRENT = leadSol;   // قائد الحلول أمام عمل المشاريع الاستراتيجية
  const denied = await api('PATCH', '/org/attribution', { kind: 'opportunity', id: 'H3', department_id: 'D_TRANS' });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'forbidden');
  const rollDenied = await api('GET', '/org/rollup?sector=STRATEGIC&year=2026');
  assert.equal(rollDenied.status, 403);
  CURRENT = admin;
});

test('الكشف محكوم بالنطاق لكل نوع على حدة', async () => {
  await assert.doesNotReject(() => attr.unassignedWork(leadSol, { sectorId: 'SOLUTIONS', kind: 'opportunity' }));
  await assert.rejects(() => attr.unassignedWork(leadStrat, { sectorId: 'SOLUTIONS', kind: 'opportunity' }),
    (e) => e.code === 'forbidden');
  // مدير المشروع نطاقه «مشروع» لا «قطاع»: لا يُفتح له كشف قطاعي رغم امتلاكه قراءة المشاريع
  assert.equal(can(pmSol, 'read', 'project'), true, 'المنح موجود بالمعنى المجرّد');
  await assert.rejects(() => attr.unassignedWork(pmSol, { sectorId: 'SOLUTIONS', kind: 'project' }),
    (e) => e.code === 'forbidden', 'النطاق لا يبلغ القطاع ⟵ يُغلق');
});
