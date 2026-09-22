// تكامل: مسار حمولة «مركز القطاع» — الرمز والترويسة والباب.
//
// ما يحرسه هذا الملف:
//   • قائد القطاع يقرأ قطاعه: ٢٠٠ وحمولةٌ كاملة، وترويسة «لا يُخزَّن» — فمالُ قطاعٍ مُرشَّحٌ
//     بصلاحية قارئه بعينه لا يُترك في ذاكرة وسيطٍ ولا في قرص متصفّحٍ يقرؤه حسابٌ آخر.
//   • قائدُ قطاعٍ آخر يُردّ ٤٠٣ ولو كتب معرّف القطاع بيده في العنوان (لا مرجع مباشر غير آمن).
//   • قطاعٌ لا وجود له يُردّ ٤٠٤ ولا يسقط صامتاً إلى قطاع القارئ.
//   • حمولةُ من أُغلق عليه بابُ الكلفة لا تحمل اسم حقلٍ حسّاس أصلاً — لا مبلغاً ولا مفتاحاً.
//   • المسار لا يقرّر شيئاً: القرار كله داخل الخدمة، والمسار ينقل الرد ورمزه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ccapi-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
// دورٌ يقرأ الإيراد والمشاريع بلا بابَي الكلفة والهامش — لا وجود لتوليفته في المصفوفة.
await db.run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_nocost','قارئ بلا كلفة','No Cost',0,'2026-01-01T00:00:00.000Z')");
for (const r of ['revenue_line', 'budget', 'project', 'opportunity', 'client', 'employee']) {
  await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_nocost', r, 'read', 'sector']);
}
await (await import('../../src/core/rbac/index.js')).initRbac();
const { commandCenterRouter } = await import('../../src/modules/finance/command-center.routes.js');
const { errorHandler } = await import('../../src/core/http/errors.js');
const express = (await import('express')).default;

const T = '2026-01-10T08:00:00.000Z';
const YR = new Date().getUTCFullYear() - 1;
const SALARY = 1_234_567;   // رقمٌ مميّز: لا يجوز أن يظهر في أي حمولة
const COST = 70_000_011;    // كلفةٌ مسجَّلة في سند

const person = (id, role, sector) => ({ id, username: id, name_ar: id, role_id: role, sector_id: sector, scope: 'sector' });
const LEAD = person('u_lead', 'sector_lead', 'S1');
const OTHER = person('u_other', 'sector_lead', 'S2');
const NOCOST = person('u_nocost', 't_nocost', 'S1');

// المسار وحده على تطبيقٍ خاصّ بهذا الاختبار: `api.routes.js` يركّبه في جلسة التكامل (W1)،
// وهذا الملف يختبر المسار نفسه لا موضعَ تركيبه.
let server, base, CURRENT = LEAD;
const http = async (path, as) => {
  CURRENT = as;
  const r = await fetch(base + path, { redirect: 'manual' });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* ردُّ خطأٍ غير JSON */ }
  return { status: r.status, headers: r.headers, text, json };
};

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  for (const u of [LEAD, OTHER, NOCOST]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: 'sector', active: 1, created_at: T });
  }
  await db.insert('client', { id: 'C1', name_ar: 'جهة ألف', created_at: T });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع ألف', sector_id: 'S1', client_id: 'C1', rag: 'GREEN',
    status: 'IN_PROGRESS', contract_value_halalas: 90_000_000, margin_pct: 34,
    start_date: `${YR}-01-01`, end_date: `${YR}-12-31`, created_at: T });
  await db.insert('revenue_line', { id: 'RL1', sector_id: 'S1', project_id: 'P1', year: YR, month: 1,
    amount_halalas: 127_765, net_amount_halalas: 111_100, created_at: T });
  await db.insert('expense', { id: 'EX1', sector_id: 'S1', project_id: 'P1', type: 'مستشار', category: 'con',
    amount_halalas: COST, net_amount_halalas: COST, incurred_year: YR, incurred_month: 1,
    status: 'APPROVED', created_at: T });
  // راتبٌ مسجَّل في كشف الموظفين: لا يُقرأ من هنا لأي دورٍ كان.
  await db.insert('employee', { id: 'E1', name_ar: 'موظف ألف', sector_id: 'S1', active: 1,
    salary_halalas: SALARY, created_at: T });
  await db.insert('budget', { id: 'B1', sector_id: 'S1', fiscal_year: YR, target_revenue_halalas: 12_000_000,
    target_sales_halalas: 20_000_000, created_at: T });

  const app = express();
  app.use((req, res, next) => { req.ctx = { user: CURRENT, ip: '127.0.0.1' }; next(); });
  app.use('/api', commandCenterRouter);
  app.use(errorHandler());
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((r) => server.close(r));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('قائد القطاع يقرأ حمولة قطاعه: ٢٠٠ وحمولةٌ كاملة وترويسةُ «لا يُخزَّن»', async () => {
  const r = await http(`/api/sectors/S1/command-center?year=${YR}`, LEAD);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(String(r.headers.get('content-type')), /application\/json/);
  assert.equal(r.json.meta.sector.id, 'S1');
  assert.equal(r.json.meta.year, YR);
  assert.equal(r.json.lines.length, 9, 'قائد القطاع يرى سطور القائمة التسعة');
  assert.equal(r.json.projects.length, 1);
  assert.ok(Array.isArray(r.json.clients) && Array.isArray(r.json.opps) && Array.isArray(r.json.stages));
});

test('قائدُ قطاعٍ آخر يُردّ عن قطاعٍ ليس قطاعه ولو كتب معرّفه بيده', async () => {
  const r = await http(`/api/sectors/S1/command-center?year=${YR}`, OTHER);
  assert.equal(r.status, 403);
  assert.ok(!/111100|34/.test(JSON.stringify(r.json?.error ?? r.text)), 'رقمٌ من القطاع المرفوض تسرّب في رسالة الردّ');
});

test('قطاعٌ لا وجود له لا يسقط صامتاً إلى قطاع القارئ — ولا يُفرَّق عن قطاعٍ خارج نطاقه', async () => {
  // من نطاقه قطاعُه: الجوابان واحد (٤٠٣) عن اسمٍ لا وجود له وعن قطاعٍ قائمٍ ليس قطاعَه —
  // وإلا صار تخمينُ المعرّفات كشفاً لما في المنصة من قطاعات.
  const nope = await http(`/api/sectors/S_NOPE/command-center?year=${YR}`, LEAD);
  const foreign = await http(`/api/sectors/S2/command-center?year=${YR}`, LEAD);
  assert.equal(nope.status, 403);
  assert.equal(foreign.status, 403);
  assert.equal(nope.text, foreign.text, 'جوابُ «غير موجود» يفرّق عن جواب «ليس لك»');
});

test('حمولةُ من أُغلق عليه بابُ الكلفة: لا اسمَ حقلٍ حسّاسٍ ولا رقمَ كلفةٍ ولا راتب', async () => {
  const r = await http(`/api/sectors/S1/command-center?year=${YR}`, NOCOST);
  assert.equal(r.status, 200);
  for (const key of ['salary_halalas', 'amount_halalas', 'margin_pct']) {
    assert.ok(!r.text.includes(key), `اسمُ الحقل الحسّاس «${key}» حاضرٌ في الحمولة`);
  }
  assert.ok(!r.text.includes(String(COST)), 'مبلغُ كلفةٍ مسجَّلٍ في سند خرج لمن لا يقرأ الكلفة');
  assert.ok(!r.text.includes(String(SALARY)), 'راتبٌ خرج في حمولة مركز القطاع');
  assert.deepEqual(r.json.lines.map((l) => l.id), ['rev']);
  assert.ok(r.json.notes.includes('costs_hidden'));
  // والحمولة تبقى صالحةً للعرض: الحجب لا يُعطّل الشاشة.
  assert.equal(r.json.projects.length, 1);
  assert.equal(r.json.lines[0].fin[0], 111_100);
});
