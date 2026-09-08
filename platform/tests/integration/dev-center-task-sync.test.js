// «مركز التطوير» ⇄ المهام — الاتجاهان معاً، وحلقةُ الصدى تُقاس بالعدّ لا بالانتظار.
//
// الاعتماد يُولّد مهمةً حقيقية في المهام، ثم تعيش النسختان معاً: تُنجَز المهمة فيُغلق بلاغُها،
// ويُغلق البلاغ فتُنجَز مهمتُه، وتُلغى المهمة فيعود البلاغ إلى «معتمد»، ويُرفض البلاغ فتُلغى
// مهمتُه. وكلُّ قاعدةٍ منها تستدعي مقابلتَها — فلولا الحارسان لدارت الاثنتان بلا نهاية.
//
// ولذلك **يُعدّ صفوفُ الأثر بالضبط** بعد كل اتجاه: حلقةٌ تنشأ تُنتج صفَّين أو أربعة زائدة
// فيسقط الاختبار برقمٍ مختلف — لا بتعليقٍ لا ينتهي ولا بمهلةٍ تنقضي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dcsync-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, items, intake, products, tasks;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', sector_id: 'SOL' };
const ctx = (u = ADMIN) => ({ user: u, ip: '1.1.1.1' });
let PRODUCT, TENANT, VERSION, ITEM, TASK;

const itemRow = () => db.get('SELECT * FROM product_item WHERE id = ?', [ITEM]);
const taskRow = () => db.get('SELECT * FROM task WHERE id = ?', [TASK]);
const auditCount = async () => Number((await db.get('SELECT COUNT(*) AS n FROM audit_log')).n);

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  items = await import('../../src/modules/products/items.js');
  intake = await import('../../src/modules/products/intake.js');
  products = await import('../../src/modules/products/products.js');
  tasks = await import('../../src/modules/pmo/tasks.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', email: 'admin@evc.sa', role_id: 'admin', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_dev', username: 'dev', name_ar: 'مطوِّر المنتج', email: 'dev@evc.sa', role_id: 'employee', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('client', { id: 'CLI', name_ar: 'جهةٌ عميلة', created_at: T });
  await db.insert('project', { id: 'PRJ_PROD', name_ar: 'تطوير المنتج', client_id: 'CLI', sector_id: 'SOL', status: 'IN_PROGRESS', created_at: T });
  await db.insert('project', { id: 'PRJ_TENANT', name_ar: 'مشروع الجهة', client_id: 'CLI', sector_id: 'SOL', status: 'IN_PROGRESS', created_at: T });

  const p = await products.createProduct(ctx(), {
    key: 'mudun', name_ar: 'منصة المدن', kind: 'external', item_prefix: 'MDN',
    project_id: 'PRJ_PROD', manager_user_id: 'u_admin',
  });
  PRODUCT = p.id;
  await products.addMember(ctx(), PRODUCT, { user_id: 'u_dev', role: 'developer' });
  TENANT = (await products.createTenant(ctx(), PRODUCT, { name: 'أمانة الرياض', client_id: 'CLI', project_id: 'PRJ_TENANT' })).id;
  VERSION = (await products.createVersion(ctx(), PRODUCT, { label: 'v1.2', released_on: '2026-09-20' })).id;
});

after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('الاعتماد يُولّد مهمةً تحمل مفتاح البند وساعاته ومشروعَ جهته', async () => {
  const it = await intake.createManual(ctx(), PRODUCT, {
    type: 'bug', title: 'لا تُحفظ البيانات', description: 'تفصيل', sector_id: 'SOL',
    where_text: 'شاشة الحفظ', tenant_id: TENANT, reporter_name: 'موظف الجهة', urgency: 'blocks',
  });
  ITEM = it.id;
  await items.triageItem(ctx(), ITEM, { size: 'M', priority: 'high', est_hours: 6.5, dev_description: 'إصلاحُ الحفظ' });
  await items.setStatus(ctx(), ITEM, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(), ITEM, { assignee_user_id: 'u_dev' });

  const link = await db.get('SELECT * FROM product_item_task WHERE item_id = ?', [ITEM]);
  assert.ok(link, 'يُكتب جسرٌ بين البند ومهمته');
  TASK = link.task_id;
  const t = await taskRow();
  assert.ok(t, 'المهمة موجودة فعلاً في المهام');
  assert.ok(t.title.startsWith(it.item_key), 'عنوان المهمة يبدأ بمفتاح البند');
  assert.equal(Number(t.estimate_hours), 6.5, 'الساعات المقدَّرة تُنسخ إلى المهمة');
  assert.equal(t.assignee_user_id, 'u_dev');
  assert.equal(t.project_id, 'PRJ_TENANT', 'مشروعُ الجهة يسبق مشروع المنتج');
  assert.equal((await itemRow()).status, 'APPROVED');
});

test('المُسنَد إليه لا بدّ أن يكون من فريق المنتج', async () => {
  await db.insert('app_user', { id: 'u_out', username: 'out', name_ar: 'من خارج الفريق', role_id: 'employee', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  const it = await intake.createManual(ctx(), PRODUCT, { type: 'bug', title: 'بلاغٌ ثانٍ', where_text: 'شاشة المهام', sector_id: 'SOL', reporter_name: 'موظف' });
  await items.setStatus(ctx(), it.id, 'TRIAGED');
  await items.setStatus(ctx(), it.id, 'AWAITING_APPROVAL');
  await assert.rejects(() => items.approveItem(ctx(), it.id, { assignee_user_id: 'u_out' }), (e) => e.status === 400);
  await assert.rejects(() => items.approveItem(ctx(), it.id, {}), (e) => e.status === 400);
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [it.id])).status, 'AWAITING_APPROVAL');
});

test('المهمة تُنجَز ⇒ البلاغ يُحلّ — بصفَّي أثرٍ لا أكثر', async () => {
  const before = await auditCount();
  await tasks.updateTask(ctx(), TASK, { status: 'DONE' });
  const it = await itemRow();
  assert.equal(it.status, 'RESOLVED');
  assert.equal(it.resolved_version_id, VERSION, 'يُختم بأحدث إصدارات المنتج');
  assert.equal((await taskRow()).status, 'DONE');
  assert.equal(await auditCount() - before, 2, 'أثرٌ للمهمة وأثرٌ للبلاغ — ولا صدى');
});

test('المهمة تُلغى ⇒ البلاغ يعود «معتمداً» — بصفَّي أثرٍ لا أكثر', async () => {
  await items.setStatus(ctx(), ITEM, 'IN_PROGRESS');           // إعادةُ فتحٍ لا تمسّ المهمة
  assert.equal((await taskRow()).status, 'DONE');
  const before = await auditCount();
  await tasks.updateTask(ctx(), TASK, { status: 'CANCELLED' });
  assert.equal((await itemRow()).status, 'APPROVED');
  assert.equal(await auditCount() - before, 2, 'أثرٌ للمهمة وأثرٌ للبلاغ — ولا صدى');
});

test('البلاغ يُحلّ ⇒ المهمة تُنجَز — بصفَّي أثرٍ لا أكثر', async () => {
  const before = await auditCount();
  await items.setStatus(ctx(), ITEM, 'RESOLVED', { version_id: VERSION });
  assert.equal((await taskRow()).status, 'DONE');
  assert.equal((await itemRow()).status, 'RESOLVED');
  assert.equal(await auditCount() - before, 2, 'أثرٌ للبلاغ وأثرٌ للمهمة — ولا صدى');
});

test('البلاغ يُرفض ⇒ المهمة تُلغى — بصفَّي أثرٍ لا أكثر', async () => {
  await items.setStatus(ctx(), ITEM, 'IN_PROGRESS');
  const before = await auditCount();
  await items.setStatus(ctx(), ITEM, 'DECLINED', { reason: 'لن نُكمل فيه — سلوكٌ مقصود' });
  assert.equal((await taskRow()).status, 'CANCELLED');
  assert.equal((await itemRow()).status, 'DECLINED');
  assert.equal(await auditCount() - before, 2, 'أثرٌ للبلاغ وأثرٌ للمهمة — ولا صدى');
});

test('مهمةٌ لا بلاغَ لها لا يمسّها الخطّاف', async () => {
  const plain = await tasks.quickAddTask(ctx(), { title: 'مهمةٌ عادية بلا بلاغ', assignee_user_id: 'u_admin', utilization_pct: 10 });
  const before = await auditCount();
  await tasks.updateTask(ctx(), plain.id, { status: 'DONE' });
  assert.equal(await auditCount() - before, 1, 'أثرُ المهمة وحده');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM product_item_task WHERE task_id = ?', [plain.id])).n, 0);
});

test('المهلة الزمنية تحكي القصة كاملةً بأسماء فاعليها', async () => {
  const events = await db.all('SELECT * FROM product_item_event WHERE item_id = ? ORDER BY created_at', [ITEM]);
  assert.ok(events.length >= 6, 'سطرٌ لكل خطوة');
  assert.equal(events[0].kind, 'created');
  assert.ok(events.every((e) => e.actor_label), 'لكل سطرٍ اسمُ فاعلٍ يُقرأ');
  assert.ok(events.some((e) => e.kind === 'status' && e.to_status === 'APPROVED'));
  assert.ok(events.some((e) => e.kind === 'task'), 'ومزامنةُ المهمة تُكتب في المهلة أيضاً');
});

// ── من يُحرّك المهمة ليس بالضرورة من يملك قرار البلاغ ────────────────────────────────
// أثرُ المهمة على بلاغها تبعٌ لقرارٍ وقع في المهام لا قرارٌ جديد في مركز التطوير. فحجزُ
// المزامنة على «مديري المنتج» كان يُسقطها صامتةً في أكثر الحالات شيوعاً: مطوِّرٌ يُلغي مهمةَ
// نفسه، وقائدُ قطاعٍ يُنجز مهمةَ فريقه ولا عضويةَ له في المنتج.
test('المطوِّر يُلغي مهمةَ نفسه ⇒ بلاغُه يعود «معتمداً» وإن لم يكن مديرَ منتج', async () => {
  const it = await intake.createManual(ctx(), PRODUCT, { type: 'bug', title: 'بلاغُ المطوِّر', where_text: 'شاشة المهام', sector_id: 'SOL', reporter_name: 'موظف' });
  await items.setStatus(ctx(), it.id, 'TRIAGED');
  await items.setStatus(ctx(), it.id, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(), it.id, { assignee_user_id: 'u_dev' });
  await items.setStatus(ctx({ id: 'u_dev', username: 'dev', name_ar: 'مطوِّر المنتج', role_id: 'employee', scope: 'own', sector_id: 'SOL' }), it.id, 'IN_PROGRESS');
  const task = (await db.get('SELECT task_id FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [it.id])).task_id;
  const dev = { id: 'u_dev', username: 'dev', name_ar: 'مطوِّر المنتج', role_id: 'employee', scope: 'own', sector_id: 'SOL' };
  const before = await auditCount();
  await tasks.updateTask(ctx(dev), task, { status: 'CANCELLED' });
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [it.id])).status, 'APPROVED');
  assert.equal(await auditCount() - before, 2, 'أثرٌ للمهمة وأثرٌ للبلاغ — ولا صدى');
});

test('من ليس من فريق المنتج يُنجز المهمة ⇒ البلاغ يُحلّ', async () => {
  await db.insert('app_user', { id: 'u_lead', username: 'lead', name_ar: 'قائد القطاع', email: 'lead@evc.sa', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL', active: 1, created_at: T });
  const lead = { id: 'u_lead', username: 'lead', name_ar: 'قائد القطاع', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL' };
  const it = await intake.createManual(ctx(), PRODUCT, { type: 'bug', title: 'بلاغٌ يُنجزه غيرُ الفريق', where_text: 'شاشة المهام', sector_id: 'SOL', reporter_name: 'موظف' });
  await items.setStatus(ctx(), it.id, 'TRIAGED');
  await items.setStatus(ctx(), it.id, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(), it.id, { assignee_user_id: 'u_dev' });
  const task = (await db.get('SELECT task_id FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [it.id])).task_id;
  await assert.rejects(() => items.getItem(lead, it.id), (e) => e.status === 404, 'ولا يقرأ البلاغ من شاشته');
  const before = await auditCount();
  await tasks.updateTask(ctx(lead), task, { status: 'DONE' });
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [it.id])).status, 'RESOLVED');
  assert.equal(await auditCount() - before, 2, 'أثرٌ للمهمة وأثرٌ للبلاغ — ولا صدى');
});

// ── بلاغٌ يُرفض ثم يُعتمد ثانيةً: الجسرُ الحيّ واحد، والأحدثُ هو المقصود ──────────────────
test('إعادةُ الاعتماد بعد رفضٍ تُنشئ مهمةً ثانية، والقديمةُ الملغاة لا تُقلب إلى «منجزة»', async () => {
  const it = await intake.createManual(ctx(), PRODUCT, { type: 'bug', title: 'بلاغٌ رُفض ثم أُعيد', where_text: 'شاشة المهام', sector_id: 'SOL', reporter_name: 'موظف' });
  await items.setStatus(ctx(), it.id, 'TRIAGED');
  await items.setStatus(ctx(), it.id, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(), it.id, { assignee_user_id: 'u_dev' });
  const taskA = (await db.get('SELECT task_id FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [it.id])).task_id;

  await items.setStatus(ctx(), it.id, 'DECLINED', { reason: 'لن نُكمل فيه الآن' });
  assert.equal((await db.get('SELECT status FROM task WHERE id = ?', [taskA])).status, 'CANCELLED');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [it.id])).n, 0,
    'جسرُ المهمة الملغاة يُفَكّ مع الرفض');

  await items.setStatus(ctx(), it.id, 'NEW');
  await items.setStatus(ctx(), it.id, 'TRIAGED');
  await items.setStatus(ctx(), it.id, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(), it.id, { assignee_user_id: 'u_dev' });
  const live = await db.all('SELECT task_id FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [it.id]);
  assert.equal(live.length, 1, 'جسرٌ حيٌّ واحد لا اثنان');
  const taskB = live[0].task_id;
  assert.notEqual(taskB, taskA);

  await items.setStatus(ctx(), it.id, 'RESOLVED', { version_id: VERSION });
  assert.equal((await db.get('SELECT status FROM task WHERE id = ?', [taskB])).status, 'DONE', 'المهمة الحيّة هي التي تُنجَز');
  assert.equal((await db.get('SELECT status FROM task WHERE id = ?', [taskA])).status, 'CANCELLED', 'والملغاةُ تبقى ملغاة');
});

// ── مديرُ المنتج ليس مديراً في الشركة ────────────────────────────────────────────────────
// «مديرُ منتجٍ» صفٌّ في `product_member` لا دورٌ في مصفوفة الشركة: مستشارٌ يدير منتجاً يملك
// قرار الاعتماد والإغلاق كاملاً، ولا يملك في المهام إلا مهمةَ نفسه. فالبابان اللذان كانا
// يُسقطان قراره — إسنادُ مهمةٍ إلى غيره عند الاعتماد، وتحديثُ مهمةِ غيره عند الإغلاق — يُفتحان
// بهما هنا: الأول بكتابة المهمة بهوية من ستُسنَد إليه، والثاني بكتابة حال المهمة مباشرةً.
// وقبلهما كان البلاغ يُكتب «تم الحل» في معاملته ثم يُردّ الطلبُ ٤٠٣، فيبقى محلولاً ومهمتُه
// مفتوحةً في قائمة مطوِّرٍ إلى الأبد.
const PM = { id: 'u_pm', username: 'pm', name_ar: 'مديرة المنتج', role_id: 'consultant', scope: 'own', sector_id: 'SOL' };

test('مستشارٌ يدير المنتج: يعتمد ويُسنِد إلى زميلٍ بلا ٤٠٣ — والمهمة تُنسب إلى معتمِدها في الأثر', async () => {
  await db.insert('app_user', { id: 'u_pm', username: 'pm', name_ar: 'مديرة المنتج', email: 'pm@evc.sa', role_id: 'consultant', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_dev2', username: 'dev2', name_ar: 'مطوِّرٌ ثانٍ', email: 'dev2@evc.sa', role_id: 'employee', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await products.addMember(ctx(), PRODUCT, { user_id: 'u_pm', role: 'manager' });
  await products.addMember(ctx(), PRODUCT, { user_id: 'u_dev2', role: 'developer' });

  const it = await intake.createManual(ctx(), PRODUCT, { type: 'bug', title: 'بلاغٌ يعتمده مستشار', where_text: 'شاشة المهام', sector_id: 'SOL', reporter_name: 'موظف' });
  await items.setStatus(ctx(PM), it.id, 'TRIAGED');
  await items.setStatus(ctx(PM), it.id, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(PM), it.id, { assignee_user_id: 'u_dev2' });

  const link = await db.get('SELECT task_id FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [it.id]);
  assert.ok(link, 'الاعتماد وقع ومعه جسرُ مهمته');
  const t = await db.get('SELECT * FROM task WHERE id = ?', [link.task_id]);
  assert.equal(t.assignee_user_id, 'u_dev2', 'المهمة في قائمة من أُسنِدت إليه');
  assert.equal(t.approval_state, null, 'ومهمةُ بلاغٍ اعتُمد لا تنتظر اعتماداً ثانياً');
  const trace = await db.get(
    "SELECT * FROM audit_log WHERE resource = 'task' AND resource_id = ? AND action = 'create' AND user_id = 'u_pm'",
    [link.task_id]);
  assert.ok(trace, 'سطرُ أثرٍ باسم من اعتمد لا باسم من أُسنِدت إليه وحده');
  assert.match(trace.detail_json || '', /dev_center/);
  assert.match(trace.detail_json || '', /u_dev2/);
});

// ── KI-115: مديرٌ يعتمد بلاغاً يتولّاه بنفسه ─────────────────────────────────────────────────
// مهمةُ البلاغ تُكتب **بهوية من ستُسنَد إليه**، فحين يُسنِد المديرُ البلاغ إلى نفسه يصير كاتبُ
// المهمة هو صاحبَها — وقاعدةُ v5.84 «نسبة الإشغال مطلوبة على مهمتك» تُلقى داخل معاملة الاعتماد
// فيسقط الاعتمادُ كلُّه لا المهمةُ وحدها. والمهمةُ هنا تؤلّفها المنصة لا صاحبُها (لم يُسأل عن
// نسبةٍ أصلاً)، فتمرّ بـ`sizeOptional` ويقدّر نسبتَه من صفّها لاحقاً.
test('مديرُ المنتج يعتمد بلاغاً ويتولّاه بنفسه: الاعتماد يقع، والمهمة تُكتب بلا نسبة إشغال', async () => {
  const it = await intake.createManual(ctx(), PRODUCT, { type: 'bug', title: 'بلاغٌ يتولّاه مديره', where_text: 'شاشة المهام', sector_id: 'SOL', reporter_name: 'موظف' });
  await items.setStatus(ctx(PM), it.id, 'TRIAGED');
  await items.setStatus(ctx(PM), it.id, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(PM), it.id, { assignee_user_id: 'u_pm' });

  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [it.id])).status, 'APPROVED',
    'سقط الاعتماد كلُّه لأن مهمةَ المعتمِد نفسه طُلبت لها نسبةُ إشغال');
  const link = await db.get('SELECT task_id FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [it.id]);
  assert.ok(link, 'اعتمادٌ بلا مهمة — والاثنان لا ينفصلان');
  const t = await db.get('SELECT * FROM task WHERE id = ?', [link.task_id]);
  assert.equal(t.assignee_user_id, 'u_pm');
  assert.equal(t.utilization_pct, null, 'كُتبت نسبةٌ لم يقلها أحد');
});

test('ومستشارٌ يدير المنتج يُغلق بلاغاً مهمتُه لغيره ⇒ المهمة تُنجَز باسمه — بصفَّي أثرٍ لا أكثر', async () => {
  const it = await intake.createManual(ctx(), PRODUCT, { type: 'bug', title: 'بلاغٌ يُغلقه مستشار', where_text: 'شاشة المهام', sector_id: 'SOL', reporter_name: 'موظف' });
  await items.setStatus(ctx(), it.id, 'TRIAGED');
  await items.setStatus(ctx(), it.id, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(), it.id, { assignee_user_id: 'u_dev' });   // مديرُ النظام يعتمد ويُسنِد إلى غيره
  const task = (await db.get('SELECT task_id FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [it.id])).task_id;

  const before = await auditCount();
  await items.setStatus(ctx(PM), it.id, 'RESOLVED', { version_id: VERSION });
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [it.id])).status, 'RESOLVED');
  const t = await db.get('SELECT * FROM task WHERE id = ?', [task]);
  assert.equal(t.status, 'DONE', 'المهمة أُنجزت — لا ٤٠٣ يترك البلاغ محلولاً ومهمتَه مفتوحة');
  assert.equal(t.completed_by, 'u_pm', 'ختمُ الإنجاز يحمل من أغلق البلاغ');
  assert.ok(t.completed_at, 'وختمُ وقته');
  assert.equal(Number(t.progress_pct), 100, 'والنسبة تكتمل كما يكتبها محرِّر المهام');
  assert.equal(await auditCount() - before, 2, 'أثرٌ للبلاغ وأثرٌ للمهمة — ولا صدى');
});

test('ورفضُه يُلغي المهمة ويمحو ختمَ إنجازها', async () => {
  const it = await intake.createManual(ctx(), PRODUCT, { type: 'bug', title: 'بلاغٌ يرفضه مستشار', where_text: 'شاشة المهام', sector_id: 'SOL', reporter_name: 'موظف' });
  await items.setStatus(ctx(), it.id, 'TRIAGED');
  await items.setStatus(ctx(), it.id, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(), it.id, { assignee_user_id: 'u_dev' });
  const task = (await db.get('SELECT task_id FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL', [it.id])).task_id;
  await items.setStatus(ctx(PM), it.id, 'RESOLVED', { version_id: VERSION });
  await items.setStatus(ctx(PM), it.id, 'IN_PROGRESS');

  const before = await auditCount();
  await items.setStatus(ctx(PM), it.id, 'DECLINED', { reason: 'سلوكٌ مقصود لا عُطل' });
  const t = await db.get('SELECT * FROM task WHERE id = ?', [task]);
  assert.equal(t.status, 'CANCELLED');
  assert.equal(t.completed_at, null, 'ختمُ الإنجاز يُمحى مع الإلغاء');
  assert.equal(t.completed_by, null);
  assert.equal(await auditCount() - before, 2, 'أثرٌ للبلاغ وأثرٌ للمهمة — ولا صدى');
});

// ── ورايةُ «بلا وسم إصدار» لا تُرفع إلا من داخل الخادم ────────────────────────────────────
test('«تم الحل» بلا وسمٍ يُردّ ولو سُمّي المفتاح نصّاً في الخيارات', async () => {
  const it = await intake.createManual(ctx(), PRODUCT, { type: 'bug', title: 'بلاغٌ بلا وسم', where_text: 'شاشة المهام', sector_id: 'SOL', reporter_name: 'موظف' });
  await items.setStatus(ctx(), it.id, 'TRIAGED');
  await items.setStatus(ctx(), it.id, 'AWAITING_APPROVAL');
  await items.approveItem(ctx(), it.id, { assignee_user_id: 'u_dev' });
  await assert.rejects(
    () => items.setStatus(ctx(), it.id, 'RESOLVED', { allowNoVersion: true, silent: true }),
    (e) => e.status === 400, 'مفتاحٌ نصّيٌّ فتح باباً داخلياً');
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [it.id])).status, 'APPROVED');
  // وبالرمز يمرّ — الباب قائمٌ لمن ينادي من داخل الخادم.
  await items.setStatus(ctx(), it.id, 'RESOLVED', { [items.ALLOW_NO_VERSION]: true });
  assert.equal((await db.get('SELECT status FROM product_item WHERE id = ?', [it.id])).status, 'RESOLVED');
});
