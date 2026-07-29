// نسبُ المشروع الأربع — مصدرٌ واحد تقرأ منه صفحةُ المشروع والمحفظةُ ولوحاتُ الإدارة.
//
// كانت كل شاشة تحسب النسبة بطريقتها من نفس الجداول، فتختلف الشاشات على مشروع واحد ولا يعرف
// القارئ أيَّها يصدّق. وأصل الخلاف أن النسب الثلاث المالية والتنفيذية كانت تُقرأ من **خانة
// حالة واحدة** على المخرَج تدوسها الفوترة. فُصلت الحقائق (ترحيلة ٠١٧)، وهذا الملف يجمعها:
//
//   • الإنجاز التنفيذي — من المخرجات المعتمَدة بأوزانها. الاعتماد وحده يرفعه: التسليم دعوى
//     من المنفِّذ، والاعتماد إقرارٌ من صاحب الحق. ويُعرض التسليم بجانبه لا مدمجاً فيه، كي
//     يُرى الفرق بين «سلّمنا» و«قُبِل» — وهو الفرق الذي يسبق كل خلافٍ على مستخلص.
//   • حالة الجدول الزمني — من المعالم: ما استُحق ولم يُحقَّق، وما اقترب.
//   • نسبة الفوترة — من ختم الفوترة على المخرجات، منسوبةً إلى قيمة العقد.
//   • نسبة التحصيل — من ختم التحصيل، منسوبةً إلى **المفوتر** لا إلى العقد: التحصيل يقيس
//     تحوّل المطالبة إلى نقد، ونسبتُه إلى العقد تخلط تأخّرَ الفوترة بتأخّر السداد.
//
// الوزن: يُقرأ من الخانة إن كتبها صاحب المشروع؛ وإلا يُشتقّ من القيمة المالية (المخرَج الذي
// يمثّل نصف العقد ليس كالمخرَج الرمزي)؛ وإلا فبالتساوي. والاشتقاق عند القراءة لا في خانة
// مخزَّنة: الخانة تشيخ مع أول مخرَج يُضاف، والاشتقاق لا يشيخ.
import { all, get } from '../../core/db/index.js';
import { nowIso } from '../../core/util/ids.js';

const N = (v) => Number(v) || 0;
const pct = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : null);

// الحالات التي تعني «أُنجز العمل» و«اعتُمد». مفصولتان عمداً: الأولى تُقاس بها الحركة،
// والثانية يُقاس بها الإنجاز المعتمَد الذي يُبنى عليه المستخلص.
export const DELIVERED_STATES = ['DELIVERED', 'ACCEPTED'];
export const ACCEPTED_STATES = ['ACCEPTED'];

// وزنُ كل مخرَج ضمن مجموعته. يُعيد Map من المعرّف إلى وزنٍ مطبَّع مجموعه ١٠٠.
export function weighDeliverables(rows = []) {
  const live = rows.filter((d) => d && !d.deleted_at);
  const out = new Map();
  if (!live.length) return out;
  const explicit = live.filter((d) => Number.isFinite(Number(d.weight)) && Number(d.weight) > 0);
  // خلطُ الأوزان المكتوبة بالمشتقّة يعطي مجموعاً بلا معنى، فالقاعدة كلٌّ أو لا شيء:
  // إن كتب صاحب المشروع وزناً لمخرَجٍ واحد فقط فما بقي لا وزن له، والاشتقاق أصدق للمجموعة كلها.
  const basis = explicit.length === live.length ? live.map((d) => Number(d.weight))
    : live.some((d) => N(d.amount_halalas) > 0) ? live.map((d) => N(d.amount_halalas))
      : live.map(() => 1);
  const total = basis.reduce((a, b) => a + b, 0);
  live.forEach((d, i) => out.set(d.id, total > 0 ? (basis[i] / total) * 100 : 100 / live.length));
  return out;
}

// الإنجاز التنفيذي وما حوله، من صفوف المخرجات كما هي (دالة صرفة — تُختبر بلا قاعدة بيانات).
export function deliveryProgress(rows = []) {
  const live = rows.filter((d) => d && !d.deleted_at);
  const w = weighDeliverables(live);
  const sum = (pred) => live.filter(pred).reduce((a, d) => a + (w.get(d.id) || 0), 0);
  const acceptedPct = Math.round(sum((d) => ACCEPTED_STATES.includes(d.status)));
  const deliveredPct = Math.round(sum((d) => DELIVERED_STATES.includes(d.status)));
  return {
    total: live.length,
    accepted: live.filter((d) => ACCEPTED_STATES.includes(d.status)).length,
    delivered: live.filter((d) => DELIVERED_STATES.includes(d.status)).length,
    invoiced: live.filter((d) => d.invoiced_at).length,
    collected: live.filter((d) => d.collected_at).length,
    // النسبة المعتمَدة هي «الإنجاز التنفيذي»، والمُسلَّم يُعرض بجانبها فيُقرأ الفارق بينهما
    // على أنه ما ينتظر اعتماد العميل — وهو أول ما يُسأل عنه في مراجعة أي مشروع.
    acceptedPct: live.length ? acceptedPct : null,
    deliveredPct: live.length ? deliveredPct : null,
    awaitingAcceptance: Math.max(0, deliveredPct - acceptedPct),
    weights: w,
  };
}

// حالة الجدول من المعالم وحدها — لا من التواريخ المخطَّطة: المعلم قرارٌ مسجَّل، ومرورُ الزمن
// ليس تأخّراً بذاته. `today` يُمرَّر كي تبقى الدالة صرفة وقابلة للاختبار.
export function scheduleHealth(milestones = [], today = nowIso().slice(0, 10)) {
  const live = milestones.filter((m) => m && !m.deleted_at);
  const soon = new Date(Date.parse(today + 'T00:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
  const met = live.filter((m) => m.status === 'MET');
  const missed = live.filter((m) => m.status === 'MISSED');
  const overdue = live.filter((m) => m.status === 'PENDING' && m.due_date && m.due_date < today);
  const upcoming = live.filter((m) => m.status === 'PENDING' && m.due_date && m.due_date >= today && m.due_date <= soon);
  const tone = (missed.length || overdue.length) ? 'red' : upcoming.length ? 'amber' : live.length ? 'green' : 'slate';
  const note = missed.length ? `${missed.length} معلماً لم يُحقَّق`
    : overdue.length ? `${overdue.length} معلماً فات استحقاقه`
      : upcoming.length ? `${upcoming.length} معلماً خلال ٣٠ يوماً`
        : live.length ? 'المعالم في مواعيدها' : 'لا معالم مسجّلة بعد';
  return { total: live.length, met: met.length, missed: missed.length, overdue, upcoming, tone, note,
    metPct: pct(met.length, live.length) };
}

// ── الحمولة الكاملة لمشروع واحد: استعلامات مجمَّعة، لا استعلام لكل صف ──────────────
// بلا حارس صلاحية هنا عمداً: تُستدعى من خدماتٍ فحصت المشروع قبلها (صفحة المشروع تفحص
// `can(read, project)` أولاً). وضعُ حارس ثانٍ هنا يوهم أنها نقطة دخول مستقلة وهي ليست كذلك.
export async function projectProgress(projectId, { today = nowIso().slice(0, 10) } = {}) {
  const [dlv, milestones, project] = await Promise.all([
    all('SELECT * FROM deliverable WHERE project_id = ? AND deleted_at IS NULL', [projectId]),
    all('SELECT * FROM milestone WHERE project_id = ? AND deleted_at IS NULL', [projectId]),
    get('SELECT contract_value_halalas, po_value_halalas, budget_halalas, progress_pct, status FROM project WHERE id = ?', [projectId]),
  ]);
  const delivery = deliveryProgress(dlv);
  const schedule = scheduleHealth(milestones, today);

  // ── المال: مقامان مختلفان لأن السؤالين مختلفان ──
  const contractValue = N(project?.contract_value_halalas) || N(project?.po_value_halalas) || N(project?.budget_halalas);
  const invoicedAmt = dlv.filter((d) => d.invoiced_at).reduce((a, d) => a + N(d.amount_halalas), 0);
  const collectedAmt = dlv.filter((d) => d.collected_at).reduce((a, d) => a + N(d.amount_halalas), 0);

  // الإنجاز المعروض: المسجَّل يدوياً يفوز إن كُتب (قرار إنسان لا يُلغى باشتقاق)، وإلا فالمشتقّ
  // من المخرجات المعتمَدة. والمشروع المكتمل مئةٌ مهما قيل — حالته أصرحُ من أي حساب.
  const stored = N(project?.progress_pct);
  const derived = delivery.acceptedPct;
  const executive = project?.status === 'COMPLETED' ? 100 : (stored > 0 ? stored : (derived ?? 0));

  return {
    projectId,
    executivePct: executive,
    executiveSource: project?.status === 'COMPLETED' ? 'status' : (stored > 0 ? 'stored' : (derived != null ? 'deliverables' : 'none')),
    delivery,
    schedule,
    money: {
      contractValue,
      invoicedAmt,
      collectedAmt,
      // نسبة الفوترة إلى قيمة العقد: «كم طالبنا به مما تعاقدنا عليه».
      //
      // والفراغ ليس صفراً — وهذه القاعدة نفسها كنتُ أطبّقها في ملخّص المالية وخالفتُها هنا،
      // فأظهرتها البيانات الحقيقية: ١١ مخرَجاً من ٣٤٢ تحمل ختم فوترة، بينما الشركة فوترت
      // ١٤.٩ مليون ريال فعلاً — لأن فواتير المنصة القديمة لم تُربط بمخرجاتها قط (لا سطر
      // `invoice_line.deliverable_id` لها). فطباعة «فوترة ٠٪» على مشروعٍ مفوترٍ بالملايين
      // كذبةٌ يقرأها المالك، والصواب أن يُقال «لم تُربط فوترته بمخرجاته» بلفظه.
      // فالنسبة تُحسب حين يوجد **ختمُ فوترة واحد على الأقل**؛ وإلا فلا أساس للقياس.
      billedPct: delivery.invoiced > 0 ? pct(invoicedAmt, contractValue) : null,
      // نسبة التحصيل إلى المفوتر: «كم قبضنا مما طالبنا به». نسبتُه إلى العقد تخلط
      // تأخُّرَ الفوترة بتأخُّر السداد فيُلام المحصِّل على عملٍ ليس عمله.
      collectedPct: pct(collectedAmt, invoicedAmt),
      uninvoicedReady: dlv.filter((d) => DELIVERED_STATES.includes(d.status) && !d.invoiced_at)
        .reduce((a, d) => a + N(d.amount_halalas), 0),
    },
  };
}

// نفس الحساب للمحفظة كلها — استعلامان اثنان لكل المشاريع، لا اثنان لكل مشروع.
export async function portfolioProgress(projectIds = [], { today = nowIso().slice(0, 10) } = {}) {
  const ids = [...new Set(projectIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const ph = ids.map(() => '?').join(',');
  const [dlv, ms] = await Promise.all([
    all(`SELECT * FROM deliverable WHERE project_id IN (${ph}) AND deleted_at IS NULL`, ids),
    all(`SELECT * FROM milestone WHERE project_id IN (${ph}) AND deleted_at IS NULL`, ids),
  ]);
  const byProject = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.project_id)) m.set(r.project_id, []);
      m.get(r.project_id).push(r);
    }
    return m;
  };
  const d = byProject(dlv); const m = byProject(ms);
  return new Map(ids.map((pid) => [pid, {
    delivery: deliveryProgress(d.get(pid) || []),
    schedule: scheduleHealth(m.get(pid) || [], today),
  }]));
}
