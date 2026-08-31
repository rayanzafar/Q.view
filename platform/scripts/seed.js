// Seed system config (workflows, report/kpi definitions, a demo schedule) + demo accounts per role.
import { run, get, insert, all } from '../src/core/db/index.js';
import { hashPassword } from '../src/core/auth/password.js';
import { id, nowIso } from '../src/core/util/ids.js';
import { initRbac } from '../src/core/rbac/index.js';
import { normName, createDepartment, createEmployee, updateEmployee, linkUserToEmployee, unlinkUserFromEmployee }
  from '../src/modules/org/org.js';

export const DEMO_PW = 'Sanad@2026'; // demo-account password — imported by the quality harness (sweep/e2e/tests)

const WORKFLOWS = [
  { key: 'opportunity_go_nogo', name: 'قرار المشاركة (Go/No-Go)', resource: 'opportunity',
    steps: [{ role: 'sector_lead', name: 'اعتماد قائد القطاع' }] },
  { key: 'proposal_approval', name: 'اعتماد العرض والتسعير', resource: 'proposal',
    steps: [{ role: 'sector_lead', name: 'اعتماد القطاع' }, { role: 'ceo_office', name: 'اعتماد مكتب الرئيس التنفيذي', min: 5000000 }] },
  { key: 'expense_approval', name: 'اعتماد المصروف', resource: 'expense',
    steps: [{ role: 'sector_lead', name: 'اعتماد القطاع' }, { role: 'ceo_office', name: 'اعتماد مكتب الرئيس التنفيذي', min: 2000000 }] },
  { key: 'timesheet_approval', name: 'اعتماد سجل الوقت', resource: 'timesheet',
    steps: [{ role: 'line_manager', name: 'اعتماد المدير المباشر' }] },
  { key: 'deliverable_acceptance', name: 'اعتماد المخرج', resource: 'deliverable',
    steps: [{ role: 'sector_lead', name: 'اعتماد القطاع' }] },
];

const REPORTS = [
  { key: 'weekly_exec_brief', name: 'الموجز التنفيذي الأسبوعي', level: 'company' },
  { key: 'sector_weekly_status', name: 'حالة القطاع الأسبوعية', level: 'sector' },
  { key: 'monthly_sector_performance', name: 'أداء القطاع الشهري', level: 'sector' },
  { key: 'project_status_report', name: 'تقرير حالة المشروع', level: 'project' },
  { key: 'workforce_utilization', name: 'تقرير القوى العاملة والإشغال', level: 'sector' },
  { key: 'opportunity_pipeline', name: 'تقرير خط الفرص', level: 'sector' },
];

const KPIS = [
  { key: 'on_time_completion', name_ar: 'الإنجاز في الوقت', level: 'project', unit: '%', dir: 'higher_better', amber: 80, red: 60 },
  { key: 'deliverable_acceptance', name_ar: 'قبول المخرجات', level: 'project', unit: '%', dir: 'higher_better', amber: 85, red: 70 },
  { key: 'utilization', name_ar: 'إشغال الموارد', level: 'team', unit: '%', dir: 'higher_better', amber: 65, red: 50 },
  { key: 'timesheet_compliance', name_ar: 'الالتزام بتسجيل الوقت', level: 'team', unit: '%', dir: 'higher_better', amber: 90, red: 75 },
  { key: 'win_rate', name_ar: 'معدل الفوز', level: 'sector', unit: '%', dir: 'higher_better', amber: 30, red: 20 },
  { key: 'pipeline_coverage', name_ar: 'تغطية خط الأنابيب', level: 'sector', unit: 'x', dir: 'higher_better', amber: 3, red: 2 },
  { key: 'ar_aging', name_ar: 'أعمار الذمم', level: 'company', unit: 'يوم', dir: 'lower_better', amber: 60, red: 90 },
];

// حساب تجريبي لكل دور في src/core/rbac/matrix.js — بلا استثناء. الأدوار السبعة الأخيرة كانت بلا
// حساب، فلم يفتح لها أحد صفحةً قط: لا المسح الحيّ (sweep) ولا مصفوفة الصلاحيات تمرّ على دور
// بلا حساب، فبقيت صفحاتها ونطاقها وحجب حقولها الحسّاسة خارج كل بوابة جودة.
//
// `scope` = أوسع نطاق بيانات يراه الشخص، وهو مشتقّ من **منح الدور نفسه** في المصفوفة لا من ذوق:
//   company ⟵ كل منح الدور بنطاق «شركة»   |  sector ⟵ منحه بنطاق «قطاع»
//   department / team ⟵ منحه بنطاق الإدارة / الفريق  |  own ⟵ منحه على ما يملكه هو فقط
export const DEMO_USERS = [
  { u: 'demo.admin', role: 'admin', scope: 'company', name: 'مسؤول النظام (تجريبي)', sector: null },
  { u: 'demo.ceo', role: 'ceo_office', scope: 'company', name: 'مكتب الرئيس التنفيذي (تجريبي)', sector: null },
  { u: 'demo.sectorlead', role: 'sector_lead', scope: 'sector', name: 'قائد قطاع الحلول (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.bd', role: 'bd_manager', scope: 'own', name: 'مدير تطوير الأعمال (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.pm', role: 'project_manager', scope: 'own', name: 'مدير مشروع (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.hr', role: 'hr', scope: 'company', name: 'الموارد البشرية (تجريبي)', sector: null },
  { u: 'demo.consultant', role: 'consultant', scope: 'own', name: 'استشاري (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.employee', role: 'employee', scope: 'own', name: 'موظف (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.viewer', role: 'viewer', scope: 'sector', name: 'مشاهد (تجريبي)', sector: 'SOLUTIONS' },

  // ── الأدوار السبعة التي كانت بلا حساب تجريبي ──
  // مدير إدارة: كل منحه بنطاق «إدارة» (قراءة الموظفين والمشاريع والمهام والوقت والمخرجات،
  // تعديل المهام، اعتماد الوقت والمصروف) — والإدارة تعيش داخل قطاع واحد، فالقطاع لازم.
  { u: 'demo.deptmgr', role: 'department_manager', scope: 'department', name: 'مدير إدارة (تجريبي)', sector: 'SOLUTIONS' },
  // مدير مباشر: منحه الأربعة كلها بنطاق «فريق» (قراءة الموظفين والمهام والوقت + اعتماد الوقت).
  { u: 'demo.linemgr', role: 'line_manager', scope: 'team', name: 'مدير مباشر (تجريبي)', sector: 'SOLUTIONS' },
  // رئيس تطوير الأعمال: وحدة مساندة على مستوى الشركة — كل منحه بنطاق «شركة» ولا يتبع قطاعاً
  // بعينه (نص التعليق في matrix.js: يعمل على فرص القطاعات الأربعة كلها).
  { u: 'demo.bdhead', role: 'bd_head', scope: 'company', name: 'رئيس تطوير الأعمال (تجريبي)', sector: null },
  // العمليات: منحه التشغيلية (مشاريع ومهام وتسكين ومعالم ومخرجات + تقارير) كلها بنطاق «قطاع».
  { u: 'demo.ops', role: 'operations', scope: 'sector', name: 'العمليات (تجريبي)', sector: 'SOLUTIONS' },
  // المشتريات: الموردون وأوامر الشراء وقراءة المشاريع والمصروفات — كلها بنطاق «شركة»، فهي
  // وظيفة مساندة لا تتبع قطاعاً. (اتساع البيانات ≠ قيادة — انظر ملاحظة الفحص في expectations.mjs.)
  { u: 'demo.procurement', role: 'procurement', scope: 'company', name: 'المشتريات (تجريبي)', sector: null },
  // المعتمِد: ثلاثة منح اعتماد فقط (فرصة/مصروف/مخرج) بنطاق «قطاع» — بلا أي منح قراءة.
  { u: 'demo.approver', role: 'approver', scope: 'sector', name: 'معتمِد (تجريبي)', sector: 'SOLUTIONS' },
  // المستخدم الخارجي يُعامَل مُعاملةً مختلفة عن الستة أعلاه، وهو ليس موظفاً في الشركة:
  //   • نطاقه «خاصتي» — منحاه الوحيدان (قراءة مشروعه وفاتورته) بنطاق «خاصتي».
  //   • **بلا قطاع**: انتماؤه إلى قطاع يجعله عضواً في بيانات القطاع لحظة إضافة أي منح قطاعي
  //     له، ويُظهره في شاشات «القطاع» كأنه من الفريق. عميلٌ لا زميل.
  //   • بريده على نطاق العميل لا نطاق الشركة — حساب بوابة خارجية لا حساب موظف.
  { u: 'demo.external', role: 'external', scope: 'own', name: 'مستخدم خارجي (تجريبي)', sector: null,
    email: 'demo.external@client.example' },
  // مكتب الرئيس التنفيذي وحدةً معزولة (لا الدور الشركي `ceo_office` أعلاه): نطاق «خاصتي» بلا قطاع —
  // بركةُ عملهم تُقرأ عبر ربط الموظف بإدارة المكتب لا عبر نطاق الحساب، فالحساب التجريبي يكفيه «خاصتي».
  { u: 'demo.officecoord', role: 'office_coordinator', scope: 'own', name: 'منسّق مكتب الرئيس (تجريبي)', sector: null },
  { u: 'demo.officemember', role: 'office_member', scope: 'own', name: 'عضو مكتب الرئيس (تجريبي)', sector: null },
];

// ─────────────────────────────────────────────────────────────────────────────
// إدارتان بموظفَيهما — الشرط الذي بدونه لا يمكن **إثبات** أثر نطاق «الإدارة» أصلاً
// حسابا «مدير إدارة» و«مدير مباشر» كانا بلا سجل موظف، ومعرّف الإدارة يُستنتج من هذا الربط
// (src/core/http/context.js) — فكانت إدارتهما فارغة دائماً، وكل سلوك يعتمد عليها معطَّلاً عملياً
// ومستحيلاً على أي فحص أن يراه.
// وإدارة واحدة لا تكفي دليلاً: «المدير رأى إدارته» ليس إثباتاً ما لم توجد إدارة ثانية بأشخاص
// معروفين بأسمائهم ويثبت **غيابهم**. لذلك إدارتان بموظفين متمايزين، وحسابٌ حيّ في كل منهما.
export const DEMO_ORG_SECTOR = 'SOLUTIONS';
export const DEMO_DEPARTMENTS = [
  { name_ar: 'إدارة تحول الأعمال', manager: 'demo.deptmgr', staff: [
    { name_ar: 'ريم الدوسري (تجريبي)', job_title: 'مديرة إدارة', account: 'demo.deptmgr' },
    { name_ar: 'بدر العنزي (تجريبي)', job_title: 'مدير مباشر', account: 'demo.linemgr' },
    { name_ar: 'هناء المطيري (تجريبي)', job_title: 'محللة أعمال', account: null },
  ] },
  { name_ar: 'إدارة البنية الرقمية', manager: null, staff: [
    // حسابٌ حيّ في الإدارة الثانية: بدونه لا مهمة مُسنَدة خارج إدارة المدير، فلا شيء يُثبت
    // استبعاده. مهام العرض مُسنَدة أصلاً إلى هذا الحساب في scripts/lib/seed-fixture.mjs.
    { name_ar: 'ماجد السبيعي (تجريبي)', job_title: 'مهندس حلول', account: 'demo.employee' },
    { name_ar: 'لمياء الغامدي (تجريبي)', job_title: 'مسؤولة تشغيل', account: null },
  ] },
];
const DEMO_HIRE_DATE = '2025-09-01'; // ثابت — كي لا يتغيّر الكشف من تشغيل إلى آخر

// تُستدعى في نهاية seed()، ومُصدَّرة وحدها لأن ترتيب البذر يختلف بين البيئتين: في التشغيل الحيّ
// تُحمَّل بيانات الأعمال (ومعها القطاعات) **قبل** الحسابات، أما في حزم الفحص فالحسابات أولاً ثم
// البيانات — فتُستدعى الخطوة بعد اكتمال الطرفين. تخطٍّ صامت وآمن حين لا يوجد القطاع بعد.
export async function seedDemoOrg() {
  const sector = await get('SELECT id FROM sector WHERE id = ? AND deleted_at IS NULL', [DEMO_ORG_SECTOR]);
  const actor = await get('SELECT id, username FROM app_user WHERE username = ?', ['demo.admin']);
  if (!sector || !actor) return { seeded: false, departments: [], linked: 0 };
  // خدمات الهيكل تفحص الصلاحية، والفحص يقرأ منح الأدوار المخزَّنة — تُحمَّل هنا صراحةً كي تعمل
  // الخطوة سواء نُودي عليها من الإقلاع أو من سطر الأوامر.
  await initRbac();
  const ctx = { user: { id: actor.id, username: actor.username, role_id: 'admin', scope: 'company',
    sector_id: null, department_id: null, projectIds: new Set(), teamIds: new Set() }, ip: '127.0.0.1' };

  const accountOf = async (username) => (username
    ? await get('SELECT id, employee_id FROM app_user WHERE username = ? AND deleted_at IS NULL', [username])
    : null);
  // الربط يمر بخدمته وحدها (تحققاتها وتدقيقها على الطرفين)، ولا يُعاد إن كان قائماً — إعادته
  // ترفع خطأً وتُضاعف سطور التدقيق بلا تغيير حقيقي.
  const linkAccount = async (username, employeeId) => {
    const acc = await accountOf(username);
    if (!acc || acc.employee_id === employeeId) return false;
    if (acc.employee_id) await unlinkUserFromEmployee(ctx, { userId: acc.id });
    const taken = await get('SELECT id FROM app_user WHERE employee_id = ? AND deleted_at IS NULL', [employeeId]);
    if (taken) await unlinkUserFromEmployee(ctx, { userId: taken.id });
    await linkUserToEmployee(ctx, { employeeId, userId: acc.id });
    return true;
  };

  const out = { seeded: true, departments: [], linked: 0 };
  for (const d of DEMO_DEPARTMENTS) {
    // البحث بالاسم المطبَّع هو قاعدة عدم التكرار نفسها التي تطبّقها الخدمة — فلا تصطدم إعادة
    // التشغيل بخطأ «الاسم مستخدم بالفعل» ولا تُنشئ إدارة ثانية بالاسم نفسه.
    const wanted = normName(d.name_ar);
    const rows = await all('SELECT id, name_ar FROM department WHERE sector_id = ? AND deleted_at IS NULL', [DEMO_ORG_SECTOR]);
    let dep = rows.find((r) => normName(r.name_ar) === wanted) || null;
    if (!dep) {
      const manager = await accountOf(d.manager);
      dep = await createDepartment(ctx, { sector_id: DEMO_ORG_SECTOR, name_ar: d.name_ar,
        manager_user_id: manager ? manager.id : null });
    }
    const staffIds = [];
    for (const s of d.staff) {
      const want = normName(s.name_ar);
      const people = await all('SELECT id, name_ar, department_id FROM employee WHERE deleted_at IS NULL');
      let emp = people.find((p) => normName(p.name_ar) === want) || null;
      if (!emp) {
        emp = await createEmployee(ctx, { name_ar: s.name_ar, sector_id: DEMO_ORG_SECTOR,
          department_id: dep.id, job_title: s.job_title, hire_date: DEMO_HIRE_DATE });
      } else if (emp.department_id !== dep.id) {
        emp = await updateEmployee(ctx, emp.id, { department_id: dep.id, sector_id: DEMO_ORG_SECTOR });
      }
      staffIds.push(emp.id);
      if (await linkAccount(s.account, emp.id)) out.linked++;
    }
    out.departments.push({ id: dep.id, name_ar: dep.name_ar, staff: staffIds });
  }
  return out;
}

export async function seed() {
  // workflows
  for (const w of WORKFLOWS) {
    let wf = await get('SELECT id FROM workflow_definition WHERE key = ?', [w.key]);
    if (!wf) {
      const wid = id('wf');
      await insert('workflow_definition', { id: wid, key: w.key, name_ar: w.name, target_resource: w.resource, active: 1, created_at: nowIso() });
      for (const [i, s] of w.steps.entries()) await insert('approval_step', { id: id('ws'), workflow_id: wid, step_order: i + 1,
        approver_role: s.role, approver_scope: 'sector', min_amount_halalas: s.min ? s.min * 100 : 0, name_ar: s.name });
    }
  }
  // report definitions
  for (const r of REPORTS) {
    if (!(await get('SELECT id FROM report_definition WHERE key = ?', [r.key])))
      await insert('report_definition', { id: id('rd'), key: r.key, name_ar: r.name, level: r.level, detail_level: 'summary',
        locale: 'ar', template_key: r.key, active: 1, created_at: nowIso() });
  }
  // kpi definitions
  for (const k of KPIS) {
    if (!(await get('SELECT id FROM kpi_definition WHERE key = ?', [k.key])))
      await insert('kpi_definition', { id: id('kpi'), key: k.key, name_ar: k.name_ar, name_en: null, level: k.level,
        unit: k.unit, direction: k.dir, rag_amber: k.amber, rag_red: k.red, active: 1 });
  }
  // demo accounts
  const hash = hashPassword(DEMO_PW);
  for (const d of DEMO_USERS) {
    let uid = (await get('SELECT id FROM app_user WHERE username = ?', [d.u]))?.id;
    if (!uid) uid = id('u');
    await run(`INSERT INTO app_user (id, username, email, name_ar, role_id, sector_id, scope, password_hash, active, must_change_pw, created_at)
         VALUES (?,?,?,?,?,?,?,?,1,0,?)
         ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, email=EXCLUDED.email, name_ar=EXCLUDED.name_ar, role_id=EXCLUDED.role_id, sector_id=EXCLUDED.sector_id, scope=EXCLUDED.scope, password_hash=EXCLUDED.password_hash, active=EXCLUDED.active, must_change_pw=EXCLUDED.must_change_pw`,
      [uid, d.u, d.email || d.u + '@evc.com.sa', d.name, d.role, d.sector, d.scope, hash, nowIso()]);
  }
  // link sector lead + give demo.pm a project via membership (project scope)
  const lead = await get("SELECT id FROM app_user WHERE username='demo.sectorlead'");
  if (lead) await run('UPDATE sector SET lead_user_id = ? WHERE id = ?', [lead.id, 'SOLUTIONS']);
  const pm = await get("SELECT id FROM app_user WHERE username='demo.pm'");
  const someProject = await get("SELECT id FROM project WHERE sector_id='SOLUTIONS' AND deleted_at IS NULL LIMIT 1");
  if (pm && someProject) await run('UPDATE project SET owner_user_id = ? WHERE id = ?', [pm.id, someProject.id]);

  // Give the person-scoped personas a realistic personal book of opportunities so the "فرصي" (My
  // Opportunities) page demonstrates a populated pipeline. Deterministic (ordered by id) and idempotent;
  // each persona gets a mix of open/won/lost so their personal win-rate is meaningful.
  const persona = async (u) => (await get('SELECT id FROM app_user WHERE username = ?', [u]))?.id;
  const owners = { bd: await persona('demo.bd'), sl: await persona('demo.sectorlead'), cons: await persona('demo.consultant'), pm: pm?.id };
  if (owners.bd) {
    const rows = await all(`SELECT o.id, st.is_won, st.is_lost FROM opportunity o JOIN stage st ON st.id=o.stage_id
       WHERE o.sector_id='SOLUTIONS' AND o.deleted_at IS NULL ORDER BY o.id`);
    const open = rows.filter((r) => !r.is_won && !r.is_lost).map((r) => r.id);
    const won = rows.filter((r) => r.is_won).map((r) => r.id);
    const lost = rows.filter((r) => r.is_lost).map((r) => r.id);
    const plan = [
      { u: owners.bd, open: 16, won: 3, lost: 3 }, { u: owners.sl, open: 10, won: 2, lost: 2 },
      { u: owners.cons, open: 6, won: 1, lost: 1 }, { u: owners.pm, open: 5, won: 1, lost: 1 },
    ];
    const actions = ['متابعة العرض الفني مع العميل', 'جدولة اجتماع إغلاق', 'إرسال التسعير المُحدَّث',
      'تأكيد نطاق العمل', 'عرض تقديمي للجنة الشرائية', 'مراجعة المسودة القانونية للعقد'];
    let oi = 0, wi = 0, li = 0, a = 0;
    for (const p of plan) {
      if (!p.u) { oi += p.open; wi += p.won; li += p.lost; continue; }
      const slice = [...open.slice(oi, oi + p.open), ...won.slice(wi, wi + p.won), ...lost.slice(li, li + p.lost)];
      for (const oid of slice) await run('UPDATE opportunity SET owner_user_id = ? WHERE id = ?', [p.u, oid]);
      for (let k = 0; k < Math.min(4, p.open); k++) {
        const oid = open[oi + k];
        if (oid) await run("UPDATE opportunity SET next_action = ? WHERE id = ? AND (next_action IS NULL OR next_action='')", [actions[(a++) % actions.length], oid]);
      }
      oi += p.open; wi += p.won; li += p.lost;
    }
  }

  // a demo weekly schedule (exec brief → a recipient group with demo.ceo)
  if (!(await get("SELECT id FROM report_schedule LIMIT 1"))) {
    const gid = id('rg'); await insert('recipient_group', { id: gid, name_ar: 'القيادة التنفيذية', created_at: nowIso() });
    const ceo = await get("SELECT id FROM app_user WHERE username='demo.ceo'");
    if (ceo) await insert('recipient', { id: id('rc'), group_id: gid, user_id: ceo.id, kind: 'to' });
    const rd = await get("SELECT id FROM report_definition WHERE key='weekly_exec_brief'");
    await insert('report_schedule', { id: id('rs'), report_id: rd.id, recipient_group_id: gid, frequency: 'weekly',
      day_of_week: 0, send_time: '08:00', active: 1, created_at: nowIso() });
  }
  // إدارتان بموظفيهما + ربط حسابات العرض بسجلاتهم (تخطٍّ صامت إن لم يوجد القطاع بعد)
  const org = await seedDemoOrg();
  console.log('✓ seed complete — demo accounts (password: ' + DEMO_PW + '):');
  DEMO_USERS.forEach((d) => console.log(`   ${d.u}  →  ${d.role}`));
  console.log(org.seeded
    ? `   إدارات العرض: ${org.departments.map((d) => d.name_ar).join('، ')} — حسابات مربوطة: ${org.linked}`
    : '   إدارات العرض: لم تُبذر بعد (القطاع غير موجود) — تُستدعى seedDemoOrg بعد تحميل بيانات الأعمال');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { close } = await import('../src/core/db/index.js');
  seed().then(() => close()).catch((e) => { console.error(e); process.exit(1); });
}
