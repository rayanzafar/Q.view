#!/usr/bin/env node
// ── تطبيق خطة الدفتر المعبّأ على المنصة — معاينةٌ افتراضاً، وكتابةٌ بأربعة أقفال ─────────────
//
//   node --experimental-sqlite scripts/apply-workbook.mjs --plan=<الخطة.json>
//        ← معاينة: لا يُفتح اتصالُ قاعدةٍ أصلاً، ولا يُكتب صفٌّ واحد. تُطبع الخطة ملخَّصةً وبصمتها.
//
//   node --experimental-sqlite scripts/apply-workbook.mjs --plan=<الخطة.json> --apply \
//        --confirm=<بصمة ملف الخطة> --backup=<ملف نسخة احتياطية طازج> \
//        [--allow-conflicts] [--actor=sysadmin@evc.sa]
//        ← التنفيذ.
//
// هذا الملف **لا يقرأ الدفتر ولا يطابق**: المطابقة عملُ `reconcile-workbook.mjs` وحده، وهذا
// يستهلك ما أنتجه. سببُ الفصل أن المعاينة التي وافق عليها المالك يجب أن تكون **هي نفسها** ما
// يُكتب: بصمة الملف (`--confirm`) تربط الموافقة بالبايتات، فخطةٌ عُدِّلت بعد العرض تُردّ.
//
// ── الأقفال الأربعة، بهذا الترتيب، قبل أي كتابة ────────────────────────────────
//   ١) بلا `--apply` ⇒ معاينة وخروج بنجاح.
//   ٢) `--confirm` ≠ بصمة ملف الخطة ⇒ رفض «الخطة تغيّرت بعد المعاينة — أعد الكشف».
//   ٣) `--backup` غائب أو أقدم من ساعة أو أصغر من ميغابايت ⇒ رفض (لا رجعة بلا نسخة).
//   ٤) `conflicts` غير فارغة بلا `--allow-conflicts` ⇒ رفض: التعارض قرارُ إنسان لا خيارُ سكربت.
//   ثم الفاعل: حسابُ دخولٍ **قائمٌ ونشط** بالبريد المُمرَّر. ولا يُنشأ حساب هنا بحال.
//
// ── لماذا حسابٌ حقيقي لا هوية مُصطنَعة ────────────────────────────────────────
// كل صفٍّ يُولد هنا يختم منشئه في `created_by`/`owner_user_id`، وهذه مفاتيح أجنبية على جدول
// الحسابات: هويةٌ مُخترَعة للسكربت تُسقط الإدراج على بوستجرس، وتترك على سكويلايت صفوفاً تشير
// إلى لا أحد. فالفاعل حسابٌ إداريٌّ قائم، واسمه يظهر في كل سطر تدقيق فيُعرف أن هذا أثرُ عملية
// استيرادٍ لا نقرةُ إنسان.
//
// ── خريطة مفاتيح العقد ⟵ مفاتيح الخدمات (وُضعت بعد قراءة الخدمات، لا بالتخمين) ──
//   العملاء      : `name_ar` ⟶ clients.createClient(ctx, { name_ar })
//   المشاريع     : department_id · client_id (أو client_ref مُحلَّلاً) · status · rag ·
//                  start_date · end_date · contract_value_sar · budget_sar ⟶ نفس الأسماء في
//                  createProject/updateProject (الخدمة تحوّل الريال إلى هللات بـ toHalalas،
//                  فلا تحويل هنا — القيمة في العقد ريالٌ شاملٌ للضريبة كما يُخزَّن العمود).
//                  `owner_user_id` ⟶ نفس الاسم (الإنشاء والتعديل كلاهما يقبله).
//                  `pm_name` ⟶ **التعديل وحده**: `createProject` لا يكتب هذا العمود إطلاقاً،
//                  فالمشروع الجديد يُنشأ ثم يُتبَع بتعديلٍ يكتب اسم مدير المشروع.
//                  `progress_pct` ⟶ التعديل وحده (الإنشاء لا يقبله).
//                  والقطاع يُؤخذ من `meta.sector_id` عند الإنشاء.
//   المراحل      : `name_ar` ⟶ governance.createItem(ctx, projectId, 'phase', { name_ar })
//   المخرجات     : `name_ar` · `amount_sar` (ريالٌ شامل — الخدمة تحوّله) · `period` بصيغة
//                  «سنة-شهر» ⟶ عمودَي الشهر والسنة · `status` · `notes` · `phase_id`
//                  (أو phase_ref مُحلَّلاً) ⟶ نفس الأسماء في createItem/updateItem.
//   الموظفون     : name_ar · name_en · job_title · department_id · employment_type ·
//                  hire_date ⟶ نفس الأسماء في org.createEmployee، والقطاع من `meta.sector_id`.
//                  التعديل: department_id · job_title ⟶ org.updateEmployee.
//                  **`capacity_pct` لا مقابل له في هاتين الخدمتين** — يُسقَط ويُطبع في
//                  «حقولٌ لم تُكتب»، وكتابتُه لها خدمتها المستقلة (سِعة الموظف) خارج نطاق هذا الملف.
//   التسكين      : employee_id · project_id · type · pct · fromMonth · toMonth · year ⟶
//                  projects.assignEmployee(ctx, projectId, {...}) بنفس الأسماء.
//
// ── ما لا يُكتب من هنا أبداً ─────────────────────────────────────────────────
//   • الفوترة والتحصيل وتواريخ التسليم والقبول: تُختم من مسارها المالي أو من تغيير الحالة نفسه.
//     خطةٌ تحمل أحد هذه المفاتيح تُردّ **قبل** أي كتابة، لا تُنظَّف بصمت.
//   • حسابات الدخول، ونقل الموظف بين القطاعات، والفواتير، والتكاليف.
//
// ── المعاملات والأثر ────────────────────────────────────────────────────────
// معاملةٌ واحدة لكل مجموعة، بالترتيب: العملاء ← المشاريع ← المراحل ← المخرجات ← الموظفون ←
// التسكين. يسبق كل مجموعةٍ سطرُ «بدء» يُكتب **خارج** معاملتها (كي يبقى شاهداً لو تعثّرت)،
// ويُختم داخلها سطرُ «انتهاء» بعددها. وتعثُّر صفٍّ واحد يُسقط مجموعته كاملة ويُوقف التشغيل —
// والمجموعات التي سبقتها تبقى مكتوبة، ويُقال ذلك صراحةً في المخرجات.
//
// ── لا تُعاد على الملف نفسه ─────────────────────────────────────────────────
// ليس في الخطة معرّفٌ ثابت يُبنى عليه «أنشئ إن لم يوجد»: إعادةُ التشغيل تُنشئ نسخاً ثانية.
// الطريق الصحيح لإعادة العمل: أعد الكشف (يقرأ الحيّ كما صار) ثم طبّق الخطة الجديدة.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const GROUPS = ['clients', 'projects', 'phases', 'deliverables', 'employees', 'allocations'];
const GROUP_AR = {
  clients: 'العملاء', projects: 'المشاريع', phases: 'المراحل',
  deliverables: 'المخرجات', employees: 'الموظفون', allocations: 'التسكين',
};
const MIN_BACKUP_BYTES = 1024 * 1024;
const MAX_BACKUP_AGE_MIN = 60;
const ALLOC_TYPES = ['pm', 'lead', 'member', 'owner'];
// أختامٌ لا تُكتب من الاستيراد بحال — تُردّ الخطة كلها إن حملتها.
const FORBIDDEN_KEYS = ['invoiced_at', 'collected_at', 'delivered_at', 'accepted_at'];

function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) o[m[1]] = m[2] ?? true;
  }
  return o;
}

const isTrue = (v) => v === true || v === 'true';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

class Refuse extends Error {}          // قفلٌ رُدّ عنده — خروج ٢
const refuse = (msg) => { throw new Refuse(msg); };

// وحدةُ القاعدة تُحمَّل عند التنفيذ وحده. المعاينة والرفض لا يفتحان اتصالاً أصلاً — ولذلك
// يُغلَق ما فُتح فقط: استيرادُها في مُعالج الخطأ كان يفتح القاعدة ليُغلقها.
let dbMod = null;
const closeDb = async () => { try { await dbMod?.close?.(); } catch { /* لا شيء */ } };

// ── قراءة الخطة والتحقق من شكلها ─────────────────────────────────────────────
export function loadPlan(path) {
  let bytes;
  try { bytes = readFileSync(path); }
  catch { refuse(`تعذّر فتح ملف الخطة «${path}» — تأكّد من المسار`); }
  const sha = sha256(bytes);
  let plan;
  try { plan = JSON.parse(bytes.toString('utf8')); }
  catch (e) { refuse(`ملف الخطة غير مقروء — ${e.message}`); }
  if (!plan || typeof plan !== 'object') refuse('ملف الخطة فارغ أو غير صالح');
  plan.meta = plan.meta || {};
  for (const g of GROUPS) if (!Array.isArray(plan[g])) plan[g] = [];
  plan.conflicts = Array.isArray(plan.conflicts) ? plan.conflicts : [];
  return { plan, sha, bytes };
}

// أختام الفوترة والتسليم تُردّ **قبل** الكتابة: تنظيفُها بصمت يجعل المعاينة تقول شيئاً
// وتكتب المنصة شيئاً آخر، وهذا أسوأ من الرفض.
export function assertNoForbiddenStamps(plan) {
  const hits = [];
  const scan = (obj, where) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of FORBIDDEN_KEYS) if (k in obj) hits.push(`${where} · ${k}`);
  };
  plan.projects.forEach((it, i) => { scan(it.patch, `مشروع #${i + 1}`); scan(it.data, `مشروع #${i + 1}`); });
  plan.deliverables.forEach((it, i) => { scan(it.patch, `مخرج #${i + 1}`); scan(it.data, `مخرج #${i + 1}`); });
  if (hits.length) {
    refuse('الخطة تحمل أختام فوترة أو تسليم، وهذه تُسجَّل من صفحتها لا من الاستيراد: ' + hits.join(' · '));
  }
}

// ── المعاينة ─────────────────────────────────────────────────────────────────
const brief = (group, it) => {
  const op = it.op === 'create' ? '+' : '~';
  switch (group) {
    case 'clients': return `${op} ${it.name_ar || it.ref || ''}`;
    case 'projects': return it.op === 'create'
      ? `+ ${it.data?.name_ar || it.ref || ''}`
      : `~ ${it.live_name || it.id} ← ${Object.keys(it.patch || {}).join('، ') || 'بلا حقول'}`;
    case 'phases': return `+ ${it.name_ar || ''} (${it.project_ref || it.project_id || ''})`;
    case 'deliverables': return it.op === 'create'
      ? `+ ${it.data?.name_ar || ''} · ${it.data?.amount_sar ?? '—'} ريال · ${it.data?.period || 'بلا شهر'}`
      : `~ ${it.id} ← ${Object.keys(it.patch || {}).join('، ') || 'بلا حقول'}`;
    case 'employees': return it.op === 'create'
      ? `+ ${it.data?.name_ar || it.ref || ''}`
      : `~ ${it.id} ← ${Object.keys(it.patch || {}).join('، ') || 'بلا حقول'}`;
    case 'allocations': return `+ ${it.employee_ref || it.employee_id} على ${it.project_ref || it.project_id}`
      + ` · ${it.pct ?? 100}% · الأشهر ${it.fromMonth ?? 1}–${it.toMonth ?? 12} · سنة ${it.year ?? '—'}`;
    default: return JSON.stringify(it);
  }
};

export function renderPreview(plan, sha, file) {
  const L = []; const p = (s = '') => L.push(s);
  p('تطبيق دفتر البيانات — معاينة (لا يُكتب شيء)');
  p('═'.repeat(78));
  p(`ملف الخطة: ${file}`);
  p(`بصمة الخطة: ${sha}`);
  if (plan.meta.file) p(`الدفتر المصدر: ${plan.meta.file}`);
  if (plan.meta.sector_id) p(`القطاع: ${plan.meta.sector_id}`);
  if (plan.meta.generated_at) p(`تاريخ الكشف: ${plan.meta.generated_at}`);
  p();
  for (const g of GROUPS) {
    const rows = plan[g];
    const creates = rows.filter((x) => x.op !== 'update').length;
    const updates = rows.length - creates;
    p(`${GROUP_AR[g]}: ${rows.length} (يُنشأ ${creates} · يُصحَّح ${updates})`);
    for (const it of rows.slice(0, 5)) p(`   ${brief(g, it)}`);
    if (rows.length > 5) p(`   … و${rows.length - 5} غيرها`);
  }
  p();
  p(`تعارضات تحتاج قرار إنسان: ${plan.conflicts.length}`);
  for (const c of plan.conflicts.slice(0, 5)) p(`   • ${c.kind || ''} — ${c.where || ''}: ${c.why || ''}`);
  if (plan.conflicts.length > 5) p(`   … و${plan.conflicts.length - 5} غيرها`);
  const ro = plan.reported_only || {};
  const roKeys = Object.keys(ro).filter((k) => Array.isArray(ro[k]) && ro[k].length);
  if (roKeys.length) {
    p();
    p('يُذكر ولا يُكتب:');
    for (const k of roKeys) p(`   • ${k}: ${ro[k].length}`);
  }
  const delta = (plan.totals || {}).revenue_delta_by_year || {};
  const years = Object.keys(delta);
  if (years.length) {
    p();
    p('أثر الإيراد بحسب السنة (ريال):');
    for (const y of years.sort()) p(`   ${y}: ${delta[y]}`);
  }
  p();
  p('للتنفيذ: أعد التشغيل مع');
  p(`   --apply --confirm=${sha} --backup=<ملف النسخة الاحتياطية>`
    + (plan.conflicts.length ? ' --allow-conflicts' : ''));
  return L.join('\n');
}

// ── الأقفال ──────────────────────────────────────────────────────────────────
export function checkGuards({ plan, sha, opts }) {
  if (!opts.confirm || String(opts.confirm).trim().toLowerCase() !== sha) {
    refuse('الخطة تغيّرت بعد المعاينة — أعد الكشف. '
      + `(البصمة الحالية ${sha}${opts.confirm ? ` والممرَّرة ${String(opts.confirm).trim()}` : ' ولم تُمرَّر بصمة'})`);
  }
  if (!opts.backup || opts.backup === true) refuse('لا تنفيذ بلا نسخة احتياطية طازجة — مرّر ملف النسخة');
  let st;
  try { st = statSync(opts.backup); }
  catch { refuse(`ملف النسخة الاحتياطية «${opts.backup}» غير موجود — خذ نسخةً ثم أعد المحاولة`); }
  const ageMin = (Date.now() - st.mtimeMs) / 60000;
  if (ageMin > MAX_BACKUP_AGE_MIN) {
    refuse(`النسخة الاحتياطية أقدم من ${MAX_BACKUP_AGE_MIN} دقيقة (عمرها ${Math.round(ageMin)} دقيقة) — خذ نسخةً جديدة`);
  }
  if (st.size < MIN_BACKUP_BYTES) {
    refuse(`النسخة الاحتياطية أصغر من المعقول (${st.size} بايت) — تأكّد أنها اكتملت قبل التنفيذ`);
  }
  if (plan.conflicts.length && !isTrue(opts['allow-conflicts'])) {
    refuse(`في الخطة ${plan.conflicts.length} تعارضاً يحتاج قرار إنسان — احسمها في الدفتر وأعد الكشف،`
      + ' أو مرّر --allow-conflicts إن كان تجاوزها قراراً واعياً');
  }
}

// ── التنفيذ ──────────────────────────────────────────────────────────────────
export async function applyPlan({ plan, sha, opts, log = console.log }) {
  const db = dbMod = await import('../src/core/db/index.js');
  const { audit } = await import('../src/core/audit/index.js');
  const { initRbac } = await import('../src/core/rbac/index.js');
  const clientsSvc = await import('../src/modules/clients/clients.js');
  const projectsSvc = await import('../src/modules/pmo/projects.js');
  const governance = await import('../src/modules/pmo/governance.js');
  const orgSvc = await import('../src/modules/org/org.js');

  const actorEmail = typeof opts.actor === 'string' ? opts.actor : 'sysadmin@evc.sa';
  const actor = await db.get(
    'SELECT * FROM app_user WHERE lower(email) = lower(?) AND active = 1 AND deleted_at IS NULL', [actorEmail]);
  if (!actor) refuse(`لا حساب دخولٍ نشطٍ بالبريد «${actorEmail}» — مرّر حساباً إدارياً قائماً بـ --actor`);
  await initRbac();

  const ctx = { user: actor, ip: '127.0.0.1' };
  const startedAt = new Date().toISOString();
  const sectorId = plan.meta.sector_id || null;
  const file = plan.meta.file || opts.plan;
  const envelope = (group, phase, counts) => audit(ctx, {
    action: 'import', resource: 'workbook', resourceId: sha.slice(0, 16), sectorId,
    detail: { via: 'workbook', file, sha, group, phase, counts },
  });

  const refs = { clients: new Map(), projects: new Map(), phases: new Map(), employees: new Map() };
  const created = { clients: [], projects: [], phases: [], deliverables: [], employees: [], allocations: [] };
  const counts = Object.fromEntries(GROUPS.map((g) => [g, { created: 0, updated: 0 }]));
  const dropped = [];   // حقولٌ في الخطة لا مقابل لها في الخدمات — تُقال ولا تُكتب

  const resolveRef = (kind, item, idKey, refKey) => {
    const direct = item[idKey];
    if (direct) return direct;
    const ref = item[refKey];
    if (ref && refs[kind].has(ref)) return refs[kind].get(ref);
    if (ref) refuse(`لم يُعرف «${ref}» — لم يُنشأ في هذه الجولة (${kind})`);
    return null;
  };

  // مجموعةٌ واحدة: سطرُ بدءٍ خارج المعاملة (شاهدٌ يبقى لو تعثّرت)، ثم العمل وسطرُ الانتهاء داخلها.
  async function runGroup(group, items, body) {
    if (!items.length) return;
    await envelope(group, 'start', { total: items.length });
    try {
      await db.tx(async () => {
        for (const [i, it] of items.entries()) await body(it, i);
        await envelope(group, 'done', counts[group]);
      });
    } catch (e) {
      const done = GROUPS.slice(0, GROUPS.indexOf(group)).filter((g) => plan[g].length).map((g) => GROUP_AR[g]);
      log('');
      log(`تعذّر إتمام مجموعة «${GROUP_AR[group]}» — ${e.message}`);
      log(`تراجعت هذه المجموعة كاملةً ولم يُكتب منها شيء.${done.length ? ' وما قبلها مكتوبٌ وثابت: ' + done.join('، ') + '.' : ''}`);
      log('صحّح السبب، أعد الكشف على الحيّ كما صار، ثم طبّق الخطة الجديدة.');
      const err = new Error(e.message);
      err.groupFailed = group;
      throw err;
    }
  }

  // ① العملاء
  await runGroup('clients', plan.clients, async (it, i) => {
    try {
      const row = await clientsSvc.createClient(ctx, { name_ar: it.name_ar });
      if (it.ref) refs.clients.set(it.ref, row.id);
      created.clients.push(row.id);
      counts.clients.created++;
    } catch (e) { throw new Error(`العميل «${it.ref || it.name_ar || i + 1}»: ${e.message}`); }
  });

  // ② المشاريع
  await runGroup('projects', plan.projects, async (it, i) => {
    const label = it.op === 'create' ? (it.ref || it.data?.name_ar) : (it.live_name || it.id);
    try {
      if (it.op === 'create') {
        const d = { ...(it.data || {}) };
        const clientId = resolveRef('clients', d, 'client_id', 'client_ref');
        const row = await projectsSvc.createProject(ctx, {
          name_ar: d.name_ar, sector_id: sectorId || undefined,
          ...(clientId ? { client_id: clientId } : {}),
          ...(d.department_id ? { department_id: d.department_id } : {}),
          ...(d.status ? { status: d.status } : {}),
          ...(d.rag ? { rag: d.rag } : {}),
          ...(d.start_date ? { start_date: d.start_date } : {}),
          ...(d.end_date ? { end_date: d.end_date } : {}),
          ...(d.contract_value_sar != null ? { contract_value_sar: d.contract_value_sar } : {}),
          ...(d.budget_sar != null ? { budget_sar: d.budget_sar } : {}),
          ...(d.owner_user_id ? { owner_user_id: d.owner_user_id } : {}),
        });
        const pid = row.id || row.project_id;
        if (it.ref) refs.projects.set(it.ref, pid);
        created.projects.push(pid);
        counts.projects.created++;
        // اسم مدير المشروع لا تكتبه خدمة الإنشاء — تعديلٌ تالٍ في المعاملة نفسها.
        if (d.pm_name) await projectsSvc.updateProject(ctx, pid, { pm_name: d.pm_name });
        return;
      }
      const patch = { ...(it.patch || {}) };
      const clientId = resolveRef('clients', patch, 'client_id', 'client_ref');
      delete patch.client_ref;
      if (clientId) patch.client_id = clientId;
      if (!Object.keys(patch).length) return;
      await projectsSvc.updateProject(ctx, it.id, patch);
      counts.projects.updated++;
    } catch (e) { throw new Error(`المشروع «${label || i + 1}»: ${e.message}`); }
  });

  // ③ المراحل
  await runGroup('phases', plan.phases, async (it, i) => {
    try {
      const pid = resolveRef('projects', it, 'project_id', 'project_ref');
      if (!pid) throw new Error('بلا مشروع');
      const row = await governance.createItem(ctx, pid, 'phase', { name_ar: it.name_ar });
      if (it.ref) refs.phases.set(it.ref, row.id);
      created.phases.push(row.id);
      counts.phases.created++;
    } catch (e) { throw new Error(`المرحلة «${it.ref || it.name_ar || i + 1}»: ${e.message}`); }
  });

  // ④ المخرجات — القيمة ريالٌ شامل والخدمة تحوّلها، والشهر «سنة-شهر» يصير عمودَي شهرٍ وسنة،
  //    وسطرُ الإيراد يُوائم نفسه داخل معاملة الكتابة (خدمة الاعتراف).
  await runGroup('deliverables', plan.deliverables, async (it, i) => {
    const label = it.op === 'create' ? (it.data?.name_ar || i + 1) : it.id;
    try {
      if (it.op === 'create') {
        const d = { ...(it.data || {}) };
        const pid = resolveRef('projects', it, 'project_id', 'project_ref');
        if (!pid) throw new Error('بلا مشروع');
        const phaseId = resolveRef('phases', d, 'phase_id', 'phase_ref');
        const row = await governance.createItem(ctx, pid, 'deliverable', {
          name_ar: d.name_ar,
          ...(d.amount_sar != null ? { amount_sar: d.amount_sar } : {}),
          ...(d.period ? { period: d.period } : {}),
          ...(d.status ? { status: d.status } : {}),
          ...(d.notes ? { notes: d.notes } : {}),
          ...(phaseId ? { phase_id: phaseId } : {}),
        });
        created.deliverables.push(row.id);
        counts.deliverables.created++;
        return;
      }
      const p = { ...(it.patch || {}) };
      const phaseId = resolveRef('phases', p, 'phase_id', 'phase_ref');
      delete p.phase_ref;
      if (phaseId) p.phase_id = phaseId;
      if (!Object.keys(p).length) return;
      await governance.updateItem(ctx, 'deliverable', it.id, p);
      counts.deliverables.updated++;
    } catch (e) { throw new Error(`المخرج «${label}»: ${e.message}`); }
  });

  // ⑤ الموظفون — سجلٌّ وإدارةٌ ومسمّى، بلا حساب دخول وبلا نقل قطاع.
  await runGroup('employees', plan.employees, async (it, i) => {
    const label = it.op === 'create' ? (it.ref || it.data?.name_ar) : it.id;
    try {
      if (it.op === 'create') {
        const d = { ...(it.data || {}) };
        if (d.capacity_pct != null) dropped.push(`الموظف «${d.name_ar}» — نسبة الدوام لا تُكتب من هنا`);
        const row = await orgSvc.createEmployee(ctx, {
          name_ar: d.name_ar, sector_id: sectorId || null,
          ...(d.name_en ? { name_en: d.name_en } : {}),
          ...(d.job_title ? { job_title: d.job_title } : {}),
          ...(d.department_id ? { department_id: d.department_id } : {}),
          ...(d.employment_type ? { employment_type: d.employment_type } : {}),
          ...(d.hire_date ? { hire_date: d.hire_date } : {}),
        });
        if (it.ref) refs.employees.set(it.ref, row.id);
        created.employees.push(row.id);
        counts.employees.created++;
        return;
      }
      const p = {};
      if ('department_id' in (it.patch || {})) p.department_id = it.patch.department_id;
      if ('job_title' in (it.patch || {})) p.job_title = it.patch.job_title;
      if (!Object.keys(p).length) return;
      await orgSvc.updateEmployee(ctx, it.id, p);
      counts.employees.updated++;
    } catch (e) { throw new Error(`الموظف «${label || i + 1}»: ${e.message}`); }
  });

  // ⑥ التسكين — السنة صريحة دائماً (الغياب يعني «السنة الحالية» في الخدمة، وهذا تخمين).
  await runGroup('allocations', plan.allocations, async (it, i) => {
    const label = `${it.employee_ref || it.employee_id} على ${it.project_ref || it.project_id}`;
    try {
      const employeeId = resolveRef('employees', it, 'employee_id', 'employee_ref');
      const projectId = resolveRef('projects', it, 'project_id', 'project_ref');
      if (!employeeId) throw new Error('بلا موظف');
      if (!projectId) throw new Error('بلا مشروع');
      const type = it.type || 'member';
      if (!ALLOC_TYPES.includes(type)) throw new Error(`صفة التسكين «${type}» غير معروفة`);
      await projectsSvc.assignEmployee(ctx, projectId, {
        employeeId, type, pct: it.pct ?? 100,
        fromMonth: it.fromMonth ?? 1, toMonth: it.toMonth ?? 12, year: it.year,
      });
      counts.allocations.created++;
      created.allocations.push(`${employeeId}→${projectId}`);
    } catch (e) { throw new Error(`تسكين ${label || i + 1}: ${e.message}`); }
  });

  const auditRow = await db.get('SELECT COUNT(*) AS "count" FROM audit_log WHERE at >= ?', [startedAt]);
  return { counts, created, dropped, startedAt, auditRows: Number(auditRow?.count || 0), actor };
}

export function renderResult(res, { sha, file }) {
  const L = []; const p = (s = '') => L.push(s);
  p('تطبيق دفتر البيانات — ما نُفِّذ فعلاً');
  p('═'.repeat(78));
  p(`ملف الخطة: ${file} · البصمة: ${sha}`);
  p(`المُنفِّذ: ${res.actor.name_ar || res.actor.username || res.actor.email}`);
  p();
  for (const g of GROUPS) {
    const c = res.counts[g];
    if (!c.created && !c.updated) continue;
    p(`${GROUP_AR[g]}: أُنشئ ${c.created} · صُحِّح ${c.updated}`);
    const ids = res.created[g];
    if (ids.length) p(`   ${ids.join('، ')}`);
  }
  if (res.dropped.length) {
    p();
    p('حقولٌ لم تُكتب (لا مقابل لها في الخدمات):');
    for (const d of res.dropped) p(`   • ${d}`);
  }
  p();
  p(`أسطر التدقيق منذ بدء التشغيل: ${res.auditRows}`);
  return L.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.plan || opts.plan === true) {
    console.error('استعمال: --plan=<الخطة.json> [--apply --confirm=<بصمة الخطة> --backup=<ملف> [--allow-conflicts] [--actor=<البريد>]]');
    process.exit(2);
  }
  const { plan, sha } = loadPlan(opts.plan);
  assertNoForbiddenStamps(plan);

  if (!isTrue(opts.apply)) {
    console.log(renderPreview(plan, sha, opts.plan));
    return;
  }
  checkGuards({ plan, sha, opts });

  let res;
  try {
    res = await applyPlan({ plan, sha, opts });
  } catch (e) {
    if (e instanceof Refuse) throw e;
    await closeDb();
    process.exit(1);
  }
  console.log(renderResult(res, { sha, file: opts.plan }));
  await closeDb();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => {
    console.error(e instanceof Refuse ? e.message : `تعذّر إتمام التطبيق: ${e.message}`);
    await closeDb();
    process.exit(e instanceof Refuse ? 2 : 1);
  });
}
