// ── مصروفات المشروع ──────────────────────────────────────────────────────────────────────────
// جدول `expense` كان شبه معطَّل: لا مسار في المنتج كله يكتب فيه صفاً، فصفحة المشروع لا تعرف
// «كم صُرف على هذا المشروع» ولا تستطيع تسجيل مصروف واحد. هذه الوحدة تفتح المسار كاملاً — قراءة
// وتسجيل وتعديل وحذف ناعم — بالقواعد نفسها المعمول بها في المنصة:
//   • حارسان لا واحد: (١) صف المشروع يجب أن يكون داخل نطاق القارئ، و(٢) منح `expense` نفسه على
//     الصف. الأول يمنع الوصول إلى مشروع قطاعٍ آخر بمعرّفه، والثاني يمنع من لا شأن له بالمال من
//     الكتابة فيه. نفس فكرة `readableProject`/`requireWrite` في وحدة الحوكمة (pmo/governance.js)،
//     مكتوبة هنا لأنها غير مُصدَّرة هناك — لا مسار صلاحيات ثانٍ ولا قاعدة مختلفة.
//   • المبلغ حقل حسّاس (`cost` في مصفوفة الحقول الحساسة): يُحجب عن غير أهله عبر `redact` نفسه
//     الذي تستعمله بقية المنصة، لا بشرط محلّي جديد.
//   • كل كتابة داخل معاملة واحدة مع سجل التدقيق.
//
// ما لا تفعله هذه الوحدة عمداً: لا تخترع عمود وصف ولا فئة مصروف ولا دورة تكرار. الجدول يحمل
// حقلاً وصفياً واحداً (`type`) وشهراً وسنة، فهذا كل ما يُسجَّل. توسيع الجدول قرار هجرة مستقلة.
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can, redactList } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';
import { splitGross } from './vat.js';

// حالات المصروف كما في تعريف الجدول، ومعناها العربي (الشاشة لا تطبع القيمة المخزَّنة أبداً).
export const EXPENSE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'];
export const EXPENSE_STATUS_AR = {
  DRAFT: 'مسودة', SUBMITTED: 'مرفوع للاعتماد', APPROVED: 'معتمد', REJECTED: 'مرفوض', PAID: 'مدفوع',
};
// ما يبقى قابلاً للتسجيل والتعديل مباشرة، وما يحتاج صلاحية اعتماد للدخول إليه أو الخروج منه.
export const OPEN_STATUSES = ['DRAFT', 'SUBMITTED'];
export const SETTLED_STATUSES = ['APPROVED', 'REJECTED', 'PAID'];

// صف المشروع لا يحمل عمود `project_id`، فيمرّ نطاق «مشروع» عليه فارغاً. تمريره صراحةً يجعل
// العضوية هي الفاصل لمن نطاقه مشروع (مدير مشروع/استشاري) بلا مساس بنطاقَي القطاع والشركة.
export const projectTarget = (p) => ({ ...p, project_id: p.id });

export async function readableProject(user, projectId) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', projectTarget(p))) throw forbidden('هذا المشروع خارج نطاق صلاحياتك');
  return p;
}

// هدف فحص الصلاحية على المصروف: قطاعه ومشروعه ومن طلبه — الأعمدة الثلاثة التي تقرؤها نطاقات
// «القطاع» و«المشروع» و«خاصتي». عند الإنشاء لا صف بعد، فالقطاع والمشروع من المشروع نفسه.
const expenseTarget = (p, row = null) => ({
  sector_id: row?.sector_id ?? p.sector_id, project_id: p.id, requested_by: row?.requested_by ?? null,
});

export const canReadExpenses = (user, p) => can(user, 'read', 'expense', expenseTarget(p));
export const canAddExpense = (user, p) => can(user, 'create', 'expense', expenseTarget(p));
export const canEditExpense = (user, p, row = null) => can(user, 'update', 'expense', expenseTarget(p, row));
export const canApproveExpense = (user, p, row = null) => can(user, 'approve', 'expense', expenseTarget(p, row));

// ── تحقق المدخلات ────────────────────────────────────────────────────────────────────────────
function cleanType(v) {
  const t = String(v ?? '').trim();
  if (!t) throw badRequest('اكتب وصف المصروف (مثل: سفر، طباعة، اشتراك شهري)');
  if (t.length > 120) throw badRequest('وصف المصروف طويل — اجعله في 120 حرفاً أو أقل');
  return t;
}
function cleanAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest('أدخل مبلغ المصروف بالريال — رقماً أكبر من صفر');
  const halalas = toHalalas(n);
  if (!(halalas > 0)) throw badRequest('أدخل مبلغ المصروف بالريال — رقماً أكبر من صفر');
  if (halalas > 100_000_000_000) throw badRequest('المبلغ أكبر من المعقول — راجع الرقم قبل الحفظ');
  return halalas;
}
// الشهر والسنة مطلوبان: مصروف بلا شهر لا يمكن وضعه على الصورة الشهرية، ووضعُه في شهر مفترض
// تلفيقٌ لا تسجيل. السؤال يُطرح على من يسجّل لأنه يعرف الإجابة.
function cleanMonth(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 12) throw badRequest('حدّد شهر الصرف — رقم الشهر من 1 إلى 12');
  return n;
}
function cleanYear(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) throw badRequest('حدّد سنة الصرف — أربعة أرقام مثل 2026');
  return n;
}

// ── ضريبة القيمة المضافة على المصروف: تُسجَّل ولا تُفترض ────────────────────────────────────
// المبلغ المُدخَل **إجمالي** كما خرج من الحساب. أما كم منه ضريبةٌ مستردّة فلا يعرفه إلا من بيده
// فاتورة المورّد، ولذلك يُسأل عنه ولا يُشتقّ: جدول المصروفات يخلط مستردّات الموظفين والرسوم
// الحكومية المعفاة بالمشتريات الخاضعة في حقلٍ وصفيٍّ حرٍّ واحد (تبرير الترحيلة ٠١٩)، فافتراض
// خمسة عشر بالمئة عليه يخترع ضريبةً مستردّة على صفوفٍ لم تحملها فينقص الكلفة ويرفع الهامش كذباً.
// ثلاثة مدخلات مقبولة، وأيّها غاب فالضريبة تبقى غير مسجَّلة (لا صفراً):
//   • `vat_sar` مبلغاً صريحاً — أدقّها، وهو ما يُقرأ من فاتورة المورّد.
//   • `vat_included: true` — المبلغ يشمل ضريبةً بالنسبة القياسية، فتُفصل بالقاعدة الواحدة.
//   • `vat_exempt: true` — المصروف لا يحمل ضريبة (راتب، رسم حكومي، مستردّ موظف): صافيه كامله
//     وضريبته صفر. وهذا صفرٌ **مقيس** لا غياب، والفرق بينه وبين الفراغ خبرٌ محاسبي حقيقي.
function cleanVat(data, grossHalalas) {
  const has = (k) => k in data && data[k] != null && data[k] !== '';
  if (has('vat_sar') || has('vatSar')) {
    const n = Number(data.vat_sar ?? data.vatSar);
    if (!Number.isFinite(n) || n < 0) throw badRequest('أدخل مبلغ الضريبة بالريال — رقماً لا يقل عن صفر');
    const vat = toHalalas(n);
    if (vat > grossHalalas) throw badRequest('مبلغ الضريبة أكبر من مبلغ المصروف نفسه — راجع الرقمين');
    return { net_amount_halalas: grossHalalas - vat, vat_halalas: vat };
  }
  if (data.vat_exempt === true || data.vat_exempt === 'true' || data.vat_exempt === 1) {
    return { net_amount_halalas: grossHalalas, vat_halalas: 0 };
  }
  if (data.vat_included === true || data.vat_included === 'true' || data.vat_included === 1) {
    const s = splitGross(grossHalalas);
    return { net_amount_halalas: s.net_halalas, vat_halalas: s.vat_halalas };
  }
  return null; // غير مُسجَّلة — تُترك فارغة، وتقرؤها الشاشة «غير مُسجَّل»
}

// ── التقديم للشاشة ───────────────────────────────────────────────────────────────────────────
// المبلغ يمرّ عبر `redact` المركزي: من لا يملك قراءة الكلفة يصله الصف بلا مبلغ وعليه وسم الحجب،
// فتقول الشاشة «الكلفة مقيّدة» بدل أن تعرض فراغاً يُقرأ صفراً.
export function presentExpenses(user, rows) {
  return redactList(user, 'expense', rows).map((r) => ({
    id: r.id, project_id: r.project_id, sector_id: r.sector_id,
    type: r.type || null,
    amount_halalas: r.amount_halalas ?? null,
    // الصافي والضريبة يتبعان المبلغ في الحجب (كلاهما كلفة)، والفراغ يعني «غير مُسجَّل» لا صفراً.
    net_amount_halalas: r._redacted_amount_halalas ? null : (r.net_amount_halalas ?? null),
    vat_halalas: r._redacted_amount_halalas ? null : (r.vat_halalas ?? null),
    vat_recorded: r._redacted_amount_halalas ? null : r.net_amount_halalas != null,
    amount_restricted: !!r._redacted_amount_halalas,
    month: r.incurred_month ?? null, year: r.incurred_year ?? null,
    status: r.status || 'DRAFT', status_ar: EXPENSE_STATUS_AR[r.status] || EXPENSE_STATUS_AR.DRAFT,
    requested_by: r.requested_by || null, requested_by_name: r.requested_by_name || null,
    created_at: r.created_at || null,
  }));
}

const SELECT_ROWS = `SELECT e.id, e.project_id, e.sector_id, e.type, e.amount_halalas,
        e.net_amount_halalas, e.vat_halalas, e.incurred_month,
        e.incurred_year, e.status, e.requested_by, e.created_at,
        COALESCE(u.name_ar, u.username) AS requested_by_name
   FROM expense e LEFT JOIN app_user u ON u.id = e.requested_by`;

// صفوف المصروفات لمشروع واحد — استعلام واحد، وترتيب يضع الأحدث أولاً وما بلا تاريخ آخراً.
export async function expenseRowsFor(projectId) {
  return await all(`${SELECT_ROWS}
   WHERE e.project_id = ? AND e.deleted_at IS NULL
   ORDER BY (e.incurred_year IS NULL), e.incurred_year DESC, (e.incurred_month IS NULL),
            e.incurred_month DESC, e.created_at DESC
   LIMIT 200`, [projectId]);
}

async function onePresented(user, expenseId) {
  const row = await get(`${SELECT_ROWS} WHERE e.id = ?`, [expenseId]);
  return presentExpenses(user, [row])[0];
}

// ── القراءة ──────────────────────────────────────────────────────────────────────────────────
export async function listProjectExpenses(user, projectId) {
  const p = await readableProject(user, projectId);
  if (!canReadExpenses(user, p)) throw forbidden('عرض مصروفات المشروع يتطلب صلاحية على المصروفات — اطلبها من مدير النظام إن كان عملك يحتاجها');
  return presentExpenses(user, await expenseRowsFor(projectId));
}

// ── التسجيل ──────────────────────────────────────────────────────────────────────────────────
export async function createExpense(ctx, projectId, data = {}) {
  const user = ctx.user;
  const p = await readableProject(user, projectId);
  if (!canAddExpense(user, p)) throw forbidden('تسجيل مصروف على هذا المشروع يتطلب صلاحية المالية أو قيادة القطاع');
  const type = cleanType(data.type ?? data.label);
  const amount = cleanAmount(data.amount_sar ?? data.amountSar);
  const month = cleanMonth(data.month ?? data.incurred_month);
  const year = cleanYear(data.year ?? data.incurred_year);
  const status = String(data.status || 'DRAFT').toUpperCase();
  if (!EXPENSE_STATUSES.includes(status)) throw badRequest('حالة المصروف غير معروفة — اخترها من القائمة');
  if (!OPEN_STATUSES.includes(status)) {
    throw badRequest('المصروف يُسجَّل مسودةً أو يُرفع للاعتماد. اعتماده أو تسجيل صرفه يتم بعد ذلك ممّن يملك صلاحية الاعتماد.');
  }
  const vat = cleanVat(data, amount);
  const eid = id('exp'); const now = nowIso();
  await tx(async () => {
    await insert('expense', {
      id: eid, project_id: p.id, sector_id: p.sector_id, type, amount_halalas: amount,
      ...(vat || {}),
      incurred_month: month, incurred_year: year, requested_by: user.id, status, created_at: now,
    });
    await audit(ctx, { action: 'create', resource: 'expense', resourceId: eid, sectorId: p.sector_id,
      detail: { project: p.id, type, amount_halalas: amount, ...(vat || {}), month, year, status } });
  });
  return await onePresented(user, eid);
}

// ── التعديل ──────────────────────────────────────────────────────────────────────────────────
// قاعدتان تحكمان التعديل:
//   • تغيير الحالة إلى (أو من) حالة محسومة — معتمد/مرفوض/مدفوع — فعل اعتماد، فيحتاج منح الاعتماد.
//   • بيانات المصروف المحسوم لا تُعدَّل: تغيير مبلغ مصروف معتمد بعد اعتماده يمحو ما اعتُمد عليه.
export async function updateExpense(ctx, expenseId, data = {}) {
  const user = ctx.user;
  const row = await get('SELECT * FROM expense WHERE id = ? AND deleted_at IS NULL', [expenseId]);
  if (!row) throw notFound('المصروف غير موجود');
  if (!row.project_id) throw badRequest('هذا المصروف غير مرتبط بمشروع، فلا يُعدَّل من صفحة المشروع');
  const p = await readableProject(user, row.project_id);
  if (!canEditExpense(user, p, row)) throw forbidden('تعديل المصروف يتطلب صلاحية المالية أو قيادة القطاع');

  const patch = {};
  const touchesFigures = ['type', 'label', 'amount_sar', 'amountSar', 'month', 'incurred_month', 'year', 'incurred_year',
    'vat_sar', 'vatSar', 'vat_included', 'vat_exempt']
    .some((k) => k in data);
  if (touchesFigures && SETTLED_STATUSES.includes(String(row.status).toUpperCase())) {
    throw badRequest('بيانات المصروف بعد حسمه لا تُعدَّل. من يملك صلاحية الاعتماد يعيده مسودةً أولاً ثم يُعدَّل.');
  }
  if ('type' in data || 'label' in data) patch.type = cleanType(data.type ?? data.label);
  if ('amount_sar' in data || 'amountSar' in data) patch.amount_halalas = cleanAmount(data.amount_sar ?? data.amountSar);
  // الضريبة تتبع المبلغ ولا تتخلّف عنه: كل صافٍ مسجَّل يخصّ المبلغ الذي سُجِّل معه. فإن تغيّر
  // المبلغ ولم يُعَد ذكرُ الضريبة في الطلب نفسه، تعود الضريبة «غير مسجَّلة» بدل أن يبقى صافٍ
  // قديم بجانب مبلغ جديد فلا يُساوي جمعُهما شيئاً. وإسقاطها إلى الفراغ يُقال في الشاشة، بخلاف
  // إبقائها كذبةً صامتة.
  const gross = patch.amount_halalas ?? row.amount_halalas;
  const vat = cleanVat(data, gross);
  if (vat) Object.assign(patch, vat);
  else if (patch.amount_halalas != null && row.net_amount_halalas != null) {
    patch.net_amount_halalas = null; patch.vat_halalas = null;
  }
  if ('month' in data || 'incurred_month' in data) patch.incurred_month = cleanMonth(data.month ?? data.incurred_month);
  if ('year' in data || 'incurred_year' in data) patch.incurred_year = cleanYear(data.year ?? data.incurred_year);
  if ('status' in data) {
    const next = String(data.status).toUpperCase();
    if (!EXPENSE_STATUSES.includes(next)) throw badRequest('حالة المصروف غير معروفة — اخترها من القائمة');
    if (next !== String(row.status).toUpperCase()) {
      const isApprovalMove = SETTLED_STATUSES.includes(next) || SETTLED_STATUSES.includes(String(row.status).toUpperCase());
      if (isApprovalMove && !canApproveExpense(user, p, row)) {
        throw forbidden('اعتماد المصروف أو تسجيل صرفه أو إعادته مسودةً يتطلب صلاحية الاعتماد');
      }
      patch.status = next;
    }
  }
  if (!Object.keys(patch).length) throw badRequest('لا تغييرات لتطبيقها');
  await tx(async () => {
    await update('expense', expenseId, patch);
    await audit(ctx, { action: 'update', resource: 'expense', resourceId: expenseId, sectorId: row.sector_id || p.sector_id,
      detail: patch });
  });
  return await onePresented(user, expenseId);
}

// ── الحذف الناعم ─────────────────────────────────────────────────────────────────────────────
export async function deleteExpense(ctx, expenseId) {
  const user = ctx.user;
  const row = await get('SELECT * FROM expense WHERE id = ? AND deleted_at IS NULL', [expenseId]);
  if (!row) throw notFound('المصروف غير موجود');
  if (!row.project_id) throw badRequest('هذا المصروف غير مرتبط بمشروع، فلا يُحذف من صفحة المشروع');
  const p = await readableProject(user, row.project_id);
  if (!canEditExpense(user, p, row)) throw forbidden('حذف المصروف يتطلب صلاحية المالية أو قيادة القطاع');
  const status = String(row.status).toUpperCase();
  if (status === 'APPROVED' || status === 'PAID') {
    throw badRequest('المصروف بعد اعتماده أو صرفه لا يُحذف — أثره المالي مسجَّل. من يملك صلاحية الاعتماد يستطيع رفضه.');
  }
  await tx(async () => {
    await update('expense', expenseId, { deleted_at: nowIso() });
    await audit(ctx, { action: 'delete', resource: 'expense', resourceId: expenseId,
      sectorId: row.sector_id || p.sector_id, detail: { project: row.project_id } });
  });
  return { ok: true, id: expenseId };
}
