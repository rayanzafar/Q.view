// من يرى مالَ المشروع — ومن لا يراه أصلاً.
//
// قرار مالك صريح: «مدير المشروع ومن فوقه يقدر يعدلها ويشوف، بس مو أي موظف مسكَّن على المشروع
// يمديه يشوف هذي الأشياء أصلاً». وكانت صفحة المشروع تعرض قسم «العقد والمالية» — قيمة العقد
// والمفوتر والمستحق — لكل من يقرأ المشروع. والاستشاري والموظف يقرآن مشاريعهم بحكم تسكينهم.
// أي أن نطاق **قراءة المشروع** كان يفتح نطاق **قراءة المال**، وهما منحان مختلفان في المصفوفة
// عن قصد. وهذا الملف يثبّت الحدّ من طرفيه: لا يُحجب عمّن يملكه، ولا يُعرض لمن لا يملكه.
//
// ويحرس ثلاثة قرارات أخرى في الجولة نفسها:
//   • مدير المشروع يملك مالية مشروعه (قراءة عقده وفواتيره وإصدار مستخلصه) — ولا فريق مالية يفعلها عنه.
//   • ومنحُه بنطاق **مشروع** لا يفتح له شاشة مالية الشركة.
//   • ومكتب الرئيس التنفيذي «فوقه» فيعدّل المشروع ومخرجاته، وكان يقرأ ولا يعدّل.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-money-'));
process.env.SANAD_DB = join(dir, 'm.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { initRbac, can } = await import('../../src/core/rbac/index.js');
const { PAGE_ACCESS } = await import('../../src/core/policy/pages.js');

const PRJ = { id: 'P1', project_id: 'P1', sector_id: 'S1' };
const U = (role, scope) => ({ id: 'u_' + role, role_id: role, sector_id: 'S1', scope,
  projectIds: new Set(['P1']), teamIds: new Set() });
// نفس التركيب الذي تبنيه الجلسة الحقيقية لكل دور
const AS = {
  project_manager: U('project_manager', 'project'),
  ceo_office: U('ceo_office', 'company'),
  sector_lead: U('sector_lead', 'sector'),
  admin: U('admin', 'company'),
  consultant: U('consultant', 'own'),
  employee: U('employee', 'own'),
};
// نفس شرط الصفحة حرفياً (src/web/views/pmo.js) — لو تغيّر هناك ولم يتغيّر هنا سقط الفحص
const seesMoney = (u) => can(u, 'read', 'contract', PRJ) || can(u, 'read', 'invoice', PRJ);

before(async () => { await initRbac(); });

test('الموظف والاستشاري المُسكَّنان يقرآن المشروع ولا يريان مالَه', () => {
  for (const r of ['consultant', 'employee']) {
    const u = AS[r];
    assert.equal(can(u, 'read', 'project', PRJ), true, `${r} يقرأ مشروعه — التسكين يقتضيه`);
    assert.equal(seesMoney(u), false, `${r} لا يرى قيمة العقد ولا المفوتر ولا المستحق`);
  }
});

test('مدير المشروع يرى مالية مشروعه ويُصدر مستخلصه — ولا فريق مالية يفعلها عنه', () => {
  const pm = AS.project_manager;
  assert.equal(seesMoney(pm), true, 'يرى عقد مشروعه وفواتيره');
  assert.equal(can(pm, 'read', 'contract', PRJ), true);
  assert.equal(can(pm, 'create', 'invoice', PRJ), true, 'ويُصدر المستخلص على مخرَجٍ سلّمه');
  assert.equal(can(pm, 'update', 'project', PRJ), true, 'ويعدّل المشروع');
  assert.equal(can(pm, 'update', 'deliverable', PRJ), true, 'ومخرجاته');
});

test('التحصيل ليس لمدير المشروع — شأن الإدارة المالية لا إدارة المشروع', () => {
  assert.equal(can(AS.project_manager, 'create', 'collection', PRJ), false);
});

// شاشة مالية الشركة أُزيلت بقرار المالك — لا تُفتح لأحد، ولا تُفتح بالعنوان المباشر.
// وكان الفحص يثبّت من يفتحها ومن يُردّ؛ صار يثبّت أنها مُغلقة على الجميع بلا استثناء —
// فأي عودة لها تسقط هنا بدل أن تمرّ صامتة.
test('شاشة مالية الشركة مُزالة — لا تُفتح لأي دور', () => {
  for (const r of ['project_manager', 'sector_lead', 'admin', 'ceo_office', 'consultant', 'employee']) {
    assert.equal(PAGE_ACCESS.finance(AS[r] || { role_id: r, scope: 'company' }), false, r);
  }
});

test('مكتب الرئيس التنفيذي «فوقه» — يعدّل المشروع ومخرجاته، وكان يقرأ ولا يعدّل', () => {
  const ceo = AS.ceo_office;
  assert.equal(can(ceo, 'update', 'project', PRJ), true);
  assert.equal(can(ceo, 'update', 'deliverable', PRJ), true);
  assert.equal(can(ceo, 'update', 'milestone', PRJ), true);
  assert.equal(can(ceo, 'approve', 'deliverable', PRJ), true, 'ويعتمد المخرَج');
  assert.equal(seesMoney(ceo), true);
  // وبلا حذف: إزالة مشروع قائم قرار لا رجعة فيه
  assert.equal(can(ceo, 'delete', 'project', PRJ), false, 'الحذف يبقى لصاحب القطاع ومدير النظام');
});

test('الراتب يبقى مختوماً — لم يُفتح لأي دور في هذه الجولة', () => {
  for (const r of Object.keys(AS)) {
    if (r === 'admin') continue;
    assert.equal(can(AS[r], 'read', 'salary'), false, r);
  }
});

// ── والحدّ الحقيقي على الصفحة نفسها، لا في المصفوفة وحدها ─────────────────────
// المصفوفة تعرف **من** يملك المنح؛ والصفحة وحدها تعرف **أين** طُبع الرقم. وقد أظهر التصيير
// موضعين فاتا الحجب الأول: «قيمة العقد» في «نظرة عامة» (أظهرُ موضعٍ في الصفحة)، و«قيمة المخرَج»
// في جدول المخرجات. فالفحص يقرأ الصفحة المُصيَّرة كاملةً بحثاً عن أي لفظِ مال.
test('الصفحة المُصيَّرة: صفر رقم مال للموظف والاستشاري — وعملُهما كاملٌ أمامهما', async () => {
  const db = await import('../../src/core/db/index.js');
  const { nowIso } = await import('../../src/core/util/ids.js');
  const { projectDetailPage } = await import('../../src/web/views/pmo.js');
  const now = nowIso();
  await db.insert('sector', { id: 'MS', name_ar: 'قطاع', kind: 'delivery', active: 1, created_at: now });
  await db.insert('client', { id: 'MC', name_ar: 'عميل', type: 'حكومي', active: 1, created_at: now });
  for (const r of ['project_manager', 'consultant', 'employee']) {
    await db.insert('app_user', { id: 'mu_' + r, username: 'm_' + r, name_ar: r, role_id: r, sector_id: 'MS',
      scope: r === 'project_manager' ? 'project' : 'own', password_hash: 'x', active: 1, created_at: now });
  }
  await db.insert('project', { id: 'MP1', name_ar: 'مشروع الحجب', sector_id: 'MS', client_id: 'MC',
    owner_user_id: 'mu_project_manager', status: 'IN_PROGRESS', contract_value_halalas: 5_000_000,
    start_date: '2026-01-01', end_date: '2026-12-31', created_at: now });
  await db.insert('contract', { id: 'MK1', code: 'CT-M', project_id: 'MP1', client_id: 'MC', sector_id: 'MS',
    value_halalas: 5_000_000, status: 'ACTIVE', created_at: now });
  await db.insert('deliverable', { id: 'MD1', project_id: 'MP1', name_ar: 'مخرَج بقيمة', amount_halalas: 2_000_000,
    status: 'DELIVERED', delivered_at: now, invoiced_at: now, sector_id: 'MS', created_at: now });

  const MONEY = ['قيمة المشروع وإيراده', 'قيمة المشروع', 'المستحق', 'نسبة الفوترة', 'حركة المال',
    'جاهز للمستخلص', 'المفوتر', 'الهامش', 'الإيراد المُثبت', 'الصرف الفعلي', 'ر.س.'];
  const render = async (role) => {
    const u = await db.get('SELECT * FROM app_user WHERE id = ?', ['mu_' + role]);
    return projectDetailPage({ ...u, projectIds: new Set(['MP1']), teamIds: new Set() }, 'MP1');
  };

  for (const role of ['consultant', 'employee']) {
    const html = await render(role);
    const leaked = MONEY.filter((m) => html.includes(m));
    assert.deepEqual(leaked, [], `${role} — لا لفظَ مالٍ واحداً على صفحته`);
    // وعملُه كاملٌ أمامه: الحجب على المال وحده لا على المشروع
    for (const need of ['المخرجات', 'الفريق والتسكين', 'المهام', 'مخرَج بقيمة']) {
      assert.ok(html.includes(need), `${role} يرى «${need}»`);
    }
    assert.ok(html.includes('وزن'), 'والوزن باقٍ — نسبةُ تقدّمٍ لا مبلغ');
    for (const bad of ['undefined', 'NaN', '[object']) assert.ok(!html.includes(bad), `${role}: ${bad}`);
  }
  const pm = await render('project_manager');
  // «المفوتر» و«المستحق على العميل» أُزيلا مع إلغاء المالية — الباقي قيمة المشروع وإيراده.
  for (const need of ['قيمة المشروع وإيراده', 'قيمة المشروع', 'الإيراد المُثبت']) {
    assert.ok(pm.includes(need), `مدير المشروع يرى «${need}»`);
  }
});

test('الحدّ صفّي: عقدُ مشروعٍ لا يديره مردودٌ عن مدير المشروع', async () => {
  // المنح بنطاق «مشروع»، فلا يكفي أن يكون مديرَ مشاريع — يجب أن يكون العقدُ عقدَ **مشروعه**.
  // بلا هذا الفحص يمرّ منحٌ يبدو مقيَّداً وهو مفتوح على كل عقود الشركة.
  const db = await import('../../src/core/db/index.js');
  const { nowIso } = await import('../../src/core/util/ids.js');
  const { contractDetail } = await import('../../src/modules/finance/finance.js');
  const now = nowIso();
  await db.insert('project', { id: 'FP', name_ar: 'مشروع غيره', sector_id: 'MS', status: 'IN_PROGRESS', created_at: now });
  await db.insert('contract', { id: 'FK', code: 'CT-F', project_id: 'FP', sector_id: 'MS',
    value_halalas: 9_000_000, status: 'ACTIVE', created_at: now });
  await db.insert('contract', { id: 'MK2', code: 'CT-MINE', project_id: 'MP1', sector_id: 'MS',
    value_halalas: 1_000_000, status: 'ACTIVE', created_at: now });
  const pm = { id: 'mu_project_manager', role_id: 'project_manager', sector_id: 'MS', scope: 'project',
    projectIds: new Set(['MP1']), teamIds: new Set() };
  const mine = await contractDetail(pm, 'MK2');
  assert.equal(mine.contract.id, 'MK2', 'عقد مشروعه يُقرأ');
  await assert.rejects(() => contractDetail(pm, 'FK'), (e) => e.code === 'forbidden',
    'وعقدُ مشروعٍ لا يديره مردود — لا يفتح المنحُ محفظة الشركة صفّاً صفّاً');
});
