#!/usr/bin/env node
// جعلُ المنصة تعكس **ملف المالك** لمشاريع قطاع الاستشارات — معاينةٌ افتراضياً.
//
//   node --experimental-sqlite scripts/apply-consulting.mjs --file=<الملف.xlsm>            ← معاينة: لا يُكتب صفٌّ واحد
//   node --experimental-sqlite scripts/apply-consulting.mjs --file=<الملف.xlsm> --apply    ← التنفيذ
//
// ── قيدٌ مُلزَم من المالك، لا يُتجاوز بخيار ولا بعلَم ────────────────────────────
// **لا يُنشأ حساب دخولٍ لأي موظف إطلاقاً.** يُنشأ سجلّ الموظف ويُسجَّل تسكينه، ولا يُنشأ له
// حساب. وإن وُجد حساب قائم يخصّه **يقيناً** رُبط به؛ وإلا بقي الموظف بلا حساب وطُبع في
// «تحتاج قرار إنسان». ولذلك لا يستدعي هذا الملف أي خدمة إنشاء حسابات — ولا يستوردها أصلاً.
//
// ── ما يُعدّ «قاطعاً» ────────────────────────────────────────────────────────
//   • المشروع: مفتاحه كوده `CONS-<رقم الملف>`. لا مطابقة بالاسم ولا بالتشابه.
//   • الشخص: اسمٌ **مطابق حرفياً** بعد توحيد الهمزات والمسافات، وسجلٌّ واحد لا غير يحمله.
//     تعدُّد المطابقات ⇒ يُترك. والأسماء هنا عربية متقاربة، وخطأ المطابقة يُسكِّن إنساناً على
//     مشروع ليس له ويُفسد حساب الطاقة الاستيعابية — فالترك أرخص من الخطأ بكثير.
//   • ربط الحساب: حسابٌ واحد لا غير باسمٍ مطابق، غير مربوط بموظف، والموظف غير محجوز لحساب آخر.
//
// ── ما لا يكتبه هذا السكربت عمداً ────────────────────────────────────────────
//   • أسماء العملاء (سجل مشترك بين مشاريع — تعديله يفسد غيره).
//   • حالة «غير معتمد» (لا نظير لها في المنصة — فرضُ نظيرٍ لها اختراعُ معنى).
//   • الإيراد والتكاليف وحالات البنود والفواتير: أرقامٌ مشتقّة من مصادرها، والكتابة عليها
//     تفصلها عن أصلها فتصير رقماً متّسق الشكل كاذب المضمون. تُكشف ولا تُكتب.
//
// كل كتابة تمر بخدمات src/modules ومعها سطر تدقيق، وإعادة التشغيل لا تُنتج أثراً مضاعفاً.
import { readWorkbook, reconcile, readPlatformDb, loadPlatform, norm, parseArgs, REF_YEAR, CONSULTING, sar } from './reconcile-consulting.mjs';

// المُنفِّذ: مدير نظام بنطاق شركة — المطابقة تعبر مشاريع القطاع كلها، ونطاقٌ أضيق يُسقط نصفها
// صامتاً. اسمه يظهر في كل سطر تدقيق فيُعرف أن هذا الصف كتبه السكربت لا إنسان.
export const APPLIER = { id: 'apply-consulting', username: 'apply-consulting',
  name_ar: 'مطابقة ملف الاستشارات', role_id: 'admin', scope: 'company', sector_id: null,
  projectIds: new Set(), teamIds: new Set() };
const ctxOf = (over = {}) => ({ user: { ...APPLIER, ...(over.user || {}) }, ip: over.ip || '127.0.0.1' });

// ─────────────────────────────────────────────────────────────────────────────
// الخطة — تُشتقّ من الكشف نفسه، فلا تفترق قاعدةُ «ما يُصلَح» عن قاعدة «ما يُكشَف».
// ─────────────────────────────────────────────────────────────────────────────

export async function planApply(opts = {}) {
  const { file, plat, report, path } = opts;
  const f = file || readWorkbook(path);
  const p = plat || await readPlatformDb();
  const res = report || reconcile(f, p);

  const plan = { projects: [], employees: [], allocations: [], links: [], skipped: [], humans: [...res.humans] };
  const skip = (what, why) => plan.skipped.push({ what, why });

  // ① حقول المشاريع القائمة — الحقول القاطعة وحدها (التاريخ، الحالة المعلومة، القيمة، الميزانية،
  //    الاسم، مدير المشروع المذكور). ما وُسم في الكشف «قرار إنسان» أو «رقم مشتقّ» لا خطة له.
  for (const r of res.rows) {
    if (r.missing) {
      const src = f.projects.find((x) => x.n === r.n);
      plan.projects.push({ kind: 'create', code: r.code, name: r.name, data: {
        code: r.code, name_ar: src.name_ar, sector_id: CONSULTING,
        status: src.status_ar === 'مكتمل' ? 'COMPLETED' : 'IN_PROGRESS',
        start_date: src.start_date, end_date: src.end_date,
        contract_value_sar: src.value_sar ?? 0, budget_sar: src.budget_sar ?? 0 },
        pm_name: src.pm_name || null });
      // العميل لا يُربط بالتخمين: مشروعٌ جديد يُنشأ بلا عميل ويُطلب ربطه يدوياً.
      plan.humans.push({ title: `${r.code} — ربط العميل`,
        why: `مشروع جديد سيُنشأ باسم «${src.name_ar}» بلا عميل. اسم العميل في الملف «${src.client_ar}» — اربطه يدوياً بسجل العميل الصحيح.` });
      continue;
    }
    const patch = Object.assign({}, ...r.fixes);
    if (Object.keys(patch).length) plan.projects.push({ kind: 'update', id: r.id, code: r.code, name: r.name, data: patch });
  }

  // ② سجلات الموظفين الناقصة — سجلٌّ فقط، بلا حساب دخول. اسمٌ واحد لكل شخص مهما تكرر في الورقة.
  const byPerson = new Map();
  for (const s of res.staffing) {
    const k = norm(s.person);
    if (!byPerson.has(k)) byPerson.set(k, { person: s.person, job_title: s.job_title, rows: [] });
    byPerson.get(k).rows.push(s);
    if (!byPerson.get(k).job_title && s.job_title) byPerson.get(k).job_title = s.job_title;
  }
  const accountsByName = new Map();
  for (const a of p.accounts || []) {
    const k = norm(a.name_ar);
    accountsByName.set(k, (accountsByName.get(k) || []).concat(a));
  }
  const takenAccounts = new Set((p.accounts || []).filter((a) => a.employee_id).map((a) => a.employee_id));

  for (const [k, g] of byPerson) {
    const missing = g.rows.some((s) => s.state === 'موظف غير موجود');
    const ambiguous = g.rows.some((s) => s.state === 'اسم مكرر');
    if (ambiguous) { skip(`موظف — ${g.person}`, 'أكثر من سجل موظف بالاسم نفسه'); continue; }
    if (!missing) continue;
    plan.employees.push({ person: g.person, key: k, data: {
      name_ar: g.person, job_title: g.job_title || null, sector_id: CONSULTING } });
    // ربط الحساب: قاطعٌ أو لا شيء. حسابٌ واحد بالاسم نفسه، غير مربوط، ولا منازع.
    const cands = (accountsByName.get(k) || []).filter((a) => !a.employee_id);
    if (cands.length === 1) plan.links.push({ person: g.person, key: k, userId: cands[0].id, username: cands[0].username });
    else if (cands.length > 1) {
      plan.humans.push({ title: `حساب — ${g.person}`,
        why: `${cands.length} حسابات دخول تحمل هذا الاسم. لا يُربط أحدها بالتخمين — اختر الحساب الصحيح يدوياً.` });
    } else {
      plan.humans.push({ title: `حساب — ${g.person}`,
        why: 'لا حساب دخول قائم بهذا الاسم. سيُنشأ سجلّ الموظف بلا حساب — وإنشاء الحساب قرار المالك وحده.' });
    }
  }
  void takenAccounts;

  // ③ التسكين
  for (const s of res.staffing) {
    if (s.state === 'مطابق' || s.state === 'اسم مكرر') continue;
    if (s.pct == null) { skip(`تسكين — ${s.person} على ${s.code}`, 'نسبة التحمل في الملف فارغة'); continue; }
    if (s.state === 'نسبة مختلفة') {
      plan.allocations.push({ kind: 'update', allocId: s.alloc_id, person: s.person, code: s.code,
        from: s.platform_pct, pct: s.pct });
    } else {
      // «تسكين ناقص» أو «موظف غير موجود» — كلاهما إنشاء تسكين؛ الثاني يسبقه إنشاء سجل الموظف.
      plan.allocations.push({ kind: 'create', person: s.person, key: norm(s.person), employeeId: s.employee_id || null,
        code: s.code, pct: s.pct, job_title: s.job_title });
    }
  }

  return { report: res, plan };
}

// ─────────────────────────────────────────────────────────────────────────────
// التنفيذ
// ─────────────────────────────────────────────────────────────────────────────

export async function applyPlan(plan, { apply = false } = {}) {
  const done = { projectsUpdated: 0, projectsCreated: 0, employeesCreated: 0, accountsLinked: 0,
    allocationsCreated: 0, allocationsUpdated: 0, failures: [] };
  if (!apply) return done;

  const { initRbac } = await import('../src/core/rbac/index.js');
  await initRbac();                       // جدول الصلاحيات يُحمَّل مرةً قبل أي فحص تفويض
  const projects = await import('../src/modules/pmo/projects.js');
  const org = await import('../src/modules/org/org.js');
  const { get } = await import('../src/core/db/index.js');
  const ctx = ctxOf();
  const idByCode = new Map();
  const idByPerson = new Map();
  const fail = (what, e) => done.failures.push({ what, why: e?.message || String(e) });
  const owner = plan.projects.some((x) => x.kind === 'create')
    ? await get(`SELECT id, username FROM app_user
                  WHERE deleted_at IS NULL AND active = 1 AND (scope = ? OR role_id = ?)
                  ORDER BY created_at LIMIT 1`, ['company', 'admin'])
    : null;
  const ownerId = owner?.id || null;

  for (const it of plan.projects) {
    try {
      if (it.kind === 'create') {
        // مالك السجل: خدمة الإنشاء تختم المشروع بحساب المُنفِّذ، وحساب السكربت ليس حساباً حقيقياً
        // فيرفضه المفتاح الأجنبي. فيُختم بحسابٍ إداري **قائم** يُذكر اسمه في الخطة صراحةً، ولا
        // يُنشأ حساب لأجل ذلك أبداً. وإن لم يوجد حسابٌ صالح تُرك المشروع لقرار إنسان.
        if (!ownerId) { fail(`مشروع ${it.code}`, 'لا حساب إداري قائم ليُختم به المشروع — أنشئه من الشاشة'); continue; }
        const row = await projects.createProject(ctx, { ...it.data, owner_user_id: ownerId });
        idByCode.set(it.code, row.id);
        // مدير المشروع لا تقبله خدمة الإنشاء — يُكتب بتعديلٍ تالٍ كي لا تبقى الجولة الثانية ترى فرقاً.
        if (it.pm_name) await projects.updateProject(ctx, row.id, { pm_name: it.pm_name });
        done.projectsCreated++;
      } else { await projects.updateProject(ctx, it.id, it.data); done.projectsUpdated++; }
    } catch (e) { fail(`مشروع ${it.code}`, e); }
  }

  for (const it of plan.employees) {
    try { const row = await org.createEmployee(ctx, it.data); idByPerson.set(it.key, row.id); done.employeesCreated++; }
    catch (e) { fail(`موظف ${it.person}`, e); }
  }

  // الربط بحسابٍ **قائم** فقط. لا إنشاء حساب هنا ولا في أي فرعٍ آخر من هذا الملف.
  for (const it of plan.links) {
    const employeeId = idByPerson.get(it.key);
    if (!employeeId) continue;
    try { await org.linkUserToEmployee(ctx, { employeeId, userId: it.userId }); done.accountsLinked++; }
    catch (e) { fail(`ربط حساب ${it.person}`, e); }
  }

  for (const it of plan.allocations) {
    try {
      if (it.kind === 'update') {
        // تصحيح النسبة شهراً شهراً عمداً: تعديل النطاق (setAllocation) يُبقي كل شهرٍ تختلف قيمته
        // عن النسبة الجديدة ظنّاً أنه تحريرٌ يدوي سابق — فلا تتغير النسبة الخاطئة أصلاً. وتحرير
        // الخلية يكتب ما يقوله الملف بلا التباس، وكلٌّ منها يمرّ بالخدمة ويترك أثر تدقيق.
        for (let m = 1; m <= 12; m++) await projects.setAllocationCell(ctx, it.allocId, m, it.pct);
        done.allocationsUpdated++; continue;
      }
      const employeeId = it.employeeId || idByPerson.get(it.key)
        || (await get('SELECT id FROM employee WHERE name_ar = ? AND deleted_at IS NULL', [it.person]))?.id;
      if (!employeeId) { fail(`تسكين ${it.person} على ${it.code}`, 'تعذّر العثور على سجل الموظف'); continue; }
      const prj = idByCode.get(it.code) || (await get('SELECT id FROM project WHERE code = ? AND deleted_at IS NULL', [it.code]))?.id;
      if (!prj) { fail(`تسكين ${it.person} على ${it.code}`, 'تعذّر العثور على المشروع'); continue; }
      await projects.assignEmployee(ctx, prj, { employeeId, pct: it.pct, fromMonth: 1, toMonth: 12, year: REF_YEAR, type: 'مشروع' });
      done.allocationsCreated++;
    } catch (e) { fail(`تسكين ${it.person} على ${it.code}`, e); }
  }
  return done;
}

// ─────────────────────────────────────────────────────────────────────────────
// العرض
// ─────────────────────────────────────────────────────────────────────────────

export function renderPlan(plan, { apply = false, done = null } = {}) {
  const L = []; const p = (s = '') => L.push(s);
  const bar = (ch = '─') => ch.repeat(78);
  p(apply ? 'مطابقة ملف الاستشارات — تنفيذ' : 'مطابقة ملف الاستشارات — معاينة (لا يُكتب شيء)');
  p(bar('═'));
  p(`مشاريع تُصحَّح: ${plan.projects.filter((x) => x.kind === 'update').length} · مشاريع تُنشأ: ${plan.projects.filter((x) => x.kind === 'create').length}`);
  p(`سجلات موظفين تُنشأ: ${plan.employees.length} (بلا حساب دخول) · ربط بحساب قائم: ${plan.links.length}`);
  p(`تسكين يُنشأ: ${plan.allocations.filter((x) => x.kind === 'create').length} · تسكين تُصحَّح نسبته: ${plan.allocations.filter((x) => x.kind === 'update').length}`);
  p(`تحتاج قرار إنسان: ${plan.humans.length} · مُتروك بلا إجراء: ${plan.skipped.length}`);
  p();

  if (plan.projects.length) {
    p('المشاريع'); p(bar());
    for (const it of plan.projects) {
      if (it.kind === 'create') { p(`   + إنشاء ${it.code} — ${it.name}`); continue; }
      const fields = Object.entries(it.data).map(([k, v]) => `${LABEL[k] || k} → ${typeof v === 'number' ? sar(v) : v}`).join(' · ');
      p(`   ~ ${it.code} — ${it.name}: ${fields}`);
    }
    p();
  }
  if (plan.employees.length) {
    p('سجلات الموظفين (بلا حساب دخول — قيد المالك)'); p(bar());
    for (const it of plan.employees) p(`   + ${it.person}${it.data.job_title ? ' · ' + it.data.job_title : ''}`);
    p();
  }
  if (plan.links.length) {
    p('ربط بحساب دخول **قائم**'); p(bar());
    for (const it of plan.links) p(`   ↔ ${it.person} ← الحساب ${it.username}`);
    p();
  }
  if (plan.allocations.length) {
    p('التسكين'); p(bar());
    for (const it of plan.allocations) {
      p(it.kind === 'create' ? `   + ${it.person} على ${it.code} بنسبة ${it.pct}%`
        : `   ~ ${it.person} على ${it.code}: ${it.from}% → ${it.pct}%`);
    }
    p();
  }
  if (plan.skipped.length) {
    p('مُتروك بلا إجراء'); p(bar());
    for (const s of plan.skipped) p(`   • ${s.what} — ${s.why}`);
    p();
  }
  p('تحتاج قرار إنسان'); p(bar('═'));
  if (!plan.humans.length) p('   لا شيء.');
  for (const h of plan.humans) { p(`▸ ${h.title}`); p(`   ${h.why}`); }
  p();
  if (done) {
    p('ما نُفِّذ فعلاً'); p(bar());
    p(`مشاريع صُحِّحت: ${done.projectsUpdated} · مشاريع أُنشئت: ${done.projectsCreated}`);
    p(`موظفون أُنشئوا: ${done.employeesCreated} · حسابات رُبطت: ${done.accountsLinked} · حسابات أُنشئت: 0 (ممنوع)`);
    p(`تسكين أُنشئ: ${done.allocationsCreated} · تسكين صُحِّح: ${done.allocationsUpdated}`);
    if (done.failures.length) {
      p(`تعذّر تنفيذها: ${done.failures.length}`);
      for (const x of done.failures) p(`   • ${x.what} — ${x.why}`);
    }
  }
  return L.join('\n');
}

const LABEL = { name_ar: 'الاسم', status: 'الحالة', pm_name: 'مدير المشروع', start_date: 'تاريخ البداية',
  end_date: 'تاريخ النهاية', contract_value_sar: 'قيمة المشروع', budget_sar: 'الميزانية' };

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) { console.error('استعمال: --file=<ملف المالك.xlsm> [--api=<العنوان> --cookie=<ملف الجلسة>] [--apply]'); process.exit(2); }
  const apply = opts.apply === true || opts.apply === 'true';
  // القراءة الحيّة للمعاينة وحدها. الكتابة تمر بخدمات القاعدة، فطلبُ التنفيذ على قراءةٍ حيّة
  // خلطٌ بين مصدرين — يُرفض صراحةً بدل أن يكتب على قاعدةٍ غير التي قرأ منها.
  if (apply && opts.api) { console.error('لا يجوز التنفيذ مع القراءة الحيّة — المعاينة فقط.'); process.exit(2); }
  const file = readWorkbook(opts.file);
  const { plat, source } = await loadPlatform(opts);
  const { plan } = await planApply({ file, plat });
  const done = await applyPlan(plan, { apply });
  console.log(`مصدر قراءة المنصة: ${source}`);
  if (opts.api) console.log('ملاحظة: القراءة الحيّة لا تكشف حسابات الدخول، فبند «ربط بحساب قائم» يُحسم عند التنفيذ على القاعدة.');
  console.log(renderPlan(plan, { apply, done: apply ? done : null }));
  if (!opts.api) { const { close } = await import('../src/core/db/index.js'); await close?.(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('تعذّر إتمام المطابقة:', e.message); process.exit(1); });
}
