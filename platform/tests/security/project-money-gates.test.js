// بوابات «صورة المال على المشروع» — كل رقم خلف بوابته، والحجب على الحقل لا على الصفحة.
//
// القواعد التي تحرسها هذه الاختبارات:
//   • من لا يملك بوابة الكلفة يبقى يرى الداخل النقدي ونِسَب التسكين — يُحجب المبلغ لا الصفحة.
//   • من يقرأ سجل المصروفات بلا بوابة الكلفة يرى العدد والتوقيت بلا مبالغ (وسم «مقيَّد» لا فراغ).
//   • **الراتب مختوم**: لا تُشتق كلفة تسكين لشخص من راتبه × نسبته، ولا يظهر رقم راتب في الحمولة
//     لأي دور — ولا حتى لمدير النظام الذي يملك رؤيته في مكانه الصحيح (كشف الموظفين).
//   • المسار (Router) لا يقرر شيئاً: القرار كله داخل الخدمة، والمسار ينقل الرد ورمزه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-money-gates-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { config } = await import('../../src/core/config.js');
const { projectMoney } = await import('../../src/modules/finance/finance.js');
const { moneyRouter } = await import('../../src/modules/finance/money.routes.js');
const { errorHandler } = await import('../../src/core/http/errors.js');
const express = (await import('express')).default;

const YR = config.fiscalYear;
const T = `${YR}-01-05T08:00:00.000Z`;
const SALARY = 1_234_567; // رقم مميّز: يُبحث عنه حرفياً في الحمولة كلها
const U = (o) => ({ projectIds: new Set(), teamIds: new Set(), scope: 'own', sector_id: null, ...o });
const admin = U({ id: 'u_admin', username: 'admin1', role_id: 'admin', scope: 'company' });
const lead1 = U({ id: 'u_l1', username: 'lead1', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' });
const proc = U({ id: 'u_pr', username: 'proc1', role_id: 'procurement', scope: 'company' });
const ext = U({ id: 'u_ext', username: 'ext1', role_id: 'external', sector_id: 'S1', scope: 'own' });
const cons = U({ id: 'u_c1', username: 'cons1', role_id: 'consultant', sector_id: 'S1', scope: 'project', projectIds: new Set(['P4']) });
const outsider = U({ id: 'u_c2', username: 'cons2', role_id: 'consultant', sector_id: 'S2', scope: 'project', projectIds: new Set(['P9']) });

let server, base;
let asUser = admin;

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_ext', username: 'ext1', role_id: 'external', sector_id: 'S1', scope: 'own', active: 1, created_at: T });
  await db.insert('employee', { id: 'EMP1', name_ar: 'سارة', job_title: 'مستشار أول', sector_id: 'S1',
    active: 1, salary_halalas: SALARY, created_at: T });
  await db.insert('project', { id: 'P4', name_ar: 'مشروع البوابات', sector_id: 'S1', owner_user_id: 'u_ext',
    status: 'IN_PROGRESS', contract_value_halalas: 900_000, actual_spend_halalas: 310_000, created_at: T });
  await db.insert('invoice', { id: 'INV4', code: 'INV-4', project_id: 'P4', sector_id: 'S1',
    amount_halalas: 400_000, status: 'ISSUED', issue_date: `${YR}-03-05`, created_at: T });
  await db.insert('collection', { id: 'C9', invoice_id: 'INV4', amount_halalas: 250_000,
    collected_at: `${YR}-03-15`, method: 'تحويل', created_at: T });
  await db.insert('expense', { id: 'X1', project_id: 'P4', sector_id: 'S1', type: 'استضافة',
    amount_halalas: 60_000, incurred_month: 3, incurred_year: YR, requested_by: 'u_l1', status: 'PAID', created_at: T });
  await db.insert('cost_line', { id: 'CL9', project_id: 'P4', sector_id: 'S1', type: 'رواتب',
    amount_halalas: 300_000, month: 3, year: YR, source: 'migration', created_at: T });
  await db.insert('allocation', { id: 'A9', employee_id: 'EMP1', person_name_ar: 'سارة', project_id: 'P4',
    project_name: 'مشروع البوابات', sector_id: 'S1', type: 'lead', monthly_json: '{"3":0.75}', year: YR,
    source: 'manual', created_at: T });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { user: asUser, ip: '127.0.0.1' }; next(); });
  app.use('/api', moneyRouter);
  app.use(errorHandler());
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (user, path, init = {}) => {
  asUser = user;
  return fetch(base + path, { headers: { 'content-type': 'application/json', connection: 'close' }, ...init });
};

test('من لا يملك بوابة الكلفة يرى الداخل النقدي والنِّسَب، ولا يرى الكلفة', async () => {
  const m = await projectMoney(ext, 'P4'); // حساب خارجي يملك مشروعه: فواتيره نعم، كلفته لا
  assert.equal(m.cashIn.permitted, true);
  assert.equal(m.cashIn.total_halalas, 250_000);
  assert.equal(m.cashIn.monthly.find((x) => x.month === 3).amount_halalas, 250_000);
  assert.equal(m.staffing.recorded, true);
  assert.equal(m.staffing.people[0].monthly[2], 75, 'النسبة الشهرية تظهر لمن يقرأ المشروع');
  assert.equal(m.cost.permitted, false, 'الكلفة محجوبة');
  assert.equal(m.cost.total_halalas, null);
  assert.equal(m.cost.project_actual_spend_halalas, null, 'المصروف الفعلي على صف المشروع محجوب أيضاً');
  assert.equal(m.expenses.permitted, false);
  assert.ok(m.cost.reason_ar, 'يُقال سبب الحجب');
});

test('قارئ سجل المصروفات بلا بوابة الكلفة: عدد وتوقيت بلا مبالغ', async () => {
  const m = await projectMoney(proc, 'P4');
  assert.equal(m.expenses.permitted, true);
  assert.equal(m.expenses.amounts_visible, false);
  assert.equal(m.expenses.count, 1, 'العدد حقيقة غير حسّاسة');
  assert.equal(m.expenses.rows[0].amount_halalas, null);
  assert.equal(m.expenses.rows[0].amount_restricted, true, 'الصف موسوم كمقيَّد لا فارغاً');
  assert.equal(m.expenses.rows[0].type, 'استضافة');
  assert.equal(m.cashOut.paid.count, 1);
  assert.equal(m.cashOut.paid.total_halalas, null, 'المبلغ محجوب والعدد ظاهر');
  assert.equal(m.cashOut.paid.monthly.find((x) => x.month === 3).amount_halalas, null);
  assert.ok(m.cashOut.amounts_reason_ar, 'سبب حجب المبالغ مذكور');
  assert.equal(m.cashIn.permitted, false, 'المشتريات لا تفتح دفتر التحصيل');
  assert.equal(m.suppliers.permitted, true, 'المشتريات تقرأ مشتريات المشروع');
});

test('قائد القطاع يرى المبالغ ولا يرى دفتر الموردين', async () => {
  const m = await projectMoney(lead1, 'P4');
  assert.equal(m.expenses.amounts_visible, true);
  assert.equal(m.expenses.rows[0].amount_halalas, 60_000);
  assert.equal(m.cashOut.paid.total_halalas, 60_000);
  assert.equal(m.cost.total_halalas, 300_000);
  assert.equal(m.expenses.can_add, true);
  assert.equal(m.expenses.can_approve, true);
  assert.equal(m.suppliers.permitted, false);
  assert.ok(m.suppliers.reason_ar);
  assert.equal(m.suppliers.rows.length, 0);
});

test('الراتب مختوم: لا كلفة تسكين لشخص، ولا رقم راتب في الحمولة لأي دور', async () => {
  for (const u of [admin, lead1, proc, ext, cons]) {
    const m = await projectMoney(u, 'P4');
    assert.equal(m.staffing.cost.available, false, `${u.role_id}: لا كلفة تسكين لكل شخص`);
    const text = JSON.stringify(m);
    assert.ok(!text.includes(String(SALARY)), `${u.role_id}: لا يتسرب رقم الراتب`);
    assert.ok(!/salary/i.test(text), `${u.role_id}: لا حقل راتب في الحمولة`);
    for (const person of m.staffing.people) {
      assert.ok(!('cost_halalas' in person), 'لا كلفة على صف الشخص');
    }
  }
});

test('الاستشاري داخل المشروع يرى النِّسَب وحدها؛ ومن خارجه يُرَدّ', async () => {
  const m = await projectMoney(cons, 'P4');
  assert.equal(m.staffing.people[0].monthly[2], 75);
  assert.equal(m.cashIn.permitted, false);
  assert.equal(m.cost.permitted, false);
  await assert.rejects(() => projectMoney(outsider, 'P4'), /خارج نطاق/);
});

// ── المسار: ينقل قرار الخدمة كما هو ─────────────────────────────────────────────────────────
test('المسار يعيد الحمولة لمن يملكها، ويعيد رمز المنع لمن لا يملكها', async () => {
  const ok = await call(lead1, '/api/projects/P4/money');
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.project.id, 'P4');
  assert.equal(body.cashIn.total_halalas, 250_000);
  assert.equal(body.year, YR);

  const withYear = await call(lead1, `/api/projects/P4/money?year=${YR - 1}`);
  assert.equal((await withYear.json()).year, YR - 1);

  const denied = await call(outsider, '/api/projects/P4/money');
  assert.equal(denied.status, 403);
  assert.ok(/خارج نطاق/.test((await denied.json()).error.message));

  const missing = await call(lead1, '/api/projects/P404/money');
  assert.equal(missing.status, 404);
});

test('المسار: تسجيل مصروف وتعديله وحذفه — والمنع يعود بالرمز الصحيح', async () => {
  const created = await call(lead1, '/api/projects/P4/expenses', {
    method: 'POST', body: JSON.stringify({ type: 'تصميم', amount_sar: 200, month: 4, year: YR }),
  });
  assert.equal(created.status, 200);
  const row = await created.json();
  assert.equal(row.amount_halalas, 20_000);

  const bad = await call(lead1, '/api/projects/P4/expenses', {
    method: 'POST', body: JSON.stringify({ type: 'تصميم', amount_sar: 200, year: YR }),
  });
  assert.equal(bad.status, 400, 'مصروف بلا شهر يُرَدّ');

  const patched = await call(lead1, `/api/finance/expenses/${row.id}`, {
    method: 'PATCH', body: JSON.stringify({ amount_sar: 250 }),
  });
  assert.equal((await patched.json()).amount_halalas, 25_000);

  const forbidden = await call(proc, `/api/finance/expenses/${row.id}`, {
    method: 'PATCH', body: JSON.stringify({ amount_sar: 999 }),
  });
  assert.equal(forbidden.status, 403, 'المشتريات تقرأ ولا تكتب المصروفات');

  const removed = await call(lead1, `/api/finance/expenses/${row.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const after = await db.get('SELECT deleted_at FROM expense WHERE id = ?', [row.id]);
  assert.ok(after.deleted_at);
  const audits = await db.all('SELECT action FROM audit_log WHERE resource = ? AND resource_id = ? ORDER BY at', ['expense', row.id]);
  assert.deepEqual(audits.map((a) => a.action), ['create', 'update', 'delete'], 'كل كتابة عبر المسار مُدقَّقة');
});
