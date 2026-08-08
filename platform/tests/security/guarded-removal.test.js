// الحذف قدرةٌ مكتملة — وآمنةٌ بذاتها لا بحُسن نيّة مَن يستعملها.
//
// لم يكن في المنتج حذفُ مشروعٍ ولا فرصة. فبياناتٌ مستوردة من نظامٍ قديم — أوعية داخلية،
// مشاريع باسم إدارة، صفوف بلا جهة — تبقى إلى الأبد في المحافظ والتقارير، ولا سبيل إلى تنظيفها
// إلا بفتح القاعدة يدوياً: بابٌ خارج التدقيق وخارج الصلاحيات.
//
// وثلاثة حدود يثبّتها هذا الملف، وهي التي تجعل بناء الحذف أماناً لا خطراً:
//   ١) المال لا يُحذف — فاتورة أو تحصيل أو عقد أو إيراد يمنع دائماً، بلا تجاوز.
//   ٢) لا يُترك يتيم — التابع يُحذف مع أصله في نفس المعاملة (وهو العطل الذي رأيناه في الإدارات).
//   ٣) الرفض يُشرح بعدده واسمه — «لا يمكن الحذف» رسالةٌ عاجزة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-remove-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let remove, db, rbac;
const T = new Date().toISOString();
const ADMIN = { id: 'u_a', username: 'a', role_id: 'admin', scope: 'company' };
const EMP = { id: 'u_e', username: 'e', role_id: 'employee', scope: 'own', sector_id: 'S1' };
const ctx = { user: ADMIN, ip: '127.0.0.1' };

before(async () => {
  remove = await import('../../src/core/lifecycle/remove.js');
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع', active: 1, created_at: T });
  const mk = async (id, name) => db.insert('project', { id, name_ar: name, sector_id: 'S1', status: 'نشط', created_at: T });
  await mk('p_clean', 'مشروع بلا التزامات');
  await mk('p_paid', 'مشروع عليه فاتورة');
  await mk('p_kids', 'مشروع له تابع');
  await db.insert('invoice', { id: 'inv1', project_id: 'p_paid', amount_halalas: 100000, status: 'ISSUED', created_at: T });
  await db.insert('employee', { id: 'e1', name_ar: 'موظف', sector_id: 'S1', active: 1, created_at: T });
  await db.insert('allocation', { id: 'al1', project_id: 'p_kids', employee_id: 'e1', sector_id: 'S1', year: 2026, created_at: T });
  await db.insert('task', { id: 'tk1', project_id: 'p_kids', title: 'مهمة', status: 'TODO', created_at: T });
  await db.insert('opportunity', { id: 'o_clean', title_ar: 'فرصة نظيفة', sector_id: 'S1', created_at: T });
  await db.insert('opportunity', { id: 'o_clean2', title_ar: 'فرصة نظيفة أخرى', sector_id: 'S1', created_at: T });
  await db.insert('opportunity', { id: 'o_won', title_ar: 'فرصة صارت مشروعاً', sector_id: 'S1', created_at: T });
  await db.insert('project', { id: 'p_from_opp', name_ar: 'مشروع من فرصة', sector_id: 'S1', source_opp_id: 'o_won', status: 'نشط', created_at: T });
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('الحذف الصحيح يعمل — وهو ما لم يكن في المنتج إطلاقاً', async () => {
  const r = await remove.removeRecord(ctx, 'project', 'p_clean');
  assert.equal(r.ok, true);
  const row = await db.get("SELECT deleted_at FROM project WHERE id = 'p_clean'");
  assert.ok(row.deleted_at, 'لم يُختم بالحذف');
  const live = await db.get("SELECT COUNT(*) n FROM project WHERE id = 'p_clean' AND deleted_at IS NULL");
  assert.equal(Number(live.n), 0, 'ما زال يُقرأ حيّاً');
});

test('والمال يمنع الحذف دائماً — والرسالة تسمّي المانع بعدده', async () => {
  await assert.rejects(() => remove.removeRecord(ctx, 'project', 'p_paid'), (e) => {
    assert.match(e.message, /فاتورة واحدة/, 'المانع لم يُسمَّ بعدده');
    assert.match(e.message, /مشروع عليه فاتورة/, 'المانع لم يُسمَّ باسم السجل');
    assert.match(e.message, /مُلغى/, 'لم يُقترح المخرج البديل');
    return true;
  });
  const row = await db.get("SELECT deleted_at FROM project WHERE id = 'p_paid'");
  assert.equal(row.deleted_at, null, 'حُذف مشروعٌ عليه فاتورة');
});

test('والتابع يُحذف مع أصله — فلا صفَّ يشير إلى مشروعٍ لا وجود له', async () => {
  const r = await remove.removeRecord(ctx, 'project', 'p_kids');
  assert.equal(r.cascaded['تسكين'], 1, 'التسكين لم يُحذف مع مشروعه');
  assert.equal(r.cascaded['مهمة'], 1, 'المهمة لم تُحذف مع مشروعها');
  for (const [t, c] of [['allocation', 'al1'], ['task', 'tk1']]) {
    const row = await db.get(`SELECT deleted_at FROM ${t} WHERE id = ?`, [c]);
    assert.ok(row.deleted_at, `${t} بقي يتيماً يشير إلى مشروعٍ محذوف`);
  }
});

test('وفرصةٌ تحوّلت إلى مشروع لا تُحذف — الحذف يقطع نسب المشروع إلى مصدره', async () => {
  await assert.rejects(() => remove.removeRecord(ctx, 'opportunity', 'o_won'), /مشروعٌ قائم/);
  const row = await db.get("SELECT deleted_at FROM opportunity WHERE id = 'o_won'");
  assert.equal(row.deleted_at, null, 'حُذفت فرصةٌ لها مشروع');
});

test('والفرصة النظيفة تُحذف', async () => {
  const r = await remove.removeRecord(ctx, 'opportunity', 'o_clean', { reason: 'إدخال مكرر' });
  assert.equal(r.ok, true);
  assert.ok((await db.get("SELECT deleted_at FROM opportunity WHERE id = 'o_clean'")).deleted_at);
});

test('regression (KI-029): سحب الفرصة بلا سبب يُرَدّ خادمياً — والسبب مطلوب حتى للنظيفة', async () => {
  // فرصةٌ نظيفة (لا مانع) لكن بلا سبب: يجب أن تُرَدّ ببادئة «سحبُ الفرصة يتطلب ذكرَ السبب»
  await assert.rejects(() => remove.removeRecord(ctx, 'opportunity', 'o_clean2'), /يتطلب ذكرَ السبب/);
  await assert.rejects(() => remove.removeRecord(ctx, 'opportunity', 'o_clean2', { reason: '   ' }), /يتطلب ذكرَ السبب/);
  // ولم تُحذف: الرفض قبل أي كتابة
  assert.equal((await db.get("SELECT deleted_at FROM opportunity WHERE id = 'o_clean2'")).deleted_at, null);
  // ومع سبب: تُحذف ويُسجَّل السبب في التدقيق
  const r = await remove.removeRecord(ctx, 'opportunity', 'o_clean2', { reason: 'خطأ إدخال' });
  assert.equal(r.ok, true);
  const a = await db.get("SELECT detail_json FROM audit_log WHERE resource = 'opportunity' AND resource_id = 'o_clean2' ORDER BY at DESC");
  assert.match(String(a.detail_json), /السبب: خطأ إدخال/);
});

test('regression (KI-030): رسالة «غير موجودة» للفرصة مؤنّثةٌ (توافق الجنس)', async () => {
  await assert.rejects(() => remove.removeRecord(ctx, 'opportunity', 'o_ghost', { reason: 'x' }), /غير موجودة أو محذوفة/);
  // والمشروع يبقى مذكّراً
  await assert.rejects(() => remove.removeRecord(ctx, 'project', 'p_ghost'), /غير موجود أو محذوف/);
});

test('والصلاحية تُفحص في الخدمة لا في الشاشة — موظفٌ لا يحذف شيئاً', async () => {
  await db.insert('project', { id: 'p_guard', name_ar: 'مشروع محروس', sector_id: 'S1', status: 'نشط', created_at: T });
  await assert.rejects(() => remove.removeRecord({ user: EMP, ip: '1.1.1.1' }, 'project', 'p_guard'),
    /صلاحية/, 'حذف موظفٌ مشروعاً');
  assert.equal((await db.get("SELECT deleted_at FROM project WHERE id = 'p_guard'")).deleted_at, null);
});

test('وكل حذف مسجَّل في التدقيق بما حُذف معه — لا فعلٌ صامت', async () => {
  const a = await db.get(
    "SELECT detail_json FROM audit_log WHERE action = 'delete' AND resource = 'project' ORDER BY at DESC LIMIT 1");
  assert.ok(a, 'لا أثر للحذف');
  assert.match(String(a.detail_json), /مشروع له تابع/, 'الأثر لا يسمّي المحذوف');
  assert.match(String(a.detail_json), /ومعه/, 'الأثر لا يذكر ما حُذف تبعاً');
});

test('وحذفُ ما لا وجود له يُردّ بوضوح لا بخطأٍ غامض', async () => {
  await assert.rejects(() => remove.removeRecord(ctx, 'project', 'p_nope'), /غير موجود/);
  await assert.rejects(() => remove.removeRecord(ctx, 'unicorn', 'x'), /نوعٌ غير معروف/);
});

test('وفحصُ المانع يُقرأ قبل الحذف — فتُعرض العاقبة قبل الضغط', async () => {
  const b = await remove.removalBlockers('project', 'p_paid');
  assert.deepEqual(b.length, 1);
  assert.match(b[0], /فاتورة واحدة/);
  assert.deepEqual(await remove.removalBlockers('project', 'p_guard'), [], 'مشروعٌ نظيف عُدّ ممنوعاً');
});

// ── سحب الفرصة: المنشئ يسحب فرصته هو — والملكية لا تفتح فرص غيره ──────────────
// «سحب الفرصة» قرارُ صاحبها قبل أن يكون قرارَ مديره: من أدخل فرصةً بالخطأ يصحّح إدخاله
// بنفسه (`ownDelete` على نوع الفرصة وحده) — ولا يمسّ ما أدخله زملاؤه.
const CREATOR = { id: 'u_c1', username: 'c1', role_id: 'consultant', scope: 'own', sector_id: 'S1' };

test('ومنشئ الفرصة يسحب فرصته النظيفة — ولو لم يملك صلاحية الحذف', async () => {
  await db.insert('opportunity', { id: 'o_mine', title_ar: 'فرصة أدخلتها بالخطأ', sector_id: 'S1', created_by: CREATOR.id, created_at: T });
  const r = await remove.removeRecord({ user: CREATOR, ip: '1.1.1.1' }, 'opportunity', 'o_mine', { reason: 'إدخال مكرر' });
  assert.equal(r.ok, true);
  assert.ok((await db.get("SELECT deleted_at FROM opportunity WHERE id = 'o_mine'")).deleted_at, 'لم تُسحب فرصته هو');
});

test('ولا يسحب فرصة زميله — ملكية الإنشاء لا تتعدّى صاحبها', async () => {
  await db.insert('opportunity', { id: 'o_peer', title_ar: 'فرصة زميل', sector_id: 'S1', created_by: 'u_colleague', created_at: T });
  await assert.rejects(() => remove.removeRecord({ user: CREATOR, ip: '1.1.1.1' }, 'opportunity', 'o_peer'),
    /صلاحية/, 'سحب فرصةً لم يُنشئها ولا يملك حذفها');
  assert.equal((await db.get("SELECT deleted_at FROM opportunity WHERE id = 'o_peer'")).deleted_at, null);
});

test('وقائد القطاع يسحب فرص قطاعه كما كان — الباب الإداري لم يضق', async () => {
  const LEAD = { id: 'u_sl', username: 'sl', role_id: 'sector_lead', scope: 'sector', sector_id: 'S1' };
  const r = await remove.removeRecord({ user: LEAD, ip: '1.1.1.1' }, 'opportunity', 'o_peer', { reason: 'تنظيف بيانات' });
  assert.equal(r.ok, true);
  assert.ok((await db.get("SELECT deleted_at FROM opportunity WHERE id = 'o_peer'")).deleted_at, 'قائد القطاع لم يعد يسحب');
});
