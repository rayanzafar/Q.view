// وحدة: محرّك المساعد المحلي — الحلّ من نص إلى **مجموعة**، والتسمية بالمعنى، والصدق عند العجز.
//
// أعطال حقيقية يحرسها هذا الملف:
//   • كان الحلّ يأخذ أول مطابقة بـLIMIT 1 ويمضي — اختيارٌ صامت عن المستخدم. صار أربع حالات
//     معلَنة: لا شيء · واحد (يُقال إنه اختير) · بضعة (تُعرض للاختيار) · كثير (ضيّق بحثك).
//   • كانت القيم المخزَّنة تُطبع خاماً داخل جملة عربية (حالة المشروع، صحته، رمز الأولوية).
//   • كان فحص جودة البيانات يَعُدّ العملاء والباقات بلا أي حارس، ويطبع صفراً يُقرأ «نظيف»
//     لمن لا يملك المنح أصلاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ai-'));
process.env.SANAD_DB = join(dir, 't.db');
delete process.env.AI_ENGINE;
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { ask, resolveRef, aiStatus, optionsFor, INTENTS } = await import('../../src/core/ai/assistant.js');

const T = '2026-07-01T00:00:00Z';
const U = (role, scope, sector, id = 'u1') => ({ id, role_id: role, scope, sector_id: sector, projectIds: new Set(), teamIds: new Set() });
const ctx = (user) => ({ user, ip: '127.0.0.1' });

before(async () => {
  // حساب حقيقي: المهمة تشير إلى المُسنَد إليه بمفتاح خارجي، فلا تُزرع مهمة لشخص لا وجود له.
  await insert('app_user', { id: 'u1', username: 'ai.unit', name_ar: 'حساب فحص', role_id: 'admin',
    scope: 'company', active: 1, created_at: T });
  await insert('sector', { id: 'S1', name_ar: 'قطاع الاختبار', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع آخر', active: 1, sort_order: 2, created_at: T });
  await insert('project', { id: 'p_test1', name_ar: 'منصة البيانات السعودية', sector_id: 'S1',
    status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 58, contract_value_halalas: 100000,
    actual_spend_halalas: 40000, start_date: '2026-01-01', end_date: '2026-12-31', created_at: T });
  await insert('project', { id: 'p_other', name_ar: 'مشروع في قطاع آخر', sector_id: 'S2',
    status: 'IN_PROGRESS', rag: 'RED', progress_pct: 10, contract_value_halalas: 50000, created_at: T });
  // ستة مشاريع تتشارك كلمة واحدة: حالتا «بضعة» و«كثير» لا تُثبتان بمشروع واحد.
  for (let i = 1; i <= 6; i++) {
    await insert('project', { id: `p_many${i}`, name_ar: `مشروع التمكين رقم ${i}`, sector_id: 'S1',
      status: 'PLANNED', rag: 'AMBER', progress_pct: 0, created_at: T });
  }
  await insert('task', { id: 't1', title: 'مراجعة وثيقة الاعتماد', sector_id: 'S1', project_id: 'p_test1',
    assignee_user_id: 'u1', status: 'TODO', priority: 'P0', due_date: '2026-07-05', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ── الحلّ من نص ───────────────────────────────────────────────────────────────
test('resolveRef: أربع حالات مصمَّمة — لا شيء، واحد، بضعة، كثير', async () => {
  const admin = U('admin', 'company', null);
  assert.equal((await resolveRef(admin, 'project', 'لخّص مشروع اسم لا وجود له إطلاقا')).total, 0);
  const one = await resolveRef(admin, 'project', 'لخّص حالة مشروع منصة البيانات السعودية');
  assert.equal(one.total, 1);
  assert.equal(one.matches[0].id, 'p_test1');
  const many = await resolveRef(admin, 'project', 'لخّص مشروع التمكين');
  assert.equal(many.total, 6, 'ستة مشاريع تحمل الكلمة نفسها');
  assert.ok(many.matches.length <= 5, 'ولا تعود القائمة كلها');
});

test('ask: مطابقة واحدة ⟵ يُلخّص **ويقول إنه اختار**', async () => {
  const r = await ask(ctx(U('admin', 'company', null)), 'لخّص حالة مشروع منصة البيانات السعودية');
  assert.ok(r.reply.includes('منصة البيانات السعودية'));
  assert.match(r.reply, /اخترتُ/, 'يقول للمستخدم أنه اختار مشروعاً بعينه كي يصحّحه إن أخطأ');
  assert.ok(!('applyToken' in r), 'ولا رمز تأكيد في ردّ قراءة');
});

test('ask: تعدّد المطابقات ⟵ خيارات بالأسماء، بلا اختيار صامت', async () => {
  const r = await ask(ctx(U('admin', 'company', null)), 'لخّص مشروع التمكين رقم');
  assert.ok(Array.isArray(r.choices) || /اكتب اسماً أدق|ضيّق/.test(r.reply), 'إما خيارات وإما طلب تضييق: ' + r.reply);
  if (r.choices) {
    assert.ok(r.choices.length >= 2);
    assert.ok(r.choices.every((c) => c.id && c.label_ar));
  }
  assert.ok(!/^\*\*مشروع التمكين رقم 1\*\*/.test(r.reply), 'ولا يلخّص أولها صامتاً');
});

test('ask: صفر مطابقات ⟵ يقول ذلك ويطلب التحديد، ولا يمضي', async () => {
  const r = await ask(ctx(U('admin', 'company', null)), 'لخّص حالة مشروع لا وجود له البتة');
  assert.match(r.reply, /حدّد المشروع|لم أجد/);
});

test('ask: بلا أي إشارة مشروع يطلب التحديد بأدب', async () => {
  const r = await ask(ctx(U('admin', 'company', null)), 'لخّص مشروع');
  assert.match(r.reply, /حدّد المشروع/);
});

test('ask: النطاق محترم — لا يُحَلّ اسم مشروع خارج نطاق صاحب الطلب', async () => {
  const lead = U('sector_lead', 'sector', 'S1', 'u2');
  const r = await ask(ctx(lead), 'لخّص حالة مشروع في قطاع آخر');
  assert.match(r.reply, /حدّد المشروع|لم أجد/, 'لا يجوز أن يحلّ اسم مشروع خارج النطاق: ' + r.reply);
});

// ── التسمية بالمعنى ───────────────────────────────────────────────────────────
const RAW = /\b(RED|AMBER|GREEN|IN_PROGRESS|NOT_STARTED|ON_HOLD|TODO|BLOCKED|DONE|P0|P1|P2|P3|QUALIFIED|NEGOTIATION)\b/;

test('لا قيمة مخزَّنة خام في أي ردّ: الحالة والصحة والأولوية بالعربية', async () => {
  const admin = U('admin', 'company', null);
  const sum = await ask(ctx(admin), 'لخّص حالة مشروع منصة البيانات السعودية');
  assert.ok(!RAW.test(sum.reply), 'ملخّص المشروع: ' + sum.reply);
  assert.match(sum.reply, /قيد التنفيذ/);
  const risks = await ask(ctx(admin), 'ما المخاطر');
  assert.ok(!RAW.test(risks.reply), 'كشف المخاطر: ' + risks.reply);
  assert.match(risks.reply, /مشاريع حرجة/);
  const prio = await ask(ctx(admin), 'ما أولوياتي اليوم');
  assert.ok(!RAW.test(prio.reply), 'الأولويات: ' + prio.reply);
  assert.match(prio.reply, /\[حرجة\]/, 'الأولوية بالمعنى لا برمزها: ' + prio.reply);
});

test('قيمة غير معروفة تُقال «غير محدّدة» لا تُطبع كما هي', async () => {
  await insert('project', { id: 'p_weird', name_ar: 'مشروع بحالة مجهولة', sector_id: 'S1',
    status: 'ZZZ_UNKNOWN', rag: 'PURPLE', progress_pct: 0, created_at: T });
  const r = await ask(ctx(U('admin', 'company', null)), 'لخّص حالة مشروع بحالة مجهولة');
  assert.ok(!/ZZZ_UNKNOWN|PURPLE/.test(r.reply), r.reply);
  assert.match(r.reply, /غير محدّدة/);
});

// ── الحجب والصدق ──────────────────────────────────────────────────────────────
test('الكلفة: مكشوفة لمن يملك بوابتها، ومحجوبة بنصٍّ صريح عن غيره', async () => {
  const fin = await ask(ctx(U('ceo_office', 'company', null, 'u3')), 'لخّص حالة مشروع منصة البيانات السعودية');
  assert.match(fin.reply, /الصرف الفعلي/);
  const pm = U('project_manager', 'own', 'S1', 'u4');
  pm.projectIds = new Set(['p_test1']);
  const r = await ask(ctx(pm), 'لخّص حالة مشروع منصة البيانات السعودية');
  assert.match(r.reply, /التكلفة محجوبة عن دورك/);
  assert.ok(!/الصرف الفعلي/.test(r.reply), 'ولا رقم صرف في ردّه');
});

test('جودة البيانات: السطر الذي لا يملكه صاحب الطلب يُحذف، ولا يُطبع صفراً', async () => {
  await insert('client', { id: 'c_notype', name_ar: 'جهة بلا تصنيف', active: 1, created_at: T });
  const admin = await ask(ctx(U('admin', 'company', null)), 'افحص جودة البيانات');
  assert.match(admin.reply, /عميل بلا تصنيف نوع/, 'مدير النظام يقرأ العملاء فيرى السطر');
  const ops = await ask(ctx(U('operations', 'sector', 'S1', 'u5')), 'افحص جودة البيانات');
  assert.ok(!/عميل بلا تصنيف/.test(ops.reply), 'العمليات بلا منح العملاء ⟵ السطر غائب لا صفر: ' + ops.reply);
  assert.ok(!/0 عميل|0 باقة/.test(ops.reply), 'ولا صفر يُقرأ نظافةً');
});

test('رسالة «لا نواقص» تسمّي ما فُحص، فلا تُقرأ شهادةً على الشركة كلها', async () => {
  // الحساب الخارجي يملك قراءة **مشاريعه** وحدها: فحصٌ واحد لا أربعة — والرسالة تقول ذلك.
  const ext = await ask(ctx(U('external', 'own', null, 'u6')), 'افحص جودة البيانات');
  assert.match(ext.reply, /فحصتُ/, ext.reply);
  assert.match(ext.reply, /المشاريع/);
  assert.ok(!/العملاء|باقات/.test(ext.reply), 'ولا يذكر ما لا يملكه: ' + ext.reply);
  // ومن لا يملك أي مصدر من مصادر الفحص يُقال له ذلك صراحةً بدل «جودة البيانات جيدة».
  const approver = await ask(ctx(U('approver', 'sector', 'S1', 'u10')), 'افحص جودة البيانات');
  assert.match(approver.reply, /ولا شيء منها ضمن صلاحيتك/, approver.reply);
});

// ── الكتابة: نموذج لا تخمين ───────────────────────────────────────────────────
test('نص يشبه أمر كتابة ⟵ نموذج، ولا رمز تأكيد ولا كتابة', async () => {
  const r = await ask(ctx(U('admin', 'company', null)), 'أنشئ مهمة متابعة العقد غداً');
  assert.equal(r.form?.type, 'task_create');
  assert.ok(!('applyToken' in r) && !('preview' in r));
  assert.match(r.reply, /معاينة/, 'الرد يشرح أن التنفيذ بعد المعاينة والتأكيد');
});

test('من لا يملك منح الكتابة يُردّ برسالة تقول ماذا يفعل', async () => {
  await assert.rejects(() => ask(ctx(U('viewer', 'sector', 'S1', 'u7')), 'أنشئ مهمة جديدة'),
    (e) => e.status === 403 && /مدير النظام/.test(e.message));
});

// ── الحالة والقوائم ───────────────────────────────────────────────────────────
test('aiStatus: محلي، والاقتراحات مُرشَّحة بالمنح', () => {
  const s = aiStatus(U('employee', 'own', 'S1', 'u8'));
  assert.equal(s.mode, 'local');
  assert.equal(s.modeLabel, 'محلي');
  assert.equal(s.configured, false);
  assert.ok(!s.suggestions.some((x) => x.intent === 'weekly_report'));
  assert.ok(INTENTS.length >= 7, 'سبع نوايا على الأقل: خمس قراءة واثنتان كتابة');
});

test('القوائم: خيارات الأولوية والحالة عربية كلها', async () => {
  const p = await optionsFor(U('employee', 'own', 'S1', 'u9'), 'priority');
  assert.ok(p.options.every((o) => /[؀-ۿ]/.test(o.label_ar)), 'كل تسمية عربية');
  const st = await optionsFor(U('employee', 'own', 'S1', 'u9'), 'task_status');
  assert.ok(st.options.every((o) => /[؀-ۿ]/.test(o.label_ar)));
});
