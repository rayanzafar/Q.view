// ── المرآة بين الفرصة والمشروع ────────────────────────────────────────────────
// «أي شيء في المشاريع موجود في الفرص — مثلاً «خدمات مدارة» مكسوبة لقطاع الابتكار وهكذا أي شيء.
//  ولازم تتأكد أي مشروع مضاف في المشاريع ينضاف مكسوباً، وأي فرصة توصل مكسوبة في الفرص على طول
//  تنعكس بقيمتها وكل شيء مشروعاً — بس أدخل عليه أحطّ بقية المعلومات كأنه مشروع جديد» — المالك.
//
// ── لماذا وحدةٌ مستقلة ───────────────────────────────────────────────────────
// الاتجاهان يلتقيان في عمودٍ واحد قائم منذ أول يوم: `project.source_opp_id`. وكان العمود يُملأ
// من الترحيل ومن زرٍّ يدوي وحده — فمن يربح فرصةً في سند لا يُولَد له مشروع، ومن يُنشئ مشروعاً
// لا أثر لفوزه في الفرص. أي أن الشاشتين تحكيان قصتين لنفس العمل ولا تلتقيان إلا بيدٍ تتذكّر.
//
// ووضعُ القاعدتين في مكانٍ واحد مقصود: لو كُتبت كلٌّ في وحدتها لافترقتا عند أول تعديل — تُضاف
// خانةٌ إلى إحداهما وتُنسى في الأخرى، فتصير للفرصة الواحدة صورتان لا صورة.
//
// ── وما لا تفعله هذه الوحدة ──────────────────────────────────────────────────
// لا تنسخ الفرصة إلى مشروعٍ نسخاً كاملاً ولا العكس: المشروع يحمل **بذرة** ما يعرفه سجلّ الفرصة
// (الاسم والجهة والقطاع والإدارة والقيمة والمالك) ثم يُكمَّل من صفحته — «بس أدخل عليه أحطّ بقية
// المعلومات كأنه مشروع جديد». والمخرجات والمعالم والعقد تبقى قراراتٍ تُكتب في المشروع لا تُخمَّن.
import { all, get, insert, update, run } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';

// ── الإدارات المشاركة تعبر المرآة (ADR-0008) ─────────────────────────────────
// «مشترك بين إدارتين ولازم المنصة تستقبل هذا الشيء»: فرصةٌ مشتركة تربح فيُولَد مشروعُها
// مشتركاً بنفس إداراته، ومشروعٌ مشترك يُنشأ فتُولَد مرآتُه كذلك — وإلا افترقت الشاشتان من
// أول يوم. المسؤولة تُستبعَد من النسخ (لا تكون مسؤولةً ومشاركةً معاً).
const PARTNER_TABLES = {
  opportunity: { table: 'opportunity_department', col: 'opportunity_id' },
  project: { table: 'project_department', col: 'project_id' },
};
async function partnerIdsOf(kind, rowId) {
  const t = PARTNER_TABLES[kind];
  return (await all(`SELECT department_id FROM ${t.table} WHERE ${t.col} = ?`, [rowId]))
    .map((r) => r.department_id).filter(Boolean);
}
async function copyPartners(ctx, fromKind, fromId, toKind, toId, excludeDeptId) {
  const src = (await partnerIdsOf(fromKind, fromId)).filter((d) => d !== (excludeDeptId || null));
  const t = PARTNER_TABLES[toKind];
  const now = nowIso();
  for (const d of src) {
    await insert(t.table, { [t.col]: toId, department_id: d, created_at: now, created_by: ctx.user?.id || null });
  }
  return src;
}

// الفرصة المولودة من مشروع تُعلَّم في `opportunity.source`. والعلامة ليست زينة: بها يُعرف
// **اتجاه الحقيقة**. الفرصة التي وُلد منها مشروع هي سجلّ ما بِيع (قيمتها ما عُرِض)، أما مرآةُ
// المشروع فسجلٌّ للفوز يتبع مشروعه — فتُحدَّث قيمتها كلما صُحِّحت قيمة المشروع، ولا تُحدَّث
// الأولى أبداً. وبلا هذه العلامة لا يمكن التمييز، فيُكتب فوق رقمٍ أدخله إنسان.
export const MIRROR_SOURCE = 'project';

// المرحلة المكسوبة تُقرأ من الجدول لا تُكتب حرفاً في الشيفرة: المراحل بيانات تُبذَر وتُعدَّل،
// و«WON» معرّفٌ في البذرة الحالية لا قانونٌ في المنتج. وترتيب الفرز يجعل الاختيار قاطعاً لو
// وُجدت أكثر من مرحلة مكسوبة يوماً.
export async function wonStage() {
  return await get('SELECT id, default_win_pct FROM stage WHERE is_won = 1 ORDER BY sort_order, id LIMIT 1');
}

export async function projectOfOpportunity(oppId) {
  if (!oppId) return null;
  return await get('SELECT * FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', [oppId]);
}

// قيمة المشروع المعروضة: العقد ثم أمر الشراء ثم الميزانية — نفس سلّم لوحة المشاريع حرفاً بحرف
// (`bestVal` في views/pmo.js). ولو اختلف السلّمان لعُرض للمشروع رقمٌ ولمرآته رقمٌ آخر.
export function projectHeadlineValue(p) {
  return Number(p.contract_value_halalas) || Number(p.po_value_halalas) || Number(p.budget_halalas) || 0;
}

// سنة البيع حقيقة مستقلة عن التنفيذ والإنشاء. الغياب يبقى غياباً حتى يؤكده المستخدم.
export function mirrorYear(p) {
  const y = Number(p.sale_year);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null;
}

// ── مشروعٌ لكل فرصة مكسوبة ───────────────────────────────────────────────────
// يُستدعى من `moveStage` عند بلوغ مرحلة مكسوبة، ومن سكربت الاستدراك. يُعيد الموجود إن وُجد،
// ولا يُنشئ ثانياً أبداً: الفحص والكتابة داخل معاملة النداء نفسها، فطلبان متزامنان لا يصنعان
// مشروعين لفرصةٍ واحدة — ومن ازدواج المشروع تبدأ ازدواجية القيمة في المحفظة.
//
// والصلاحية هنا **ليست صلاحية إنشاء مشروع**، وهذا مقصود: من يملك إغلاق الفرصة فوزاً يملك أن
// يُثبت فوزه. ولو اشتُرطت صلاحية المشاريع لسقط الفوز نفسه في وجه مدير مبيعات لا يُنشئ مشاريع —
// أو لصار الفوز يُسجَّل بلا مشروع فتعود الشاشتان إلى الافتراق الذي بُنيت هذه الوحدة لإنهائه.
// والأثر مسجَّل في التدقيق بعلامته (`mirror: 'opportunity'`) فلا يُقرأ كأنه إنشاءٌ يدوي.
export async function ensureProjectForWonOpportunity(ctx, opp) {
  const existing = await projectOfOpportunity(opp.id);
  if (existing) return { project_id: existing.id, created: false };
  const pid = id('prj');
  const now = nowIso();
  await insert('project', {
    id: pid,
    name_ar: opp.title_ar,
    sector_id: opp.sector_id || null,
    department_id: opp.department_id || null,
    client_id: opp.client_id || null,
    owner_user_id: opp.owner_user_id || ctx.user?.id || null,
    // قيمة البيع محفوظة في الفرصة المصدر؛ لا تصبح قيمة عقد مؤكدة بمجرد الفوز.
    contract_value_halalas: null,
    // لم يبدأ: المشروع وُلد للتوّ ولا تواريخ له ولا فريق. وحالتُه قرارُ مديره من صفحته.
    status: 'NOT_STARTED', rag: null, kind: 'external',
    source_opp_id: opp.id,
    created_at: now, created_by: ctx.user?.id || null,
  });
  // الفرصة المشتركة تربح مشروعاً مشتركاً: إداراتها المشاركة تُنسخ على مشروعها ساعة ولادته —
  // «لازم في المشاريع تطلع» لمن كان يعمل عليها فرصةً.
  const partners = await copyPartners(ctx, 'opportunity', opp.id, 'project', pid, opp.department_id || null);
  await audit(ctx, { action: 'create', resource: 'project', resourceId: pid, sectorId: opp.sector_id || null,
    detail: { mirror: 'opportunity', source_opp_id: opp.id, value_halalas: Number(opp.value_halalas) || 0,
      ...(partners.length ? { partner_department_ids: partners } : {}) } });
  return { project_id: pid, created: true };
}

// ── فرصةٌ مكسوبة لكل مشروع ───────────────────────────────────────────────────
// يُستدعى من إنشاء المشروع. opts.year سنة بيع أكدها المستخدم؛ الغياب يبقى بلا سنة
// ومستبعداً من المبيعات إلى حين المراجعة. opts.historic يحفظ الاستبعاد التاريخي الصريح.
export async function ensureOpportunityForProject(ctx, project, opts = {}) {
  if (project.source_opp_id) {
    const linked = await get('SELECT id FROM opportunity WHERE id = ? AND deleted_at IS NULL', [project.source_opp_id]);
    if (linked) return { opportunity_id: linked.id, created: false };
  }
  const won = await wonStage();
  // بلا مرحلة مكسوبة في الجدول لا مكان للفرصة أصلاً. لا نخترع مرحلة ولا نُسقِط إنشاء المشروع:
  // المشروع أُنشئ فعلاً، وغياب المرآة يُبلَّغ ولا يُبطل عملاً قائماً.
  if (!won) return { opportunity_id: null, created: false, reason: 'no_won_stage' };
  const oid = id('opp');
  const now = nowIso();
  const value = projectHeadlineValue(project);
  const saleYear = mirrorYear({ sale_year: opts.year });
  await insert('opportunity', {
    id: oid, title_ar: project.name_ar,
    client_id: project.client_id || null,
    sector_id: project.sector_id || null,
    department_id: project.department_id || null,
    owner_user_id: project.owner_user_id || ctx.user?.id || null,
    stage_id: won.id, win_pct: won.default_win_pct ?? 100,
    value_halalas: value,
    year: saleYear,
    source: MIRROR_SOURCE,
    exclude_from_sales: opts.historic || saleYear == null ? 1 : 0,
    stage_changed_at: now,
    created_at: now, created_by: ctx.user?.id || null,
  });
  await insert('opportunity_stage_history', {
    id: id('osh'), opportunity_id: oid, from_stage_id: null, to_stage_id: won.id,
    changed_by: ctx.user?.id || null, changed_at: now,
    note: 'سُجِّل الفوز مع إنشاء المشروع',
  });
  await update('project', project.id, { source_opp_id: oid });
  // مشروعٌ مشترك تُولَد مرآتُه مشتركة — الاتجاه المقابل لنسخ الفوز، بنفس الاستبعاد.
  const partners = await copyPartners(ctx, 'project', project.id, 'opportunity', oid, project.department_id || null);
  await audit(ctx, { action: 'create', resource: 'opportunity', resourceId: oid, sectorId: project.sector_id || null,
    detail: { mirror: 'project', project_id: project.id, value_halalas: value,
      ...(partners.length ? { partner_department_ids: partners } : {}) } });
  return { opportunity_id: oid, created: true };
}

// ── مرآةُ المشروع تتبع مشروعها ───────────────────────────────────────────────
// «أي شيء في المشاريع موجود في الفرص»: لو صُحِّحت قيمة المشروع أو اسمه أو جهته ثم بقيت المرآة
// على قيمتها الأولى، لقرأ المالك رقمين لعملٍ واحد على شاشتين — وهو عين ما بُنيت المرآة لمنعه.
// وتُحدَّث **مرايا المشاريع وحدها** (`source = 'project'`): الفرصة التي وُلد منها المشروع سجلٌّ
// لما عُرِض على الجهة، والكتابةُ فوقها تمحو تاريخاً كتبه إنسان.
const MIRROR_FIELDS = [['name_ar', 'title_ar'], ['client_id', 'client_id'], ['sector_id', 'sector_id'],
  ['department_id', 'department_id'], ['owner_user_id', 'owner_user_id']];
export async function syncMirrorFromProject(ctx, project) {
  if (!project?.source_opp_id) return { updated: false };
  const opp = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [project.source_opp_id]);
  if (!opp || opp.source !== MIRROR_SOURCE) return { updated: false };
  const patch = {};
  for (const [pcol, ocol] of MIRROR_FIELDS) {
    if ((project[pcol] ?? null) !== (opp[ocol] ?? null)) patch[ocol] = project[pcol] ?? null;
  }
  const value = projectHeadlineValue(project);
  if (value !== (Number(opp.value_halalas) || 0)) patch.value_halalas = value;
  // الإدارات المشاركة تتبع المشروع كما تتبعه إدارتُه المسؤولة (ADR-0008): تُقارن مجموعتان
  // وتُكتب مجموعة المشروع كاملةً عند الاختلاف — مسحٌ فكتابة، كما يكتبها بابا التعديل نفساهما.
  const pPartners = (await partnerIdsOf('project', project.id))
    .filter((d) => d !== (project.department_id || null)).sort();
  const oPartners = (await partnerIdsOf('opportunity', opp.id)).sort();
  const partnersDiffer = pPartners.length !== oPartners.length || pPartners.some((d, i) => d !== oPartners[i]);
  if (!Object.keys(patch).length && !partnersDiffer) return { updated: false };
  if (partnersDiffer) {
    const now = nowIso();
    await run('DELETE FROM opportunity_department WHERE opportunity_id = ?', [opp.id]);
    for (const d of pPartners) {
      await insert('opportunity_department',
        { opportunity_id: opp.id, department_id: d, created_at: now, created_by: ctx.user?.id || null });
    }
  }
  if (Object.keys(patch).length) {
    patch.updated_at = nowIso();
    patch.updated_by = ctx.user?.id || null;
    await update('opportunity', opp.id, patch);
  }
  await audit(ctx, { action: 'update', resource: 'opportunity', resourceId: opp.id, sectorId: project.sector_id || null,
    detail: { mirror: 'project', project_id: project.id,
      fields: [...Object.keys(patch), ...(partnersDiffer ? ['partner_department_ids'] : [])] } });
  return { updated: true, opportunity_id: opp.id };
}

// ── هل المشروع ما زال بذرةً لم تُمسّ ─────────────────────────────────────────
// التراجع عن الفوز كان ممنوعاً كلما وُجد مشروع — وهو حكمٌ صحيح حين يكون المشروع عملاً قائماً.
// لكن بعد أن صار كل فوزٍ يُولِّد مشروعاً، صار المنع يقع على **كل** تراجع: يُغلق المالك فرصةً
// فوزاً بالخطأ فلا يجد إلى الرجوع سبيلاً أبداً. فالتفريق بالعمل لا بالوجود: بذرةٌ لم يُكتب فيها
// شيء تُطوى مع التراجع، ومشروعٌ فيه مخرَجٌ أو مهمة أو فاتورة أو تسكين يمنع التراجع كما كان.
const TOUCH_TABLES = ['deliverable', 'milestone', 'task', 'allocation', 'invoice', 'contract', 'document',
  'project_phase', 'risk', 'issue'];
export async function projectIsUntouched(projectId) {
  for (const t of TOUCH_TABLES) {
    const r = await get(`SELECT id FROM ${t} WHERE project_id = ? AND deleted_at IS NULL LIMIT 1`, [projectId]);
    if (r) return false;
  }
  return true;
}

// المشاريع بلا فرصة — للاستدراك وللتقارير. تُعاد كاملة الصفوف كي يقرر النداء ما يفعل بها.
export async function projectsWithoutOpportunity() {
  return await all(`SELECT * FROM project
     WHERE deleted_at IS NULL
       AND (source_opp_id IS NULL
            OR source_opp_id NOT IN (SELECT id FROM opportunity WHERE deleted_at IS NULL))
     ORDER BY created_at`);
}
