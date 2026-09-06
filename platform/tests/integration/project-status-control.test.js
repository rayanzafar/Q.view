// ── حالة المشروع: ضابطٌ يُرى، ويُتَّخذ من القائمة (v5.73) ────────────────────────
//
// «حالة المشروع إلى الآن ما حطّيتوها — أغيّر حالة المشروع مكتمل ولا معلّق ولا قيد التشغيل»
// (قائدة قطاع الاستشارات، 2026-09-02). والضابط كان في ترويسة المشروع فعلاً واستعملته مرّتين
// في ٢٤ أغسطس — لكنه كان يُقرأ **وسماً**: حدٌّ شفاف وحشوةُ شارة وبلا عنوانٍ ولا سهم. ولم يكن
// في **قائمة** المشاريع موضعٌ لتغييرها أصلاً، وهي شاشةُ تنظيف المشاريع القديمة.
//
// ما تحرسه هذه الحارة:
//   ١) الترويسة تحمل عنوان «الحالة:» وقائمةً مُعلَّمة «غيّر حالة المشروع» لمن يملك التعديل،
//      وشارةً هادئة لمن يقرأ فقط — فلا يُرسَم ضابطٌ يردّه الخادم.
//   ٢) القائمة تحمل الضابط نفسه في خانة الحالة، **بحكم الصفّ** لا بحكم الشاشة.
//   ٣) مشروعُ الترحيل (بلا مالك ولا إدارة، مكتمل، أنشأته الترحيلة) يُفتح لقائد قطاعه —
//      وهي الحالة التي يُنظَّف فيها القديم فعلاً؛ فشلُها يعني عطباً في حكم الصفّ لا رخصةً
//      في توسيع الصلاحية.
//   ٤) خيارات القائمة خمسٌ بالضبط بأسمائها العربية من قاموس العرض.
//   ٥) لا تسريب تقني ولا جرجون في أيٍّ من الشاشتين لأيٍّ من الأدوار.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-prjstatus-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, P, rbac, tr, BANNED;
const T = '2026-01-05T00:00:00Z';
const U = (id, role, scope, projects = []) => ({
  id, username: id, name_ar: 'مستخدم ' + id, role_id: role, scope, sector_id: 'CONS',
  projectIds: new Set(projects), teamIds: new Set(), departmentIds: new Set(),
  opportunityIds: new Set(), departmentGrants: [], managedDepartmentIds: new Set(),
});
const LEAD = U('u_lead', 'sector_lead', 'sector');
const CONS = U('u_cons', 'consultant', 'own', ['PRJ_LEGACY', 'PRJ_LIVE']);
const EMP = U('u_emp', 'employee', 'own', ['PRJ_LIVE']);
// مديرةُ إدارةٍ **مشارِكة** في المشروع لا مسؤولةٍ عنه (ADR-0008): الخادم يقبل كتابتها بالباب
// ذي الدرجتين، فيجب أن تراها القائمةُ ضابطاً لا شارةً — وإلا عُرض لها ما تملكه جامداً.
const DM = { ...U('u_dm', 'department_manager', 'department'), department_id: 'D2', departmentIds: new Set(['D2']) };

before(async () => {
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  P = await import('../../src/web/pages.js');
  ({ tr } = await import('../../src/web/layout.js'));
  ({ BANNED_UI_TERMS: BANNED } = await import('../../src/web/i18n/glossary.js'));

  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', color: '#244A99',
    active: 1, sort_order: 1, created_at: T });
  await db.insert('department', { id: 'D1', sector_id: 'CONS', name_ar: 'إدارة الاستشارات', active: 1, created_at: T });
  await db.insert('department', { id: 'D2', sector_id: 'CONS', name_ar: 'إدارة الحلول', active: 1, created_at: T });
  await db.insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  for (const u of [LEAD, CONS, EMP, DM]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      scope: u.scope, sector_id: 'CONS', active: 1, created_at: T });
  }
  await db.run('UPDATE sector SET lead_user_id = ? WHERE id = ?', ['u_lead', 'CONS']);

  // مشروع الترحيل حرفاً: بلا مالك، بلا إدارة، مكتمل، أنشأته الترحيلة لا شخص.
  await db.insert('project', { id: 'PRJ_LEGACY', code: 'OLD-1', name_ar: 'برنامج قديم مُرحَّل',
    sector_id: 'CONS', client_id: 'C1', owner_user_id: null, department_id: null,
    status: 'COMPLETED', rag: 'GREEN', progress_pct: 0, start_date: '2023-02-01', end_date: '2023-11-30',
    created_at: T, created_by: 'migration' });
  // ومشروعٌ قائم بمالكه وإدارته — به يُقاس الوجه الآخر.
  await db.insert('project', { id: 'PRJ_LIVE', code: 'PRJ-2', name_ar: 'برنامج التحول',
    sector_id: 'CONS', client_id: 'C1', owner_user_id: 'u_lead', department_id: 'D1',
    status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 40, contract_value_halalas: 50000000,
    start_date: '2026-01-01', end_date: '2026-12-31', created_at: T });
  // إدارةٌ مشارِكة على المشروع القائم — لا مسؤولةٌ عنه.
  await db.insert('project_department', { project_id: 'PRJ_LIVE', department_id: 'D2', created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const SEL = 'data-action-change="prj-status-sel"';
// خانةُ الحالة في صفّ الجدول: من `data-label="الحالة"` إلى نهاية الخانة.
const statusCellOf = (html, projectId) => {
  const row = html.split('<tr ').find((r) => r.includes(`data-id="${projectId}"`)) || '';
  const cell = row.split('data-label="الحالة"')[1] || '';
  return cell.split('</td>')[0] || '';
};
const optionsOf = (fragment) => [...fragment.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)]
  .map((m) => [m[1], m[2]]);

test('ترويسة المشروع: عنوان «الحالة:» وقائمةٌ مُعلَّمة لقائد القطاع', async () => {
  const html = await P.projectDetailPage(LEAD, 'PRJ_LEGACY');
  assert.ok(html.includes('<span class="prj-st-lbl">الحالة:</span>'), 'العنوان «الحالة:» غائب عن الترويسة');
  assert.ok(html.includes(SEL), 'قائمة الحالة غائبة عن ترويسة من يملك التعديل');
  assert.ok(html.includes('aria-label="غيّر حالة المشروع"'), 'القائمة بلا تسمية تقول ما تفعل');
  assert.ok(html.includes('title="غيّر حالة المشروع —'), 'العنوان التوضيحي لا يبدأ بالفعل نفسه');
  assert.ok(html.includes('class="prj-st-c" aria-hidden="true">▾<'), 'لا سهمَ يقول إن القائمة تُفتح');
  assert.ok(html.includes('border:1px solid var(--_stl)'), 'الحدّ ما زال شفافاً — تُقرأ شارةً لا قائمة');
  assert.ok(html.includes('data-id="PRJ_LEGACY"') && html.includes('data-prev="COMPLETED"'),
    'القائمة لا تحمل المشروع ولا حالته السابقة');
});

test('ترويسة المشروع: شارةٌ هادئة للاستشاري — ولا قائمةَ تُرسَم ثم تُرَدّ', async () => {
  const html = await P.projectDetailPage(CONS, 'PRJ_LEGACY');
  assert.ok(!html.includes(SEL), 'قائمة الحالة ظهرت لمن لا يملك التعديل');
  assert.ok(html.includes('<span class="prj-st-lbl">الحالة:</span>'), 'الاسم اختفى مع الضابط — والقارئ يحتاجه');
  assert.ok(html.includes(`>${tr('COMPLETED')}<`), 'الحالة نفسها لا تُقرأ في شارة القارئ');
});

test('قائمة المشاريع: الضابط في خانة الحالة على مشروع الترحيل لقائد القطاع', async () => {
  // البوابةُ الصفّية أولاً — لو رُدَّ الصفّ فالعطب في حكم الصلاحية لا في الشاشة.
  const legacy = await db.get('SELECT * FROM project WHERE id = ?', ['PRJ_LEGACY']);
  assert.equal(legacy.owner_user_id, null, 'المشروع المُرحَّل يجب أن يكون بلا مالك');
  assert.equal(legacy.department_id, null, 'المشروع المُرحَّل يجب أن يكون بلا إدارة');
  assert.ok(rbac.can(LEAD, 'update', 'project', legacy),
    'قائد القطاع لا يملك تعديل مشروع قطاعه المُرحَّل — الحكم قطاعي، فراجع scopeReaches لا الشاشة');

  const html = await P.projectsPage(LEAD, {});
  const cell = statusCellOf(html, 'PRJ_LEGACY');
  assert.ok(cell.includes(SEL), 'خانة الحالة ما زالت شارةً جامدة في القائمة');
  assert.ok(cell.includes('data-list="1"'), 'الضابط لا يُعلن أنه داخل قائمة — فلا تحديث في مكانه');
  assert.ok(cell.includes('data-id="PRJ_LEGACY"'), 'الضابط بلا مشروعه');
  assert.ok(cell.includes('data-prev="COMPLETED"'), 'الضابط بلا حالته السابقة — فلا استرجاع عند الرفض');
  assert.ok(html.includes('data-status-count="COMPLETED"'), 'عدّاد الشريحة بلا وسمٍ يُحرَّك به');
});

test('قائمة المشاريع: الموظف صاحب النطاق الخاص يرى شارةً لا قائمة', async () => {
  const html = await P.projectsPage(EMP, {});
  assert.ok(html.includes('برنامج التحول'), 'الموظف لا يرى مشروعه أصلاً — تغيّر نطاق القراءة');
  assert.ok(!html.includes(SEL), 'ضابط الحالة ظهر لموظفٍ لا يملك تعديل المشروع');
  const cell = statusCellOf(html, 'PRJ_LIVE');
  assert.ok(cell.includes(tr('IN_PROGRESS')), 'الحالة لا تُقرأ في خانة القارئ');
});

test('القائمة تتبع حكم الخادم: مديرةُ إدارةٍ مشارِكة ترى الضابط لا الشارة', async () => {
  const live = await db.get('SELECT * FROM project WHERE id = ?', ['PRJ_LIVE']);
  assert.equal(live.department_id, 'D1', 'المشروع يجب أن تكون إدارتُه المسؤولة غير إدارة المديرة');
  assert.equal(rbac.can(DM, 'update', 'project', { ...live, project_id: live.id }), false,
    'الصفُّ الخام يمرّ بلا مشاركة — الفحص يقيس شيئاً آخر');
  const { projectActionAllowed } = await import('../../src/modules/pmo/project-access.js');
  assert.equal(await projectActionAllowed(DM, 'update', live), true,
    'الخادم يردّ كتابة المديرة المشارِكة — العطب في الباب لا في الشاشة');

  const html = await P.projectsPage(DM, {});
  assert.ok(html.includes('برنامج التحول'), 'المشروع المشترك لا يظهر في قائمتها أصلاً');
  const cell = statusCellOf(html, 'PRJ_LIVE');
  assert.ok(cell.includes(SEL), 'خانة الحالة شارةٌ جامدة لمن يقبل الخادمُ كتابتَها');
  const head = await P.projectDetailPage(DM, 'PRJ_LIVE');
  assert.ok(head.includes(SEL), 'الترويسة والقائمة تختلفان في الحكم على الصفّ نفسه');
});

test('كل قائمةٍ في القائمة تقول مشروعها لقارئ الشاشة', async () => {
  const html = await P.projectsPage(LEAD, {});
  const names = [...html.matchAll(/aria-label="غيّر حالة المشروع([^"]*)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 2, 'لا قوائم حالةٍ في الشاشة — الفحص يقيس فراغاً');
  assert.equal(new Set(names).size, names.length, 'تسميةٌ واحدة مكرّرة على كل صفّ — لا يُعرف أيُّ مشروعٍ يُغلق');
  assert.ok(names.every((n) => n.includes('«')), 'التسمية بلا اسم المشروع');
});

test('خيارات الحالة خمسٌ بالضبط بأسمائها العربية', async () => {
  const html = await P.projectsPage(LEAD, {});
  const cell = statusCellOf(html, 'PRJ_LEGACY');
  const opts = optionsOf(cell);
  assert.deepEqual(opts.map((o) => o[0]),
    ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'], 'قائمة الحالات ليست الخمس المعتمدة');
  assert.deepEqual(opts.map((o) => o[1]),
    ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((s) => tr(s)),
    'أسماء الحالات ليست من قاموس العرض');
  assert.equal(opts.filter((o) => cell.includes(`value="${o[0]}" selected`)).length, 1, 'لا حالةَ مختارة — أو أكثر من واحدة');
});

test('لا تسريب تقني ولا جرجون في الشاشتين لكل دور', async () => {
  const pages = [
    ['قائمة المشاريع · قائد القطاع', await P.projectsPage(LEAD, {})],
    ['قائمة المشاريع · موظف', await P.projectsPage(EMP, {})],
    ['صفحة المشروع · قائد القطاع', await P.projectDetailPage(LEAD, 'PRJ_LEGACY')],
    ['صفحة المشروع · استشاري', await P.projectDetailPage(CONS, 'PRJ_LEGACY')],
  ];
  // النص المرئي وحده: الوسوم والنصوص البرمجية والأنماط ليست مما يقرأه المستخدم.
  const visible = (html) => html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (const [name, html] of pages) {
    const txt = visible(html);
    for (const bad of ['undefined', 'NaN', '[object']) {
      assert.ok(!txt.includes(bad), `«${bad}» ظاهر للمستخدم في ${name}`);
    }
    assert.ok(!/(?<![A-Za-z])null(?![A-Za-z])/.test(txt), `«لا قيمة» تقنية ظاهرة في ${name}`);
    for (const term of BANNED) {
      if (['null', 'undefined', 'NaN', '[object'].includes(term)) continue;
      const rx = new RegExp(`(?<![A-Za-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i');
      assert.ok(!rx.test(txt), `مصطلح ممنوع «${term}» ظاهر في ${name}`);
    }
  }
});
