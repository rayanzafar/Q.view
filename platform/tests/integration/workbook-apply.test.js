// دفترُ القطاع المعبّأ: من الكشف إلى الكتابة — الطريق كاملاً على قاعدةٍ حقيقية.
//
// السكربتان يُشغَّلان **كما يُشغِّلهما الإنسان**: عمليةٌ مستقلّة لكلٍّ منهما بمتغيّر `SANAD_DB`
// نفسه، فيُقرأ منهما ما يُقرأ في الطرفية — رمزُ الخروج والمخرجات — لا ما تعيده دالّةٌ مُستدعاة.
// والدفتر دفترٌ حقيقي: يُولّده `make-sap-intake-workbook.mjs` ثم تُكتب فيه الصفوف بالمكتبة
// المورَّدة، وصفُّ المثال يبقى في أوراقٍ ويُكتب فوق أوائله في ورقة المشاريع — كما فعل الفريق.
//
// ما يحرسه هذا الملف بترتيب أهميته:
//   ١) الكشف لا يكتب صفاً واحداً — عددُ كل جدولٍ قبله وبعده سواء.
//   ٢) الاسم المكتوب بخطأٍ إملائي يُطابَق المشروعَ القائم تصحيحاً لا إضافة، واسمُ المنصة يبقى.
//   ٣) مخرجٌ طابق واكتسب شهراً وسنة ⇒ سطرُ إيرادٍ بذلك الشهر وحده.
//   ٤) «مفوتر؟ نعم» بلا فاتورة ⇒ لا فاتورة تُنشأ، والصفُّ يُذكر في «مفوتر بلا فاتورة».
//   ٥) «محصَّل؟ نعم» ⇒ لا تحصيل يُنشأ.
//   ٦) «المعلم» يصير مرحلةً على المشروع يحملها المخرج — ولا معلَم يُكتب.
//   ٧) بقايا صف المثال لا تُكتب: قيمةُ العقد وحالةُ المشروع تبقيان كما في المنصة.
//   ٨) التسكين يُكتب بسنة التشغيل الصريحة وبالصفة المقابلة لما في الدفتر.
//   ٩) إعادةُ الكشف بعد التطبيق: لا إضافة ولا تصحيح في أي مجموعة.
//   ١٠) الأقفال: بصمةٌ خاطئة، ونسخةٌ احتياطية غائبة، وخطةٌ تحمل ختمَ فوترة — ثلاثتها رفضٌ بلا كتابة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DIR = mkdtempSync(join(tmpdir(), 'sanad-wbapply-'));
process.env.SANAD_DB = join(DIR, 'wb.db');
delete process.env.DATABASE_URL;            // القاعدة المؤقتة وحدها — لا بيئةٌ حيّة بحال
const ROOT = new URL('../..', import.meta.url).pathname;

const WB = join(DIR, 'دفتر-الاستشارات.xlsx');
const OUT = join(DIR, 'plan');
const PLAN = `${OUT}.json`;
const BACKUP = join(DIR, 'backup.ndjson');
const T = '2026-01-10T08:00:00.000Z';
const SECTOR = 'قطاع الاستشارات';
const ACTOR = 'import.admin@evc.sa';

// أسماء المنصة كما أثبتتها، وأسماءُ الدفتر كما كتبها الفريق: فراغٌ مزدوج وحرفٌ مقلوب.
const P1 = 'مشروع بناء الاستراتيجية الرقمية لوزارة التجربة';
const P1_SHEET = 'مشروع  بناء الاستراتيحية الرقمية لوزارة التجربة ';
const P2 = 'مشروع تشغيل ودعم منصة الموارد';
const P3 = 'برنامج التحول المؤسسي';
const CLIENT = 'وزارة التجربة';
const D_PM = 'إدارة المشاريع';
const D_GOV = 'إدارة الحوكمة';
const EMP = 'ريم سعد الحربي';
const DLV_LIVE = 'تقرير الوضع الراهن';
const DLV_NEW = 'ورشة إطلاق البرنامج';
const PHASE = 'المرحلة الأولى';

let db;
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const readPlan = () => JSON.parse(readFileSync(PLAN, 'utf8'));

/** تشغيلُ سكربتٍ في عمليةٍ مستقلّة — رمزُ الخروج مقروءٌ لا ملقى. */
function run(script, args) {
  const r = spawnSync(process.execPath, ['--experimental-sqlite', join(ROOT, script), ...args],
    { env: process.env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const reconcile = (extra = []) => run('scripts/reconcile-workbook.mjs',
  [`--file=${WB}`, `--out=${OUT}`, `--sector=${SECTOR}`, '--year=2026', ...extra]);

// جداولُ الأثر كلُّها: أيُّ كتابةٍ في أيٍّ منها تظهر فارقاً في العدد.
const TABLES = ['sector', 'department', 'client', 'project', 'deliverable', 'project_phase',
  'milestone', 'employee', 'allocation', 'app_user', 'revenue_line', 'invoice', 'collection', 'audit_log'];
async function countAll() {
  const out = {};
  for (const t of TABLES) out[t] = (await db.get(`SELECT COUNT(*) AS "c" FROM ${t}`)).c;
  return out;
}
const countOf = async (sql, params = []) => (await db.get(sql, params)).c;

// ── الدفتر: يُولَّد حقيقةً ثم تُكتب صفوفُه ───────────────────────────────────
async function buildWorkbook() {
  const gen = run('scripts/make-sap-intake-workbook.mjs',
    [`--sector=${SECTOR}`, `--departments=${D_PM}،${D_GOV}`, `--out=${WB}`]);
  assert.equal(gen.code, 0, `تعذّر توليد الدفتر: ${gen.out}`);
  const XLSX = await import('../../vendor/xlsx/xlsx.mjs');
  const wb = XLSX.read(readFileSync(WB), { type: 'buffer' });
  const put = (sheet, rowNo, cells) =>
    XLSX.utils.sheet_add_aoa(wb.Sheets[sheet], [cells], { origin: `A${rowNo}` });

  // المشاريع — السطر ٢ هو صفُّ المثال: تُكتب أوائلُه وتبقى بقيّتُه بقايا مثالٍ لا بيانات.
  put('المشاريع', 2, [P2, CLIENT, D_GOV]);
  put('المشاريع', 3, [P1_SHEET, CLIENT, D_PM, null, null, 'أصفر', null, null,
    null, null, null, null, '2026-12-31']);
  put('المشاريع', 4, [P3, CLIENT, D_GOV]);

  // المخرجات — صفُّ المثال يبقى كما وُلد (فيُسقَط كلُّه)، والبيانات من السطر ٣.
  // السطر الرابع بلا مشروعٍ في خانته: يُسحب إليه أصلُ ما قبله.
  put('المخرجات', 3, [P3, null, DLV_LIVE, 250000, null, 6, 2026, null, 'تم التسليم',
    null, null, 'نعم', null, null, 'نعم']);
  put('المخرجات', 4, [null, PHASE, DLV_NEW, 77000, null, 9, 2026, null, 'مسودة',
    null, null, 'لا', null, null, 'لا']);

  put('الموظفون', 3, [EMP, null, 'استشاري أول', D_PM]);

  put('التسكين', 3, [EMP, P3, null, 'مدير المشروع', 3, 9, 50]);
  put('التسكين', 4, [EMP, P1_SHEET, null, 'عضو فريق', 1, 12, 100]);

  writeFileSync(WB, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

before(async () => {
  for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
    const r = run(s, []);
    assert.equal(r.code, 0, `${s}: ${r.out}`);
  }
  db = await import('../../src/core/db/index.js');
  await buildWorkbook();
  writeFileSync(BACKUP, Buffer.alloc(1200000, 0x20));   // نسخةٌ طازجة تتجاوز حدَّ الميغابايت

  await db.insert('sector', { id: 'CONS', name_ar: SECTOR, active: 1, sort_order: 1, created_at: T });
  await db.insert('department', { id: 'D_PM', sector_id: 'CONS', name_ar: D_PM, active: 1, created_at: T });
  await db.insert('department', { id: 'D_GOV', sector_id: 'CONS', name_ar: D_GOV, active: 1, created_at: T });
  await db.insert('client', { id: 'c1', name_ar: CLIENT, active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_imp', username: 'import.admin', email: ACTOR,
    name_ar: 'مسؤول الاستيراد', role_id: 'admin', scope: 'company', sector_id: 'CONS', active: 1, created_at: T });

  await db.insert('project', { id: 'p1', code: 'CONS-1', name_ar: P1, sector_id: 'CONS', client_id: 'c1',
    department_id: 'D_PM', status: 'IN_PROGRESS', rag: 'GREEN', start_date: '2026-01-01',
    end_date: '2026-10-31', created_at: T });
  // المشروع الذي يقع صفُّه على صف المثال: قيمتُه وحالتُه هنا هما ما يجب ألّا يُبدَّل بقيم المثال.
  await db.insert('project', { id: 'p2', code: 'CONS-2', name_ar: P2, sector_id: 'CONS', client_id: 'c1',
    department_id: 'D_PM', status: 'ON_HOLD', rag: 'GREEN', contract_value_halalas: 11500000,
    budget_halalas: 900000, created_at: T });
  await db.insert('project', { id: 'p3', code: 'CONS-3', name_ar: P3, sector_id: 'CONS', client_id: 'c1',
    department_id: 'D_GOV', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });

  // مخرجٌ مُسلَّمٌ بلا شهرٍ (الدفتر يؤرّخه) وآخرُ مؤرَّخٌ أصلاً (الدفتر لا يضيف له شيئاً).
  await db.insert('deliverable', { id: 'dlv1', project_id: 'p3', sector_id: 'CONS', name_ar: DLV_LIVE,
    amount_halalas: 28750000, status: 'DELIVERED', delivered_at: T, created_at: T });
  await db.insert('deliverable', { id: 'dlv2', project_id: 'p3', sector_id: 'CONS', name_ar: 'خطة التنفيذ التفصيلية',
    amount_halalas: 11500000, status: 'DRAFT', month: 3, year: 2026, created_at: T });

  await db.insert('employee', { id: 'e1', name_ar: EMP, sector_id: 'CONS', department_id: 'D_PM',
    job_title: 'استشاري', status: 'نشط', active: 1, created_at: T });
  await db.insert('employee', { id: 'e2', name_ar: 'خالد ناصر العتيبي', sector_id: 'CONS',
    department_id: 'D_GOV', status: 'نشط', active: 1, created_at: T });
  // تسكينٌ قائم: صفُّ الدفتر المقابل له يُذكر ولا يُعاد.
  await db.insert('allocation', { id: 'a_live', employee_id: 'e1', person_name_ar: EMP, project_id: 'p1',
    project_name: P1, sector_id: 'CONS', type: 'member', year: 2026,
    monthly_json: JSON.stringify({ 1: 1, 2: 1 }), source: 'manual', created_at: T });
});

after(async () => { await db?.close?.(); rmSync(DIR, { recursive: true, force: true }); });

let before_;

test('الكشف يقرأ المنصة ولا يكتب فيها صفاً واحداً', async () => {
  before_ = await countAll();
  const r = reconcile();
  assert.equal(r.code, 0, `الكشف لم ينتهِ نظيفاً:\n${r.out}`);
  assert.deepEqual(await countAll(), before_, 'الكشف غيّر عدد صفٍّ في القاعدة');

  const plan = readPlan();
  assert.equal(plan.conflicts.length, 0, `تعارضاتٌ غير متوقَّعة: ${JSON.stringify(plan.conflicts)}`);
  assert.equal(plan.meta.sector_id, 'CONS');
  assert.ok(r.out.includes('كُتبت الخطة'), 'المخرجات لا تقول أين كُتبت الخطة');
});

test('اسمٌ فيه خطأ إملائي وفراغٌ مزدوج يُطابق مشروعَه القائم — تصحيحاً لا إضافة', () => {
  const plan = readPlan();
  const creates = plan.projects.filter((p) => p.op === 'create');
  assert.deepEqual(creates, [], 'أُدرج مشروعٌ جديدٌ لاسمٍ له نظير');
  const it = plan.projects.find((p) => p.id === 'p1');
  assert.ok(it, 'المشروع المكتوب بخطأ لم يُطابَق أصلاً');
  assert.equal(it.op, 'update');
  assert.equal(it.live_name, P1, 'الخطة تحمل اسم المنصة لا اسم الدفتر');
  assert.deepEqual(Object.keys(it.patch).sort(), ['end_date', 'rag'], 'الرقعة تحمل غير ما أضافه الدفتر');
  assert.ok(!('name_ar' in it.patch), 'الاسم لا يُكتب من الدفتر بحال');
  const m = plan.matches.projects.find((x) => x.live === P1);
  assert.ok(m.score >= 0.7 && m.rule === 'jaccard', `درجة المطابقة غير متوقَّعة: ${JSON.stringify(m)}`);
});

test('الأقفال ترفض قبل أي كتابة: بصمةٌ خاطئة، ونسخةٌ غائبة، وخطةٌ تحمل ختم فوترة', async () => {
  const good = sha(PLAN);
  const wrong = run('scripts/apply-workbook.mjs',
    [`--plan=${PLAN}`, '--apply', '--confirm=0000000000000000000000000000000000000000000000000000000000000000', `--backup=${BACKUP}`]);
  assert.equal(wrong.code, 2, 'بصمةٌ خاطئة لم تُردّ');
  assert.ok(wrong.out.includes('تغيّرت'), `الرسالة لا تقول إن الخطة تغيّرت: ${wrong.out}`);

  const noBackup = run('scripts/apply-workbook.mjs', [`--plan=${PLAN}`, '--apply', `--confirm=${good}`]);
  assert.equal(noBackup.code, 2, 'التنفيذ بلا نسخةٍ احتياطية لم يُردّ');
  assert.ok(noBackup.out.includes('نسخة احتياطية'), noBackup.out);

  const stamped = join(DIR, 'plan-stamped.json');
  const p = readPlan();
  p.deliverables.push({ op: 'update', id: 'dlv2', patch: { invoiced_at: '2026-05-03' } });
  writeFileSync(stamped, JSON.stringify(p));
  const refused = run('scripts/apply-workbook.mjs', [`--plan=${stamped}`, '--apply',
    `--confirm=${sha(stamped)}`, `--backup=${BACKUP}`]);
  assert.equal(refused.code, 2, 'خطةٌ تحمل ختم فوترة لم تُردّ');
  assert.ok(refused.out.includes('أختام فوترة'), refused.out);

  assert.deepEqual(await countAll(), before_, 'قفلٌ رُدّ عنده وقد كُتب شيء');
});

test('التطبيق يكتب ما في الخطة وحده — بحسابٍ إداريٍّ قائم', () => {
  const r = run('scripts/apply-workbook.mjs',
    [`--plan=${PLAN}`, '--apply', `--confirm=${sha(PLAN)}`, `--backup=${BACKUP}`, `--actor=${ACTOR}`]);
  assert.equal(r.code, 0, `التطبيق تعثّر:\n${r.out}`);
  assert.ok(r.out.includes('ما نُفِّذ فعلاً'), r.out);
  assert.ok(/أسطر التدقيق منذ بدء التشغيل: [1-9]/.test(r.out), 'لا أثرَ تدقيقٍ في المخرجات');
});

test('اسم المنصة بقي حرفاً بحرف، ولم يُولد مشروعٌ رابع', async () => {
  const p1 = await db.get('SELECT * FROM project WHERE id = ?', ['p1']);
  assert.equal(p1.name_ar, P1, 'اسم المشروع كُتب من الدفتر');
  assert.equal(p1.rag, 'AMBER', 'مؤشر الصحة لم يُصحَّح');
  assert.equal(p1.end_date, '2026-12-31', 'تاريخ النهاية لم يُصحَّح');
  assert.equal(await countOf('SELECT COUNT(*) AS "c" FROM project WHERE deleted_at IS NULL'), 3,
    'عدد المشاريع تغيّر — أُنشئ نظيرٌ لمشروعٍ قائم');
});

test('مخرجٌ اكتسب شهراً وسنة ⇒ سطرُ إيرادٍ بذلك الشهر وحده', async () => {
  const dlv = await db.get('SELECT * FROM deliverable WHERE id = ?', ['dlv1']);
  assert.equal(dlv.month, 6);
  assert.equal(dlv.year, 2026);
  const lines = await db.all('SELECT * FROM revenue_line WHERE deliverable_id = ?', ['dlv1']);
  assert.equal(lines.length, 1, 'سطرُ الإيراد ليس واحداً');
  assert.equal(lines[0].month, 6);
  assert.equal(lines[0].year, 2026);
  assert.equal(await countOf('SELECT COUNT(*) AS "c" FROM revenue_line'), 1,
    'كُتب إيرادٌ لمخرجٍ لم يُسلَّم');
});

test('«مفوتر؟ نعم» و«محصَّل؟ نعم» يُذكران ولا يُخترع لهما مستند', async () => {
  assert.equal(await countOf('SELECT COUNT(*) AS "c" FROM invoice'), 0, 'أُنشئت فاتورة');
  assert.equal(await countOf('SELECT COUNT(*) AS "c" FROM collection'), 0, 'أُنشئ تحصيل');
  const ro = readPlan().reported_only;
  const inv = ro.invoiced_without_date.find((x) => x.name === DLV_LIVE);
  assert.ok(inv, 'الصفُّ المفوتر لم يُذكر في «مفوتر بلا فاتورة»');
  assert.equal(inv.had_date, false, 'ذُكر وكأن له تاريخ فاتورة');
  assert.ok(ro.collected_without_invoice.some((x) => x.name === DLV_LIVE), 'المحصَّل لم يُذكر');
});

test('«المعلم» يصير مرحلةً يحملها المخرج — ولا معلَم يُكتب', async () => {
  const phases = await db.all('SELECT * FROM project_phase WHERE project_id = ? AND deleted_at IS NULL', ['p3']);
  assert.equal(phases.length, 1, 'عدد المراحل ليس واحدة');
  assert.equal(phases[0].name_ar, PHASE);
  const dlv = await db.get('SELECT * FROM deliverable WHERE name_ar = ? AND deleted_at IS NULL', [DLV_NEW]);
  assert.ok(dlv, 'المخرج الجديد لم يُكتب');
  assert.equal(dlv.phase_id, phases[0].id, 'المخرج لا يحمل مرحلته');
  assert.equal(await countOf('SELECT COUNT(*) AS "c" FROM milestone'), 0, 'كُتب معلَم');
});

test('بقايا صف المثال لا تُكتب: قيمة العقد وحالة المشروع كما في المنصة', async () => {
  const p2 = await db.get('SELECT * FROM project WHERE id = ?', ['p2']);
  assert.equal(p2.contract_value_halalas, 11500000, 'قيمة العقد صارت قيمة المثال');
  assert.equal(p2.status, 'ON_HOLD', 'حالة المشروع صارت حالة المثال');
  assert.equal(p2.pm_name, null, 'مدير المشروع كُتب من صف المثال');
  assert.equal(p2.budget_halalas, 900000, 'الميزانية صارت ميزانية المثال');
  assert.equal(p2.department_id, 'D_GOV', 'ما كتبه الفريق فعلاً لم يُطبَّق');
  const residue = readPlan().reported_only.example_residue.filter((x) => x.sheet === 'المشاريع');
  assert.ok(residue.some((x) => x.column === 'قيمة العقد بدون ضريبة'), 'البقايا لم تُذكر للفريق');
  assert.ok(residue.some((x) => x.column === 'مدير المشروع'));
});

test('التسكين يُكتب بسنة التشغيل وبالصفة المقابلة، والقائم منه يُذكر ولا يُعاد', async () => {
  const rows = await db.all('SELECT * FROM allocation WHERE deleted_at IS NULL ORDER BY created_at');
  assert.equal(rows.length, 2, 'عدد التسكينات غير متوقَّع');
  const fresh = rows.find((a) => a.project_id === 'p3');
  assert.ok(fresh, 'التسكين الجديد لم يُكتب');
  assert.equal(fresh.year, 2026, 'سنة التسكين ليست سنة التشغيل');
  assert.equal(fresh.type, 'pm', 'صفة التسكين لم تُردّ إلى قيمتها المخزَّنة');
  assert.equal(fresh.employee_id, 'e1');
  const already = readPlan().reported_only.allocations_already_live;
  assert.ok(already.some((x) => x.project === P1 && x.type === 'member'), 'التسكين القائم لم يُذكر');
  const emp = await db.get('SELECT * FROM employee WHERE id = ?', ['e1']);
  assert.equal(emp.job_title, 'استشاري أول', 'المسمى الوظيفي لم يُصحَّح');
});

test('إعادة الكشف بعد التطبيق: لا إضافة ولا تصحيح في أي مجموعة', async () => {
  const r = reconcile();
  assert.equal(r.code, 0, `الكشف الثاني لم ينتهِ نظيفاً:\n${r.out}`);
  const plan = readPlan();
  for (const g of ['clients', 'projects', 'phases', 'deliverables', 'employees', 'allocations']) {
    assert.deepEqual(plan[g], [], `${g}: الجولة الثانية تحمل عملاً — ${JSON.stringify(plan[g])}`);
  }
  assert.equal(plan.conflicts.length, 0, JSON.stringify(plan.conflicts));
  // ولا سطرَ إيرادٍ ثانياً للمخرج نفسه: الإيراد يُوائم نفسه ولا يتضاعف.
  assert.equal(await countOf('SELECT COUNT(*) AS "c" FROM revenue_line'), 1);
});
