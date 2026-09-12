// اختبارات محرك الاستيراد: المحلّلات المطبوعة (مال/تاريخ/lookup بأرقام عربية)، قرارات
// إضافة/تحديث/تجاهل، كشف التكرار، رمز التأكيد، التنفيذ والتراجع، حجب التراجع بعملية أحدث،
// حجب عمود الراتب، خطأ نطاق الصف — وقاعدة الذهاب-الإياب لكل المحوّلات الستة (تصدير → استيراد = تجاهل 100%).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-import-engine.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, engine, parse, xlsx;

const U = (role, sector, scope = 'own') => ({
  id: 'u_' + role, username: 'u.' + role, role_id: role, sector_id: sector, scope,
  projectIds: new Set(), teamIds: new Set(),
});
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const admin = () => U('admin', null, 'company');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// يبني ملف xlsx في الذاكرة من ترويسات labelAr وصفوف كائنات، ثم يرفعه ويعاين.
async function uploadRows(c, adapter, rows, { mode = 'upsert', fileName = 'test.xlsx' } = {}) {
  const columns = engine.visibleColumns(c.user, adapter);
  const { buffer } = xlsx.buildExport({ columns, rows, format: 'xlsx' });
  const up = await engine.upload(c, adapter.type, buffer, fileName);
  const pv = await engine.preview(c, adapter.type, { runId: up.runId, mapping: up.autoMapping, mode });
  return { up, pv };
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  parse = await import('../../src/modules/io/parse.js');
  xlsx = await import('../../src/modules/io/xlsx.js');
  engine = await import('../../src/modules/io/engine.js');

  const now = ids.nowIso();
  await db.insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await db.insert('stage', { id: 'PROP', name_ar: 'عرض مقدم', default_win_pct: 50, sort_order: 2, is_won: 0, is_lost: 0 });
  await db.insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, sort_order: 3, is_won: 1, is_lost: 0 });
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', active: 1, created_at: now });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع الدراسات', active: 1, created_at: now });
  for (const [uid, uname, role, sector, scope, name] of [
    ['u_admin', 'u.admin', 'admin', null, 'company', 'مدير النظام'],
    ['u_sector_lead', 'u.sector_lead', 'sector_lead', 'S1', 'sector', 'قائد القطاع'],
    ['u_bd', 'u.bd', 'bd_manager', 'S1', 'own', 'مدير التطوير'],
    ['u_hr', 'u.hr', 'hr', null, 'company', 'الموارد البشرية'],
  ]) {
    await db.insert('app_user', { id: uid, username: uname, name_ar: name, role_id: role, sector_id: sector, scope, active: 1, created_at: now });
  }
  await db.insert('client', { id: 'C1', code: 'CL-1', name_ar: 'وزارة النقل', name_en: 'MoT', type: 'حكومي', sector_market: 'النقل', active: 1, created_at: now });
  await db.insert('contact', { id: 'CT1', client_id: 'C1', name: 'م. سعد العتيبي', title: 'مدير المشاريع', email: 's@mot.gov.sa', phone: '0555', created_at: now });
  await db.insert('employee', { id: 'E1', name_ar: 'موظف الاختبار', name_en: 'Test Emp', sector_id: 'S1', job_title: 'مستشار', salary_halalas: 1800000, employment_type: 'أساسي', status: 'نشط', active: 1, created_at: now });
  await db.insert('project', {
    id: 'P1', code: 'PRJ-1', name_ar: 'مشروع التحول', sector_id: 'S1', client_id: 'C1', owner_user_id: 'u_admin',
    status: 'IN_PROGRESS', rag: 'GREEN', budget_halalas: 120000000, contract_value_halalas: 150000000,
    progress_pct: 40, start_date: '2026-01-01', end_date: '2026-12-31', pm_name: 'م. خالد', created_at: now,
  });
  await db.insert('opportunity', {
    id: 'O1', code: 'OPP-1', title_ar: 'فرصة تجريبية', client_id: 'C1', sector_id: 'S1', owner_user_id: 'u_bd',
    stage_id: 'LEAD', win_pct: 10, value_halalas: 25000000, year: 2026, next_action: 'اجتماع تمهيدي',
    notes: 'ملاحظة', stage_changed_at: now, created_at: now,
  });
  await db.insert('allocation', {
    id: 'A1', employee_id: 'E1', person_name_ar: 'موظف الاختبار', project_id: 'P1', project_name: 'مشروع التحول',
    sector_id: 'S1', type: 'member', year: new Date().getUTCFullYear(),
    monthly_json: JSON.stringify({ 1: 0.5, 2: 0.5 }), source: 'manual', created_at: now,
  });
  await db.insert('revenue_line', { id: 'R1', sector_id: 'S1', project_id: 'P1', amount_halalas: 50000000, month: 1, year: 2026, label: 'دفعة يناير', auto: 0, created_at: now });
  await db.insert('revenue_line', { id: 'R2', sector_id: 'S1', project_id: null, amount_halalas: 25000000, month: 2, year: 2026, label: 'دفعة فبراير', auto: 0, created_at: now });
});

after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

// ── المحلّلات المطبوعة ──
test('parse: money accepts Arabic-Indic digits, separators, and currency suffixes → halalas', () => {
  assert.equal(parse.parseMoney('١٬٢٣٤٫٥٠'), 123450);
  assert.equal(parse.parseMoney('1,250,000'), 125000000);
  assert.equal(parse.parseMoney('150000 ريال'), 15000000);
  assert.equal(parse.parseMoney('٢٥٠٠'), 250000);
  assert.throws(() => parse.parseMoney('كثير'), /قيمة مالية غير صالحة/);
  assert.throws(() => parse.parseMoney('-5', { min: 0 }), /الحد الأدنى/);
});

test('parse: date accepts DD/MM/YYYY and YYYY-MM-DD (Arabic digits too) → ISO', () => {
  assert.equal(parse.parseDate('31/12/2026'), '2026-12-31');
  assert.equal(parse.parseDate('1/2/2026'), '2026-02-01');
  assert.equal(parse.parseDate('2026-02-01'), '2026-02-01');
  assert.equal(parse.parseDate('٣١/١٢/٢٠٢٦'), '2026-12-31');
  assert.throws(() => parse.parseDate('31/02/2026'), /تاريخ غير موجود/);
  assert.throws(() => parse.parseDate('غداً'), /صيغة تاريخ/);
});

test('parse: pct + int bounds with Arabic errors', () => {
  assert.equal(parse.parsePct('٨٥٪'), 85);
  assert.throws(() => parse.parsePct('120'), /بين 0 و100/);
  assert.equal(parse.parseIntCell('٢٠٢٦'), 2026);
  assert.throws(() => parse.parseIntCell('نص'), /عدداً صحيحاً/);
});

test('parse: lookup resolves by id, code, and normalized Arabic name; lists candidates when unresolved', () => {
  const lk = parse.makeLookup([
    { id: 'C1', code: 'CL-1', name_ar: 'وزارة النقل' },
    { id: 'C2', code: 'CL-2', name_ar: 'وزارة الصحة' },
  ], { label: 'العملاء' });
  assert.equal(lk('C1').id, 'C1');
  assert.equal(lk('cl-2').id, 'C2');
  assert.equal(lk('وزارة النقل').id, 'C1');
  assert.equal(lk('وزاره النقل').id, 'C1'); // تطبيع الهاء/التاء المربوطة
  const err = (() => { try { lk('وزارة'); } catch (e) { return e.message; } })();
  assert.match(err, /غير موجود في العملاء/);
  assert.match(err, /أقرب المتاح/);
});

test('engine: autoMap matches exact labels, aliases, and normalized contains', () => {
  const cols = engine.ADAPTERS.opportunities.columns;
  const m = engine.autoMap(['العنوان', 'رقم الفرصة', 'القيمة (ريال)', 'عمود غريب'], cols);
  assert.equal(m.title_ar, 0);
  assert.equal(m.code, 1); // عبر الاسم البديل
  assert.equal(m.value, 2);
  assert.equal(Object.values(m).includes(3), false);
});

// ── المعاينة: قرارات وأخطاء ──
test('preview: create/update/skip diff + cell-addressed Arabic errors + in-file duplicates', async () => {
  const a = engine.ADAPTERS.opportunities;
  const rows = [
    { code: 'OPP-9', title_ar: 'فرصة جديدة كلياً', client: 'وزارة النقل', sector: 'قطاع الحلول', stage: 'ليدز', value: 100000, win_pct: 10, year: 2026 },
    { code: 'OPP-1', title_ar: 'فرصة تجريبية', client: 'وزارة النقل', sector: 'قطاع الحلول', stage: 'ليدز', value: 250000, win_pct: 10, year: 2026, next_action: 'اجتماع تمهيدي', notes: 'ملاحظة' },
    { code: 'OPP-1', title_ar: 'فرصة تجريبية', value: 999999 }, // مكرر داخل الملف
    { title_ar: 'فرصة بقيمة تالفة', value: 'كثير جداً' },
    { code: 'OPP-1B', title_ar: 'فرصة تجريبية', client: 'وزارة النقل', value: 300000 },
  ];
  // الصف 2 (OPP-1) مطابق تماماً → تجاهل؛ الصف الأخير لا كود مطابق لكن نفس العنوان → تحديث القيمة
  const { pv } = await uploadRows(ctx(admin()), a, rows);
  assert.equal(pv.counts.total, 5);
  assert.equal(pv.counts.create, 1);
  assert.equal(pv.counts.skip, 1);
  assert.equal(pv.counts.error, 2);
  assert.equal(pv.counts.update, 1);
  const dupErr = pv.errors.find((e) => /مكرر داخل الملف/.test(e.message));
  assert.ok(dupErr, 'يجب كشف التكرار داخل الملف');
  const cellErr = pv.errors.find((e) => /الصف 5:/.test(e.message) && /القيمة \(ريال\)/.test(e.message));
  assert.ok(cellErr, 'خطأ الخلية يجب أن يذكر الصف واسم العمود بالعربية');
});

test('preview: mode add skips existing records instead of updating them', async () => {
  const a = engine.ADAPTERS.opportunities;
  const rows = [{ code: 'OPP-1', title_ar: 'فرصة تجريبية', value: 777777 }];
  const { pv } = await uploadRows(ctx(admin()), a, rows, { mode: 'add' });
  assert.equal(pv.counts.skip, 1);
  assert.equal(pv.counts.update, 0);
});

test('preview: replace mode is admin-only', async () => {
  const a = engine.ADAPTERS.opportunities;
  const lead = U('sector_lead', 'S1', 'sector');
  const columns = engine.visibleColumns(lead, a);
  const { buffer } = xlsx.buildExport({ columns, rows: [{ title_ar: 'س', sector: 'قطاع الحلول' }], format: 'xlsx' });
  const up = await engine.upload(ctx(lead), a.type, buffer, 'r.xlsx');
  await assert.rejects(
    () => engine.preview(ctx(lead), a.type, { runId: up.runId, mapping: up.autoMapping, mode: 'replace' }),
    /مدير النظام/);
});

// ── التنفيذ والتراجع ──
test('apply: rejects a stale/mismatched confirmToken', async () => {
  const a = engine.ADAPTERS.clients;
  const { up } = await uploadRows(ctx(admin()), a, [{ code: 'CL-7', name_ar: 'جهة سابعة' }]);
  await assert.rejects(
    () => engine.apply(ctx(admin()), a.type, { runId: up.runId, confirmToken: 'deadbeef' }),
    /رمز التأكيد/);
  // وتغيير المطابقة بعد المعاينة يُبطل الرمز القديم
  const pv1 = await engine.preview(ctx(admin()), a.type, { runId: up.runId, mapping: up.autoMapping, mode: 'upsert' });
  await engine.preview(ctx(admin()), a.type, { runId: up.runId, mapping: up.autoMapping, mode: 'add' });
  await assert.rejects(
    () => engine.apply(ctx(admin()), a.type, { runId: up.runId, confirmToken: pv1.confirmToken }),
    /رمز التأكيد/);
});

test('apply → import_row before/after written; undo restores before_json and audits', async () => {
  const a = engine.ADAPTERS.clients;
  const c = ctx(admin());
  // إنشاء عميل جديد + تحديث عميل قائم (تغيير التصنيف)
  const rows = [
    { code: 'CL-9', name_ar: 'هيئة الترفيه', type: 'حكومي', contact_name: 'أ. نورة', contact_email: 'n@x.sa' },
    { code: 'CL-1', name_ar: 'وزارة النقل', type: 'شبه حكومي' },
  ];
  const { up, pv } = await uploadRows(c, a, rows);
  assert.equal(pv.counts.create, 1);
  assert.equal(pv.counts.update, 1);
  const res = await engine.apply(c, a.type, { runId: up.runId, confirmToken: pv.confirmToken });
  assert.equal(res.created, 1);
  assert.equal(res.updated, 1);
  assert.ok(res.undoExpiresAt > ids.nowIso(), 'مهلة التراجع 7 أيام مفعّلة');

  const created = await db.get("SELECT * FROM client WHERE code = 'CL-9' AND deleted_at IS NULL");
  assert.ok(created, 'العميل الجديد أُنشئ');
  assert.equal((await db.get("SELECT type FROM client WHERE id = 'C1'")).type, 'شبه حكومي');
  const irs = await db.all('SELECT * FROM import_row WHERE run_id = ? ORDER BY row_no', [up.runId]);
  assert.equal(irs.length, 2);
  assert.ok(irs.every((r) => r.after_json), 'كل صف منفَّذ يحمل لقطة بعد');
  assert.ok(JSON.parse(irs[1].before_json).client.type === 'حكومي', 'لقطة قبل التحديث محفوظة');
  assert.ok(await db.get("SELECT id FROM audit_log WHERE action = 'import.apply' AND resource_id = ?", [up.runId]), 'تدقيق التنفيذ');

  const und = await engine.undo(c, up.runId);
  assert.equal(und.undone, true);
  assert.equal((await db.get("SELECT type FROM client WHERE id = 'C1'")).type, 'حكومي', 'التحديث ارتد إلى ما قبل الاستيراد');
  assert.ok((await db.get("SELECT deleted_at FROM client WHERE code = 'CL-9'")).deleted_at, 'المُنشأ حُذف حذفاً ناعماً');
  assert.equal((await db.get('SELECT status FROM import_run WHERE id = ?', [up.runId])).status, 'undone');
  assert.ok(await db.get("SELECT id FROM audit_log WHERE action = 'import.undo' AND resource_id = ?", [up.runId]), 'تدقيق التراجع');
});

test('undo: blocked when a later applied run touched the same records; unblocked after undoing it', async () => {
  const a = engine.ADAPTERS.clients;
  const c = ctx(admin());
  const runOf = async (type) => {
    const { up, pv } = await uploadRows(c, a, [{ code: 'CL-1', name_ar: 'وزارة النقل', sector_market: type }]);
    await engine.apply(c, a.type, { runId: up.runId, confirmToken: pv.confirmToken });
    return up.runId;
  };
  const runA = await runOf('النقل البري');
  await sleep(10);
  const runB = await runOf('النقل الذكي');
  await assert.rejects(() => engine.undo(c, runA), /عملية استيراد أحدث/);
  await engine.undo(c, runB);
  await engine.undo(c, runA); // بعد التراجع عن الأحدث يصبح الأقدم قابلاً للتراجع
  assert.equal((await db.get("SELECT sector_market FROM client WHERE id = 'C1'")).sector_market, 'النقل');
});

test('undo: rejected after the 7-day window expires', async () => {
  const a = engine.ADAPTERS.clients;
  const c = ctx(admin());
  const { up, pv } = await uploadRows(c, a, [{ code: 'CL-EXP', name_ar: 'جهة مؤقتة' }]);
  await engine.apply(c, a.type, { runId: up.runId, confirmToken: pv.confirmToken });
  await db.update('import_run', up.runId, { undo_expires_at: '2020-01-01T00:00:00.000Z' });
  await assert.rejects(() => engine.undo(c, up.runId), /انتهت مهلة التراجع/);
});

// ── الحساسية والنطاق ──
test('sensitive: عمود الراتب في التصدير لمدير النظام فقط — محجوب عن كل دور آخر حتى تكامل Odoo', () => {
  const a = engine.ADAPTERS.employees;
  const adminCols = engine.visibleColumns(U('admin', null, 'company'), a).map((c) => c.key);
  assert.ok(adminCols.includes('salary'), 'مدير النظام يصدّر عمود الراتب');
  for (const [role, sector, scope] of [
    ['hr', null, 'company'], ['sector_lead', 'S1', 'sector'],
    ['ceo_office', null, 'company'], ['bd_manager', 'S1', 'sector'], ['ceo_office', null, 'company'],
  ]) {
    const cols = engine.visibleColumns(U(role, sector, scope), a).map((c) => c.key);
    assert.ok(!cols.includes('salary'), `${role} يجب ألا يصدّر عمود الراتب`);
  }
});

test('row scope: sector_lead importing an employee into another sector gets a row error, not a silent skip', async () => {
  const a = engine.ADAPTERS.employees;
  const lead = U('sector_lead', 'S1', 'sector');
  const { pv } = await uploadRows(ctx(lead), a, [
    { name_ar: 'موظف ضمن نطاقي', sector: 'قطاع الحلول' },
    { name_ar: 'موظف خارج نطاقي', sector: 'قطاع الدراسات' },
  ]);
  assert.equal(pv.counts.create, 1);
  assert.equal(pv.counts.error, 1);
  assert.match(pv.errors[0].message, /خارج نطاق صلاحيتك/);
});

test('KI-092: استيراد تسكينٍ متعدد السنين لنفس (الموظف×المشروع) — كل صفٍّ يسكن سنته ولا يفسد غيرها', async () => {
  // ثلاثة صفوف لنفس الزوج والسنةُ الحالية في **وسطها** عمداً: قبل الإصلاح كان كل إنشاء يقع
  // على سنة اليوم ثم «يُرقَّع» أقدمُ تسكينٍ للزوج — فتفسد السنوات ويصطدم أحد الصفوف بمانع التكرار.
  const a = engine.ADAPTERS.staffing;
  const now = ids.nowIso();
  const Y = new Date().getUTCFullYear();
  await db.insert('project', {
    id: 'P_KI092', code: 'PRJ-KI092', name_ar: 'مشروع سنوات التسكين', sector_id: 'S1',
    status: 'IN_PROGRESS', rag: 'GREEN', created_at: now,
  });
  const c = ctx(U('sector_lead', 'S1', 'sector'));
  const rows = [
    { employee: 'موظف الاختبار', project: 'مشروع سنوات التسكين', year: Y + 1, from_month: 1, to_month: 6, pct: 50 },
    { employee: 'موظف الاختبار', project: 'مشروع سنوات التسكين', year: Y, from_month: 1, to_month: 12, pct: 80 },
    { employee: 'موظف الاختبار', project: 'مشروع سنوات التسكين', year: Y - 1, from_month: 7, to_month: 12, pct: 30 },
  ];
  const { up, pv } = await uploadRows(c, a, rows, { mode: 'add', fileName: 'ki092.xlsx' });
  assert.equal(pv.counts.error, 0, JSON.stringify(pv.errors));
  assert.equal(pv.counts.create, 3);
  const ap = await engine.apply(c, 'staffing', { runId: up.runId, confirmToken: pv.confirmToken });
  assert.equal(ap.errors, 0, 'التنفيذ بلا أخطاء صفوف');
  assert.equal(ap.created, 3);
  const allocs = await db.all(
    'SELECT year, monthly_json FROM allocation WHERE project_id = ? AND deleted_at IS NULL ORDER BY year',
    ['P_KI092']);
  assert.deepEqual(allocs.map((r) => Number(r.year)), [Y - 1, Y, Y + 1], 'ثلاث سنوات صحيحة بلا تكرار ولا ضياع');
  const monthsCount = allocs.map((r) => Object.keys(JSON.parse(r.monthly_json)).length);
  assert.deepEqual(monthsCount, [6, 12, 6], 'المخطط الشهري لكل سنة كما في ملفها');
});

// ── قاعدة الذهاب-الإياب لكل محوّل: تصدير → إعادة استيراد (إضافة وتحديث) = تجاهل 100% ──
for (const type of ['clients', 'employees', 'opportunities', 'projects', 'staffing', 'revenues']) {
  test(`round-trip ${type}: export → reimport upsert → 100% skip`, async () => {
    const a = engine.ADAPTERS[type];
    const c = ctx(admin());
    const exported = await a.fetchRows(c.user, {});
    assert.ok(exported.length >= 1, `يوجد ما يُصدَّر لنوع ${type}`);
    const { pv } = await uploadRows(c, a, exported, { fileName: `rt-${type}.xlsx` });
    assert.equal(pv.counts.error, 0, `لا أخطاء: ${JSON.stringify(pv.errors)}`);
    assert.equal(pv.counts.create, 0, `لا إضافات: ${JSON.stringify(pv.rows.filter((r) => r.action === 'create'))}`);
    assert.equal(pv.counts.update, 0, `لا تحديثات: ${JSON.stringify(pv.rows.filter((r) => r.action === 'update'))}`);
    assert.equal(pv.counts.skip, exported.length, 'كل الصفوف مطابقة تماماً');
  });
}
