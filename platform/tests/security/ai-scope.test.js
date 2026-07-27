// نطاق المساعد: **باب واحد** لأرقام الشركة، ومحور نطاق واحد للقراءات، وختم للراتب والكلفة.
//
// عطلان حقيقيان يحرسهما هذا الملف:
//   ① كان «الموجز الأسبوعي» يصل إلى أرقام الشركة عبر حارسٍ يسأل **اتساع نافذة الحساب**
//      (`user.scope === 'company'`) بدل الحارس الحقيقي `seesCompanyPerformance` (منحٌ قيادي مع
//      نافذة شركية). فالمشتريات — نافذته شركية بحقّ وليس له منح تقرير ولا مؤشر — كان يُردّ ٤٠٣
//      على مسار مقاييس الشركة ويستقبل الأرقام نفسها من المساعد. بابان لبيتٍ واحد.
//   ② كانت القراءات تكتب محور النطاق بيدها: `user.scope === 'company' ? '' : 'AND sector_id = ?'`.
//      وهو ليس المحور: من منحُه بنطاق «مشروع» (المستشار) أو «خاصتي» كان يُعامَل معاملة القطاع
//      كاملاً. والمحور الصحيح واحد في المنصة كلها: `scopeFilter`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ai-scope-'));
process.env.SANAD_DB = join(dir, 't.db');
delete process.env.AI_ENGINE;
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const db = await import('../../src/core/db/index.js');
const { initRbac, can } = await import('../../src/core/rbac/index.js');
await initRbac();
const { seesCompanyPerformance } = await import('../../src/core/policy/pages.js');
const { ask } = await import('../../src/core/ai/assistant.js');
const { ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js');

const T = '2026-07-01T00:00:00Z';
const SALARY = 1234567;                              // رقم راتب يجب ألا يظهر في أي ردّ لأي دور
const SOL_RED = 'مشروع الحلول الحرج';
const CONS_RED = 'مشروع الاستشارات الحرج';

// شخصية لكل دور، بنطاق واقعي (نفس أشكال scripts/seed.js) — سبعة عشر دوراً بلا استثناء.
const PERSONAS = {
  admin: ['company', null], ceo_office: ['company', null], sector_lead: ['sector', 'SOL'],
  bd_manager: ['own', 'SOL'], project_manager: ['own', 'SOL'], finance: ['company', null],
  hr: ['company', null], consultant: ['own', 'SOL'], employee: ['own', 'SOL'], viewer: ['sector', 'SOL'],
  department_manager: ['department', 'SOL'], line_manager: ['team', 'SOL'], bd_head: ['company', null],
  operations: ['sector', 'SOL'], procurement: ['company', null], approver: ['sector', 'SOL'],
  external: ['own', null],
};
const U = (role) => ({ id: 'u_' + role, username: role, role_id: role, scope: PERSONAS[role][0],
  sector_id: PERSONAS[role][1], projectIds: new Set(), teamIds: new Set() });
const ctx = (u) => ({ user: u, ip: '10.0.0.1' });
const say = async (u, msg) => {
  try { return { ok: true, ...(await ask(ctx(u), msg)) }; }
  catch (e) { return { ok: false, status: e.status, reply: e.message }; }
};

before(async () => {
  for (const role of Object.keys(PERSONAS)) {
    await db.insert('app_user', { id: 'u_' + role, username: role, name_ar: role, role_id: role,
      scope: PERSONAS[role][0], sector_id: PERSONAS[role][1], active: 1, created_at: T });
  }
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T,
    target_revenue_halalas: 100000, target_sales_halalas: 200000 });
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T,
    target_revenue_halalas: 100000, target_sales_halalas: 200000 });
  await db.insert('project', { id: 'P_SOL', name_ar: SOL_RED, sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'RED', progress_pct: 30, contract_value_halalas: 500000, actual_spend_halalas: 400000, created_at: T });
  await db.insert('project', { id: 'P_CONS', name_ar: CONS_RED, sector_id: 'CONS', status: 'IN_PROGRESS',
    rag: 'RED', progress_pct: 10, contract_value_halalas: 700000, actual_spend_halalas: 600000, created_at: T });
  await db.insert('employee', { id: 'E1', name_ar: 'موظف براتب', sector_id: 'SOL', salary_halalas: SALARY,
    active: 1, created_at: T });
  await db.insert('client', { id: 'C1', name_ar: 'جهة بلا تصنيف', active: 1, created_at: T });
  await db.insert('task', { id: 'TSK_SOL', title: 'مهمة متأخرة في الحلول', project_id: 'P_SOL', sector_id: 'SOL',
    assignee_user_id: 'u_employee', status: 'TODO', priority: 'P1', due_date: '2020-01-01', created_at: T });
  await db.insert('task', { id: 'TSK_CONS', title: 'مهمة متأخرة في الاستشارات', project_id: 'P_CONS', sector_id: 'CONS',
    assignee_user_id: 'u_consultant', status: 'TODO', priority: 'P1', due_date: '2020-01-01', created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── ① باب واحد لأرقام الشركة ──────────────────────────────────────────────────
test('الموجز الأسبوعي: بوابته `seesCompanyPerformance` نفسها لكل دور بلا استثناء', async () => {
  for (const role of Object.keys(ROLE_GRANTS)) {
    const u = U(role);
    const expected = seesCompanyPerformance(u);
    const r = await say(u, 'اكتب الموجز التنفيذي الأسبوعي');
    assert.equal(r.ok, expected, `${role}: المساعد ${r.ok ? 'أعطى' : 'منع'} أرقام الشركة والسياسة تقول ${expected}`);
    if (!expected) {
      assert.equal(r.status, 403);
      assert.match(r.reply, /خارج صلاحيتك/);
      assert.match(r.reply, /أولوياتي اليوم|ملخّص مشروع|مخاطر/, `${role}: الرفض بلا بديل مقترح`);
    }
  }
});

test('المشتريات — الحالة التي كشفت العطل: يُردّ على المسارين معاً', async () => {
  const proc = U('procurement');
  assert.equal(seesCompanyPerformance(proc), false, 'اتساع النافذة ليس رتبة قيادية');
  const r = await say(proc, 'أعطني الموجز الأسبوعي');
  assert.equal(r.status, 403);
  assert.ok(!/\d{3,}/.test(r.reply), 'ولا رقم واحد يتسرّب في رسالة الرفض');
});

// ── ② محور النطاق ─────────────────────────────────────────────────────────────
test('كشف المخاطر: لا اسم مشروع من قطاع لا يصل إليه صاحب الطلب', async () => {
  for (const role of Object.keys(PERSONAS)) {
    const u = U(role);
    const r = await say(u, 'ما المخاطر البارزة');
    if (!r.ok) { assert.equal(r.status, 403); continue; }
    const reachesCons = can(u, 'read', 'project', { sector_id: 'CONS', id: 'P_CONS' });
    if (!reachesCons) assert.ok(!r.reply.includes(CONS_RED), `${role} رأى مشروع قطاع آخر: ${r.reply}`);
    const reachesSol = can(u, 'read', 'project', { sector_id: 'SOL', id: 'P_SOL' });
    if (!reachesSol) assert.ok(!r.reply.includes(SOL_RED), `${role} رأى مشروعاً خارج نطاقه: ${r.reply}`);
  }
});

test('كشف المخاطر: قائد قطاع الحلول يرى مشروعه الحرج ولا يرى الآخر', async () => {
  const r = await say(U('sector_lead'), 'ما المخاطر');
  assert.ok(r.reply.includes(SOL_RED));
  assert.ok(!r.reply.includes(CONS_RED));
  assert.match(r.reply, /مهمة متأخرة/, 'والمهام المتأخرة محسوبة ضمن نطاقه');
  assert.ok(!r.reply.includes('مهمة متأخرة في الاستشارات'));
});

test('المستشار بنطاق «مشروع» يرى مشاريعه هو لا قطاعه كله', async () => {
  const cons = U('consultant');
  cons.projectIds = new Set(['P_CONS']);
  const r = await say(cons, 'ما المخاطر');
  assert.ok(r.reply.includes(CONS_RED), 'يرى مشروعه المسكَّن عليه: ' + r.reply);
  assert.ok(!r.reply.includes(SOL_RED), 'ولا يرى مشروعاً آخر في قطاعه المكتوب على حسابه');
});

test('من لا يملك قراءة المشاريع يُقال له ذلك — لا «لا مخاطر» تُقرأ طمأنينة', async () => {
  const r = await say(U('approver'), 'ما المخاطر');
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.reply, /خارج صلاحيتك/);
});

test('جودة البيانات: سطر العملاء لمن يملك قراءة العملاء وحده', async () => {
  const bd = await say(U('bd_manager'), 'افحص جودة البيانات');
  assert.match(bd.reply, /عميل بلا تصنيف نوع/);
  const ops = await say(U('operations'), 'افحص جودة البيانات');
  assert.ok(!/عميل/.test(ops.reply), 'العمليات بلا منح العملاء: ' + ops.reply);
});

test('الأولويات: مهام صاحب الطلب وحده', async () => {
  const emp = await say(U('employee'), 'ما أولوياتي');
  assert.match(emp.reply, /مهمة متأخرة في الحلول/);
  assert.ok(!/الاستشارات/.test(emp.reply));
  const hr = await say(U('hr'), 'ما أولوياتي');
  assert.ok(!/مهمة متأخرة/.test(hr.reply), 'لا مهام له فلا قائمة');
});

// ── ③ الختم على المال والراتب في كل ردّ لكل دور ───────────────────────────────
test('ختم الراتب والكلفة: على كل نية ولكل دور', async () => {
  const prompts = ['ما المخاطر', 'افحص جودة البيانات', 'ما أولوياتي', 'اكتب الموجز الأسبوعي',
    `لخّص حالة مشروع ${SOL_RED}`];
  for (const role of Object.keys(PERSONAS)) {
    const u = U(role);
    u.projectIds = new Set(['P_SOL', 'P_CONS']);
    for (const p of prompts) {
      const r = await say(u, p);
      assert.ok(!r.reply.includes(String(SALARY)), `${role}: رقم راتب في ردّ «${p}»`);
      assert.ok(!/salary|راتب/i.test(r.reply), `${role}: ذكر الراتب في ردّ «${p}»: ${r.reply}`);
      if (!r.ok) continue;
      // ختم الكلفة يُقاس على **ملخّص المشروع** وحده: هو الردّ الذي يحمل رقم الصرف أصلاً.
      if (p.startsWith('لخّص') && r.reply.includes(SOL_RED) && !r.reply.includes('حدّد المشروع')) {
        if (can(u, 'read', 'cost')) assert.match(r.reply, /الصرف الفعلي/, `${role}: يملك بوابة الكلفة ولا يراها`);
        else {
          assert.match(r.reply, /التكلفة محجوبة عن دورك/, `${role}: ملخّص بلا ختم الكلفة: ${r.reply}`);
          assert.ok(!/الصرف الفعلي/.test(r.reply), `${role}: رقم الصرف الفعلي ظاهر`);
        }
      }
    }
  }
});
