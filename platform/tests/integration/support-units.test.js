// وحدات المساندة — الموجة 009: «قطاع تسليم» و«وحدة مساندة» داخل جدول الوحدات نفسه.
//
// القرار الذي يحرسه هذا الملف: قطاعات التسليم **أربعة** لا خامس لها في أي شاشة أعمال، بينما
// «الخدمات المشتركة» و«تطوير الأعمال» و«المالية» وحدات على مستوى الشركة تحمل أشخاصاً يُستعان
// بهم على مشاريع أي قطاع. الحالة الحيّة التي أطلقت الموجة: ثلاثة أشخاص في الخدمات المشتركة
// مسكَّنون على «منظومة رصد دخول الحافلات» و«مشروع النقل — الهيئة الملكية» وهما مشروعا الحلول،
// وهم لا يتبعون أي إدارة داخل الحلول.
//
// ما يُثبَت هنا:
//   (١) الترحيلة على قاعدة **عامرة** (مطبَّقة سلفاً): كل قطاع قائم يصير «قطاع تسليم» صراحةً،
//       ولا يُفقد صف، ولا تُعاد الترحيلة عند إعادة التشغيل.
//   (٢) الخدمة: النوع الافتراضي «تسليم»، والقيمة المجهولة مرفوضة برسالة عربية، وكل كتابة مدقَّقة.
//   (٣) وحدة المساندة **خارج** قائمة قطاعات التسليم، وداخل شجرة الهيكل (فهي جزء من الشركة).
//   (٤) تقرير جودة الهيكل لا يطالب وحدة مساندة مسطّحة بإدارات ولا يعدّ موظفيها «خارج أي إدارة»،
//       ولا يعدّها قطاعاً في أي رقم يقرأه المالك.
//   (٥) **حالة المورد المشترك**: موظف الخدمات المشتركة يُسكَّن على مشروع الحلول فعلاً، بينما
//       الحاجز بين قطاعات التسليم يبقى قائماً كما كان.
//   (٦) الدور الجديد «رئيس تطوير الأعمال»: يقرأ ويكتب عبر القطاعات كلها، ولا يرى راتباً أبداً،
//       ولا ينشئ قطاعاً ولا يحذفه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WAVE = '009_support_units.sql';
const dir = mkdtempSync(join(tmpdir(), 'sanad-support-'));
process.env.SANAD_DB = join(dir, 'legacy.db');
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = join(ROOT, 'migrations');
const T = '2026-07-01T00:00:00.000Z';

// ── قاعدة تشبه الحيّة: كل ترحيلة قبل الموجة مطبَّقة ومسجَّلة، وفيها القطاعات الأربعة فعلاً ──
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const beforeWave = files.slice(0, files.indexOf(WAVE));
{
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(process.env.SANAD_DB);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of beforeWave) {
    raw.exec(readFileSync(join(MIG, f), 'utf8'));
    raw.prepare('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)').run(f, T);
  }
  const ins = raw.prepare('INSERT INTO sector (id, name_ar, active, sort_order, created_at) VALUES (?, ?, 1, ?, ?)');
  for (const [id, name, order] of [
    ['SOLUTIONS', 'قطاع الحلول', 1], ['CONSULTING', 'قطاع الاستشارات', 2],
    ['STRATEGIC', 'المشاريع الاستراتيجية', 3], ['SAP', 'قطاع SAP', 4],
  ]) ins.run(id, name, order, T);
  raw.prepare('INSERT INTO department (id, sector_id, name_ar, active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run('dep_smart', 'SOLUTIONS', 'إدارة المدن الذكية', T);
  raw.close();
}

const { migrate } = await import('../../scripts/migrate.js');
const { seedRbac } = await import('../../scripts/seed-rbac.js');
const db = await import('../../src/core/db/index.js');
const { get, all, insert, close } = db;

const U = (role, sector, scope) => ({ id: `u_${role}_${sector || 'x'}`, username: role, role_id: role,
  sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });
const admin = U('admin', null, 'company');
const bdHead = U('bd_head', 'SOLUTIONS', 'company');   // د. ياسر: داخل الحلول، ومسؤوليته الشركة
const solLead = U('sector_lead', 'SOLUTIONS', 'sector');
const CTX = (user) => ({ user, ip: '127.0.0.1' });

let org, orgQuality, projects, opps, rbac;
// سطور التدقيق للمورد بعد لحظة معيّنة — كل كتابة يجب أن تترك أثراً
const auditRows = (resource, resourceId) =>
  all('SELECT * FROM audit_log WHERE resource = ? AND resource_id = ? ORDER BY at, id', [resource, resourceId]);

before(async () => {
  await migrate();
  await seedRbac();
  rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  org = await import('../../src/modules/org/org.js');
  orgQuality = await import('../../src/modules/org/org-quality.js');
  projects = await import('../../src/modules/pmo/projects.js');
  opps = await import('../../src/modules/crm/opportunities.js');

  await insert('stage', { id: 'LEAD', name_ar: 'مبدئية', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  // مشروعان حقيقيان في الحلول + فرصة في كل قطاع (لقراءة الدور الجديد عبر القطاعات)
  await insert('project', { id: 'P_BUS', name_ar: 'منظومة رصد دخول الحافلات', sector_id: 'SOLUTIONS',
    status: 'IN_PROGRESS', created_at: T });
  await insert('project', { id: 'P_CONS', name_ar: 'مشروع استشاري', sector_id: 'CONSULTING',
    status: 'IN_PROGRESS', created_at: T });
  await insert('opportunity', { id: 'O_SOL', title_ar: 'فرصة الحلول', sector_id: 'SOLUTIONS',
    stage_id: 'LEAD', value_halalas: 100000, created_at: T });
  await insert('opportunity', { id: 'O_CONS', title_ar: 'فرصة الاستشارات', sector_id: 'CONSULTING',
    stage_id: 'LEAD', value_halalas: 200000, created_at: T });
  // موظف داخل الحلول (لإثبات بقاء الحاجز بين قطاعات التسليم)
  await insert('employee', { id: 'E_CONS', name_ar: 'مستشار الاستشارات', sector_id: 'CONSULTING',
    active: 1, salary_halalas: 2400000, created_at: T });
});

after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ═════════════════════ (١) الترحيلة على قاعدة عامرة ═════════════════════

test('الترحيلة تُطبَّق وتضع «قطاع تسليم» على كل قطاع قائم — تعبئة رجعية لا تخمين', async () => {
  assert.ok(await get('SELECT version FROM schema_migration WHERE version = ?', [WAVE]), 'الموجة مسجَّلة');
  const rows = await all('SELECT id, name_ar, kind FROM sector ORDER BY sort_order');
  assert.equal(rows.length, 4, 'القطاعات الأربعة كما هي — لا صف مفقود ولا صف مزروع');
  for (const r of rows) assert.equal(r.kind, 'delivery', `${r.name_ar} قطاع تسليم بعد التعبئة`);
  assert.equal((await get('SELECT name_ar FROM department WHERE id = ?', ['dep_smart'])).name_ar,
    'إدارة المدن الذكية', 'لا صف قائم تضرّر');
});

test('الترحيلة لا تُنشئ أي وحدة مساندة بنفسها — الإنشاء قرار مسؤول مدقَّق', async () => {
  const support = await all("SELECT id FROM sector WHERE kind = 'support'");
  assert.equal(support.length, 0, 'لا وحدة تُدسّ في الترحيلة بلا صاحب ولا سطر تدقيق');
});

test('إعادة التشغيل لا تعيد تطبيق الموجة ولا تكسر العمود', async () => {
  await migrate();
  await migrate();
  assert.equal((await all('SELECT version FROM schema_migration WHERE version = ?', [WAVE])).length, 1);
  assert.equal((await get('SELECT kind FROM sector WHERE id = ?', ['SOLUTIONS'])).kind, 'delivery');
});

test('الملف خالٍ من علامة الاستفهام اللاتينية — تمر الترحيلة كاملة على المحرّك الآخر', () => {
  const sql = readFileSync(join(MIG, WAVE), 'utf8');
  assert.equal(sql.includes('?'), false, 'ولا حتى داخل تعليق: كل علامة تُستبدل بمعامل مربوط');
  // الجُمل التنفيذية وحدها (بلا سطور التعليق التي تشرح ما لا يُكتب)
  const statements = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.equal(/ADD COLUMN IF NOT EXISTS/i.test(statements), false, 'صيغة لا يدعمها المحرّك المستخدم في التطوير');
  assert.equal(/ALTER TABLE sector ADD COLUMN kind TEXT/.test(statements), true);
  assert.equal(/ALTER COLUMN|DROP NOT NULL/i.test(statements), false,
    'لا مساس بإلزامية أي عمود قائم — جملتان مختلفتان بين المحرّكين');
});

// ═════════════════════ (٢) الخدمة: قبول النوع والتحقق منه ═════════════════════

test('الافتراضي «قطاع تسليم» حين لا يُذكر النوع — والكتابة مدقَّقة', async () => {
  const s = await org.createSector(CTX(admin), { id: 'NEWDEL', name_ar: 'قطاع تجريبي', sort_order: 9 });
  assert.equal(s.kind, 'delivery');
  assert.equal(org.isDelivery(s), true);
  const rows = await auditRows('sector', 'NEWDEL');
  assert.equal(rows.length, 1, 'سطر تدقيق واحد للإنشاء');
  assert.equal(rows[0].action, 'create');
  assert.equal(JSON.parse(rows[0].detail_json).kind, 'delivery', 'النوع محفوظ في أثر التدقيق');
});

test('إنشاء وحدة مساندة صراحةً — «الخدمات المشتركة» على مستوى الشركة', async () => {
  const s = await org.createSector(CTX(admin), { id: 'SHARED', name_ar: 'الخدمات المشتركة',
    kind: 'support', sort_order: 20 });
  assert.equal(s.kind, 'support');
  assert.equal(org.isDelivery(s), false);
  assert.equal(org.isSupportUnit(s), true);
  const bd = await org.createSector(CTX(admin), { id: 'BIZDEV', name_ar: 'تطوير الأعمال',
    kind: 'support', sort_order: 21 });
  assert.equal(bd.kind, 'support');
  assert.equal(JSON.parse((await auditRows('sector', 'SHARED'))[0].detail_json).kind, 'support');
});

test('نوع مجهول مرفوض برسالة عربية تقول الخيارين — لا نوع ثالث يتسلل', async () => {
  await assert.rejects(
    () => org.createSector(CTX(admin), { id: 'BAD', name_ar: 'وحدة بنوع مجهول', kind: 'shared_services' }),
    (e) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /نوع الوحدة غير معروف/);
      assert.match(e.message, /وحدة مساندة/);
      return true;
    });
  assert.equal(await get('SELECT id FROM sector WHERE id = ?', ['BAD']), undefined, 'لا صف يُكتب عند الرفض');
  await assert.rejects(() => org.updateSector(CTX(admin), 'SHARED', { kind: 'أخرى' }), /نوع الوحدة غير معروف/);
  assert.equal((await get('SELECT kind FROM sector WHERE id = ?', ['SHARED'])).kind, 'support', 'النوع لم يتغيّر');
});

test('تعديل النوع مسموح على وحدة فارغة ومدقَّق', async () => {
  const s = await org.updateSector(CTX(admin), 'NEWDEL', { kind: 'support' });
  assert.equal(s.kind, 'support');
  const rows = await auditRows('sector', 'NEWDEL');
  assert.equal(rows.length, 2);
  assert.equal(JSON.parse(rows[1].detail_json).kind, 'support');
  await org.updateSector(CTX(admin), 'NEWDEL', { kind: 'delivery' }); // نعيدها كما كانت
  assert.equal((await get('SELECT kind FROM sector WHERE id = ?', ['NEWDEL'])).kind, 'delivery');
});

test('تحويل قطاع تسليم يحمل عملاً إلى وحدة مساندة مرفوض — الاختفاء الصامت ممنوع', async () => {
  await assert.rejects(() => org.updateSector(CTX(admin), 'SOLUTIONS', { kind: 'support' }),
    (e) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /لا يمكن تحويل/);
      assert.match(e.message, /انقل هذه الأعمال/);
      return true;
    });
  assert.equal((await get('SELECT kind FROM sector WHERE id = ?', ['SOLUTIONS'])).kind, 'delivery');
});

test('إنشاء وحدة تنظيمية يبقى لمدير النظام وحده', async () => {
  await assert.rejects(() => org.createSector(CTX(solLead), { id: 'X1', name_ar: 'وحدة', kind: 'support' }),
    (e) => e.status === 403);
});

// ═══════════ (٣) وحدة المساندة خارج «القطاعات» وداخل شجرة الشركة ═══════════

test('قائمة قطاعات التسليم تستثني وحدات المساندة — لا قطاع خامس أمام المالك', async () => {
  const delivery = await org.listDeliverySectors();
  const ids = delivery.map((s) => s.id);
  assert.deepEqual(ids.sort(), ['CONSULTING', 'NEWDEL', 'SAP', 'SOLUTIONS', 'STRATEGIC'].sort());
  assert.equal(ids.includes('SHARED'), false, 'الخدمات المشتركة ليست قطاعاً');
  assert.equal(ids.includes('BIZDEV'), false, 'تطوير الأعمال ليس قطاعاً');
  assert.ok(delivery.every((s) => org.isDelivery(s)));
});

test('شجرة الهيكل تعرض وحدات المساندة — هي جزء من الشركة وإن لم تكن قطاعاً', async () => {
  const tree = await org.orgTree(admin);
  const ids = tree.map((s) => s.id);
  assert.ok(ids.includes('SHARED'), 'الوحدة تظهر في الهيكل، وإلا اختفى موظفوها من المنصة كلها');
  const shared = tree.find((s) => s.id === 'SHARED');
  assert.equal(shared.kind, 'support', 'النوع مرافق للصف كي تميّزه الشاشة');
});

test('التمييز مُعرَّف مرة واحدة: الفراغ يعني «قطاع تسليم» على المحرّك وفي الذاكرة معاً', async () => {
  assert.equal(org.DELIVERY_KIND, 'delivery');
  assert.equal(org.SUPPORT_KIND, 'support');
  assert.deepEqual(org.SECTOR_KINDS, ['delivery', 'support']);
  assert.equal(org.isDelivery({ kind: null }), true, 'صف قديم بلا نوع = قطاع تسليم');
  assert.equal(org.isDelivery({ kind: '' }), true);
  assert.equal(org.isDelivery({ kind: 'support' }), false);
  // نفس الحكم داخل الاستعلام — الشرط النصي والدالة لا يفترقان
  const viaSql = (await all(`SELECT id FROM sector WHERE deleted_at IS NULL AND ${org.DELIVERY_SECTOR_SQL}`)).map((r) => r.id);
  const viaJs = (await all('SELECT * FROM sector WHERE deleted_at IS NULL')).filter(org.isDelivery).map((r) => r.id);
  assert.deepEqual(viaSql.sort(), viaJs.sort());
});

// ═════════ (٤) تقرير جودة الهيكل يقرأ وحدة المساندة على حقيقتها ═════════

test('وحدة مساندة مسطّحة لا تُتّهم بأنها «قطاع بلا إدارات»', async () => {
  // ثلاثة أشخاص يتبعون الخدمات المشتركة مباشرة — شكلها الصحيح، لا خلل فيه
  for (let i = 1; i <= 3; i++) {
    await insert('employee', { id: `E_SH${i}`, name_ar: `موظف الخدمات المشتركة ${i}`,
      sector_id: 'SHARED', active: 1, created_at: T });
  }
  const r = await orgQuality.orgHealth(admin);
  const flat = r.findings.filter((f) => f.type === 'sector_without_departments');
  const flaggedIds = flat.flatMap((f) => f.items.map((i) => i.id));
  assert.equal(flaggedIds.includes('SHARED'), false, 'الوحدة المسطّحة شكلها مكتمل لا ناقص');
  assert.equal(flaggedIds.includes('BIZDEV'), false);
  assert.ok(flaggedIds.includes('CONSULTING'), 'قطاع تسليم بلا إدارة يبقى ملاحظة — لم يُعطَّل الفحص');
});

test('موظفو وحدة مساندة مسطّحة ليسوا «موظفين خارج أي إدارة»', async () => {
  const r = await orgQuality.orgHealth(admin);
  const orphans = r.findings.filter((f) => f.type === 'employees_without_department');
  assert.equal(orphans.some((f) => f.sector_id === 'SHARED'), false,
    'ملاحظة لا يمكن إغلاقها أبداً (لا إدارة تُنقل إليها) تُفسد التقرير وتُعلّم المالك تجاهله');
  const check = r.checks.find((c) => c.id === 'employees_without_department');
  assert.equal(check.items.some((i) => String(i.id).startsWith('E_SH')), false);
});

test('عدد «القطاعات» في التقرير أربعة لا ستة — وحدات المساندة رقم مستقل', async () => {
  const r = await orgQuality.orgHealth(admin);
  assert.equal(r.totals.sectors, 5, 'قطاعات التسليم وحدها (الأربعة + التجريبي)');
  assert.equal(r.totals.support_units, 2, 'الخدمات المشتركة وتطوير الأعمال');
  assert.equal(r.summary.sectors, r.totals.sectors);
  assert.equal(r.summary.support_units, 2);
});

test('التقرير يظل تشخيصاً خالصاً: لا صف ولا سطر تدقيق يُكتب', async () => {
  const before = {
    sectors: (await all('SELECT id FROM sector')).length,
    employees: (await all('SELECT id FROM employee')).length,
    audits: (await all('SELECT id FROM audit_log')).length,
  };
  await orgQuality.orgHealth(admin);
  await orgQuality.orgHealth(admin, { sector: 'SHARED' });
  assert.deepEqual({
    sectors: (await all('SELECT id FROM sector')).length,
    employees: (await all('SELECT id FROM employee')).length,
    audits: (await all('SELECT id FROM audit_log')).length,
  }, before, 'الضمانة الأصلية للملف: يشخّص ولا يغيّر');
});

test('لا مصطلح محظور في نصوص تقرير وحدة المساندة', async () => {
  const { bannedTermIn } = await import('../../scripts/check-glossary.mjs');
  const r = await orgQuality.orgHealth(admin, { sector: 'SHARED' });
  const texts = [
    ...r.findings.flatMap((f) => [f.title, f.message, f.suggestion]),
    ...r.checks.flatMap((c) => [c.title_ar, c.detail_ar, c.fix_hint_ar]),
    r.summary.headline_ar,
  ].filter(Boolean);
  for (const t of texts) assert.equal(bannedTermIn(t), null, `نص ظاهر للمستخدم: ${t}`);
});

// ═════════ (٥) حالة المورد المشترك: التسكين عبر القطاعات ═════════

test('موظف وحدة مساندة يُسكَّن على مشروع قطاع آخر — وهو سبب وجود الوحدة', async () => {
  const before = (await all('SELECT id FROM audit_log')).length;
  const staffing = await projects.assignEmployee(CTX(admin), 'P_BUS', { employeeId: 'E_SH1', pct: 50 });
  const row = staffing.assigned.find((a) => a.employee_id === 'E_SH1');
  assert.ok(row, 'الشخص مُسكَّن فعلاً على مشروع الحلول');
  const alloc = await get('SELECT * FROM allocation WHERE id = ?', [row.id]);
  assert.equal(alloc.sector_id, 'SOLUTIONS', 'التسكين ينتمي لقطاع المشروع — العمل عمل الحلول');
  const emp = await get('SELECT sector_id FROM employee WHERE id = ?', ['E_SH1']);
  assert.equal(emp.sector_id, 'SHARED', 'ولا يُنقل الشخص من وحدته: هو معار لا منقول');
  const audits = await auditRows('allocation', row.id);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'create');
  assert.equal(audits[0].sector_id, 'SOLUTIONS');
  assert.ok((await all('SELECT id FROM audit_log')).length > before);
});

test('الحاجز بين قطاعات التسليم باقٍ: موظف الاستشارات لا يُسكَّن على مشروع الحلول', async () => {
  await assert.rejects(() => projects.assignEmployee(CTX(admin), 'P_BUS', { employeeId: 'E_CONS' }),
    (e) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /من قطاع آخر/);
      return true;
    });
});

test('قائمة المتاحين للتسكين تعرض موظفي وحدات المساندة إلى جانب موظفي القطاع', async () => {
  const st = await projects.projectStaffing(admin, 'P_CONS');
  const ids = st.available.map((e) => e.id);
  assert.ok(ids.includes('E_SH2'), 'بلا هذا لا يستطيع المسؤول اختيار الشخص أصلاً');
  assert.ok(ids.includes('E_CONS'), 'موظفو القطاع كما كانوا');
  assert.equal(ids.includes('E_SH1'), false, 'المسكَّن سلفاً على مشروع آخر يبقى معروضاً هنا فقط إن لم يُسكَّن على هذا المشروع');
});

test('الشخص نفسه يُسكَّن على مشروعَي قطاعين مختلفين معاً — مورد مشترك حقيقي', async () => {
  await projects.assignEmployee(CTX(admin), 'P_CONS', { employeeId: 'E_SH1', pct: 30 });
  const rows = await all(`SELECT a.sector_id FROM allocation a
     WHERE a.employee_id = ? AND a.deleted_at IS NULL ORDER BY a.sector_id`, ['E_SH1']);
  assert.deepEqual(rows.map((r) => r.sector_id), ['CONSULTING', 'SOLUTIONS']);
});

// ═════════ (٦) الدور الجديد: رئيس تطوير الأعمال — كل شيء إلا الرواتب ═════════

test('رئيس تطوير الأعمال يقرأ الفرص في القطاعات كلها', async () => {
  const rows = await opps.listOpportunities(bdHead);
  const sectors = new Set(rows.map((o) => o.sector_id));
  assert.ok(sectors.has('SOLUTIONS') && sectors.has('CONSULTING'),
    'مسؤوليته الشركة كلها لا قطاعه وحده');
  assert.equal(rbac.effectiveScope(bdHead, 'read', 'opportunity'), 'company');
});

test('رئيس تطوير الأعمال ينشئ فرصة ويعدّلها في قطاع ليس قطاعه — مع تدقيق كامل', async () => {
  const created = await opps.createOpportunity(CTX(bdHead), {
    title_ar: 'فرصة نقل — الهيئة الملكية', sector_id: 'CONSULTING', value_sar: 500000 });
  assert.equal(created.sector_id, 'CONSULTING');
  const a1 = await auditRows('opportunity', created.id);
  assert.equal(a1.length, 1);
  assert.equal(a1[0].role_id, 'bd_head');

  const updated = await opps.updateOpportunity(CTX(bdHead), created.id, { title_ar: 'فرصة النقل — الهيئة الملكية' });
  assert.equal(updated.title_ar, 'فرصة النقل — الهيئة الملكية');
  const a2 = await auditRows('opportunity', created.id);
  assert.equal(a2.length, 2);
  assert.equal(a2[1].action, 'update');
});

test('رئيس تطوير الأعمال لا يرى راتباً بأي طريق — الختم لا يُفتح لدور جديد', async () => {
  assert.equal(rbac.can(bdHead, 'read', 'salary'), false);
  assert.equal(rbac.canSeeSensitive(bdHead, 'salary'), false);
  // الحجب في الخدمة لا في الشاشة: القيمة تُمسح من الصف المُعاد
  const emp = await get('SELECT * FROM employee WHERE id = ?', ['E_CONS']);
  const shown = rbac.redact(bdHead, 'employee', emp);
  assert.equal(shown.salary_halalas, null);
  assert.equal(shown._redacted_salary_halalas, true);
  // ولا يتسرب من كشف الفريق
  const roster = await org.staffingRoster(bdHead, { year: 2026 });
  for (const p of roster.roster) {
    assert.equal('salary_halalas' in p, false, 'الراتب لا يُسلسَل أصلاً لمن لا يملك قراءته');
  }
  // ولا منح راتب في المصفوفة نفسها لأي دور غير مدير النظام
  const matrix = await import('../../src/core/rbac/matrix.js');
  for (const [role, grants] of Object.entries(matrix.ROLE_GRANTS)) {
    if (role === 'admin') continue;
    assert.equal(grants.some((g) => g.resource === 'salary'), false, `الدور ${role} بلا منح راتب`);
  }
});

test('رئيس تطوير الأعمال لا ينشئ قطاعاً ولا يحذفه ولا يملك منحاً شاملاً', async () => {
  assert.equal(rbac.can(bdHead, 'create', 'sector'), false);
  assert.equal(rbac.can(bdHead, 'delete', 'sector'), false);
  assert.equal(rbac.can(bdHead, 'admin', 'sector'), false);
  assert.equal(rbac.can(bdHead, 'read', 'sector'), true, 'يقرأ القطاعات ليعمل عليها');
  await assert.rejects(() => org.createSector(CTX(bdHead), { id: 'NOPE', name_ar: 'قطاع' }),
    (e) => e.status === 403);
  assert.equal(await get('SELECT id FROM sector WHERE id = ?', ['NOPE']), undefined);
  const matrix = await import('../../src/core/rbac/matrix.js');
  assert.equal(matrix.ROLE_GRANTS.bd_head.some((g) => g.resource === '*'), false, 'لا منح شامل');
  assert.equal(matrix.ROLE_GRANTS.bd_head.some((g) => g.action === 'delete'), false, 'لا حذف لأي مورد');
  assert.ok(matrix.ROLE_LABELS.bd_head.ar, 'للدور اسم عربي يظهر في الواجهة');
});

test('رئيس تطوير الأعمال يقرأ المال والهامش والكلفة على مستوى الشركة ولا يكتب المال', async () => {
  for (const r of ['contract', 'invoice', 'collection', 'report', 'kpi']) {
    assert.equal(rbac.can(bdHead, 'read', r), true, `يقرأ ${r}`);
    assert.equal(rbac.can(bdHead, 'create', r), false, `ولا ينشئ ${r}`);
  }
  assert.equal(rbac.canSeeSensitive(bdHead, 'margin'), true);
  assert.equal(rbac.canSeeSensitive(bdHead, 'cost'), true);
  assert.equal(rbac.canSeeSensitive(bdHead, 'ip'), false, 'عناوين الدخول شأن أمني لا شأن أعمال');
  assert.equal(rbac.can(bdHead, 'export', 'report'), true);
});
