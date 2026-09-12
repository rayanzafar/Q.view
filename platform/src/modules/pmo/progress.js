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

// Evidence describes the existing weighting rule; it never rewrites a stored plan.
function weightingEvidence(live) {
  const explicitCount = live.filter((d) => Number.isFinite(Number(d.weight)) && Number(d.weight) > 0).length;
  const basis = !live.length ? 'none' : explicitCount === live.length ? 'explicit'
    : live.some((d) => N(d.amount_halalas) > 0) ? 'amount' : 'equal';
  return { basis, partialExplicitWeights: explicitCount > 0 && explicitCount < live.length,
    unvaluedCount: live.filter((d) => d.amount_halalas == null || d.amount_halalas === '').length,
    zeroWeightCount: basis === 'amount' ? live.filter((d) => N(d.amount_halalas) === 0).length : 0 };
}

// Facts and review notices are distinct from policy: keep current percentages until
// the owner reviews each project's basis, including completed projects with gaps.
export function progressEvidence(project = {}, delivery = deliveryProgress()) {
  const warnings = [];
  const warn = (code, message) => warnings.push({ code, message });
  const weighting = delivery.weighting || weightingEvidence([]);
  if (project.status === 'COMPLETED' && delivery.total > delivery.accepted)
    warn('COMPLETED_WITH_UNACCEPTED_OUTPUTS', 'المشروع مسجل مكتملًا، وبعض مخرجاته لم تعتمد بعد؛ راجع الحالة والمخرجات قبل اعتماد النسبة.');
  if (project.status === 'COMPLETED' && !delivery.total)
    warn('COMPLETED_WITHOUT_OUTPUTS', 'نسبة الإنجاز مستندة إلى حالة المشروع المكتمل؛ لا توجد مخرجات مسجلة للتحقق منها.');
  if (project.status !== 'COMPLETED' && !delivery.total && !N(project.progress_pct))
    warn('NO_PROGRESS_EVIDENCE', 'لا توجد مخرجات أو نسبة موثقة يمكن التحقق منها؛ الصفر المسجل قد يكون قيمة ابتدائية.');
  if (weighting.partialExplicitWeights)
    warn('PARTIAL_EXPLICIT_WEIGHTS', 'أوزان بعض المخرجات غير مكتملة؛ الحساب الحالي لا يستخدم الأوزان الجزئية، ويحتاج أساس القياس إلى مراجعة.');
  if (weighting.unvaluedCount)
    warn('UNVALUED_DELIVERABLES', 'توجد مخرجات بلا قيمة مسجلة؛ راجعها قبل اعتماد أساس قياس الإنجاز.');
  if (weighting.zeroWeightCount)
    warn('ZERO_WEIGHT_DELIVERABLES', 'توجد مخرجات لا تؤثر في النسبة الحالية لأن الحساب مشتق من القيم المالية؛ راجع أوزانها.');
  if (weighting.basis === 'equal')
    warn('EQUAL_WEIGHT_FALLBACK', 'الحساب الحالي يساوي بين المخرجات لغياب الأوزان والقيم؛ هذا ليس تأكيدًا لاعتماد خطة متساوية.');
  return { warnings, weighting, storedPct: N(project.progress_pct) > 0 ? N(project.progress_pct) : null,
    acceptedPct: delivery.acceptedPct };
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
    weighting: weightingEvidence(live),
  };
}

// حالة الجدول من المعالم وحدها — لا من التواريخ المخطَّطة: المعلم قرارٌ مسجَّل، ومرورُ الزمن
// ليس تأخّراً بذاته. `today` يُمرَّر كي تبقى الدالة صرفة وقابلة للاختبار.
export function scheduleHealth(milestones = [], today = nowIso().slice(0, 10)) {
  const live = milestones.filter((m) => m && !m.deleted_at);
  const soon = new Date(Date.parse(today + 'T00:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
  const met = live.filter((m) => m.status === 'MET');
  const missed = live.filter((m) => m.status === 'MISSED');
  const validDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  };
  const undated = live.filter((m) => m.status === 'PENDING' && !validDate(m.due_date));
  const overdue = live.filter((m) => m.status === 'PENDING' && validDate(m.due_date) && m.due_date < today);
  const upcoming = live.filter((m) => m.status === 'PENDING' && validDate(m.due_date) && m.due_date >= today && m.due_date <= soon);
  const tone = (missed.length || overdue.length) ? 'red' : upcoming.length ? 'amber' : undated.length ? 'slate' : live.length ? 'green' : 'slate';
  const baseNote = missed.length ? `${missed.length} معلماً لم يُحقَّق`
    : overdue.length ? `${overdue.length} معلماً فات استحقاقه`
      : upcoming.length ? `${upcoming.length} معلماً خلال ٣٠ يوماً`
        : undated.length ? 'لا يمكن تقييم الجدول قبل استكمال تواريخ المعالم'
          : live.length ? 'المعالم في مواعيدها' : 'لا معالم مسجّلة بعد';
  const note = undated.length ? `${baseNote} · ${undated.length} معالم تحتاج تاريخًا صحيحًا` : baseNote;
  return { total: live.length, met: met.length, missed: missed.length, overdue, upcoming, undated, tone, note,
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

  // ── الإنجاز المعروض: **المخرجات تحكم متى وُجدت** ──────────────────────────────
  //
  // كانت القاعدة «المسجَّل يدوياً يفوز إن كُتب»، ونيّتها سليمة — قرار إنسان لا يُلغى باشتقاق.
  // لكنها انكسرت على البيانات الحقيقية بأسوأ صورة ممكنة: مشروعٌ حمل `progress_pct = 58`
  // **من استيراد المنصة القديمة** — لا إنسانَ كتبه في سند — فاعتمد مديرُه المخرجات الاثني عشر
  // كلَّها (أوزانها ١٠٠٪) وبقيت الشاشة تقول **٥٨٪**. والبطاقة نفسها تناقض نفسها في سطرين:
  // «الإنجاز التنفيذي ٥٨٪» فوق «١٢ من ١٢ مخرَجاً معتمَداً».
  //
  // وأخطر ما فيه أنه **لا سبيل إلى تصحيحه من الواجهة**: لا حقل لنسبة الإنجاز في صفحة المشروع،
  // فالرقم المستورد يبقى أبداً، والعمل الحقيقي لا يحرّكه شيء. أي أن المنصة تُعاقِب من يستعملها.
  //
  // فالقاعدة انقلبت إلى ما يطابق نموذج المنتج: **متى وُجدت مخرجات فهي مقياس الإنجاز** — هي ما
  // يحرّكه الفريق وما يُبنى عليه المستخلص. والمسجَّل يبقى مصدراً لمشروعٍ **بلا مخرجات** يُقاس
  // تقدّمه بتقدير مديره. والمكتمل مئةٌ مهما قيل — حالته أصرحُ من أي حساب.
  const stored = N(project?.progress_pct);
  const derived = delivery.acceptedPct;
  const executive = project?.status === 'COMPLETED' ? 100
    : (derived != null ? derived : stored);

  return {
    projectId,
    evidence: progressEvidence(project || {}, delivery),
    executivePct: executive,
    executiveSource: project?.status === 'COMPLETED' ? 'status'
      : (derived != null ? 'deliverables' : (stored > 0 ? 'stored' : 'none')),
    // الرقم المسجَّل يُعاد كما هو بجانب المشتقّ: حين يختلفان اختلافاً بيّناً على مشروعٍ له
    // مخرجات، فذلك خبرٌ عن بياناتٍ مستوردة لم تُحدَّث — لا يُخفى بل يُقال لمن يقرأ.
    storedPct: stored > 0 ? stored : null,
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

/**
 * نسبة الإنجاز المعروضة لمجموعة مشاريع — **بالقاعدة نفسها في كل شاشة**.
 *
 * وُجدت لأن ستّ شاشات كانت تطبع `project.progress_pct` خاماً: صفحة العميل، ولوحة القيادة
 * (ثلاثة مواضع)، ومركز القطاع، وتقريرا الفترة والبريد. فمشروعٌ اعتُمدت مخرجاته الاثنا عشر كلها
 * يُقرأ **مئةً** في صفحته و**٥٨٪** في صفحة عميله — والرقمان على شاشتين تُقرآن في اجتماع واحد.
 *
 * وليست المشكلة أن إحداهما خطأ فحسب، بل أن **لا أحد يعرف أيّهما يصدّق** — وهذا أسوأ من رقمٍ
 * خاطئ معلوم. فالحساب هنا لا في الشاشات، والشاشة تعرض ما يصلها.
 *
 * @param {Array<{id:string,status?:string,progress_pct?:number}>} projects صفوف المشاريع كما قُرئت
 * @returns {Promise<Map<string,{pct:number,source:'status'|'deliverables'|'stored'}>>}
 */
export async function effectiveProgress(projects = [], { today = nowIso().slice(0, 10) } = {}) {
  const rows = (projects || []).filter((p) => p && p.id);
  const out = new Map();
  if (!rows.length) return out;
  const port = await portfolioProgress(rows.map((p) => p.id), { today });
  for (const p of rows) {
    const derived = port.get(p.id)?.delivery?.acceptedPct ?? null;
    out.set(p.id, p.status === 'COMPLETED' ? { pct: 100, source: 'status' }
      : derived != null ? { pct: derived, source: 'deliverables' }
        : { pct: Math.max(0, Math.min(100, Math.round(N(p.progress_pct)))), source: 'stored' });
  }
  return out;
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
