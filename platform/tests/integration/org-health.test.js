// تكامل: تقرير جودة الهيكل التنظيمي (orgHealth) — تشخيص فقط.
// القاعدة المصغّرة تعيد إنتاج الهيكل الحيّ حرفياً: قطاع الحلول 29 موظفاً في 5 إدارات
// («Ai&Data» ٥ · «Innovation» ١ · «إدارة المدن الذكية» ٠ · «الحلول» ١٢ · «تطوير الأعمال» ١)
// ⟵ مجموع الإدارات 19 و10 موظفين خارج أي إدارة؛ وقطاع الاستشارات بإدارة واحدة بلا موظفين؛
// والمشاريع الاستراتيجية وSAP بلا أي إدارة. ما يحرسه هذا الملف:
//   • الفحوص الثمانية تكتشف كل مشكلة من هذه المشاكل بالعدد الصحيح وبالقطاع الصحيح.
//   • التقرير لا يكتب شيئاً إطلاقاً: لا سطر تدقيق ولا تعديل اسم ولا نقل موظف.
//   • النطاق: قائد القطاع يرى قطاعه وحده، ومن لا صلاحية له يُرفض برسالة عربية.
//   • فحص «الأعمال بلا إدارة» مؤجَّل بأمان قبل وجود خانة الإدارة، ويبدأ تلقائياً بعدها.
//   • درجة الاكتمال: بند واحد لكل فئة مهما تعدّدت قطاعاتها، والبند غير المقيس لا يُخصم عليه.
//   • أسماء الأعمال لا تُدرَج لمن لا يملك قراءتها أصلاً — العدد نعم، الأسماء لا.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-orghealth-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, all, exec, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { orgHealth } = await import('../../src/modules/org/org-quality.js');
const { bannedTermIn } = await import('../../scripts/check-glossary.mjs');

const T = '2026-07-01T00:00:00Z';
const U = (role, sector, scope) => ({ id: `u_${role}`, role_id: role, sector_id: sector, scope,
  projectIds: new Set(), teamIds: new Set() });
const admin = U('admin', null, 'company');
const solLead = U('sector_lead', 'SOLUTIONS', 'sector');
const consLead = U('sector_lead', 'CONSULTING', 'sector');
const plain = U('employee', 'SOLUTIONS', 'own');
// الموارد البشرية: نطاق شركة على الموظفين، وبلا أي قراءة على المشاريع والفرص والتسكين
const hr = U('hr', null, 'company');

const byType = (r, t) => r.findings.filter((f) => f.type === t);
const oneOf = (r, t) => { const f = byType(r, t); assert.equal(f.length, 1, `نتيجة واحدة من نوع ${t}`); return f[0]; };

before(async () => {
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  await insert('sector', { id: 'STRATEGIC', name_ar: 'المشاريع الاستراتيجية', active: 1, sort_order: 3, created_at: T });
  await insert('sector', { id: 'SAP', name_ar: 'قطاع SAP', active: 1, sort_order: 4, created_at: T });

  const deps = [
    ['d_ai', 'SOLUTIONS', 'Ai&Data', 5],
    ['d_innov', 'SOLUTIONS', 'Innovation', 1],
    ['d_smart', 'SOLUTIONS', 'إدارة المدن الذكية', 0],
    ['d_sol', 'SOLUTIONS', 'الحلول', 12],
    ['d_bd', 'SOLUTIONS', 'تطوير الأعمال', 1],
    ['d_pmo', 'CONSULTING', 'مكتب إدارة المشاريع', 0],
  ];
  for (const [did, sid, name, n] of deps) {
    await insert('department', { id: did, sector_id: sid, name_ar: name, active: 1, created_at: T });
    for (let i = 1; i <= n; i++) {
      await insert('employee', { id: `e_${did}_${i}`, name_ar: `موظف ${did} ${i}`, sector_id: sid,
        department_id: did, active: 1, created_at: T });
    }
  }
  // العشرة خارج أي إدارة (الفجوة الحقيقية: 19 داخل الإدارات + 10 = 29)
  for (let i = 1; i <= 10; i++) {
    await insert('employee', { id: `e_orphan_${i}`, name_ar: `موظف بلا إدارة ${i}`, sector_id: 'SOLUTIONS',
      active: 1, created_at: T });
  }
  // قطاع SAP له موظفون ولا إدارة واحدة — أخطر من قطاع فارغ تماماً
  for (let i = 1; i <= 2; i++) {
    await insert('employee', { id: `e_sap_${i}`, name_ar: `موظف SAP ${i}`, sector_id: 'SAP', active: 1, created_at: T });
  }
  // 43 مشروعاً (20 حلول + 23 استشارات) و6 فرص — كلها بلا إدارة بحكم غياب الخانة اليوم
  for (let i = 1; i <= 20; i++) {
    await insert('project', { id: `p_sol_${i}`, name_ar: `مشروع حلول ${i}`, sector_id: 'SOLUTIONS', created_at: T });
  }
  for (let i = 1; i <= 23; i++) {
    await insert('project', { id: `p_cons_${i}`, name_ar: `مشروع استشارات ${i}`, sector_id: 'CONSULTING', created_at: T });
  }
  await insert('stage', { id: 'LEAD', name_ar: 'مبدئية', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  for (let i = 1; i <= 6; i++) {
    await insert('opportunity', { id: `o_${i}`, title_ar: `فرصة ${i}`, sector_id: 'SOLUTIONS', stage_id: 'LEAD', created_at: T });
  }
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ── الفحوص الأربعة التي تعمل اليوم بلا أي ترحيلة ──
test('موظفون خارج أي إدارة: 10 في قطاع الحلول — بالعدد وبالقطاع', async () => {
  const r = await orgHealth(admin);
  const rows = byType(r, 'employees_without_department');
  const sol = rows.find((f) => f.sector_id === 'SOLUTIONS');
  assert.ok(sol, 'نتيجة خاصة بقطاع الحلول');
  assert.equal(sol.count, 10);
  assert.equal(sol.severity, 'تحذير');
  assert.match(sol.message, /10 موظفين/);
  assert.match(sol.message, /قطاع الحلول/);
  assert.match(sol.message, /29 موظفاً/, 'يذكر إجمالي القطاع كي تُقرأ النسبة لا الرقم وحده');
  assert.equal(sol.items.length, 10, 'التفاصيل تسمّي كل واحد منهم');
  assert.ok(sol.suggestion.length > 10, 'لكل نتيجة اقتراح إجراء');
  // القاعدة المعروضة: مجموع الإدارات + غير المنسوبين = إجمالي القطاع
  assert.equal(r.totals.employees_without_department, 12, '10 في الحلول + 2 في SAP');
  const sap = rows.find((f) => f.sector_id === 'SAP');
  assert.equal(sap.count, 2);
});

test('أسماء غير عربية: «Ai&Data» و«Innovation» مع اقتراح اسم عربي لكل واحدة', async () => {
  const f = oneOf(await orgHealth(admin), 'department_name_not_arabic');
  assert.equal(f.count, 2);
  assert.equal(f.severity, 'تحذير');
  const names = f.items.map((i) => i.name_ar).sort();
  assert.deepEqual(names, ['Ai&Data', 'Innovation']);
  const sug = Object.fromEntries(f.items.map((i) => [i.name_ar, i.suggested_name_ar]));
  assert.equal(sug['Ai&Data'], 'إدارة الذكاء الاصطناعي والبيانات');
  assert.equal(sug.Innovation, 'إدارة الابتكار');
  assert.ok(f.items.every((i) => i.sector_name_ar === 'قطاع الحلول'), 'كل نتيجة تحمل قطاعها');
  assert.match(f.suggestion, /الاسم الأجنبي/, 'يذكر حفظ الاسم الأجنبي فلا يُفقد شيء');
});

test('التباس التسمية: إدارة «الحلول» داخل «قطاع الحلول» ملاحظة لا تحذير', async () => {
  const f = oneOf(await orgHealth(admin), 'department_name_same_as_sector');
  assert.equal(f.count, 1);
  assert.equal(f.severity, 'ملاحظة');
  assert.equal(f.items[0].id, 'd_sol');
  assert.equal(f.items[0].employees, 12, 'يذكر كم شخصاً في السلة الغامضة');
  assert.match(f.message, /«الحلول» داخل «قطاع الحلول»/);
  assert.match(f.suggestion, /القرار قرارك/, 'المنصة تقترح ولا تعيد التسمية تلقائياً');
});

test('إدارات بصفر موظفين: المدن الذكية ومكتب إدارة المشاريع', async () => {
  const f = oneOf(await orgHealth(admin), 'department_without_employees');
  assert.equal(f.count, 2);
  assert.equal(f.severity, 'ملاحظة');
  assert.deepEqual(f.items.map((i) => i.id).sort(), ['d_pmo', 'd_smart']);
});

test('قطاعات بلا أي إدارة: تحذير لأن أحدهما فيه موظفون', async () => {
  const f = oneOf(await orgHealth(admin), 'sector_without_departments');
  assert.equal(f.count, 2);
  assert.deepEqual(f.items.map((i) => i.id).sort(), ['SAP', 'STRATEGIC']);
  assert.equal(f.severity, 'تحذير', 'قطاع فيه موظفون بلا إدارة ليس مجرد ملاحظة');
  assert.equal(f.items.find((i) => i.id === 'SAP').employees, 2);
  assert.equal(f.items.find((i) => i.id === 'STRATEGIC').employees, 0);
});

test('التحذيرات تسبق الملاحظات في الترتيب، والإجماليات تطابق القاعدة', async () => {
  const r = await orgHealth(admin);
  const sev = r.findings.map((f) => f.severity);
  assert.equal(sev.indexOf('ملاحظة') > sev.lastIndexOf('تحذير'), true, 'كل التحذيرات أولاً');
  assert.equal(r.counts.total, r.findings.length);
  assert.equal(r.counts.warnings + r.counts.notes, r.counts.total);
  assert.equal(r.ok, false);
  assert.equal(r.company_wide, true);
  assert.deepEqual(
    { s: r.totals.sectors, d: r.totals.departments, e: r.totals.employees },
    { s: 4, d: 6, e: 31 });
});

// ── تشخيص فقط: صفر كتابة ──
test('التقرير لا يكتب شيئاً: لا سطر تدقيق ولا تغيير في أي صف', async () => {
  const auditBefore = (await get('SELECT COUNT(*) n FROM audit_log')).n;
  const depsBefore = await all('SELECT id, name_ar, sector_id, deleted_at FROM department ORDER BY id');
  const empsBefore = await all('SELECT id, department_id FROM employee ORDER BY id');
  await orgHealth(admin);
  await orgHealth(solLead);
  assert.equal((await get('SELECT COUNT(*) n FROM audit_log')).n, auditBefore,
    'خدمة تشخيص لا تكتب ⟵ لا سطر تدقيق (والتدقيق فرض على كل كتابة)');
  assert.equal(auditBefore, 0, 'لم تُكتب أي كتابة أصلاً في هذا الملف');
  assert.deepEqual(await all('SELECT id, name_ar, sector_id, deleted_at FROM department ORDER BY id'), depsBefore,
    '«Ai&Data» تبقى كما هي — التعريب قرار المالك لا تصحيح تلقائي');
  assert.deepEqual(await all('SELECT id, department_id FROM employee ORDER BY id'), empsBefore);
});

// ── الصلاحية والنطاق ──
test('النطاق: قائد قطاع الاستشارات يرى قطاعه وحده — لا موظفي الحلول ولا أسماءها', async () => {
  const r = await orgHealth(consLead);
  assert.equal(r.company_wide, false);
  assert.equal(r.sector, 'CONSULTING');
  assert.equal(byType(r, 'employees_without_department').length, 0, 'لا يرى العشرة في قطاع غيره');
  assert.equal(byType(r, 'department_name_not_arabic').length, 0, 'أسماء الحلول ليست من شأنه');
  const empty = oneOf(r, 'department_without_employees');
  assert.deepEqual(empty.items.map((i) => i.id), ['d_pmo']);
  assert.equal(r.totals.departments, 1);
  assert.equal(byType(r, 'sector_without_departments').length, 0, 'القطاعات الفارغة خارج نطاقه');
});

test('النطاق: قائد قطاع الحلول يرى فجوات قطاعه فقط', async () => {
  const r = await orgHealth(solLead);
  assert.equal(r.sector, 'SOLUTIONS');
  const orphan = oneOf(r, 'employees_without_department');
  assert.equal(orphan.count, 10, 'لا يُحسب له موظفو SAP');
  assert.equal(r.totals.employees, 29, 'إجمالي قطاعه وحده');
});

test('ترشيح القطاع لصاحب نطاق الشركة، ورفض قطاع غير موجود برسالة عربية', async () => {
  const r = await orgHealth(admin, { sector: 'CONSULTING' });
  assert.equal(r.sector, 'CONSULTING');
  assert.equal(r.totals.departments, 1);
  await assert.rejects(() => orgHealth(admin, { sector: 'لا_يوجد' }), (e) => {
    assert.equal(e.code, 'bad_request');
    assert.match(e.message, /غير موجود/);
    return true;
  });
  // ترشيح مكرَّر في الرابط يصل قائمةً — رسالة عربية مفهومة لا خطأ داخلي
  await assert.rejects(() => orgHealth(admin, { sector: ['SOLUTIONS', 'CONSULTING'] }),
    (e) => e.code === 'bad_request');
  assert.equal((await orgHealth(admin, { sector: '' })).sector, null, 'ترشيح فارغ = كل القطاعات');
});

test('من لا يملك عرض الهيكل يُرفض، ومن لا قطاع له يُرفض برسالة تقول ماذا يفعل', async () => {
  await assert.rejects(() => orgHealth(plain), (e) => e.code === 'forbidden');
  await assert.rejects(() => orgHealth(U('sector_lead', null, 'sector')), (e) => {
    assert.equal(e.code, 'forbidden');
    assert.match(e.message, /غير مرتبط بأي قطاع/);
    return true;
  });
});

// ── نص التقرير كله عربي وخالٍ من المصطلحات التقنية ──
test('كل نص يقرأه المستخدم في التقرير عربي وبلا مصطلح محظور', async () => {
  const r = await orgHealth(admin);
  const texts = [];
  for (const f of r.findings) texts.push(f.severity, f.title, f.message, f.suggestion);
  for (const p of r.pending) texts.push(p.title, p.note);
  for (const c of r.checks) {
    texts.push(c.title_ar, c.severity_ar, c.detail_ar, c.fix_hint_ar);
    for (const i of c.items) texts.push(i.hint_ar);
  }
  texts.push(r.summary.headline_ar);
  assert.ok(texts.length >= 20);
  for (const t of texts) {
    assert.ok(typeof t === 'string' && t.trim(), 'لا نص فارغ في التقرير');
    assert.ok(/[؀-ۿ]/.test(t), `نص بلا عربية: ${t}`);
    assert.equal(bannedTermIn(t), null, `مصطلح محظور داخل: ${t}`);
  }
});

// ── الأعمال بلا إدارة: يعمل متى وُجدت خانة الإدارة، ويبقى مؤجَّلاً بأمان قبلها ──
const columnNames = async (table) => (await all(`SELECT name FROM pragma_table_info('${table}')`)).map((r) => r.name);
const ensureDeptColumn = async (table) => {
  if (!(await columnNames(table)).includes('department_id')) await exec(`ALTER TABLE ${table} ADD COLUMN department_id TEXT`);
};

test('مع وجود خانة الإدارة: 43 مشروعاً و6 فرص بلا إدارة — والنطاق يسري عليها أيضاً', async () => {
  for (const t of ['project', 'opportunity']) await ensureDeptColumn(t);
  const r = await orgHealth(admin);
  assert.equal(r.pending.length, 0, 'لا فحص مؤجَّل ما دامت الخانة موجودة');
  const proj = oneOf(r, 'projects_without_department');
  assert.equal(proj.count, 43);
  assert.equal(proj.severity, 'تحذير');
  assert.match(proj.message, /43 مشروعاً/);
  assert.match(proj.suggestion, /لا تخمّنه/, 'الإسناد قرار بشري لا تخمين آلي من الاسم');
  assert.equal(proj.items.length, 43);
  assert.equal(proj.items_capped, false, 'دون سقف التفاصيل ⟵ القائمة كاملة');
  assert.equal(r.totals.projects_without_department, 43);
  const opp = oneOf(r, 'opportunities_without_department');
  assert.equal(opp.count, 6);
  assert.equal(r.totals.opportunities_without_department, 6);

  const cons = oneOf(await orgHealth(consLead), 'projects_without_department');
  assert.equal(cons.count, 23, 'قائد القطاع يرى مشاريع قطاعه وحدها');

  // إسناد مشروع لإدارته (بخدمة أخرى) يُنقص العدد تلقائياً — التقرير يقرأ الواقع لا نسخة مخزَّنة
  await exec("UPDATE project SET department_id = 'd_sol' WHERE id = 'p_sol_1'");
  assert.equal(oneOf(await orgHealth(admin), 'projects_without_department').count, 42);
});

test('قاعدة لم تُطبَّق عليها الترحيلة: الفحص مؤجَّل بلا انكسار، ويعود تلقائياً بعد إضافة الخانة', async () => {
  // محاكاة البيئة الحيّة قبل الترحيلة: نزع الخانة (وفهرسها) من الجدولين.
  for (const [table, ix] of [['project', 'ix_project_dept'], ['opportunity', 'ix_opp_dept']]) {
    await exec(`DROP INDEX IF EXISTS ${ix}`);
    await exec(`ALTER TABLE ${table} DROP COLUMN department_id`);
  }
  const before = await orgHealth(admin); // يجب ألا يرمي خطأً
  assert.deepEqual(before.pending.map((p) => p.type).sort(),
    ['opportunities_without_department', 'projects_without_department']);
  assert.equal(byType(before, 'projects_without_department').length, 0);
  assert.equal(byType(before, 'opportunities_without_department').length, 0);
  assert.equal(before.totals.projects_without_department, undefined, 'لا رقم مخترع لفحص لم يجرِ');
  for (const p of before.pending) assert.match(p.note, /يبدأ هذا الفحص تلقائياً/);
  // وبقية الفحوص تعمل كالمعتاد رغم غياب الخانة
  assert.equal(oneOf(before, 'department_name_not_arabic').count, 2);

  for (const t of ['project', 'opportunity']) await ensureDeptColumn(t);
  const after = await orgHealth(admin);
  assert.equal(after.pending.length, 0, 'الفحص يبدأ تلقائياً بعد الترحيلة بلا إعادة تشغيل');
  assert.equal(oneOf(after, 'projects_without_department').count, 43);
});

// ── إدارات بلا مسؤول ──
test('إدارات بلا مسؤول معيَّن: العدد يتناقص بمجرد تعيين مسؤول لإحداها', async () => {
  const f = oneOf(await orgHealth(admin), 'department_without_manager');
  assert.equal(f.count, 6, 'الست كلها بلا مسؤول');
  assert.equal(f.severity, 'ملاحظة');
  assert.match(f.suggestion, /عيّن مسؤولاً/);
  await insert('app_user', { id: 'u_ayoub', username: 'ayoub', name_ar: 'أيوب الزاكي',
    role_id: 'sector_lead', sector_id: 'SOLUTIONS', scope: 'sector', active: 1, created_at: T });
  await exec("UPDATE department SET manager_user_id = 'u_ayoub' WHERE id = 'd_smart'");
  assert.equal(oneOf(await orgHealth(admin), 'department_without_manager').count, 5);
});

// ── فرص بلا قطاع: سؤال على مستوى الشركة ──
test('فرصة بلا قطاع: تظهر في عرض الشركة، وتُعلن «غير مقيسة» تحت ترشيح قطاع', async () => {
  await insert('opportunity', { id: 'o_stray', title_ar: 'فرصة يتيمة', stage_id: 'LEAD', created_at: T });
  const company = await orgHealth(admin);
  const f = oneOf(company, 'opportunity_without_sector');
  assert.equal(f.count, 1);
  assert.equal(f.severity, 'تحذير');
  assert.equal(f.items[0].name_ar, 'فرصة يتيمة');
  assert.equal(company.totals.opportunities_without_sector, 1);

  const scoped = await orgHealth(solLead);
  assert.equal(byType(scoped, 'opportunity_without_sector').length, 0, 'لا تُنسب فرصة بلا قطاع إلى قطاع بعينه');
  assert.equal(scoped.totals.opportunities_without_sector, undefined, 'لا رقم لما لم يُقَس');
  const item = scoped.checks.find((c) => c.id === 'opportunity_without_sector');
  assert.equal(item.skipped, true);
  assert.equal(item.deduction, 0, 'ما لم يُقَس لا يُخصم عليه');
  assert.match(item.detail_ar, /على مستوى الشركة/);
});

// ── درجة الاكتمال: بند واحد لكل فئة ──
test('درجة الاكتمال: ثمانية بنود، بند واحد لكل فئة مهما تعدّدت قطاعاتها', async () => {
  const r = await orgHealth(admin);
  assert.equal(r.checks.length, 8);
  assert.equal(new Set(r.checks.map((c) => c.id)).size, 8, 'لا تكرار في البنود');
  // «موظفون بلا إدارة» نتيجتان (الحلول وSAP) لكنه بند واحد بعدد مجموعهما
  assert.equal(byType(r, 'employees_without_department').length, 2);
  const emp = r.checks.find((c) => c.id === 'employees_without_department');
  assert.equal(emp.count, 12);
  assert.equal(emp.count, r.totals.employees_without_department);
  // المشاريع والفرص والتسكين بند واحد: «أعمال بلا إدارة»
  const work = r.checks.find((c) => c.id === 'work_without_department');
  assert.match(work.detail_ar, /مشروعاً/);
  assert.match(work.detail_ar, /فرص/);
  // الدرجة = 100 ناقص أوزان البنود المفتوحة وحدها
  const open = r.checks.filter((c) => !c.skipped && c.count > 0);
  assert.equal(r.score, Math.max(0, 100 - open.reduce((a, c) => a + c.deduction, 0)));
  assert.ok(r.score < 100, 'هيكل بهذه الفجوات لا يمكن أن يكون مكتملاً');
  assert.equal(r.summary.issues, open.length);
  assert.equal(r.summary.high + r.summary.medium + r.summary.low, open.length);
  assert.match(r.summary.headline_ar, /درجة الاكتمال/);
  // البنود المغلقة لا تُخصم
  for (const c of r.checks) if (c.count === 0) assert.equal(c.deduction, 0);
});

// ── التسكين بلا إدارة: يدخل بند «أعمال بلا إدارة» في عرض الدرجة وحده ──
test('سطور التسكين بلا إدارة تُحتسب في بند الأعمال ولا تُضاف إلى النتائج', async () => {
  const workCount = (r) => r.checks.find((c) => c.id === 'work_without_department').count;
  const beforeCount = workCount(await orgHealth(admin));
  for (let i = 1; i <= 2; i++) {
    await insert('allocation', { id: `a_${i}`, employee_id: 'e_d_sol_1', person_name_ar: `موظف ${i}`,
      project_id: 'p_sol_2', project_name: 'مشروع حلول 2', sector_id: 'SOLUTIONS', year: 2026, created_at: T });
  }
  const r = await orgHealth(admin);
  assert.equal(workCount(r), beforeCount + 2, 'التسكين غير المنسوب يدخل بند الأعمال');
  assert.match(r.checks.find((c) => c.id === 'work_without_department').detail_ar, /تسكين/);
  assert.equal(r.totals.allocations_without_department, 2);
  assert.equal(r.findings.some((f) => f.type.startsWith('allocation')), false,
    'لا نتيجة مستقلة للتسكين — عقد النتائج يبقى كما هو');
});

// ── أسماء الأعمال محجوبة عمّن لا يملك قراءتها ──
test('الموارد البشرية ترى عدد الأعمال بلا إدارة ولا ترى أسماءها', async () => {
  const a = oneOf(await orgHealth(admin), 'projects_without_department');
  const h = oneOf(await orgHealth(hr), 'projects_without_department');
  assert.equal(h.count, a.count, 'العدد معلومة حوكمة يراها الجميع');
  assert.ok(a.items.length > 0, 'مدير النظام يرى الأسماء');
  assert.equal(h.items.length, 0, 'من لا يملك قراءة المشاريع لا يرى أسماءها');
  assert.equal(h.items_hidden, true);
  assert.equal(a.items_hidden, false);
});
