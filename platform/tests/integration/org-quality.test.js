// عرض «درجة اكتمال الهيكل» — العقد التنفيذي لخدمة تشخيص الهيكل (orgHealth):
//   { score, checks: [{ id, severity, title_ar, detail_ar, count, items, fix_hint_ar }], summary }
//
// السبب من الملف: المالك نظر إلى صفحة الهيكل فقال «جدا سيء»، وهو محق — الحيّ اليوم فيه إدارتان
// باسم لاتيني داخل منتج عربي بالكامل، وإدارة اسمها «الحلول» داخل قطاع اسمه «قطاع الحلول»،
// وعشرة موظفين في قطاع الحلول بلا إدارة، وقطاعان بلا أي هيكل، وفرصتان بلا قطاع، ولا مشروع
// واحد ولا فرصة واحدة منسوبة إلى إدارة. القاعدة المصغَّرة أدناه تعيد إنتاج ذلك حرفياً.
//
// ما يحرسه هذا الملف:
//   • كل بند من الثمانية يتحقق على خلل مزروع، ويصمت حين يُصلَح الخلل نفسه.
//   • الدرجة تتحرك مع الإصلاح: 63 ⟵ 55 (حين تُفتح خانة الإدارة) ⟵ 100 بعد إغلاق كل فئة.
//   • التشخيص لا يكتب شيئاً إطلاقاً: لا صف ولا سطر تدقيق (يُقارَن كل جدول قبلاً وبعداً).
//   • بند «الأعمال بلا إدارة» لا ينكسر قبل وصول خانة الإدارة — يُعلَن مؤجَّلاً ولا يُخصم عليه.
//   • البوابة: من لا يملك عرض الهيكل يُرفض، وقائد القطاع لا يرى قطاعاً غير قطاعه مهما طلب.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-orgscore-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, all, run, exec, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { orgHealth, CHECK_IDS, SEVERITY_WEIGHT } = await import('../../src/modules/org/org-quality.js');
const { bannedTermIn } = await import('../../scripts/check-glossary.mjs');

const T = '2026-07-01T00:00:00Z';
const U = (role, sector, scope) => ({ id: `u_${role}_${sector || 'x'}`, role_id: role, sector_id: sector,
  scope, projectIds: new Set(), teamIds: new Set() });
const admin = U('admin', null, 'company');
const solLead = U('sector_lead', 'SOLUTIONS', 'sector');
const consLead = U('sector_lead', 'CONSULTING', 'sector');

const checkOf = (r, id) => {
  const c = r.checks.find((x) => x.id === id);
  assert.ok(c, `البند ${id} غير موجود في التقرير`);
  return c;
};

before(async () => {
  // القطاعات الأربعة المجمَّدة — لا خامس أبداً
  for (const [id, name_ar, order] of [
    ['SOLUTIONS', 'قطاع الحلول', 1], ['CONSULTING', 'قطاع الاستشارات', 2],
    ['STRATEGIC', 'المشاريع الاستراتيجية', 3], ['SAP', 'قطاع SAP', 4],
  ]) await insert('sector', { id, name_ar, active: 1, sort_order: order, created_at: T });

  await insert('app_user', { id: 'u_mgr', username: 'mgr', name_ar: 'مسؤول إدارة', role_id: 'sector_lead',
    sector_id: 'SOLUTIONS', scope: 'sector', active: 1, created_at: T });

  // [معرّف, قطاع, اسم, عدد موظفيها, لها مسؤول؟]
  const deps = [
    ['d_ai', 'SOLUTIONS', 'Ai&Data', 5, false],
    ['d_innov', 'SOLUTIONS', 'Innovation', 1, false],
    ['d_smart', 'SOLUTIONS', 'إدارة المدن الذكية', 0, true],
    ['d_sol', 'SOLUTIONS', 'الحلول', 12, true],
    ['d_bd', 'SOLUTIONS', 'تطوير الأعمال', 1, true],
    ['d_pmo', 'CONSULTING', 'مكتب إدارة المشاريع', 0, true],
  ];
  for (const [id, sector_id, name_ar, n, managed] of deps) {
    await insert('department', { id, sector_id, name_ar, active: 1, created_at: T,
      manager_user_id: managed ? 'u_mgr' : null });
    for (let i = 1; i <= n; i++) {
      await insert('employee', { id: `e_${id}_${i}`, name_ar: `موظف ${id} ${i}`, sector_id,
        department_id: id, active: 1, created_at: T });
    }
  }
  // عشرة في قطاع الحلول بلا إدارة، واثنان في SAP الذي لا إدارة فيه أصلاً
  for (let i = 1; i <= 10; i++) {
    await insert('employee', { id: `e_free_${i}`, name_ar: `موظف بلا إدارة ${i}`, sector_id: 'SOLUTIONS',
      active: 1, created_at: T });
  }
  for (let i = 1; i <= 2; i++) {
    await insert('employee', { id: `e_sap_${i}`, name_ar: `موظف قطاع الموارد ${i}`, sector_id: 'SAP',
      active: 1, created_at: T });
  }

  await insert('stage', { id: 'LEAD', name_ar: 'مبدئية', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  for (let i = 1; i <= 4; i++) {
    await insert('opportunity', { id: `o_sol_${i}`, title_ar: `فرصة حلول ${i}`, sector_id: 'SOLUTIONS',
      stage_id: 'LEAD', created_at: T });
  }
  // فرصتان بلا قطاع إطلاقاً — الحالة الحيّة اليوم
  for (let i = 1; i <= 2; i++) {
    await insert('opportunity', { id: `o_stray_${i}`, title_ar: `فرصة بلا قطاع ${i}`, stage_id: 'LEAD', created_at: T });
  }
  for (let i = 1; i <= 3; i++) {
    await insert('project', { id: `p_sol_${i}`, name_ar: `مشروع حلول ${i}`, sector_id: 'SOLUTIONS', created_at: T });
  }
  await insert('project', { id: 'p_cons_1', name_ar: 'مشروع استشارات 1', sector_id: 'CONSULTING', created_at: T });
  await insert('allocation', { id: 'a_1', employee_id: 'e_d_sol_1', project_id: 'p_sol_1',
    person_name_ar: 'موظف d_sol 1', project_name: 'مشروع حلول 1', sector_id: 'SOLUTIONS', year: 2026, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ── العقد نفسه ────────────────────────────────────────────────────────────────
test('العقد: درجة + ثمانية بنود لكل واحد منها عنوان وسبب وعدد وأمثلة وماذا أفعل', async () => {
  const r = await orgHealth(admin);
  assert.equal(typeof r.score, 'number');
  assert.ok(r.score >= 0 && r.score <= 100, 'الدرجة داخل المدى');
  assert.deepEqual(r.checks.map((c) => c.id), CHECK_IDS, 'الترتيب ثابت تعتمد عليه الواجهة');
  assert.equal(r.checks.length, 8);
  for (const c of r.checks) {
    assert.ok(['high', 'medium', 'low'].includes(c.severity), `${c.id}: شدّة غير معروفة`);
    assert.equal(typeof c.count, 'number');
    assert.ok(Array.isArray(c.items));
    for (const k of ['title_ar', 'detail_ar', 'fix_hint_ar']) {
      assert.ok(typeof c[k] === 'string' && c[k].trim(), `${c.id}: ${k} فارغ`);
    }
  }
  assert.equal(r.summary.score, r.score);
  assert.equal(r.summary.issues, r.checks.filter((c) => !c.skipped && c.count > 0).length);
  assert.deepEqual({ s: r.summary.sectors, d: r.summary.departments, e: r.summary.employees },
    { s: 4, d: 6, e: 31 }, 'ما فُحص فعلاً: 4 قطاعات و6 إدارات و31 موظفاً');
});

// ── كل بند يتحقق على خلل مزروع ────────────────────────────────────────────────
test('موظفون بلا إدارة: 12 — عاجل، ومع كل واحد قطاعه', async () => {
  const c = checkOf(await orgHealth(admin), 'employees_without_department');
  assert.equal(c.count, 12, '10 في الحلول + 2 في قطاع الموارد');
  assert.equal(c.severity, 'high');
  assert.equal(c.items.length, 12, 'الأمثلة تسمّي كل واحد منهم');
  assert.ok(c.items.every((i) => i.id && i.name && i.hint_ar));
  assert.ok(c.items.some((i) => i.hint_ar.includes('قطاع الحلول')));
  assert.match(c.fix_hint_ar, /أسنِد/, 'يقول ماذا أفعل لا ما هو الخطأ');
});

test('قطاعات بلا إدارات: قطاعان — ويميّز القطاع الذي فيه موظفون من الفارغ', async () => {
  const c = checkOf(await orgHealth(admin), 'sector_without_departments');
  assert.equal(c.count, 2);
  assert.equal(c.severity, 'high');
  assert.deepEqual(c.items.map((i) => i.id).sort(), ['SAP', 'STRATEGIC']);
  assert.match(c.items.find((i) => i.id === 'SAP').hint_ar, /موظفان/, 'قطاع فيه ناس بلا هيكل');
  assert.match(c.items.find((i) => i.id === 'STRATEGIC').hint_ar, /لا موظفين/);
});

test('فرص بلا قطاع: فرصتان حيَّتان — عاجل', async () => {
  const c = checkOf(await orgHealth(admin), 'opportunity_without_sector');
  assert.equal(c.count, 2);
  assert.equal(c.severity, 'high');
  assert.equal(c.skipped, false);
  assert.deepEqual(c.items.map((i) => i.id).sort(), ['o_stray_1', 'o_stray_2']);
});

test('اسم إدارة يكرّر اسم قطاعها: «الحلول» داخل «قطاع الحلول»', async () => {
  const c = checkOf(await orgHealth(admin), 'department_name_echoes_sector');
  assert.equal(c.count, 1);
  assert.equal(c.severity, 'medium');
  assert.equal(c.items[0].id, 'd_sol');
  assert.match(c.items[0].hint_ar, /12 موظفاً/, 'يذكر كم شخصاً في السلة الغامضة');
});

test('أسماء إدارات بغير العربية: «Ai&Data» و«Innovation» مع اسم عربي مقترح', async () => {
  const c = checkOf(await orgHealth(admin), 'non_arabic_department_name');
  assert.equal(c.count, 2);
  assert.equal(c.severity, 'medium');
  assert.deepEqual(c.items.map((i) => i.name).sort(), ['Ai&Data', 'Innovation']);
  assert.ok(c.items.every((i) => i.hint_ar.includes('الاسم المقترح')), 'الاقتراح جاهز أمام المالك');
});

test('إدارات بلا موظفين: المدن الذكية ومكتب إدارة المشاريع', async () => {
  const c = checkOf(await orgHealth(admin), 'department_without_employees');
  assert.equal(c.count, 2);
  assert.equal(c.severity, 'medium');
  assert.deepEqual(c.items.map((i) => i.id).sort(), ['d_pmo', 'd_smart']);
});

test('إدارات بلا مسؤول: إدارتان — أدنى الشدّات، ولا تُهمَل', async () => {
  const c = checkOf(await orgHealth(admin), 'department_without_manager');
  assert.equal(c.count, 2);
  assert.equal(c.severity, 'low');
  assert.deepEqual(c.items.map((i) => i.id).sort(), ['d_ai', 'd_innov']);
});

// ── الدرجة ───────────────────────────────────────────────────────────────────
test('الدرجة = 100 ناقص وزن كل بند متحقق (عاجل ٨ · مهم ٤ · مؤجَّل ١) ولا تنزل تحت الصفر', async () => {
  const r = await orgHealth(admin);
  const expected = r.checks.filter((c) => !c.skipped && c.count > 0)
    .reduce((a, c) => a + SEVERITY_WEIGHT[c.severity], 0);
  assert.equal(r.score, Math.max(0, 100 - expected));
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.equal(r.summary.high, r.checks.filter((c) => !c.skipped && c.count > 0 && c.severity === 'high').length);
  assert.match(r.summary.headline_ar, new RegExp(`درجة الاكتمال ${r.score} من 100`));
});

// ── البند السادس: يتحمّل غياب خانة «الإدارة» ولا يُسقط التقرير معه ────────────
// خانة الإدارة على جداول العمل تصل مع ترحيلة الإسناد. نُسقطها هنا عمداً كي نُثبت أن التشخيص
// كله يبقى عاملاً على قاعدة لم تصلها الترحيلة بعد (وهي حال أي بيئة قبل النشر).
const WORK_TABLES = [['project', 'ix_project_dept'], ['opportunity', 'ix_opp_dept'], ['allocation', 'ix_alloc_dept']];
test('بلا خانة الإدارة: بند الأعمال مؤجَّل — لا انكسار ولا خصم ولا ادعاء سلامة', async () => {
  for (const [t, ix] of WORK_TABLES) {
    try {
      await exec(`DROP INDEX IF EXISTS ${ix}`);
      await exec(`ALTER TABLE ${t} DROP COLUMN department_id`);
    } catch { /* الخانة غير موجودة أصلاً — وهي الحالة المقصودة تماماً */ }
  }
  const r = await orgHealth(admin); // يجب ألا يرمي شيئاً
  const c = checkOf(r, 'work_without_department');
  assert.equal(c.skipped, true, 'لا يُفحص ما لا يمكن فحصه');
  assert.equal(c.count, 0);
  assert.equal(c.deduction, 0, 'بند لم يُقَس لا يُخصم عليه');
  assert.ok(c.detail_ar.includes('لم يُفعَّل بعد'), 'يقول للمالك لماذا لا رقم هنا');
  assert.equal(r.summary.skipped, 1);
  // ثلاثة بنود عاجلة (٢٤) + ثلاثة مهمة (١٢) + بند أدنى شدّة (١) = ٣٧
  assert.deepEqual({ h: r.summary.high, m: r.summary.medium, l: r.summary.low }, { h: 3, m: 3, l: 1 });
  assert.equal(r.score, 63);
});

test('بعد وصول خانة الإدارة: البند يعمل تلقائياً بلا تعديل كود ويشمل المشاريع والفرص والتسكين', async () => {
  for (const [t] of WORK_TABLES) await exec(`ALTER TABLE ${t} ADD COLUMN department_id TEXT`);
  const r = await orgHealth(admin);
  const c = checkOf(r, 'work_without_department');
  assert.equal(c.skipped, false);
  assert.equal(c.severity, 'high');
  assert.equal(c.count, 4 + 6 + 1, '4 مشاريع + 6 فرص + تسكين واحد');
  assert.match(c.detail_ar, /4 مشاريع/);
  assert.match(c.detail_ar, /6 فرص/);
  assert.match(c.detail_ar, /تسكين واحد/);
  assert.equal(r.score, 55, 'بند عاجل جديد ⟵ الدرجة تنزل ٨');
  assert.equal(r.summary.skipped, 0);
});

// ── تشخيص فقط: صفر كتابة ─────────────────────────────────────────────────────
test('التشخيص لا يكتب شيئاً: لا سطر تدقيق ولا صف يتغيّر في أي جدول', async () => {
  const TABLES = ['sector', 'department', 'employee', 'opportunity', 'project', 'allocation', 'audit_log'];
  const before = {};
  for (const t of TABLES) before[t] = (await get(`SELECT COUNT(*) n FROM ${t}`)).n;
  const depsBefore = await all('SELECT id, name_ar, sector_id, manager_user_id, deleted_at FROM department ORDER BY id');
  const empsBefore = await all('SELECT id, sector_id, department_id FROM employee ORDER BY id');

  await orgHealth(admin);
  await orgHealth(solLead);
  await orgHealth(admin, { sectorId: 'CONSULTING' });

  for (const t of TABLES) {
    assert.equal((await get(`SELECT COUNT(*) n FROM ${t}`)).n, before[t], `عدد صفوف ${t} تغيّر`);
  }
  assert.equal(before.audit_log, 0, 'لا كتابة أصلاً ⟵ لا تدقيق (والتدقيق فرض على كل كتابة)');
  assert.deepEqual(await all('SELECT id, name_ar, sector_id, manager_user_id, deleted_at FROM department ORDER BY id'),
    depsBefore, '«Ai&Data» تبقى كما هي — التعريب قرار المالك لا تصحيح تلقائي');
  assert.deepEqual(await all('SELECT id, sector_id, department_id FROM employee ORDER BY id'), empsBefore,
    'لا نقل موظف بصمت — إسناده قرار بشري');
});

// ── الصلاحية والنطاق ─────────────────────────────────────────────────────────
test('البوابة: من لا يملك عرض الهيكل يُرفض برسالة عربية تقول ماذا يفعل', async () => {
  for (const u of [U('employee', 'SOLUTIONS', 'own'), U('bd_manager', 'SOLUTIONS', 'sector'),
    U('viewer', 'SOLUTIONS', 'sector'), U('consultant', 'SOLUTIONS', 'own')]) {
    await assert.rejects(() => orgHealth(u), (e) => {
      assert.equal(e.code, 'forbidden', `${u.role_id} كان يجب أن يُرفض`);
      assert.ok(/[؀-ۿ]/.test(e.message) && !/[A-Za-z]/.test(e.message), 'الرسالة عربية خالصة');
      return true;
    }, `${u.role_id} يجب ألا يرى الهيكل`);
  }
  await assert.rejects(() => orgHealth(null), (e) => e.code === 'forbidden');
});

test('النطاق: قائد قطاع يرى قطاعه وحده — ولا يصل إلى قطاع غيره ولو طلبه صراحةً', async () => {
  const own = await orgHealth(consLead);
  assert.equal(own.sectorId, 'CONSULTING');
  assert.equal(checkOf(own, 'employees_without_department').count, 0, 'العشرة في قطاع غيره ليسوا من شأنه');
  assert.equal(checkOf(own, 'non_arabic_department_name').count, 0, 'أسماء قطاع الحلول ليست من شأنه');

  // طلب قطاع غيره صراحةً لا يسرّب صفاً واحداً منه
  const asked = await orgHealth(consLead, { sectorId: 'SOLUTIONS' });
  assert.equal(asked.sectorId, 'CONSULTING', 'الطلب يُقصَر على قطاعه لا يُنفَّذ');
  const names = asked.checks.flatMap((c) => c.items.map((i) => `${i.name} ${i.hint_ar}`)).join(' ');
  assert.ok(!names.includes('Ai&Data') && !names.includes('قطاع الحلول'), 'لا اسم ولا موظف من قطاع آخر');

  // ونفس الترشيح لصاحب نطاق الشركة يعمل فعلاً
  const wide = await orgHealth(admin, { sectorId: 'CONSULTING' });
  assert.equal(wide.sectorId, 'CONSULTING');
  assert.equal(wide.summary.departments, 1);
});

test('نطاق «الإدارة» لا يفتح قطاعاً كاملاً: صاحبه محبوس في قطاعه رغم أن فحص الصف يمرّ عليه', async () => {
  // مزلق حقيقي في محرك الصلاحيات: منح بنطاق «إدارة» يمرّ على أي صف لا يحمل معرّف إدارة —
  // وصف القطاع لا يحمله — فلو بُني النطاق على فحص الصلاحية وحده لرأى مدير إدارة كل قطاع.
  const deptMgr = { id: 'u_dm', role_id: 'department_manager', sector_id: 'CONSULTING',
    scope: 'department', department_id: 'd_pmo', projectIds: new Set(), teamIds: new Set() };
  const r = await orgHealth(deptMgr, { sectorId: 'SOLUTIONS' });
  assert.equal(r.sectorId, 'CONSULTING', 'قطاع حسابه لا القطاع الذي طلبه');
  assert.equal(r.summary.departments, 1, 'إدارات قطاعه وحده');
  const leaked = r.checks.flatMap((c) => c.items.map((i) => `${i.name} ${i.hint_ar}`)).join(' ');
  assert.ok(!leaked.includes('قطاع الحلول'), 'لا صف واحد من قطاع آخر');
});

test('فرص بلا قطاع تُعلَن مؤجَّلة داخل عرض قطاع واحد — لا رقم مضلِّل ولا خصم', async () => {
  const c = checkOf(await orgHealth(solLead), 'opportunity_without_sector');
  assert.equal(c.skipped, true, 'فرصة بلا قطاع لا تقع داخل نطاق أي قطاع');
  assert.equal(c.deduction, 0);
  assert.match(c.detail_ar, /مستوى الشركة/);
});

// ── لغة التقرير ──────────────────────────────────────────────────────────────
test('كل نص مؤلَّف في العرض عربي خالص وبلا مصطلح محظور', async () => {
  const r = await orgHealth(admin);
  // العناوين وأسطر «ماذا أفعل» من تأليفنا ⟵ عربية خالصة بلا حرف لاتيني واحد
  for (const c of r.checks) {
    for (const t of [c.title_ar, c.fix_hint_ar, c.severity_ar]) {
      assert.ok(/[؀-ۿ]/.test(t), `نص بلا عربية: ${t}`);
      assert.ok(!/[A-Za-z]/.test(t), `تسريب حروف لاتينية: ${t}`);
      assert.equal(bannedTermIn(t), null, `مصطلح محظور داخل: ${t}`);
    }
    // الأسباب والأمثلة قد تقتبس اسماً من بيانات العميل («Ai&Data») — عربية ومفهومة، بلا مصطلح تقني
    for (const t of [c.detail_ar, ...c.items.map((i) => i.hint_ar)]) {
      assert.ok(/[؀-ۿ]/.test(t), `نص بلا عربية: ${t}`);
      assert.equal(bannedTermIn(t), null, `مصطلح محظور داخل: ${t}`);
    }
  }
  assert.equal(bannedTermIn(r.summary.headline_ar), null);
  assert.ok(!/[A-Za-z]/.test(r.summary.headline_ar));
});

// ── ويصمت حين يُصلَح الخلل: الرقم يتحرك إلى 100 ──────────────────────────────
test('بعد إغلاق كل فئة (بقرار بشري خارج هذه الخدمة): كل بند يصمت والدرجة 100', async () => {
  // إدارات للقطاعين اللذين بلا هيكل + نقل موظفيهما إليها
  await insert('department', { id: 'd_strat', sector_id: 'STRATEGIC', name_ar: 'إدارة المبادرات',
    manager_user_id: 'u_mgr', active: 1, created_at: T });
  await insert('department', { id: 'd_sap', sector_id: 'SAP', name_ar: 'إدارة تطبيقات الأعمال',
    manager_user_id: 'u_mgr', active: 1, created_at: T });
  await insert('employee', { id: 'e_strat_1', name_ar: 'موظف المبادرات', sector_id: 'STRATEGIC',
    department_id: 'd_strat', active: 1, created_at: T });
  await run('UPDATE employee SET department_id = ? WHERE sector_id = ? AND department_id IS NULL', ['d_sap', 'SAP']);
  await run('UPDATE employee SET department_id = ? WHERE sector_id = ? AND department_id IS NULL', ['d_smart', 'SOLUTIONS']);
  await insert('employee', { id: 'e_pmo_1', name_ar: 'موظف مكتب المشاريع', sector_id: 'CONSULTING',
    department_id: 'd_pmo', active: 1, created_at: T });
  // تعريب الاسمين، وفك التباس «الحلول»، وتعيين مسؤول لكل إدارة
  await run('UPDATE department SET name_ar = ? WHERE id = ?', ['إدارة الذكاء الاصطناعي والبيانات', 'd_ai']);
  await run('UPDATE department SET name_ar = ? WHERE id = ?', ['إدارة الابتكار', 'd_innov']);
  await run('UPDATE department SET name_ar = ? WHERE id = ?', ['إدارة تسليم الحلول', 'd_sol']);
  await run('UPDATE department SET manager_user_id = ? WHERE manager_user_id IS NULL', ['u_mgr']);
  // إسناد الفرصتين إلى قطاع، وكل عمل إلى إدارته
  await run('UPDATE opportunity SET sector_id = ? WHERE sector_id IS NULL', ['SOLUTIONS']);
  for (const t of ['project', 'opportunity', 'allocation']) {
    await run(`UPDATE ${t} SET department_id = ? WHERE department_id IS NULL`, ['d_sol']);
  }

  const r = await orgHealth(admin);
  for (const c of r.checks) {
    assert.equal(c.count, 0, `${c.id} ما زال يتحقق: ${c.detail_ar}`);
    assert.equal(c.items.length, 0, `${c.id} ما زال يعرض أمثلة`);
    assert.equal(c.deduction, 0);
    assert.equal(c.skipped, false, `${c.id} يجب أن يكون مقيساً لا مؤجَّلاً`);
  }
  assert.equal(r.score, 100);
  assert.equal(r.summary.issues, 0);
  assert.equal(r.summary.affected, 0);
  assert.match(r.summary.headline_ar, /مكتمل/);
  assert.equal(r.ok, true, 'العرضان متسقان: لا نتيجة ولا بند');
});
