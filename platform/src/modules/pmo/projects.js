// PMO — Projects service. Scope-filtered, redacts sensitive financials (cost/margin).
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can, redact, redactList } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';
import { isDelivery, SUPPORT_KIND } from '../org/org.js';
import { staffingCandidates, projectTeamLoad } from './capacity.js';
import { effectiveProgress } from './progress.js';
import { ensureOpportunityForProject, syncMirrorFromProject } from '../crm/opp-project-sync.js';

export async function listProjects(user, filters = {}) {
  const f = scopeFilter(user, 'project', 'read', { ownerCol: 'owner_user_id' });
  const where = [f.clause, 'deleted_at IS NULL'];
  const params = [...f.params];
  if (filters.sector) { where.push('sector_id = ?'); params.push(filters.sector); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  // مرشّح السنة (اختياري): المشروع «يخص السنة» إذا تقاطعت مدته معها (بدأ فيها أو قبلها ولم
  // ينتهِ قبلها) أو سُجّل له إيراد فيها. بدون سنة = السلوك السابق كاملًا.
  // Portable on both drivers: year via substr(date,1,4) (no strftime/date()).
  const y = Number(filters.year);
  if (Number.isInteger(y) && y >= 2000 && y <= 2100) {
    where.push(`((start_date IS NOT NULL AND substr(start_date,1,4) <= ? AND (end_date IS NULL OR substr(end_date,1,4) >= ?))
      OR id IN (SELECT project_id FROM revenue_line WHERE year = ? AND project_id IS NOT NULL))`);
    params.push(String(y), String(y), y);
  }
  const rows = await all(`SELECT * FROM project WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`, params);
  return redactList(user, 'project', rows);
}

// «مشاريعي» — المشاريع التي يعمل عليها الشخص **نفسه** داخل قطاع بعينه (شاشة «قطاعي»).
// مصدران لا واحد، وهذا وصفٌ لما يسجّله المنتج فعلاً لا تساهلاً في الصلاحية:
//   • ما يصل إليه نطاقه (listProjects) — ملكيته للمشروع أو عضويته فيه؛
//   • وما **سُكِّن** عليه فعلاً (جدول التسكين) — وهو ما تكتبه شاشة التسكين حين يضع قائد القطاع
//     شخصاً على مشروع. محرّك الصلاحيات لا يقرأ التسكين اليوم: نطاق «مشروع» مبني على العضوية
//     والملكية وحدهما، ولا مسار في المنتج كله يكتب عضوية مشروع. فالاكتفاء بالنطاق يجعل شاشة
//     «قطاعي» فارغة أمام من يعمل على مشروع منذ شهور — عُطل لا حماية.
// حدّ الأمان محفوظ من طرفين: لا يُقرأ التسكين إلا لمن يملك منح قراءة المشاريع أصلاً، ولا يعود
// من الصف إلا ما هو تشغيلي (الاسم والحالة والإنجاز) — بلا عقد ولا ميزانية ولا كلفة ولا هامش.
const MY_PROJECT_STATUS_ORDER = ['IN_PROGRESS', 'PLANNED', 'NOT_STARTED', 'ON_HOLD', 'COMPLETED'];
export async function myProjectsInSector(user, sectorId) {
  if (!user || !sectorId || !can(user, 'read', 'project')) return [];
  const byId = new Map();
  const keep = (p) => {
    if (p && p.id && !byId.has(p.id)) {
      byId.set(p.id, { id: p.id, name_ar: p.name_ar, status: p.status, rag: p.rag, progress_pct: p.progress_pct || 0 });
    }
  };
  for (const p of await listProjects(user, { sector: sectorId })) keep(p);
  const employeeId = user.employee_id || user.employeeId || null;
  if (employeeId) {
    for (const p of await all(
      `SELECT p.id, p.name_ar, p.status, p.rag, p.progress_pct
         FROM allocation a JOIN project p ON p.id = a.project_id
        WHERE a.employee_id = ? AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND p.sector_id = ?`,
      [employeeId, sectorId])) keep(p);
  }
  const rank = (s) => { const i = MY_PROJECT_STATUS_ORDER.indexOf(s); return i < 0 ? MY_PROJECT_STATUS_ORDER.length : i; };
  return [...byId.values()]
    .filter((p) => p.status !== 'CANCELLED')
    .sort((a, b) => rank(a.status) - rank(b.status) || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'));
}

// «الخطوة التالية» للمحفظة: أقرب معلم قادم (PENDING) حسب تاريخ الاستحقاق لكل مشروع —
// استعلام مجمّع واحد للمحفظة كلها، لا استعلام لكل صف. المعالم غير المؤرّخة تُعامل كأبعد
// تاريخ ممكن فتظهر فقط عندما لا يوجد معلم قادم مؤرّخ. يعيد [{project_id, title, due_date}].
export async function nextMilestones(projectIds = []) {
  const ids = [...new Set(projectIds)].filter(Boolean);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = await all(
    `SELECT m.project_id, m.name_ar AS title, m.due_date
       FROM milestone m
       JOIN (SELECT project_id, MIN(COALESCE(due_date, '9999-12-31')) AS nd
               FROM milestone
              WHERE status = 'PENDING' AND deleted_at IS NULL AND project_id IN (${ph})
              GROUP BY project_id) nx
         ON nx.project_id = m.project_id AND COALESCE(m.due_date, '9999-12-31') = nx.nd
      WHERE m.status = 'PENDING' AND m.deleted_at IS NULL
      ORDER BY m.project_id, m.created_at`, ids);
  const out = []; const seen = new Set();
  for (const r of rows) { // معلمان بنفس التاريخ لنفس المشروع: الأقدم إنشاءً يمثّل الخطوة
    if (seen.has(r.project_id)) continue;
    seen.add(r.project_id);
    out.push({ project_id: r.project_id, title: r.title, due_date: r.due_date || null });
  }
  return out;
}

// ── تصنيف المشروع: «لمن يُنجَز هذا العمل؟» ────────────────────────────────────
// الخانة المخزَّنة لنوع المشروع لا يُعوَّل عليها في البيانات المنقولة: الترحيل كتب «داخلي» على
// 34 مشروعاً من 43، منها 31 **له عميل مسجَّل** و23 تحمل قيمة تعاقدية بعشرات الملايين، ولا مسار
// في المنتج كله يعدّل هذه الخانة بعد الإنشاء (قائمة التعديل المسموح بها لا تشملها). فقراءتها
// حرفياً تطبع «داخلي» فوق عقد عميل حقيقي — كذبة يقرأها المالك على الشاشة كل يوم.
// لذلك يُشتقّ التصنيف من **قرائن الصف نفسه** لا من الخانة: القرينة أحدث وأصعب في الوهم — العميل
// والقيمة التعاقدية وأمر الشراء والإيراد المحقق والفرصة المصدر كلها سجلات يكتبها المنتج اليوم،
// والخانة سطر متروك منذ النقل. وتُقرأ الخانة حين تقول شيئاً **موجباً** فقط: «لعميل» و«منتج»
// تصريحان من المصدر، أما «داخلي» فهي القيمة الافتراضية التي وقعت على كل ما لم يُصنَّف فلا تحمل
// معلومة أصلاً. لا تُكتب هنا خانة ولا يُصحَّح صف: تصحيح البيانات قرار مالك، والشاشة تعرض الصدق.
// الترتيب (الأعلى يفوز):
//   ١) عميل مسجَّل نوعه «داخلي» (الشركة نفسها) ⇐ تشغيل داخلي. وهذه هي الكذبة المعاكسة التي
//      تقع فيها قاعدة «له عميل ⇒ مشروع عميل» وحدها: أربعة مشاريع مربوطة بعميل اسمه «قطاع
//      الحلول — داخلي (رؤية الخبراء)» — أي الشركة على نفسها — بلا عقد ولا إيراد ولا فرصة.
//   ٢) عميل مسجَّل (حكومي/خاص/شبه حكومي) ⇐ مشروع عميل.
//   ٣) مسجَّل «منتج» ⇐ منتج.
//   ٤) بلا عميل لكن بقرينة تجارية (قيمة تعاقدية أو أمر شراء أو إيراد محقق أو فرصة مصدر أو
//      تصريح «لعميل») ⇐ مشروع عميل ينقصه ربط العميل — لا عملٌ داخلي. بلا هذا البند يُقلب
//      مشروع «إنشاء وتشغيل المنصة المكانية» (تصريحه «لعميل» وله إيراد محقق) إلى تشغيل داخلي.
//   ٥) وإلا ⇐ تشغيل داخلي. ولا كيان اسمه «مشاريع داخلية»: التسمية في المعجم وحده.
// `stale` تعني: المشتقّ يخالف المخزَّن. الشاشة تذكرها في تلميح الوسم بدل أن تُخفي التناقض، كي
// يعرف المالك أن البيانات نفسها تحتاج تصحيحاً ولا يظن الاشتقاق تجميلاً دائماً.
// أثر القاعدة على المحفظة الحيّة اليوم (43 مشروعاً): 36 «مشروع عميل» · 7 «تشغيل داخلي» · لا منتج
// بعد؛ منها 27 صفاً يخالف خانته المخزَّنة ويحمل 67.9 مليون ريال قيمة تعاقدية كانت تُقرأ «داخلي».
// دالة صرفة بلا استعلام: الشاشة تمرّر ما قرأته أصلاً (نوع العميل + الإيراد المحقق) فتتطابق كل
// الشاشات على تصنيف واحد للمشروع الواحد.
const INTERNAL_CLIENT_TYPE = 'داخلي'; // من CLIENT_TYPES في وحدة العملاء — العميل الذي هو الشركة
export function projectKind(project = {}, evidence = {}) {
  const p = project || {};
  const clientType = evidence.clientType == null ? '' : String(evidence.clientType).trim();
  const revenue = Number(evidence.revenueHalalas) || 0;
  const stored = String(p.kind || '').trim().toLowerCase();
  const storedKey = stored === 'external' ? 'client' : stored === 'product' ? 'product' : stored ? 'internal' : null;
  const out = (key, basis) => ({ key, basis, stale: storedKey != null && storedKey !== key });
  if (p.client_id && clientType === INTERNAL_CLIENT_TYPE) return out('internal', 'internal_client');
  if (p.client_id) return out('client', 'client');
  if (stored === 'product') return out('product', 'stated_product');
  if (Number(p.contract_value_halalas) > 0) return out('client', 'contract');
  if (Number(p.po_value_halalas) > 0) return out('client', 'purchase_order');
  if (revenue > 0) return out('client', 'revenue');
  if (p.source_opp_id) return out('client', 'opportunity');
  if (stored === 'external') return out('client', 'stated_external');
  return out('internal', 'none');
}

// الإيراد المحقق لكل مشروع — من **بنود الإيراد**، وهي المصدر الذي تُقرأ منه كل أرقام الإيراد في
// المنصة (لوحة القطاع، صفحة العميل، التقارير). خانة الإيراد على صف المشروع تُقرأ في ثلاث شاشات
// ولا يكتبها شيء في المنتج كله: رقم جامد من الترحيل لا يتحرّك مهما سُجِّل إيراد جديد — واستيراد
// الإيراد يكتب بنود الإيراد لا الخانة. فالرقم المعروض منها يشيخ بصمت، وهذا ما يعالجه هذا المصدر.
// استعلام مجمّع واحد للمحفظة كلها (لا استعلام لكل صف). `year` اختيارية: بلا سنة = كل ما سُجِّل
// للمشروع، ومعها = المحقق في تلك السنة وحدها. الجدول بلا حذف ناعم، فلا مرشّح حذف له.
export async function projectRevenue(projectIds = [], year = null) {
  const ids = [...new Set(projectIds)].filter(Boolean);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const params = [...ids];
  const y = Number(year);
  const yearClause = Number.isInteger(y) && y >= 2000 && y <= 2100 ? (params.push(y), ' AND year = ?') : '';
  const rows = await all(
    `SELECT project_id, COALESCE(SUM(amount_halalas),0) AS revenue_halalas
       FROM revenue_line WHERE project_id IN (${ph})${yearClause}
      GROUP BY project_id`, params);
  return rows.map((r) => ({ project_id: r.project_id, revenue_halalas: Number(r.revenue_halalas) || 0 }));
}

export async function getProject(user, pid) {
  const row = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [pid]);
  if (!row) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', row)) throw forbidden();
  // ── نسبة الإنجاز: تُحسب هنا كي لا يقرأ أحدٌ العمود المخزَّن ─────────────────
  // «لما أدخل تفاصيل الفرصة يجيني الإنجاز ١٠٠، لما أضغط التفاصيل يجيني ٥٨ — هذا غير مقبول».
  // وهو نفس العطل الذي أُصلح في ست شاشات: العمود `progress_pct` رقمٌ مستورد من المنصة القديمة
  // لا يتحرّك مهما اعتُمدت المخرجات. لكن **النافذة الجانبية تقرأ من هذا المسار لا من الشاشة**،
  // فبقيت على الرقم الجامد وحدها — والحارس البنيوي كان يمسح `web/views` و`core/reports` ولا
  // يمسح شيفرة المتصفّح، فأفلتت منه.
  //
  // والعلاج في المسار لا في النافذة: كل من ينادي هذه الخدمة — نافذةٌ اليوم وشاشةٌ غداً —
  // يأخذ الرقم محسوباً. وهذا هو معنى «مصدرٌ واحد للحقيقة» عملياً: لا يُترك الحساب لكل قارئ.
  const eff = await effectiveProgress([row]);
  const e = eff.get(row.id) || null;
  return { ...redact(user, 'project', row), progress_effective_pct: e ? e.pct : (row.progress_pct || 0) };
}

export async function createProject(ctx, data) {
  const user = ctx.user;
  const sectorId = data.sector_id || user.sector_id;
  if (!can(user, 'create', 'project', { sector_id: sectorId })) throw forbidden();
  if (!data.name_ar) throw badRequest('اسم المشروع مطلوب');
  const pid = id('prj'); const now = nowIso();
  // «لازم تتأكد أي مشروع مضاف في المشاريع ينضاف مكسوباً» — والمشروع وفرصته يُكتبان في معاملة
  // واحدة: مشروعٌ بلا فرصته يعيد الشاشتين إلى الافتراق من أول صفّ يُكتب بعد هذا السطر.
  await tx(async () => {
    await insert('project', {
      id: pid, code: data.code || null, name_ar: data.name_ar, sector_id: sectorId,
      client_id: data.client_id || null, owner_user_id: data.owner_user_id || user.id,
      status: data.status || 'IN_PROGRESS', rag: data.rag || 'GREEN', kind: data.kind || 'external',
      budget_halalas: toHalalas(data.budget_sar), contract_value_halalas: toHalalas(data.contract_value_sar),
      start_date: data.start_date || null, end_date: data.end_date || null,
      source_opp_id: data.source_opp_id || null, created_at: now, created_by: user.id,
    });
    await audit(ctx, { action: 'create', resource: 'project', resourceId: pid, sectorId });
    await ensureOpportunityForProject(ctx, await get('SELECT * FROM project WHERE id = ?', [pid]));
  });
  return await getProject(user, pid);
}

export async function updateProject(ctx, pid, data) {
  const user = ctx.user;
  const row = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [pid]);
  if (!row) throw notFound('المشروع غير موجود');
  if (!can(user, 'update', 'project', row)) throw forbidden();
  // Validate controlled enums so the Kanban PATCH (or any client) can't store arbitrary values.
  const STATUSES = ['NOT_STARTED', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
  const RAGS = ['GREEN', 'AMBER', 'RED'];
  if ('status' in data && !STATUSES.includes(data.status)) throw badRequest('حالة المشروع غير صحيحة');
  if ('rag' in data && !RAGS.includes(data.rag)) throw badRequest('حالة المشروع غير صحيحة — اخترها من القائمة');
  if ('progress_pct' in data) { const n = Number(data.progress_pct); if (!Number.isFinite(n) || n < 0 || n > 100) throw badRequest('نسبة الإنجاز يجب أن تكون بين 0 و100'); }
  const patch = {};
  // ── مدير المشروع ──
  // «المسؤولية على الأشخاص في التعديل والتسكين بدءاً من مدير المشروع» — ولم يكن في المنتج
  // **طريقٌ واحد** لتعيين مدير مشروع بعد إنشائه: العمود يُكتب مرة عند الإنشاء ثم لا يمسّه أحد.
  // والأثر أعمق من حقلٍ ناقص: نطاق «مشروع» في محرّك الصلاحيات يُبنى من `owner_user_id` نفسه
  // (core/http/context.js) — فمديرُ مشروعٍ لم يُسجَّل مالكاً لا يملك مشروعه أصلاً، ومنحُه
  // الكامل على مشاريعه يبقى بلا مشروعٍ واحد يسري عليه. أي أن الدور كان معطَّلاً عملياً.
  if ('owner_user_id' in data) {
    const uid = data.owner_user_id || null;
    if (uid) {
      const u = await get('SELECT id, active, deleted_at FROM app_user WHERE id = ?', [uid]);
      if (!u || u.deleted_at || !Number(u.active)) throw badRequest('الحساب المختار لإدارة المشروع غير موجود أو موقوف');
    }
    patch.owner_user_id = uid;
  }
  // ── إدارة المشروع ──
  // «عشان نهاية السنة نعرف كل إدارة كم دخّلت» — والنسبة إلى إدارةٍ خارج قطاع المشروع تكسر
  // الجمع من الطرفين: تُحسب في إدارةٍ لا تعمل فيه، وتغيب عن قطاعها.
  if ('department_id' in data) {
    const did = data.department_id || null;
    if (did) {
      const d = await get('SELECT id, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [did]);
      if (!d) throw badRequest('الإدارة المختارة غير موجودة');
      const sid = 'sector_id' in data ? data.sector_id : row.sector_id;
      if (sid && d.sector_id !== sid) throw badRequest('الإدارة المختارة تتبع قطاعاً آخر — اختر إدارة من قطاع المشروع نفسه');
    }
    patch.department_id = did;
  }
  if ('client_id' in data) {
    const cid = data.client_id || null;
    if (cid && !await get('SELECT id FROM client WHERE id = ? AND deleted_at IS NULL', [cid])) {
      throw badRequest('الجهة المختارة غير موجودة');
    }
    patch.client_id = cid;
  }
  // ── الاسم والرمز ومدّة المشروع ────────────────────────────────────────────
  // «لازم في طريقة لتعديل المشروع: قيمته أو مدّته أو أو أو». والاسم والتواريخ كانت تُقبل هنا
  // منذ البداية ولا يرسلها **موضعٌ واحد** في الواجهة — فالمشروع يُولَد باسمه وتاريخه الأولين
  // ويبقى عليهما مهما تغيّر الواقع. والرمز لم يكن يُقبل أصلاً، فيُفتح معهما بحدٍّ معقول.
  if ('code' in data) {
    const c = String(data.code ?? '').trim().slice(0, 60);
    patch.code = c || null;
  }
  if ('name_ar' in data && !String(data.name_ar ?? '').trim()) throw badRequest('اسم المشروع مطلوب');
  for (const k of ['name_ar', 'status', 'rag', 'progress_pct', 'start_date', 'end_date', 'pm_name']) {
    if (k in data) patch[k] = data[k];
  }
  // التواريخ ترسم المدّة، ومدّةٌ تنتهي قبل أن تبدأ تقلب كل حساب جدولٍ في الصفحة إلى رقمٍ سالب
  // يُقرأ «متأخر» بلا سبب. الحدّ هنا لا في الشاشة: الشاشة بابٌ من أبواب، والمسار يقبل من كلّها.
  const startAfter = 'start_date' in patch ? patch.start_date : row.start_date;
  const endAfter = 'end_date' in patch ? patch.end_date : row.end_date;
  if (startAfter && endAfter && String(endAfter) < String(startAfter)) {
    throw badRequest('تاريخ الانتهاء قبل تاريخ البدء — راجع التاريخين');
  }
  for (const [k, col] of [['budget_sar', 'budget_halalas'], ['contract_value_sar', 'contract_value_halalas'],
    ['po_value_sar', 'po_value_halalas']]) {
    if (k in data) {
      const n = Number(data[k]);
      if (!Number.isFinite(n) || n < 0) throw badRequest('القيمة تُكتب رقماً بالريال — أو صفراً إن لم تُتفق بعد');
      if (n > 1e10) throw badRequest('القيمة أكبر من المعقول — راجع الرقم قبل الحفظ');
      patch[col] = toHalalas(n);
    }
  }
  patch.updated_at = nowIso(); patch.updated_by = user.id;
  await tx(async () => {
    await update('project', pid, patch);
    await audit(ctx, { action: 'update', resource: 'project', resourceId: pid, sectorId: row.sector_id, detail: patch });
    // مرآةُ المشروع في الفرص تتبعه: تصحيحُ قيمةٍ هنا يبقى نصفَ تصحيح إن قرأ المالك الرقم القديم
    // في «الفرص» غداً. ولا تُمَسّ الفرصة التي وُلد منها المشروع — تلك سجلّ ما عُرِض على الجهة.
    await syncMirrorFromProject(ctx, await get('SELECT * FROM project WHERE id = ?', [pid]));
  });
  return await getProject(user, pid);
}

// ── Staffing (تسكين): assign/unassign employees to a project via the allocation model ──
export async function projectStaffing(user, projectId, opts = {}) {
  const p = await get('SELECT * FROM project WHERE id=? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', p)) throw forbidden();
  const assigned = await all(`SELECT a.id, a.employee_id, a.person_name_ar, a.type, e.job_title
     FROM allocation a LEFT JOIN employee e ON e.id=a.employee_id
     WHERE a.project_id=? AND a.deleted_at IS NULL ORDER BY a.created_at`, [projectId]);
  const assignedIds = new Set(assigned.map((a) => a.employee_id));
  // المتاحون للتسكين = موظفو قطاع المشروع + **موظفو وحدات المساندة** (الخدمات المشتركة، تطوير
  // الأعمال، المالية). وحدة المساندة ليست قطاع تسليم، وأشخاصها مورد مشترك للشركة كلها يُستعان
  // بهم على مشاريع أي قطاع — وهذا هو سبب وجودها أصلاً. بلا هذا السطر يبقى الثلاثة في «الخدمات
  // المشتركة» غير قابلين للاختيار على أي مشروع، فتُسجَّل تسكيناتهم الحقيقية خارج المنصة.
  const available = (await all(
    `SELECT e.id, e.name_ar, e.job_title FROM employee e
       LEFT JOIN sector s ON s.id = e.sector_id AND s.deleted_at IS NULL
      WHERE e.active = 1 AND e.deleted_at IS NULL AND (e.sector_id = ? OR s.kind = ?)
      ORDER BY e.name_ar`, [p.sector_id, SUPPORT_KIND]))
    .filter((e) => !assignedIds.has(e.id));
  // الضغطُ الحالي يُرفَق بالقائمتين: اختيارُ عضوٍ بلا رؤية حِمله قرارٌ بمعصوب العينين — ومنه
  // يقع التسكين فوق المئة صامتاً. والفشل هنا لا يُسقط الشاشة: التسكين يجب أن يعمل ولو تعذّرت
  // قراءة الضغط (لمن لا يملك قراءة الموظفين مثلاً)، فتعود القائمة بلا أرقام لا بخطأ.
  let load = null;
  try {
    const [cand, team] = await Promise.all([
      staffingCandidates(user, projectId, opts),
      projectTeamLoad(user, projectId, opts),
    ]);
    load = { candidates: cand.candidates, team: team.team, month: cand.month, monthLabel: cand.monthLabel,
      year: cand.year, overloaded: team.overloaded, fteNow: team.fteNow };
  } catch { load = null; }
  return { project: { id: p.id, name_ar: p.name_ar, sector_id: p.sector_id }, assigned, available, load,
    canStaff: can(user, 'update', 'project', p) };
}

// Build a {month: fraction} map from an allocation % and a month range (defaults: from the current
// month through year-end at 100%). Fraction is 0–1.5 (150% caps deliberate over-allocation input).
function monthlyPlan({ pct, fromMonth, toMonth }) {
  const frac = Math.max(0, Math.min(150, Number(pct) || 100)) / 100;
  const f = Math.max(1, Math.min(12, Number(fromMonth) || (new Date().getUTCMonth() + 1)));
  const t = Math.max(f, Math.min(12, Number(toMonth) || 12));
  const mj = {}; for (let m = f; m <= t; m++) mj[m] = frac;
  return mj;
}

// سنة التسكين: كانت تُؤخذ من ساعة الخادم دائماً، فيستحيل تسكين خطة السنة القادمة — يفتح
// المدير في نوفمبر خطة العام المقبل فتُكتب على العام الجاري صامتةً، ويقرأ الجميع أرقاماً
// في السنة الخطأ. والسنة تُقبل الآن من الطلب ضمن نافذة معقولة: سنة سابقة (تصحيح متأخر)
// وثلاث قادمة (تخطيط). وما وراء ذلك خطأ إدخال لا نيّة — والكتابة عليه إفسادٌ صامت.
export const ALLOC_YEAR_BACK = 1;
export const ALLOC_YEAR_AHEAD = 3;
export function resolveAllocationYear(raw, now = new Date()) {
  const current = now.getUTCFullYear();
  if (raw == null || raw === '') return current;
  const y = Number(String(raw).trim());
  if (!Number.isInteger(y)) throw badRequest('سنة التسكين يجب أن تكون سنة صحيحة مثل ' + current);
  if (y < current - ALLOC_YEAR_BACK || y > current + ALLOC_YEAR_AHEAD) {
    throw badRequest(`سنة التسكين خارج المدى المسموح — اختر بين ${current - ALLOC_YEAR_BACK} و${current + ALLOC_YEAR_AHEAD}`);
  }
  return y;
}

export async function assignEmployee(ctx, projectId, { employeeId, type, pct, fromMonth, toMonth, year }) {
  const user = ctx.user;
  const p = await get('SELECT * FROM project WHERE id=? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'update', 'project', p)) throw forbidden('تسكين الموظفين يتطلب صلاحية إدارة المشروع');
  const emp = await get('SELECT * FROM employee WHERE id=? AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw badRequest('الموظف غير موجود');
  // الحاجز بين القطاعات يبقى قائماً بين **قطاعات التسليم** وحدها: موظف الحلول لا يُسكَّن على
  // مشروع الاستشارات بلا نقله. أما موظف **وحدة مساندة** (خدمات مشتركة، تطوير أعمال، مالية) فهو
  // مورد مشترك على مستوى الشركة بحكم تعريف وحدته، ويُسكَّن على مشروع أي قطاع بلا نقل ولا استثناء
  // يدوي — وهذا هو الغرض المعلن من وحدات المساندة.
  if (emp.sector_id && p.sector_id && emp.sector_id !== p.sector_id) {
    const home = await get('SELECT id, name_ar, kind FROM sector WHERE id = ?', [emp.sector_id]);
    if (isDelivery(home)) throw badRequest('لا يمكن تسكين موظف من قطاع آخر على هذا المشروع');
  }
  const allocYear = resolveAllocationYear(year);
  // التكرار يُقاس **داخل السنة**: نفس الشخص على نفس المشروع في ٢٠٢٦ و٢٠٢٧ تسكينان صحيحان
  // لا تكرار، وبلا هذا الشرط يستحيل تخطيط السنة القادمة على مشروع قائم.
  if (await get('SELECT id FROM allocation WHERE project_id=? AND employee_id=? AND year=? AND deleted_at IS NULL',
    [projectId, employeeId, allocYear])) throw badRequest(`الموظف مُسكَّن على هذا المشروع في سنة ${allocYear} مسبقًا`);
  const aid = id('alloc'); const now = nowIso();
  await insert('allocation', { id: aid, employee_id: employeeId, person_name_ar: emp.name_ar, project_id: projectId,
    project_name: p.name_ar, sector_id: p.sector_id, type: type || 'member', year: allocYear,
    monthly_json: JSON.stringify(monthlyPlan({ pct, fromMonth, toMonth })), source: 'manual', created_at: now });
  await audit(ctx, { action: 'create', resource: 'allocation', resourceId: aid, sectorId: p.sector_id, detail: { project: projectId, employee: employeeId, pct: pct || 100, year: allocYear } });
  return await projectStaffing(user, projectId);
}

// Edit an existing allocation's load (%/month-range). Same permission as staffing the project.
// A body carrying `month` is a SINGLE-CELL edit (heat-grid inline editing) → setAllocationCell.
export async function setAllocation(ctx, allocationId, body = {}) {
  if (body.month != null) return setAllocationCell(ctx, allocationId, body.month, body.pct);
  const { pct, fromMonth, toMonth, type } = body;
  const user = ctx.user;
  const a = await get('SELECT * FROM allocation WHERE id=? AND deleted_at IS NULL', [allocationId]);
  if (!a) throw notFound('التسكين غير موجود');
  const p = await get('SELECT * FROM project WHERE id=?', [a.project_id]);
  if (!p || !can(user, 'update', 'project', p)) throw forbidden();
  // NOTE: allocation carries no updated_at column — patch only real columns.
  // الأشهر المحرَّرة يدوياً (تحرير الخلية الواحدة) تُحفظ: كان استبدال الخريطة كاملة يمحوها بصمت.
  // القاعدة: النطاق الجديد يحدد الأشهر المشمولة، وأي شهر داخل النطاق له قيمة يدوية سابقة تختلف
  // عن النسبة العامة يبقى كما هو؛ والأشهر خارج النطاق تُزال كما هو متوقع من تعديل النطاق.
  let prev = {}; try { prev = JSON.parse(a.monthly_json || '{}'); } catch { prev = {}; }
  const plan = monthlyPlan({ pct, fromMonth, toMonth });
  const planFrac = Object.values(plan)[0];
  const merged = {};
  for (const m of Object.keys(plan)) {
    const keptManual = prev[m] != null && Number(prev[m]) !== planFrac;
    merged[m] = keptManual ? prev[m] : plan[m];
  }
  const patch = { monthly_json: JSON.stringify(merged) };
  if (type) patch.type = type;
  await update('allocation', allocationId, patch);
  await audit(ctx, { action: 'update', resource: 'allocation', resourceId: allocationId, sectorId: a.sector_id, detail: { pct: pct || 100 } });
  return await projectStaffing(user, a.project_id);
}

// Single-month edit of an allocation's monthly_json (heat-grid cell editing). `pct` arrives as a
// PERCENTAGE (0–150) and is stored as a fraction clamped to 0–1.5; 0 clears the month.
// Permission = same as setAllocation (manage the project's staffing). Audited.
export async function setAllocationCell(ctx, allocationId, month, pct) {
  const user = ctx.user;
  const a = await get('SELECT * FROM allocation WHERE id=? AND deleted_at IS NULL', [allocationId]);
  if (!a) throw notFound('التسكين غير موجود');
  const p = await get('SELECT * FROM project WHERE id=?', [a.project_id]);
  if (!p || !can(user, 'update', 'project', p)) throw forbidden('تعديل التسكين يتطلب صلاحية إدارة المشروع');
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw badRequest('الشهر يجب أن يكون بين 1 و12');
  const n = Number(pct);
  if (!Number.isFinite(n)) throw badRequest('أدخل نسبة تسكين صحيحة (0–150)');
  const frac = Math.max(0, Math.min(150, n)) / 100; // clamp: fraction 0–1.5
  let mj = {}; try { mj = JSON.parse(a.monthly_json || '{}'); } catch { mj = {}; }
  if (frac > 0) mj[m] = frac; else delete mj[m];
  await update('allocation', allocationId, { monthly_json: JSON.stringify(mj) });
  await audit(ctx, { action: 'update', resource: 'allocation', resourceId: allocationId, sectorId: a.sector_id,
    detail: { month: m, pct: Math.round(frac * 100) } });
  return { id: allocationId, employee_id: a.employee_id, project_id: a.project_id, month: m,
    pct: Math.round(frac * 100), months: mj };
}

export async function unassignEmployee(ctx, allocationId) {
  const user = ctx.user;
  const a = await get('SELECT * FROM allocation WHERE id=? AND deleted_at IS NULL', [allocationId]);
  if (!a) throw notFound('التسكين غير موجود');
  const p = await get('SELECT * FROM project WHERE id=?', [a.project_id]);
  if (!p || !can(user, 'update', 'project', p)) throw forbidden();
  await update('allocation', allocationId, { deleted_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: 'allocation', resourceId: allocationId, sectorId: a.sector_id });
  return await projectStaffing(user, a.project_id);
}

// ── ملفات المشروع وتحديثاته ───────────────────────────────────────────────────
// جدول المستندات يحمل `project_id` منذ الموجة الثانية ولا يكتبه شيء في المنتج كله: كل مسار
// المستندات مبنيّ على العميل وحده. فوثيقةُ نطاق العمل ومحضرُ التسليم لا موضع لهما في المنصة،
// ويُتداولان خارجها. وهذان المساران يفتحان الخانة القائمة بلا جدول جديد ولا رفع ملفات:
// **بيانات وصفية ورابط** كما في مستندات العميل تماماً — الملف يبقى حيث هو، والمنصة تدلّ عليه.
const DOC_KINDS = ['contract', 'proposal', 'report', 'letter', 'other'];

export async function projectDocuments(user, projectId) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', { ...p, project_id: p.id })) throw forbidden('هذا المشروع خارج نطاق صلاحياتك');
  const documents = await all(`SELECT id, name, kind, url, note, uploaded_by, created_at
     FROM document WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [projectId]);
  return { projectId, documents, canEdit: can(user, 'update', 'project', { ...p, project_id: p.id }) };
}

export async function addProjectDocument(ctx, projectId, data = {}) {
  const user = ctx.user;
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'update', 'project', { ...p, project_id: p.id })) throw forbidden('إضافة مستند تتطلب صلاحية إدارة المشروع');
  const name = (data.name || '').toString().trim();
  if (!name) throw badRequest('اسم المستند مطلوب');
  const url = (data.url || '').toString().trim() || null;
  // نفس شرط مستندات العميل: الرابط الآمن وحده. الروابط بأنماط أخرى (javascript: مثلاً) تُعرض
  // في صفحة يفتحها كل الفريق، فالشرط حمايةٌ لا تشدّد.
  if (url && !/^https?:\/\//i.test(url)) throw badRequest('رابط المستند يجب أن يبدأ بـ https://');
  const kind = DOC_KINDS.includes(data.kind) ? data.kind : 'other';
  const did = id('doc');
  await insert('document', {
    id: did, project_id: projectId, client_id: p.client_id || null, name, kind, url,
    note: (data.note || '').toString().trim() || null,
    uploaded_by: user.name_ar || user.username || null, created_at: nowIso(),
  });
  await audit(ctx, { action: 'create', resource: 'document', resourceId: did, sectorId: p.sector_id,
    detail: { project_id: projectId, name, kind } });
  return await get('SELECT * FROM document WHERE id = ?', [did]);
}

export async function deleteProjectDocument(ctx, docId) {
  const user = ctx.user;
  const d = await get('SELECT * FROM document WHERE id = ? AND deleted_at IS NULL', [docId]);
  if (!d || !d.project_id) throw notFound('المستند غير موجود');
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [d.project_id]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'update', 'project', { ...p, project_id: p.id })) throw forbidden('حذف مستند يتطلب صلاحية إدارة المشروع');
  await update('document', docId, { deleted_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: 'document', resourceId: docId, sectorId: p.sector_id });
  return { ok: true };
}

// «آخر التحديثات» — سجلُّ التدقيق نفسه مقروءاً بلغة الناس، لا سجلٌّ ثانٍ يُكتب بجانبه.
// كل كتابة في المنصة تمرّ على `audit(ctx, …)` بوصفٍ عربي مقصود، فالمادة موجودة كاملة ولا
// يعوزها إلا أن تُقرأ. وسجلٌّ ثانٍ يُكتب يدوياً كان سيتباعد عن الأول من أول مسارٍ يُنسى.
// حدُّ ما يُعرض: أحداث هذا المشروع وسجلاته وحدها — والوصف نصٌّ عربي كتبته الخدمة، وما ليس
// كذلك (وصفٌ مُرمَّز أو غائب) يُترك فارغاً ولا يُطبع خاماً في وجه القارئ.
const UPDATE_ACTION_AR = { create: 'أُضيف', update: 'حُدِّث', delete: 'حُذف', login: 'دخول' };
const UPDATE_RESOURCE_AR = {
  project: 'المشروع', deliverable: 'مخرَج', milestone: 'معلم', project_phase: 'مرحلة',
  task: 'مهمة', allocation: 'تسكين', invoice: 'مستخلص', document: 'مستند',
  risk: 'خطر', issue: 'معوق', decision: 'قرار', change_request: 'طلب تغيير', contract: 'عقد',
};
export async function projectUpdates(user, projectId, limit = 20) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', { ...p, project_id: p.id })) throw forbidden('هذا المشروع خارج نطاق صلاحياتك');
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = await all(
    `SELECT a.id, a.at, a.action, a.resource, a.detail_json, COALESCE(u.name_ar, a.username) actor
       FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id
      WHERE a.resource_id = ?
         OR a.resource_id IN (SELECT id FROM deliverable    WHERE project_id = ?)
         OR a.resource_id IN (SELECT id FROM milestone      WHERE project_id = ?)
         OR a.resource_id IN (SELECT id FROM project_phase  WHERE project_id = ?)
         OR a.resource_id IN (SELECT id FROM task           WHERE project_id = ?)
         OR a.resource_id IN (SELECT id FROM allocation     WHERE project_id = ?)
         OR a.resource_id IN (SELECT id FROM document       WHERE project_id = ?)
      ORDER BY a.at DESC LIMIT ?`,
    [projectId, projectId, projectId, projectId, projectId, projectId, projectId, n]);
  return rows.map((r) => ({
    id: r.id, at: r.at, actor: r.actor || null,
    action: UPDATE_ACTION_AR[r.action] || '',
    resource: UPDATE_RESOURCE_AR[r.resource] || '',
    detail: readableDetail(r.detail_json),
  }));
}

// الوصف مخزَّن مُرمَّزاً دائماً (`JSON.stringify` في كاتب التدقيق)، فالنصّ العربي يصل بين
// علامتَي اقتباس والبنيةُ تصل قوساً. يُعرض النصّ وحده: البنية قائمةُ أعمدة كُتبت للمطوّر لا
// جملةٌ لقارئ، وطبعُها خاماً يضع قوساً ومصطلحاً إنجليزياً في وجه المستخدم.
function readableDetail(raw) {
  if (raw == null || raw === '') return '';
  let v; try { v = JSON.parse(raw); } catch { return ''; }
  return typeof v === 'string' && /[؀-ۿ]/.test(v) ? v.trim() : '';
}
