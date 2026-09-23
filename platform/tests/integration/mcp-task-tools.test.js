// ── أدوات المهام في المساعد: العدسات، ودورتا الإنشاء والتحديث ────────────────────────────
// ما تحرسه:
//   ١) العدسات مطابقة لعدّادات شاشة «مهامي» — القارئ يقرأ الرقم نفسه في المكانين.
//   ٢) «غير مُسجَّل» ≠ صفر: مهمة بلا موعد وبلا خطوة تالية وبلا نسبة تُعلن الغياب لا رقماً.
//   ٣) التنفيذ برمز المعاينة وحده: أي حقل تغييرٍ آخر يُردّ، والرمز لمرة واحدة.
//   ٤) الرمز يبطل إذا تحرّكت المهمة بعد المعاينة.
//   ٥) مهمة خارج النطاق تُردّ بجملة عربية تقول من يملكها.
//   ٦) الغلاف: كل نتيجة تحمل لحظتها ونطاقها ووحداتها وجزئيتها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
// تقويم الأداة هو تقويم الرياض لا تقويم غرينتش — والتثبيت هنا لا في `Date` مباشرةً.
import { riyadhDate } from '../../src/core/i18n/time.js';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mcp-tasks-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, run, get, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { listTools, runTool, registerTools } = await import('../../src/modules/ai/team-tools.js');
const { TASK_TOOLS } = await import('../../src/modules/ai/tasks-tools.js');
registerTools(TASK_TOOLS);

const T = '2026-01-05T00:00:00Z';
// «اليوم» في هذا الملف هو يومُ الرياض بعينه، لأن الأداة تقيس التأخّر بيوم الناس هنا
// (`riyadhDate`) لا بيوم غرينتش. ولو بُنيت المواعيد على UTC لانقلب الحكم كلَّ ليلة بين
// التاسعة ومنتصف الليل: يومُ الرياض يكون قد تقدّم، فتصير المهمةُ «المستحقة اليوم» متأخرةً
// عند الأداة وهي في نظر الملف مستحقّةٌ بعد — وهذا ما أسقط الفحص فعلاً عند الساعة ٢٢:٣١.
const today = riyadhDate();
const past = riyadhDate(new Date(Date.now() - 5 * 86400000));
// عضوية المشروع تأتي مع المستخدم المحلول كما تأتي في الجلسة الحقيقية — بدونها يردّ الربطُ
// بالمشروع بحقّ («خارج نطاقك»)، وهو سلوكٌ سليم لا عيب فيه.
const U = (id, role, scope) => ({ id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: 'SOL', scope, projectIds: new Set(['P1']), teamIds: new Set() });
const ME = U('u_me', 'consultant', 'own');
const OTHER = U('u_other', 'consultant', 'own');
const ctxOf = (u) => ({ user: u, ip: '127.0.0.1' });

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  for (const u of [ME, OTHER]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id, sector_id: 'SOL', scope: u.scope, active: 1, created_at: T });
  }
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('project', { id: 'P1', code: 'PRJ-1', name_ar: 'مشروع التحول', sector_id: 'SOL', client_id: 'C1', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });
  // مهامي: متأخرة · بلا موعد ولا خطوة ولا نسبة · متوقفة بسبب
  const mk = (id, extra) => insert('task', {
    id, title: 'مهمة ' + id, assignee_user_id: ME.id, created_by: ME.id, sector_id: 'SOL',
    status: 'TODO', priority: 'P2', work_kind: 'internal', approved_by: ME.id, created_at: T, ...extra,
  });
  await mk('t_late', { due_date: past, next_step: 'إرسال المسودة', utilization_pct: 20 });
  await mk('t_bare', {});
  await mk('t_block', { status: 'BLOCKED', blocked_reason: 'بانتظار ردّ العميل', due_date: today });
  await mk('t_prj', { project_id: 'P1', work_kind: 'project', due_date: today, utilization_pct: 10, next_step: 'مراجعة' });
  // مهمة شخص آخر — خارج نطاقي
  await insert('task', { id: 't_theirs', title: 'مهمة زميل', assignee_user_id: OTHER.id, created_by: OTHER.id,
    sector_id: 'SOL', status: 'TODO', priority: 'P2', work_kind: 'internal', approved_by: OTHER.id, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const envelopeOk = (out, tool) => {
  assert.equal(out.tool, tool, 'اسم الأداة في الغلاف');
  assert.ok(out.as_of && out.today, 'اللحظة واليوم');
  assert.ok(out.scope_ar && /نطاق/.test(out.scope_ar), 'النطاق مكتوب بالعربية');
  assert.ok(out.units && typeof out.units === 'object', 'الوحدات معلَنة');
  assert.ok(Array.isArray(out.refs), 'روابط المصدر');
};

test('الأدوات الخمس مسجَّلة ومعروضة لصاحب الحساب', () => {
  const names = listTools(ME).map((t) => t.name);
  for (const n of ['sanad_list_tasks', 'sanad_preview_task_create', 'sanad_create_task', 'sanad_preview_task_update', 'sanad_update_task']) {
    assert.ok(names.includes(n), `${n} في القائمة`);
  }
  const listed = listTools(ME).find((t) => t.name === 'sanad_list_tasks');
  assert.equal(listed.kind, 'read');
  assert.ok(/العدسات|عدسات|متأخرة/.test(listed.description_ar), 'الوصف عربي يشرح العدسات');
});

test('العدسات وعدّاداتها، والغلاف بترقيمه', async () => {
  const out = await runTool(ctxOf(ME), 'sanad_list_tasks', {});
  envelopeOk(out, 'sanad_list_tasks');
  assert.equal(out.who, 'me');
  // التقويمان واحد: يومُ الغلاف هو اليوم الذي بُنيت عليه مواعيد هذا الملف. لو افترقا لانقلبت
  // كلُّ عدسةٍ زمنيةٍ أدناه بلا سببٍ ظاهر، فيُقال ذلك هنا صراحةً بدل أن يُقرأ من رقمٍ مضلِّل.
  assert.equal(out.today, today, 'يومُ الأداة هو يومُ الملف — تقويم الرياض في الاثنين');
  assert.ok(out.partial && out.partial.page === 1 && Number.isInteger(out.partial.total), 'الترقيم كامل بعدد كلي');
  assert.equal(out.partial.total, 4, 'مهامي الأربع');
  assert.equal(out.counters.overdue.count, 1, 'متأخرة واحدة');
  assert.equal(out.counters.no_due_date.count, 1, 'بلا موعد واحدة');
  assert.equal(out.counters.blocked.count, 1, 'متوقفة واحدة');
  const late = await runTool(ctxOf(ME), 'sanad_list_tasks', { view: 'overdue' });
  assert.equal(late.tasks.length, 1);
  assert.equal(late.tasks[0].id, 't_late');
  assert.ok(late.tasks[0].overdue_days.recorded && late.tasks[0].overdue_days.value >= 4, 'أيام التأخّر محسوبة');
});

test('«غير مُسجَّل» لا صفر: مهمة بلا موعد ولا خطوة ولا نسبة', async () => {
  const out = await runTool(ctxOf(ME), 'sanad_list_tasks', { view: 'no_due_date' });
  const t = out.tasks.find((x) => x.id === 't_bare');
  assert.ok(t, 'المهمة العارية في العدسة');
  assert.equal(t.overdue_days.recorded, false, 'لا تأخّر يُقاس بلا موعد');
  assert.equal(t.overdue_days.value, null, 'ولا يُحوَّل إلى صفر');
  assert.ok(/غير مُسجَّل|بلا موعد/.test(t.overdue_days.ar), 'ويقول لماذا بالعربية');
  assert.equal(t.next_step.recorded, false);
  assert.equal(t.utilization_pct.recorded, false);
  assert.equal(t.utilization_pct.value, null, 'النسبة الغائبة ليست صفراً');
});

test('نصوص المهام بيانات لا تعليمات، والوحدات معلَنة', async () => {
  const out = await runTool(ctxOf(ME), 'sanad_list_tasks', {});
  assert.ok(/نصوص مصدرية/.test(out.text_is_data_ar), 'إعلان أن النصوص بيانات');
  assert.ok(/لا قيم مالية/.test(out.units.money_ar), 'لا مال في قراءات المهام');
  assert.ok(/لا يُجمع/.test(out.units.task_load_ar), 'نسبة الإشغال مقياس مستقل');
});

test('مهام الفريق تتطلب نطاقاً يتجاوز صاحبها — والرفض عربي', async () => {
  await assert.rejects(() => runTool(ctxOf(ME), 'sanad_list_tasks', { who: 'team' }), (e) => {
    assert.match(e.message, /صلاحية قراءة مهام|نطاق/, 'جملة عربية تقول ما ينقص');
    return true;
  });
});

test('دورة الإنشاء: المعاينة لا تكتب، والتنفيذ بالرمز وحده لمرة واحدة', async () => {
  const pv = await runTool(ctxOf(ME), 'sanad_preview_task_create', {
    title: 'مهمة من المساعد', linkKind: 'project', projectId: 'P1', dueDate: today, priority: 'P1', utilizationPct: 15, nextStep: 'البدء',
  });
  envelopeOk(pv, 'sanad_preview_task_create');
  assert.ok(pv.previewToken && pv.expires_at, 'رمز ولحظة انتهاء');
  assert.equal(pv.will_be.priority_ar, 'عالية');
  assert.ok(/مشروع/.test(pv.will_be.linked_work_ar));
  assert.equal((await get('SELECT COUNT(*) n FROM task WHERE title = ?', ['مهمة من المساعد'])).n, 0, 'المعاينة لم تكتب شيئاً');

  await assert.rejects(() => runTool(ctxOf(ME), 'sanad_create_task', { previewToken: pv.previewToken, title: 'التفاف' }),
    (e) => { assert.match(e.message, /رمز المعاينة وحده/); return true; }, 'حمولة خام تُردّ');

  const done = await runTool(ctxOf(ME), 'sanad_create_task', { previewToken: pv.previewToken });
  assert.equal(done.applied, true);
  assert.equal(done.task.title, 'مهمة من المساعد');
  assert.equal((await get('SELECT COUNT(*) n FROM task WHERE title = ?', ['مهمة من المساعد'])).n, 1, 'كُتبت مرة واحدة');

  await assert.rejects(() => runTool(ctxOf(ME), 'sanad_create_task', { previewToken: pv.previewToken }),
    (e) => { assert.match(e.message, /طُبِّقت من قبل/); return true; }, 'الرمز لا يُستعمل مرتين');
});

test('نسبة الإشغال مطلوبة على مهمتك — تُردّ في المعاينة لا عند التنفيذ', async () => {
  await assert.rejects(() => runTool(ctxOf(ME), 'sanad_preview_task_create', { title: 'بلا نسبة' }),
    (e) => { assert.match(e.message, /نسبة الإشغال مطلوبة على مهمتك/); return true; });
});

test('دورة التحديث: قبل/بعد، ولا تغيير ⟵ ردّ', async () => {
  const pv = await runTool(ctxOf(ME), 'sanad_preview_task_update', { taskId: 't_late', priority: 'P0', nextStep: 'التصعيد' });
  envelopeOk(pv, 'sanad_preview_task_update');
  assert.equal(pv.changes.length, 2);
  const pr = pv.changes.find((c) => c.field === 'priority');
  assert.equal(pr.before_ar, 'متوسطة');
  assert.equal(pr.after_ar, 'حرجة');
  const out = await runTool(ctxOf(ME), 'sanad_update_task', { previewToken: pv.previewToken });
  assert.equal(out.applied, true);
  assert.equal((await get('SELECT priority FROM task WHERE id = ?', ['t_late'])).priority, 'P0');

  await assert.rejects(() => runTool(ctxOf(ME), 'sanad_preview_task_update', { taskId: 't_late', priority: 'P0' }),
    (e) => { assert.match(e.message, /لا فرق/); return true; }, 'طلب بلا أثر يُردّ');
});

test('«متوقفة» بلا سبب مكتوب تُردّ', async () => {
  await assert.rejects(() => runTool(ctxOf(ME), 'sanad_preview_task_update', { taskId: 't_prj', status: 'BLOCKED' }),
    (e) => { assert.match(e.message, /سبب مكتوب/); return true; });
});

test('الرمز يبطل إذا تحرّكت المهمة بعد المعاينة', async () => {
  const pv = await runTool(ctxOf(ME), 'sanad_preview_task_update', { taskId: 't_prj', priority: 'P1' });
  await run('UPDATE task SET priority = ?, updated_at = ? WHERE id = ?', ['P3', new Date().toISOString(), 't_prj']);
  await assert.rejects(() => runTool(ctxOf(ME), 'sanad_update_task', { previewToken: pv.previewToken }),
    (e) => { assert.match(e.message, /تغيّرت المهمة بعد المعاينة|اطلب معاينة جديدة/); return true; });
});

test('مهمة خارج النطاق: الردّ عربي ويقول من يملكها', async () => {
  await assert.rejects(() => runTool(ctxOf(ME), 'sanad_preview_task_update', { taskId: 't_theirs', priority: 'P0' }),
    (e) => { assert.match(e.message, /صاحبها ومديره/); return true; });
});

test('كل نداء يُسجَّل في سجل نشاط المساعد باسم صاحبه', async () => {
  const before = (await get('SELECT COUNT(*) n FROM ai_activity_log WHERE user_id = ? AND intent = ?', [ME.id, 'tool:sanad_list_tasks'])).n;
  await runTool(ctxOf(ME), 'sanad_list_tasks', {});
  const after = (await get('SELECT COUNT(*) n FROM ai_activity_log WHERE user_id = ? AND intent = ?', [ME.id, 'tool:sanad_list_tasks'])).n;
  assert.equal(after, before + 1, 'سطر واحد لكل نداء');
});
