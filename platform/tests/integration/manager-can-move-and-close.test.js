// عطلان بلسان المالك، وكلاهما «الباب موجود لكنه لا يُفتح»:
//
// ١) «أنا كمدير إدارة مو عارف أنقل الفرصة من إدارة إلى إدارة» — والنقل كان **ينجح ويُكتب في
//    القاعدة** ثم تُقرأ الفرصة قراءةً أخيرة لإرجاعها للشاشة، فتُردّ القراءة لأنها صارت في
//    إدارةٍ ليست له، فتظهر رسالة «صلاحيتك لا تسمح بهذا الإجراء» على عملٍ تمّ فعلاً. وهذا أسوأ
//    من المنع الصريح: يعيد المحاولة فيُخبَر بالمنع ثانيةً، ويظنّ الباب مغلقاً وهو مفتوح —
//    وقد تكون الفرصة انتقلت مرتين وهو يحسبها لم تنتقل مرة.
//
// ٢) «لازم أقدر أحطّ إنّ هذا المشروع تمّ الانتهاء منه ويصير يبيّن إنه أُغلق» — الحالات الخمس
//    موجودة منذ أول إصدار (أعمدة اللوحة مبنيّة عليها والخدمة تقبلها وتدقّقها) ولم يكن في
//    الواجهة موضعٌ واحد يكتبها. فالمشروع يُولَد «قيد التنفيذ» ويبقى كذلك مهما انتهى.
//
// وشرطٌ ثالث ذكره المالك صراحةً ويجب ألّا ينكسر: «حتى لو صرفنا كل المخرجات بس هو قائم برضو
// ممكن» — فاكتمال المخرجات لا يُغلق المشروع تلقائياً أبداً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mgr-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, rbac, opps, projects, P, depts;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
let DM; // مدير إدارة الابتكار — يقود إدارةً واحدة ولا ينتمي إلى غيرها

before(async () => {
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  projects = await import('../../src/modules/pmo/projects.js');
  depts = await import('../../src/core/rbac/departments.js');
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_dm', username: 'dm', name_ar: 'مدير إدارة الابتكار', role_id: 'department_manager', scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء الاصطناعي', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });

  // يُبنى كما يبنيه المنتج عند حلّ الجلسة (core/http/context.js) لا يدوياً.
  DM = {
    id: 'u_dm', username: 'dm', name_ar: 'مدير إدارة الابتكار', role_id: 'department_manager',
    scope: 'department', sector_id: 'SOL', department_id: null,
    departmentIds: await depts.readerDepartmentIds('u_dm', null),
  };
});

after(() => rmSync(dir, { recursive: true, force: true }));

const mkOpp = async (dept) => {
  const oid = 'O_' + Math.random().toString(36).slice(2, 9);
  await db.insert('opportunity', { id: oid, title_ar: 'فرصة الإدارة', sector_id: 'SOL', department_id: dept,
    stage_id: 'PROPOSAL', value_halalas: 100000, owner_user_id: 'u_admin', created_at: T });
  return oid;
};

// ── ١ · مدير الإدارة ينقل فرصته ──────────────────────────────────────────────
test('مدير الإدارة يفتح فرصة إدارته ويرى شريط التحكم', async () => {
  const oid = await mkOpp('D_INNO');
  const html = await P.opportunityDetailPage(DM, oid);
  assert.ok(html.includes('التحكم بالفرصة'), 'مدير الإدارة لا يرى شريط التحكم على فرصة إدارته');
  assert.ok(html.includes('إدارة الذكاء الاصطناعي'), 'وجهة النقل غائبة عن قائمته');
});

// العطل الأصلي: النقل ينجح ثم يُرمى خطأٌ فيظنّه المالك فشل.
test('وينقلها إلى إدارة أخرى بلا رسالة منعٍ كاذبة — والنقل يُكتب فعلاً', async () => {
  const oid = await mkOpp('D_INNO');
  const res = await opps.updateOpportunity({ user: DM, ip: '1' }, oid, { department_id: 'D_AI' });
  const row = await db.get('SELECT department_id FROM opportunity WHERE id = ?', [oid]);
  assert.equal(row.department_id, 'D_AI', 'النقل لم يُكتب');
  assert.ok(res && res.ok, 'لم يُعَد تأكيدٌ للناقل');
  assert.equal(res.movedOutOfReach, true,
    'الردّ لا يقول إن الفرصة غادرت نطاقه — فتُعاد الشاشة إلى صفحةٍ يردّها النظام');
  assert.equal(res.department_id, 'D_AI');
});

// والحدّ محفوظ: لا يفتح ما ليس له أصلاً.
test('ولا يمسّ فرصةً في إدارةٍ ليست له', async () => {
  const oid = await mkOpp('D_AI');
  await assert.rejects(() => opps.updateOpportunity({ user: DM, ip: '1' }, oid, { department_id: 'D_INNO' }),
    (e) => /صلاحيت/.test(e.message), 'نقل فرصةً من إدارةٍ لا يقودها');
});

// نفس الفخّ على المحور الآخر — القطاع. كان الحارس يغطّيه وحده، فتغطيتُه الآن دليلٌ على أن
// التعميم لم يكسر ما كان يعمل: الفحص صار على الصفّ بعد التعديل أياً كان الحقل الذي حرّكه.
test('ونقل القطاع يبقى مغطّى بالحارس نفسه بعد تعميمه', async () => {
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T });
  const lead = { id: 'u_sl', username: 'sl', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL' };
  await db.insert('app_user', { id: 'u_sl', username: 'sl', name_ar: 'قائد قطاع الحلول', role_id: 'sector_lead', scope: 'sector', sector_id: 'SOL', active: 1, created_at: T });
  const oid = await mkOpp('D_INNO');
  const res = await opps.updateOpportunity({ user: lead, ip: '1' }, oid, { sector_id: 'CONS' });
  const row = await db.get('SELECT sector_id, department_id FROM opportunity WHERE id = ?', [oid]);
  assert.equal(row.sector_id, 'CONS', 'النقل لم يُكتب');
  assert.equal(row.department_id, null, 'بقيت إدارة القطاع القديم');
  assert.equal(res.movedOutOfReach, true, 'قائد القطاع نقلها خارج قطاعه ثم قيل له «ممنوع» على عملٍ نجح');
});

// ── ٢ · حالة المشروع تُكتب من الشاشة ─────────────────────────────────────────
test('الحالات الأربع كلها معروضة على المشروع — قائم ومعلّق ومكتمل وملغى', async () => {
  await db.insert('project', { id: 'P1', name_ar: 'منصة البيانات', sector_id: 'SOL', client_id: 'CL',
    owner_user_id: 'u_admin', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });
  const html = await P.projectDetailPage(ADMIN, 'P1', {});
  assert.ok(html.includes('prj-status-sel'), 'لا موضع في الشاشة يكتب حالة المشروع');
  for (const [v, ar] of [['IN_PROGRESS', 'قيد التنفيذ'], ['ON_HOLD', 'متوقّف مؤقتًا'],
    ['COMPLETED', 'مكتمل'], ['CANCELLED', 'ملغى'], ['NOT_STARTED', 'لم يبدأ']]) {
    assert.ok(html.includes(`value="${v}"`), `الحالة «${ar}» غائبة عن القائمة`);
  }
});

test('وإغلاق المشروع يُكتب ويظهر مغلقاً', async () => {
  await projects.updateProject({ user: ADMIN, ip: '1' }, 'P1', { status: 'COMPLETED' });
  assert.equal((await db.get('SELECT status FROM project WHERE id=?', ['P1'])).status, 'COMPLETED');
  const html = await P.projectDetailPage(ADMIN, 'P1', {});
  assert.ok(html.includes('value="COMPLETED" selected'), 'المشروع أُغلق ولا تُظهر الشاشة إغلاقه');
  await projects.updateProject({ user: ADMIN, ip: '1' }, 'P1', { status: 'IN_PROGRESS' });
});

test('وحالةٌ غير معروفة تُرَدّ — لا تُكتب خانةٌ لا تفهمها اللوحة', async () => {
  await assert.rejects(() => projects.updateProject({ user: ADMIN, ip: '1' }, 'P1', { status: 'FINISHED' }),
    (e) => /حالة المشروع/.test(e.message));
});

// شرط المالك الصريح — وهو الذي يمنع «ذكاءً» ضارّاً لو أضافه أحد غداً.
test('واكتمالُ المخرجات كلها لا يُغلق المشروع — «حتى لو صرفنا كل المخرجات بس هو قائم برضو ممكن»', async () => {
  await db.insert('project', { id: 'P2', name_ar: 'مشروع دعم مستمر', sector_id: 'SOL', client_id: 'CL',
    owner_user_id: 'u_admin', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });
  for (const n of [1, 2, 3]) {
    await db.insert('deliverable', { id: 'DV' + n, project_id: 'P2', name_ar: 'مخرَج ' + n, month: n, year: 2026,
      status: 'ACCEPTED', amount_halalas: 100000, created_at: T });
  }
  const { projectProgress } = await import('../../src/modules/pmo/progress.js');
  const prog = await projectProgress('P2');
  assert.equal(prog.executivePct, 100, 'الإنجاز لا يتبع المخرجات المعتمَدة');
  const row = await db.get('SELECT status FROM project WHERE id=?', ['P2']);
  assert.equal(row.status, 'IN_PROGRESS',
    'أُغلق المشروع وحده باكتمال مخرجاته — والإغلاق قرار مديره لا نتيجة حسبة');
});
